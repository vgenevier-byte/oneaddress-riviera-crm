import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Client } from 'pg';
import { assertMonthlyLocalTarget } from './server-local-target.mjs';

export const statusFile = process.env.MONTHLY_CHARGES_STATUS_FILE;
assert.ok(statusFile, 'MONTHLY_CHARGES_STATUS_FILE required; repository env is never loaded');
export const directory = dirname(statusFile);
export const status = JSON.parse(readFileSync(statusFile, 'utf8'));
assertMonthlyLocalTarget({ api: status.API_URL, database: status.DB_URL, app: 'http://127.0.0.1:3183', mail: 'http://127.0.0.1:55634', acknowledgement: process.env.IZORD_TEST_ACK });
export const sql = new Client({ connectionString: status.DB_URL });
export async function connect() {
  await sql.connect();
  assert.equal(Number((await sql.query("select count(*) from auth.users where email is null or email not like '%@example.invalid'")).rows[0].count), 0, 'Every identity must be fictitious');
}
export async function request(path, token, body, method) {
  const response = await fetch(status.API_URL + path, { method: method ?? (body === undefined ? 'GET' : 'POST'), redirect: 'error', headers: { apikey: status.ANON_KEY, ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await response.text(); let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data };
}
export const rpc = (name, token, args = {}) => request('/rest/v1/rpc/' + name, token, args);
export async function login(user) {
  const result = await request('/auth/v1/token?grant_type=password', null, { email: user.email, password: user.password });
  assert.equal(result.status, 200, 'Real local Auth login succeeds');
  assert.equal(result.data.user.id, user.id);
  return result.data.access_token;
}
export const read = (token, args = {}) => rpc('crm_read_monthly_charges', token, args);
