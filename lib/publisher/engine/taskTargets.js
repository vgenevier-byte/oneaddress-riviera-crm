import { createClient } from '@supabase/supabase-js';
import { query } from './database.js';
import { publisherContext } from './context.js';
import { localSimulation, requireEnv } from './env.js';

const headers = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Authorization', 'X-Content-Type-Options': 'nosniff' };
const json = (body, status = 200) => Response.json(body, { status, headers });
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const target = post => ({ ref: { type: 'publisher_creation', id: String(post.id) }, state: 'available',
  label: post.theme || 'Création Publisher', detail: [String(post.post_date).slice(0, 10), post.format, post.creative_universe].filter(Boolean).join(' · '), status: post.status });

/** Read-only Neon catalogue. No media retrieval, provider call or content mutation.
 * The private Supabase proof stores identity/existence only, never a title or caption.
 */
export async function handleTaskPublisher(request) {
  try {
    if (!['GET', 'POST'].includes(request.method)) return json({ error: 'Méthode refusée.' }, 405);
    const token = request.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
    if (!token) return json({ error: 'Connexion requise.' }, 401);
    const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { headers: { Authorization: `Bearer ${token}` }, fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) } };
    const client = createClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'), options);
    const identity = await client.auth.getUser(token);
    if (identity.error || !identity.data.user) return json({ error: 'Session invalide.' }, 401);
    const actor = identity.data.user.id;
    const exporting = new URL(request.url).searchParams.get('export') === '1';
    async function check() {
      const [publisher, access] = await Promise.all([client.rpc('crm_authorize_publisher', { p_action: exporting ? 'export-text' : 'history' }), client.rpc('crm_access_snapshot')]);
      if (publisher.error || access.error || publisher.data !== true || !access.data?.active || !['read', 'contribute'].includes(access.data.modules?.tasks?.level)) throw new Error('forbidden');
    }
    await check();
    return await publisherContext.run({ actor, check }, async () => {
      let ids;
      if (request.method === 'POST') {
        if (Number(request.headers.get('content-length')) > 16384) return json({ error: 'Demande trop volumineuse.' }, 413);
        const raw = await request.text();
        if (raw.length > 16384) return json({ error: 'Demande trop volumineuse.' }, 413);
        let body; try { body = JSON.parse(raw); } catch { return json({ error: 'JSON invalide.' }, 400); }
        if (!Array.isArray(body.ids) || body.ids.length > 100 || !body.ids.every(uuid)) return json({ error: 'Références invalides.' }, 400);
        ids = [...new Set(body.ids)];
      }
      const posts = ids
        ? await query("select id,theme,post_date,format,creative_universe,status from publisher_posts where id = any($1::uuid[]) and generation_status='ready'", [ids])
        : await query("select id,theme,post_date,format,creative_universe,status from publisher_posts where generation_status='ready' order by post_date desc,id");
      await check();
      if (ids?.length) {
        const key = requireEnv(localSimulation() ? 'LOCAL_AUTH_INVITE_KEY' : 'CRM_INVITE_AUTH_KEY');
        const admin = createClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), key, { auth: { persistSession: false, autoRefreshToken: false } });
        for (const id of ids) {
          await check();
          const confirmed = await admin.rpc('crm_task_publisher_confirm', { p_user: actor, p_id: id, p_exists: posts.some(post => String(post.id) === id) });
          if (confirmed.error) throw new Error('confirmation_unavailable');
        }
      }
      await check();
      return json({ items: posts.map(target) });
    });
  } catch (error) {
    return json({ error: error instanceof Error && error.message === 'forbidden' ? 'Accès refusé.' : 'Catalogue Publisher indisponible.' }, error instanceof Error && error.message === 'forbidden' ? 403 : 503);
  }
}
