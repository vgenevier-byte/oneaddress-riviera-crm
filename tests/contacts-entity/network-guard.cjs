// Disposable Contacts bench only. No non-loopback network from the Next process.
'use strict';
const net = require('node:net');
const tls = require('node:tls');
const { syncBuiltinESMExports } = require('node:module');
const ports = new Set(String(process.env.CONTACTS_ENTITY_ALLOWED_PORTS || '').split(',').map(Number));
const hosts = new Set(['127.0.0.1', 'localhost', '::1']);
function inspect(args) {
  const first = args[0];
  if (Array.isArray(first)) return inspect(first);
  if (first && typeof first === 'object' && typeof first.path === 'string') return;
  if (typeof first === 'string' && !/^\d+$/.test(first)) return;
  const options = first && typeof first === 'object' ? first : { port: first, host: typeof args[1] === 'string' ? args[1] : 'localhost' };
  if (!hosts.has(String(options.host || options.hostname || 'localhost')) || !ports.has(Number(options.port))) throw new Error('Non-local Contacts bench connection blocked');
}
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) { inspect(args); return connect.apply(this, args); };
const secure = tls.connect;
tls.connect = function (...args) { inspect(args); return secure.apply(this, args); };
const original = globalThis.fetch;
globalThis.fetch = async function (input, init) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.protocol !== 'http:' || !hosts.has(url.hostname) || !ports.has(Number(url.port)) || url.username || url.password) throw new Error('Non-local Contacts bench fetch blocked');
  return original(input, { ...init, redirect: 'error' });
};
syncBuiltinESMExports();
