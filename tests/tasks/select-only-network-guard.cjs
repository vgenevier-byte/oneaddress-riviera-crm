// Disposable UI fixture only: no Auth, database or external network transport.
'use strict';
const net = require('node:net'), tls = require('node:tls');
const { syncBuiltinESMExports } = require('node:module');
if (process.env.TASKS_SELECT_ONLY_ACK !== 'TASKS_UI_FICTION_ONLY') throw new Error('Explicit UI fixture opt-in required');
function inspect(args) {
  const first = args[0];
  if (Array.isArray(first)) return inspect(first);
  // Next.js workers may use local Unix sockets; this is not outbound IP traffic.
  if (first && typeof first === 'object' && typeof first.path === 'string') return;
  if (typeof first === 'string' && !/^\d+$/.test(first)) return;
  const options = first && typeof first === 'object' ? first : { port: first, host: typeof args[1] === 'string' ? args[1] : 'localhost' };
  if (String(options.host || options.hostname || 'localhost') !== '127.0.0.1' || Number(options.port) !== 3201) throw new Error('Non-fixture connection blocked');
}
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) { inspect(args); return connect.apply(this, args); };
const secure = tls.connect;
tls.connect = function (...args) { inspect(args); return secure.apply(this, args); };
const originalFetch = globalThis.fetch;
globalThis.fetch = function (input, init) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.port !== '3201' || url.username || url.password) throw new Error('Non-fixture fetch blocked');
  return originalFetch(input, { ...init, redirect: 'error' });
};
syncBuiltinESMExports();
