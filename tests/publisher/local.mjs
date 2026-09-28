import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { local, assertPublisherLocalTarget } from './local-target.mjs';

export { local };
export const statusPath = process.env.LOCAL_STATUS_FILE || join(local.directory, 'local-status.private.json');
export const status = JSON.parse(readFileSync(statusPath, 'utf8'));
assertPublisherLocalTarget(status);
const require = createRequire(import.meta.url);
export const { Client } = require(process.env.LOCAL_PG_MODULE || '/private/tmp/crm-publisher-runtime/node_modules/pg');
export const output = join(local.directory, 'results');
export const fixturePath = join(local.directory, 'fixtures.private.json');
export async function request(path, token, body, method) {
  const response = await fetch(status.API_URL + path, { method: method || (body === undefined ? 'GET' : 'POST'), redirect: 'error', headers: { apikey: status.ANON_KEY, ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data };
}
export const rpc = (name, token, body = {}) => request('/rest/v1/rpc/' + name, token, body);
export async function login(user) {
  const result = await request('/auth/v1/token?grant_type=password', null, { email: user.email, password: user.password });
  assert.equal(result.status, 200, 'Real local Auth login must succeed');
  assert.equal(result.data.user.id, user.id);
  return result.data.access_token;
}
export async function appRequest(action, token, body, query = {}) {
  const url = new URL('/api/publisher', local.app); url.searchParams.set('action', action);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
  const response = await fetch(url, { method: body === undefined ? 'GET' : 'POST', redirect: 'error', headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: local.app }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const bytes = Buffer.from(await response.arrayBuffer());
  let data; try { data = JSON.parse(bytes.toString()); } catch { data = null; }
  return { status: response.status, data, bytes, headers: response.headers };
}
