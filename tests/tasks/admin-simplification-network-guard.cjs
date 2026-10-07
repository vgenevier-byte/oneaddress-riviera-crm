// Preloaded only by the disposable demo. Outbound transport stays on loopback.
'use strict';
const net = require('node:net'), tls = require('node:tls');
const { syncBuiltinESMExports } = require('node:module');
if (process.env.TASKS_TEST_ACK !== 'TASKS_DISPOSABLE_LOCAL_ONLY') throw new Error('Local Tasks opt-in required');
const ports = new Set([3200, 55731]);
function inspect(args) {
  const first = args[0];
  if (Array.isArray(first)) return inspect(first);
  if (first && typeof first === 'object' && typeof first.path === 'string') return;
  if (typeof first === 'string' && !/^\d+$/.test(first)) return;
  const options = first && typeof first === 'object' ? first : { port: first, host: typeof args[1] === 'string' ? args[1] : 'localhost' };
  if (String(options.host || options.hostname || 'localhost') !== '127.0.0.1' || !ports.has(Number(options.port))) throw new Error('Non-demo connection blocked');
}
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) { inspect(args); return connect.apply(this, args); };
const secure = tls.connect;
tls.connect = function (...args) { inspect(args); return secure.apply(this, args); };
const fetchOriginal = globalThis.fetch;
globalThis.fetch = async function (input, init) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !ports.has(Number(url.port)) || url.username || url.password) throw new Error('Non-demo fetch blocked');
  return fetchOriginal(input, { ...init, redirect: 'error' });
};
syncBuiltinESMExports();
