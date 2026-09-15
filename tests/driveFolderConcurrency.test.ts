import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, test } from "node:test";
import { resolveVendorFolder, vendorFolderIdentity, type VendorFolderSpec } from "../app/api/drive/_vendorFolders";
import type { FolderRegistry, FolderIdentity } from "../app/api/drive/_folderRegistry";
import { mockDrive, mockFolder } from "./fixtures/driveFolders";

// Explicit opt-in, local throwaway database only. No live Supabase or Drive.
const url = process.env.OAR_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) || parsed.pathname !== "/oar_folder_registry_test") throw new Error("Tests require the isolated local oar_folder_registry_test database");
}
const spec: VendorFolderSpec = { workspaceId: "oneaddress-riviera", contactId: "contact-test", parentId: "vendor-root", sharedDriveId: "shared-test", kind: "vendor-root", name: "Prestataire fictif" };

describe("coordination distribuée sur PostgreSQL réel, Drive simulé", { skip: !url }, () => {
  let pool: any;
  before(async () => {
    const { Pool } = require("pg"); // Test-only runtime, installed outside the repository.
    pool = new Pool({ connectionString: url, max: 25 });
    await pool.query(`do $$ begin
      if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    end $$;`);
    // Test-only simulation of PostgREST's verified JWT subject; never installed remotely.
    await pool.query(`create schema auth;
      create function auth.uid() returns uuid language sql stable as
        'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
      grant usage on schema auth to anon, authenticated;
      create table public.crm_workspace_state (payload jsonb not null);
      insert into public.crm_workspace_state values ('{"fixture":"unchanged"}');`);
    await pool.query(readFileSync("supabase/migrations/20260914210807_drive_folder_registry.sql", "utf8"));
  });
  after(async () => { await pool?.end(); });
  beforeEach(async () => { await pool.query("truncate public.crm_drive_folder_registry"); });
  function registry(): FolderRegistry {
    const call = async (name: string, values: unknown[]) => {
      const client = await pool.connect();
      try {
        await client.query("set role authenticated");
        await client.query("select set_config('request.jwt.claim.sub', $1, false)", ["11111111-1111-4111-8111-111111111111"]);
        return (await client.query(`select public.${name}(${values.map((_, i) => `$${i+1}`).join(",")}) as result`, values)).rows[0].result;
      } finally { await client.query("reset role; reset request.jwt.claim.sub"); client.release(); }
    };
    const args = (i: FolderIdentity, token: string) => [i.workspaceId, i.logicalKey, token];
    return {
      claim: (i,t) => call("crm_drive_folder_claim", [i.workspaceId,i.logicalKey,i.parentId,t]),
      reserve: (i,t,id) => call("crm_drive_folder_reserve", [...args(i,t),id]),
      ready: (i,t,id) => call("crm_drive_folder_ready", [...args(i,t),id])
    };
  }
  const expire = () => pool.query("update public.crm_drive_folder_registry set lease_expires_at = clock_timestamp() - interval '1 second' where status='creating'");

  for (const kind of ["vendor-root", "rib"] as const) {
    test(`20 connexions concurrentes ${kind} : un créateur et un seul ID`, async () => {
      const drive = mockDrive();
      const ids = await Promise.all(Array.from({length:20}, () => resolveVendorFolder({ ...spec, kind }, { registry: registry(), fetchDrive: drive.fetchDrive })));
      assert.equal(new Set(ids).size, 1); assert.equal(drive.state.generated, 1); assert.equal(drive.files.size, 1); assert.equal(drive.creates.length, 1);
      assert.equal((await pool.query("select status from public.crm_drive_folder_registry")).rows[0].status, "ready");
    });
  }
  test("20 uploads indépendants : même hiérarchie prestataire puis RIB", async () => {
    const drive = mockDrive();
    const ids = await Promise.all(Array.from({length:20}, async () => {
      const clientRegistry = registry();
      const parentId = await resolveVendorFolder(spec, { registry: clientRegistry, fetchDrive: drive.fetchDrive });
      return resolveVendorFolder({ ...spec, parentId, kind:"rib", name:"RIB" }, { registry: clientRegistry, fetchDrive: drive.fetchDrive });
    }));
    assert.equal(new Set(ids).size, 1); assert.equal(drive.files.size, 2); assert.equal(drive.state.generated, 2); assert.equal(drive.creates.length, 2);
    assert.equal(drive.files.get(ids[0])?.parents[0], "reserved-1");
  });
  test("identités avec séparateurs ne peuvent pas entrer en collision", () => {
    assert.notEqual(vendorFolderIdentity({ ...spec, contactId:"a:rib" }).logicalKey, vendorFolderIdentity({ ...spec, contactId:"a", kind:"rib" }).logicalKey);
  });
  test("deux prestataires et renommage : identités stables", async () => {
    const drive = mockDrive();
    const first = await resolveVendorFolder(spec, { registry: registry(), fetchDrive: drive.fetchDrive });
    const other = await resolveVendorFolder({ ...spec, contactId: "second" }, { registry: registry(), fetchDrive: drive.fetchDrive });
    const renamed = await resolveVendorFolder({ ...spec, name: "Nom modifié" }, { registry: registry(), fetchDrive: drive.fetchDrive });
    assert.notEqual(first, other); assert.equal(first, renamed); assert.equal(drive.files.size, 2);
  });
  test("timeout après création : GET confirme le même ID", async () => {
    const drive = mockDrive(); drive.state.timeoutAfterCreate = 1;
    const id = await resolveVendorFolder(spec, { registry: registry(), fetchDrive: drive.fetchDrive });
    assert.equal(id, "reserved-1"); assert.equal(drive.state.generated, 1); assert.equal(drive.files.size, 1);
  });
  test("timeout et GET temporairement absent : retry 409 avec le même ID", async () => {
    const drive = mockDrive(); drive.state.timeoutAfterCreate = 1; drive.state.hiddenGets = 1;
    assert.equal(await resolveVendorFolder(spec, { registry: registry(), fetchDrive: drive.fetchDrive }), "reserved-1");
    assert.deepEqual(drive.creates, ["reserved-1", "reserved-1"]); assert.equal(drive.state.conflicts, 1); assert.equal(drive.files.size, 1);
  });
  test("crash après Drive avant ready : reprise sans nouvelle création", async () => {
    const drive = mockDrive(); const first = registry();
    await assert.rejects(() => resolveVendorFolder(spec, { registry: { ...first, ready: async () => { throw new Error("Simulated crash"); } }, fetchDrive: drive.fetchDrive }));
    assert.equal(drive.files.size, 1); await expire();
    assert.equal(await resolveVendorFolder(spec, { registry: registry(), fetchDrive: drive.fetchDrive }), "reserved-1");
    assert.equal(drive.creates.length, 1); assert.equal(drive.state.generated, 1);
  });
  test("crash après réservation avant Drive et réponse RPC perdue : ID durable réutilisé", async () => {
    const drive = mockDrive(); const first = registry();
    await assert.rejects(() => resolveVendorFolder(spec, { registry: { ...first, reserve: async (...args) => { await first.reserve(...args); throw new Error("Lost reserve response"); } }, fetchDrive: drive.fetchDrive }));
    assert.equal(drive.files.size, 0); assert.equal(drive.state.generated, 1); await expire();
    assert.equal(await resolveVendorFolder(spec, { registry: registry(), fetchDrive: drive.fetchDrive }), "reserved-1"); assert.equal(drive.state.generated, 1);
  });
  test("bail actif : le second worker ne crée et ne génère rien", async () => {
    const drive = mockDrive(); await registry().claim(vendorFolderIdentity(spec), randomUUID());
    await assert.rejects(() => resolveVendorFolder(spec, { registry: registry(), fetchDrive: drive.fetchDrive, maxWaitMs: 20, sleep: async () => new Promise(r => setTimeout(r,5)) }), (e:any) => e.status === 503);
    assert.equal(drive.state.generated, 0); assert.equal(drive.creates.length, 0);
  });
  test("lease expirée : un seul takeover parmi 20, ancien token rejeté", async () => {
    const i = vendorFolderIdentity(spec); const old = randomUUID(); const r = registry();
    await r.claim(i,old); await r.reserve(i,old,"reserved-before-crash"); await expire();
    const claims = await Promise.all(Array.from({length:20}, () => registry().claim(i, randomUUID())));
    assert.equal(claims.filter(c => c.claimed).length, 1); assert.ok(claims.every(c => c.drive_folder_id === "reserved-before-crash"));
    assert.equal(await r.reserve(i,old,"wrong-id"), null); assert.equal(await r.ready(i,old,"reserved-before-crash"), false);
  });
  test("ancien créateur reprend après takeover : même ID, 409, aucun doublon", async () => {
    const drive = mockDrive(); let entered!: () => void; let release!: () => void;
    const reached = new Promise<void>(r => { entered = r; }); const pause = new Promise<void>(r => { release = r; });
    const stale = resolveVendorFolder(spec, { registry: registry(), fetchDrive: async (input, init) => {
      if (init?.method === "POST") { entered(); await pause; } return drive.fetchDrive(input,init);
    } });
    await reached; await expire();
    const winner = await resolveVendorFolder(spec, { registry: registry(), fetchDrive: drive.fetchDrive }); release();
    assert.equal(await stale, winner); assert.equal(drive.state.generated, 1); assert.equal(drive.files.size, 1); assert.equal(drive.state.conflicts, 1);
  });
  test("réponse ready perdue : retry HTTP lit ready sans recréer", async () => {
    const drive = mockDrive(); const r = registry();
    await assert.rejects(() => resolveVendorFolder(spec, { registry: { ...r, ready: async (...args) => { await r.ready(...args); throw new Error("Lost ready response"); } }, fetchDrive: drive.fetchDrive }));
    assert.equal(await resolveVendorFolder(spec, { registry: registry(), fetchDrive: drive.fetchDrive }), "reserved-1"); assert.equal(drive.creates.length, 1);
  });
  test("appProperties : récupération et réservation d’un dossier préexistant", async () => {
    const drive = mockDrive(); drive.files.set("recovered", mockFolder(spec,"recovered"));
    assert.equal(await resolveVendorFolder(spec, { registry: registry(), fetchDrive: drive.fetchDrive }), "recovered");
    assert.equal(drive.state.generated, 0); assert.equal(drive.creates.length, 0);
  });
  for (const [label, patch] of [
    ["mauvais parent", { parents:["outside"] }], ["hors Shared Drive", { driveId:"outside" }],
    ["MIME incorrect", { mimeType:"text/plain" }], ["supprimé", { trashed:true }], ["appProperties incorrectes", { appProperties:{} }]
  ] as const) {
    test(`récupération ${label} : refus explicite`, async () => {
      const drive = mockDrive(); drive.state.searchOverride = [{ ...mockFolder(spec,"bad"), ...patch } as ReturnType<typeof mockFolder>];
      await assert.rejects(() => resolveVendorFolder(spec, { registry: registry(), fetchDrive: drive.fetchDrive }), (e:any) => e.status === 409);
      assert.equal(drive.creates.length, 0); assert.equal(drive.state.generated, 0);
    });
  }
  test("dossier ready déplacé : refus sans création de remplacement", async () => {
    const drive = mockDrive(); const id = await resolveVendorFolder(spec, { registry: registry(), fetchDrive: drive.fetchDrive });
    drive.files.get(id)!.parents = ["wrong-parent"];
    await assert.rejects(() => resolveVendorFolder(spec, { registry: registry(), fetchDrive: drive.fetchDrive }), (e:any) => e.status === 409);
    assert.equal(drive.state.generated, 1); assert.equal(drive.creates.length, 1);
  });
  test("plusieurs dossiers récupérables : refus sans adoption arbitraire", async () => {
    const drive = mockDrive(); drive.files.set("a",mockFolder(spec,"a")); drive.files.set("b",mockFolder(spec,"b"));
    await assert.rejects(() => resolveVendorFolder(spec, { registry: registry(), fetchDrive: drive.fetchDrive }), (e:any) => e.status === 409);
    assert.equal(drive.state.generated, 0);
  });
  test("réservation existante incompatible avec dossier récupéré : aucun nouvel ID", async () => {
    const drive = mockDrive(); const r = registry(); const i = vendorFolderIdentity(spec); const token = randomUUID();
    await r.claim(i,token); await r.reserve(i,token,"reserved-existing"); await expire(); drive.files.set("other", mockFolder(spec,"other"));
    await assert.rejects(() => resolveVendorFolder(spec, { registry: registry(), fetchDrive: drive.fetchDrive }), (e:any) => e.status === 409);
    assert.equal(drive.creates.length, 0); assert.equal(drive.state.generated, 0);
  });
  test("parent registre immuable et ID déjà réservé jamais remplacé", async () => {
    const r = registry(); const i = vendorFolderIdentity(spec); const token = randomUUID(); await r.claim(i,token);
    await r.reserve(i,token,"immutable"); assert.equal((await r.reserve(i,token,"new-id"))?.drive_folder_id, "immutable");
    await assert.rejects(() => r.claim({...i,parentId:"other"},randomUUID()));
    await assert.rejects(() => pool.query("update public.crm_drive_folder_registry set drive_folder_id='other'"));
  });
  async function asRole(role: "anon" | "authenticated", subject: string, action: (client: any) => Promise<void>) {
    const client = await pool.connect();
    try {
      await client.query(`set role ${role}`);
      await client.query("select set_config('request.jwt.claim.sub', $1, false)", [subject]);
      await action(client);
    } finally { await client.query("reset role; reset request.jwt.claim.sub"); client.release(); }
  }
  const subject = "11111111-1111-4111-8111-111111111111";
  const calls = [
    ["crm_drive_folder_claim", [spec.workspaceId, "vendor:security", "parent", randomUUID()]],
    ["crm_drive_folder_reserve", [spec.workspaceId, "vendor:security", randomUUID(), "id"]],
    ["crm_drive_folder_ready", [spec.workspaceId, "vendor:security", randomUUID(), "id"]]
  ] as const;
  for (const role of ["anon", "authenticated"] as const) {
    test(`${role} : lecture directe refusée`, () => asRole(role, subject, async client => {
      await assert.rejects(() => client.query("select * from public.crm_drive_folder_registry"), { code: "42501" });
    }));
    test(`${role} : INSERT, UPDATE, DELETE et TRUNCATE directs refusés`, () => asRole(role, subject, async client => {
      for (const sql of [
        "insert into public.crm_drive_folder_registry default values",
        "update public.crm_drive_folder_registry set status='ready'",
        "delete from public.crm_drive_folder_registry",
        "truncate public.crm_drive_folder_registry"
      ]) await assert.rejects(() => client.query(sql), { code: "42501" });
    }));
  }
  test("anon : les trois RPC sont interdites même avec un subject", () => asRole("anon", subject, async client => {
    for (const [name, values] of calls) await assert.rejects(() => client.query(`select public.${name}($1,$2,$3,$4)`, values), { code: "42501" });
  }));
  test("authenticated : claim, reserve, ready autorisés et résultats minimaux sans lease", async () => {
    const r = registry(), i = vendorFolderIdentity(spec), token = randomUUID();
    const claim = await r.claim(i,token);
    assert.equal(claim.claimed, true);
    assert.deepEqual(Object.keys(claim).sort(), ["workspace_id","logical_key","parent_drive_folder_id","drive_folder_id","status","claimed"].sort());
    const second = await r.claim(i,randomUUID()); assert.equal(second.claimed, false);
    assert.doesNotMatch(JSON.stringify(second), /lease|11111111/);
    const reserved = await r.reserve(i,token,"security-id");
    assert.deepEqual(Object.keys(reserved!).sort(), ["workspace_id","logical_key","parent_drive_folder_id","drive_folder_id","status"].sort());
    assert.equal(await r.ready(i,token,"security-id"), true);
  });
  test("chaque RPC refuse auth.uid() absent", () => asRole("authenticated", "", async client => {
    for (const [name, values] of calls) await assert.rejects(() => client.query(`select public.${name}($1,$2,$3,$4)`, values), { code:"42501", message:"not_authenticated" });
  }));
  test("chaque RPC refuse workspace arbitraire ou NULL", () => asRole("authenticated", subject, async client => {
    for (const workspace of ["other", null]) for (const [name, values] of calls) {
      await assert.rejects(() => client.query(`select public.${name}($1,$2,$3,$4)`, [workspace,...values.slice(1)]), { code:"22023", message:"invalid_workspace" });
    }
  }));
  test("chaque RPC refuse les clés hors format y compris NULL et longueur excessive", () => asRole("authenticated", subject, async client => {
    for (const key of [null,"", "anything", "invoice:a", "vendor:", "vendor:a:other", "vendor:a:rib:rib", "vendor:a b", "vendor:a/b", "vendor:%zz", "vendor:%", "vendor:a\n", "vendor:"+"a".repeat(500)]) {
      for (const [name, values] of calls) await assert.rejects(() => client.query(`select public.${name}($1,$2,$3,$4)`, [values[0],key,...values.slice(2)]), { code:"22023", message:"invalid_logical_key" });
    }
  }));
  test("UUID, identifiant encodé et suffixe RIB acceptés", async () => {
    for (const contactId of [randomUUID(), "a:rib", "café", "a!~*'()._-"]) for (const kind of ["vendor-root", "rib"] as const) {
      assert.equal((await registry().claim(vendorFolderIdentity({ ...spec, contactId, kind }),randomUUID())).claimed,true);
    }
  });
  test("RLS sans policies, trois definers à search_path fixe et aucune autre table touchée", async () => {
    const before = (await pool.query("select * from public.crm_workspace_state")).rows;
    const r = registry(), i = vendorFolderIdentity(spec), token = randomUUID();
    await r.claim(i,token); await r.reserve(i,token,"sentinel"); await r.ready(i,token,"sentinel");
    assert.deepEqual((await pool.query("select * from public.crm_workspace_state")).rows,before);
    assert.equal((await pool.query("select relrowsecurity from pg_class where oid='public.crm_drive_folder_registry'::regclass")).rows[0].relrowsecurity,true);
    assert.equal((await pool.query("select * from pg_policies where schemaname='public' and tablename='crm_drive_folder_registry'")).rows.length,0);
    const functions = (await pool.query("select proname, prosecdef, proconfig, prosrc from pg_proc where pronamespace='public'::regnamespace and proname in ('crm_drive_folder_claim','crm_drive_folder_reserve','crm_drive_folder_ready')")).rows;
    assert.equal(functions.length,3);
    for (const fn of functions) {
      assert.equal(fn.prosecdef,true); assert.deepEqual(fn.proconfig,["search_path=pg_catalog"]);
      assert.match(fn.prosrc,/auth\.uid\(\)/); assert.doesNotMatch(fn.prosrc,/execute|crm_workspace_state/i);
      const tables = [...fn.prosrc.matchAll(/(?:from|update|insert into)\s+(public\.\w+)/gi)].map((m:any) => m[1]);
      assert.ok(tables.length>0); assert.ok(tables.every((table:string) => table === "public.crm_drive_folder_registry"));
    }
  });
});
