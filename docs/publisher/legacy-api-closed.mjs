// Future cutover payload: replace app/frontend/api/publisher.js in every legacy
// Publisher entry point. This file is NOT deployed or wired to the running source.
// A closed endpoint deliberately has no database/provider/security imports.
export default function closedPublisher(_request, response) {
  response.statusCode = 410;
  response.setHeader('Cache-Control', 'private, no-store, max-age=0');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Set-Cookie', 'oar_publisher_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0');
  response.end(JSON.stringify({ error: 'Le Publisher utilise désormais votre compte CRM.', url: 'https://oneaddress-riviera-crm.vercel.app/publisher' }));
}
