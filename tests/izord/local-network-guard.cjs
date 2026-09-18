// Preloaded only in the isolated build/server. Deny TCP egress beyond the local bench.
'use strict';
const net = require('node:net');
const tls = require('node:tls');
const { syncBuiltinESMExports } = require('node:module');
if (process.env.IZORD_TEST_ACK !== 'IZORD_DISPOSABLE_LOCAL_ONLY') throw new Error('Local network guard requires explicit opt-in');
const permitted = new Set([3159, 55431]);
function inspect(args) {
  let first = args[0];
  if (Array.isArray(first)) return inspect(first);
  if (first && typeof first === 'object' && typeof first.path === 'string') return; // Node IPC pipe, not a network endpoint.
  if (typeof first === 'string' && !/^\d+$/.test(first)) return; // Node IPC pipe.
  const options = first && typeof first === 'object' ? first : { port: first, host: typeof args[1] === 'string' ? args[1] : 'localhost' };
  const hostname = String(options.host || options.hostname || 'localhost');
  if (hostname !== '127.0.0.1' || !permitted.has(Number(options.port))) throw new Error('Non-bench network connection blocked');
}
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) { inspect(args); return originalConnect.apply(this, args); };
const originalTLS = tls.connect;
tls.connect = function (...args) { inspect(args); return originalTLS.apply(this, args); };
const originalFetch = globalThis.fetch;
globalThis.fetch = async function (input, init) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !permitted.has(Number(url.port)) || url.username || url.password) throw new Error('Non-bench fetch blocked');
  return originalFetch(input, { ...init, redirect: 'error' });
};
syncBuiltinESMExports();
