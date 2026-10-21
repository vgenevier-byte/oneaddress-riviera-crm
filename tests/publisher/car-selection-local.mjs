import { readFileSync } from 'node:fs';
import pg from 'pg';
export const directory = '/private/tmp/oar-publisher-car-selection-bench-20261021';
export const fixture = JSON.parse(readFileSync(`${directory}/fixtures.json`));
if (fixture.app !== 'http://127.0.0.1:3183' || fixture.database !== 'postgresql://publisher_local:Fictitious-local-only-20261021@127.0.0.1:55542/publisher_car_selection') throw new Error('Local cars fixture only');
export const trace = () => readFileSync(`${directory}/provider-trace.jsonl`, 'utf8').trim().split('\n').filter(Boolean).map(x => JSON.parse(x));
export const sql = new pg.Client({ connectionString: fixture.database, types: { getTypeParser: (oid, format) => oid === 1082 ? value => value : pg.types.getTypeParser(oid, format) } });
export async function request(action, body, who = 'editor', query = {}) {
  const url = new URL('/api/publisher', fixture.app); url.searchParams.set('action', action);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const response = await fetch(url, { method: body === undefined ? 'GET' : 'POST', headers: { ...(who ? { authorization: `Bearer ${fixture.sessions[who].access_token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json', origin: fixture.app }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const bytes = Buffer.from(await response.arrayBuffer()); let data; try { data = JSON.parse(bytes.toString()); } catch { data = null; }
  return { status: response.status, data, bytes, headers: response.headers };
}
