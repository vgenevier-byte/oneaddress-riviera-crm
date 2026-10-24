// Same preloaded TCP/fetch boundary as tests/izord/local-network-guard.cjs,
// with the dedicated Publisher ports. It never loads repository .env files.
'use strict';
const net = require('node:net');
const tls = require('node:tls');
const { syncBuiltinESMExports } = require('node:module');
if (process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:55931') throw new Error('Isolated task links bench required');
const permitted = new Set([3198, 55931, 55932, 55934]);
function inspect(args) {
  const first = args[0];
  if (Array.isArray(first)) return inspect(first);
  if (first && typeof first === 'object' && typeof first.path === 'string') return;
  if (typeof first === 'string' && !/^\d+$/.test(first)) return;
  const options = first && typeof first === 'object' ? first : { port: first, host: typeof args[1] === 'string' ? args[1] : 'localhost' };
  if (String(options.host || options.hostname || 'localhost') !== '127.0.0.1' || !permitted.has(Number(options.port))) throw new Error('Non-Publisher-local TCP connection blocked');
}
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) { inspect(args); return connect.apply(this, args); };
const secureConnect = tls.connect;
tls.connect = function (...args) { inspect(args); return secureConnect.apply(this, args); };
const originalFetch = globalThis.fetch;
globalThis.fetch = async function (input, init) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !permitted.has(Number(url.port)) || url.username || url.password) throw new Error('Non-Publisher-local fetch blocked');
  return originalFetch(input, { ...init, redirect: 'error' });
};
syncBuiltinESMExports();
