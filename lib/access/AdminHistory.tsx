"use client";

import { useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { isCancelled, useScopedOperations } from "./operations";

type HistoryEvent = {
  id: string;
  created_at: string;
  action: string;
  actor_id: string | null;
  subject_id: string | null;
};
type HistoryCursor = { beforeId: string; snapshotId: string };
type HistoryPage = { events: HistoryEvent[]; nextCursor: HistoryCursor | null; hasMore: boolean };
type HistoryState = HistoryPage & { status: "loading" | "ready" | "error" };
const emptyPage: HistoryPage = { events: [], nextCursor: null, hasMore: false };
const pageSize = 50;
const historyActionKeys = new Set(["access_saved", "invitation_prepared", "invitation_accepted", "invitation_revoked", "document_classified", "document_shared", "document_share_revoked", "document_trash_started", "document_trashed", "contact_document_reserved", "contact_document_confirmed", "contact_document_withdrawn", "contact_document_replaced", "contact_document_shared", "worker_documents_removed"]);

// Keep bigint identifiers as strings from the RPC through the next request.
function parsePage(value: unknown): HistoryPage {
  if (!value || typeof value !== "object") throw new Error("Invalid history page");
  const page = value as HistoryPage;
  if (!Array.isArray(page.events) || page.events.length > pageSize || typeof page.hasMore !== "boolean") throw new Error("Invalid history page");
  let previous: bigint | null = null;
  for (const event of page.events) {
    if (typeof event.id !== "string" || !/^\d+$/.test(event.id) || typeof event.created_at !== "string" || !Number.isFinite(Date.parse(event.created_at)) || typeof event.action !== "string" || (event.actor_id !== null && typeof event.actor_id !== "string") || (event.subject_id !== null && typeof event.subject_id !== "string")) throw new Error("Invalid history event");
    const id = BigInt(event.id);
    if (previous !== null && id >= previous) throw new Error("Invalid history order");
    previous = id;
  }
  if (page.hasMore) {
    const cursor = page.nextCursor;
    if (!cursor || typeof cursor.beforeId !== "string" || !/^\d+$/.test(cursor.beforeId) || typeof cursor.snapshotId !== "string" || !/^\d+$/.test(cursor.snapshotId) || cursor.beforeId !== page.events.at(-1)?.id || BigInt(cursor.snapshotId) < BigInt(cursor.beforeId)) throw new Error("Invalid history cursor");
  } else if (page.nextCursor !== null) throw new Error("Invalid history cursor");
  return page;
}

export default function AdminHistory({ users }: { users: { id: string; email: string }[] }) {
  const { t, formatDate } = useI18n();
  const begin = useScopedOperations("admin");
  const request = useRef({ sequence: 0 });
  const [history, setHistory] = useState<HistoryState>({ ...emptyPage, status: "loading" });
  const [expanded, setExpanded] = useState(false);
  const listId = useId();

  const readPage = useCallback(async (cursor: HistoryCursor | null) => {
    const lease = request.current, sequence = ++lease.sequence;
    try {
      const op = await begin();
      const result = await op.run(() => op.client.rpc("crm_admin_history_page", { p_before_id: cursor?.beforeId ?? null, p_snapshot_id: cursor?.snapshotId ?? null, p_limit: pageSize }).abortSignal(op.signal));
      if (sequence !== lease.sequence) return;
      if (result.error) throw result.error;
      const page = parsePage(result.data);
      if (cursor && (page.events.some(event => BigInt(event.id) >= BigInt(cursor.beforeId) || BigInt(event.id) > BigInt(cursor.snapshotId)) || (page.nextCursor && page.nextCursor.snapshotId !== cursor.snapshotId))) throw new Error("Invalid history continuation");
      setHistory(current => ({ ...page, events: cursor ? [...current.events, ...page.events] : page.events, status: "ready" }));
    } catch (error) {
      if (sequence === lease.sequence && !isCancelled(error)) setHistory(current => ({ ...current, status: "error" }));
    }
  }, [begin]);

  useLayoutEffect(() => {
    const lease = request.current, sequence = lease.sequence;
    void Promise.resolve().then(() => { if (sequence === lease.sequence) void readPage(null); });
    return () => { lease.sequence++; };
  }, [readPage]);

  function loadOlder() {
    setHistory(current => ({ ...current, status: "loading" }));
    void readPage(history.nextCursor);
  }

  const shown = expanded ? history.events : history.events.slice(0, 3);
  const email = (id: string) => users.find(user => user.id === id)?.email;
  return <section className="panel" data-admin-history>
    <h2>{t("admin.history.title")}</h2>
    <div id={listId}>
      {shown.map(event => <p key={event.id} data-admin-history-event={event.id}>
        <time dateTime={event.created_at}>{formatDate(event.created_at, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</time>
        {" · "}{t("admin.history.author")} {event.actor_id ? email(event.actor_id) ?? t("admin.history.unavailableAccount", { id: event.actor_id }) : t("navigation.unspecified")}
        {" · "}{t("admin.history.action")} {historyActionKeys.has(event.action) ? t(`admin.history.action.${event.action}`) : event.action}
        {" · "}{t("admin.history.recipient")} {event.subject_id ? email(event.subject_id) ?? t("admin.history.unavailableSubject", { id: event.subject_id }) : t("navigation.unspecified")}
      </p>)}
    </div>
    {history.status === "ready" && history.events.length === 0 && <p>{t("admin.history.empty")}</p>}
    {history.events.length > 0 && <p data-admin-history-count>{expanded ? t("admin.history.loaded", { count: history.events.length }) : t("admin.history.shown", { count: shown.length, total: history.events.length })}{history.hasMore ? t("admin.history.olderRemaining") : history.status === "ready" ? t("admin.history.complete") : ""}</p>}
    {history.events.length > 3 && <button type="button" aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded(value => !value)}>{expanded ? t("admin.history.collapse") : t("admin.history.expand")}</button>}
    {history.status === "loading" && <p role="status">{t("admin.history.loading")}</p>}
    {history.status === "error" && <><p role="status">{t("admin.history.readFailed")}</p><button type="button" onClick={loadOlder}>{t("admin.history.retry")}</button></>}
    {expanded && history.hasMore && history.status !== "error" && <button type="button" disabled={history.status === "loading"} onClick={loadOlder}>{t("admin.history.loadOlder")}</button>}
  </section>;
}
