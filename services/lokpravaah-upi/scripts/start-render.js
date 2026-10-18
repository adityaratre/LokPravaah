import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { runMigrations } from '../packages/db/src/migrate.js';
import { startControlCenter } from '../apps/control-center/src/index.js';

const INTERNAL = Object.freeze({ api: 6100, checkout: 7000, admin: 6001, gmail: 6003, sms: 6002, control: 8090 });

function normalizeBase(value) {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  const parsed = new URL(raw);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('PUBLIC_BASE_URL / RENDER_EXTERNAL_URL must be a clean http(s) base URL without credentials, query, or fragment.');
  }
  return parsed.origin;
}

function hostOf(value) {
  try { return new URL(value).host.toLowerCase(); } catch { return ''; }
}

function cleanIncomingHeaders(headers, targetPort) {
  const safe = { ...headers, host: `127.0.0.1:${targetPort}` };
  // These internal-renderer headers must never be trusted when supplied by a browser.
  delete safe['x-internal-render'];
  delete safe['x-internal-token'];
  delete safe['connection'];
  delete safe['proxy-connection'];
  delete safe['keep-alive'];
  delete safe['transfer-encoding'];
  delete safe['upgrade'];
  return safe;
}

function sendJson(res, status, body) {
  if (res.headersSent) return;
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(JSON.stringify(body));
}

function routeRequest(req, env) {
  const url = new URL(req.url || '/', 'http://render.internal');
  const path = url.pathname;
  const host = String(req.headers.host || '').toLowerCase().split(':')[0];

  // Custom subdomains can be attached to this same Render service later. If their hostnames
  // are distinct, honour them; otherwise the same-origin path routing below is used.
  const externalHost = hostOf(env.PUBLIC_BASE_URL || env.RENDER_EXTERNAL_URL).split(':')[0];
  const roleHosts = [
    ['admin', hostOf(env.BASE_ADMIN_URL).split(':')[0]],
    ['api', hostOf(env.BASE_PAYMENT_API_URL).split(':')[0]],
    ['checkout', hostOf(env.BASE_CHECKOUT_URL).split(':')[0]],
    ['gmail', hostOf(env.BASE_GMAIL_URL).split(':')[0]],
  ];
  const matches = roleHosts.filter(([role, candidate]) => candidate && candidate === host && candidate !== externalHost);
  if (matches.length === 1) {
    const [role] = matches[0];
    const port = role === 'admin' ? INTERNAL.admin : role === 'api' ? INTERNAL.api : role === 'gmail' ? INTERNAL.gmail : INTERNAL.checkout;
    return { port, path: req.url, role };
  }

  if (path === '/health' || path === '/healthz') return { health: true };
  if (path === '/') return { landing: true };

  // Admin-specific API endpoints are checked by the AdminServer for an admin token.
  if (path === '/api/admin/tickets' || path.startsWith('/api/services') || path === '/api/logs/stream') {
    return { port: INTERNAL.admin, path: req.url, role: 'admin' };
  }
  if (path === '/admin' || path === '/youpi-sms-gateway.apk') {
    return { port: INTERNAL.admin, path: req.url, role: 'admin' };
  }
  if (path === '/api' || path.startsWith('/api/')) {
    return { port: INTERNAL.api, path: req.url, role: 'api' };
  }
  if (path === '/gmail' || path.startsWith('/gmail/')) {
    const remainder = req.url.slice('/gmail'.length) || '/';
    return { port: INTERNAL.gmail, path: remainder.startsWith('?') ? `/${remainder}` : remainder, role: 'gmail' };
  }
  // Checkout serves /checkout/:id, QR images, SDK, icons, and its own health endpoint.
  return { port: INTERNAL.checkout, path: req.url, role: 'checkout' };
}

function proxyRequest(req, res, targetPort, targetPath) {
  const headers = cleanIncomingHeaders(req.headers, targetPort);
  headers['x-forwarded-host'] = req.headers.host || '';
  headers['x-forwarded-proto'] = req.headers['x-forwarded-proto'] || (process.env.RENDER ? 'https' : 'http');
  headers['x-forwarded-for'] = req.socket.remoteAddress || '';
  const upstream = http.request({
    hostname: '127.0.0.1',
    port: targetPort,
    path: targetPath,
    method: req.method,
    headers
  }, (upstreamRes) => {
    res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
    upstreamRes.pipe(res);
  });
  upstream.on('error', (error) => {
    sendJson(res, 502, { error: 'Gateway upstream unavailable', servicePort: targetPort, message: error.message });
  });
  req.on('aborted', () => upstream.destroy());
  req.pipe(upstream);
}

async function checkUpstream(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1800) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForRequiredServices(ports, timeoutMs = 35000) {
  const deadline = Date.now() + timeoutMs;
  const remaining = new Set(ports);
  while (remaining.size && Date.now() < deadline) {
    await Promise.all([...remaining].map(async (port) => {
      if (await checkUpstream(port)) remaining.delete(port);
    }));
    if (remaining.size) await delay(500);
  }
  if (remaining.size) throw new Error(`Required internal service(s) did not become healthy: ports ${[...remaining].join(', ')}. Check startup logs and environment variables.`);
}

process.env.NODE_ENV = 'production';
process.env.YOUPI_MODE = 'render';
process.env.YOUPI_RENDER_MODE = 'true';
process.env.YOUPI_BIND_HOST = '127.0.0.1';
process.env.PAYMENT_API_PORT ||= String(INTERNAL.api);
process.env.CHECKOUT_PORTAL_PORT ||= String(INTERNAL.checkout);
process.env.MERCHANT_ADMIN_PORT ||= String(INTERNAL.admin);
process.env.GMAIL_OBSERVER_PORT ||= String(INTERNAL.gmail);
process.env.SMS_OBSERVER_PORT ||= String(INTERNAL.sms);
process.env.CONTROL_CENTER_PORT ||= String(INTERNAL.control);

const publicBase = normalizeBase(process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || '');
if (publicBase) {
  process.env.PUBLIC_BASE_URL = publicBase;
  process.env.BASE_CHECKOUT_URL ||= publicBase;
  process.env.BASE_PAYMENT_API_URL ||= publicBase;
  process.env.BASE_ADMIN_URL ||= `${publicBase}/admin`;
  process.env.BASE_GMAIL_URL ||= `${publicBase}/gmail`;
} else {
  console.warn('[Render] RENDER_EXTERNAL_URL is not available yet. Public URL defaults will be resolved when the service is assigned a URL.');
}

console.log('====================================================');
console.log('Starting LokPravaah UPI Gateway in Render mode');
console.log('Public entrypoint will bind to Render PORT; private services stay on loopback.');
console.log('====================================================');

const missingSecrets = [
  'ADMIN_API_TOKEN', 'INTERNAL_SERVICE_TOKEN', 'OBSERVER_API_TOKEN',
  'ENCRYPTION_MASTER_KEY', 'LOKPRAVAAH_DONATION_WEBHOOK_SECRET'
].filter((name) => !String(process.env[name] || '').trim() || /^CHANGE_ME/i.test(String(process.env[name] || '').trim()));
if (missingSecrets.length) {
  console.warn(`[Security setup required] Set these Render environment variables before accepting real payments: ${missingSecrets.join(', ')}.`);
}
if (!process.env.SQLITE_DB_PATH) {
  console.warn('[Storage warning] The gateway uses SQLite at data/lokpravaah_upi.sqlite. Render Free storage is ephemeral; attach a persistent disk before real donations.');
}

// Create / migrate the shared SQLite database before starting child services.
const migration = runMigrations();
console.log(`[Database] Migrations complete. Default merchant: ${migration.defaultMerchant?.businessName || 'available after configuration'}`);

// The control center is bound to loopback only; its authenticated UI routes are proxied by AdminServer.
const controlCenter = await startControlCenter(INTERNAL.control);
await controlCenter.processManager.startAll();
await waitForRequiredServices([INTERNAL.api, INTERNAL.checkout, INTERNAL.admin]);

const port = Number(process.env.PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  await controlCenter.close();
  throw new Error('Render did not provide a valid PORT. Ensure this is deployed as a Render Web Service.');
}

const server = http.createServer(async (req, res) => {
  const route = routeRequest(req, process.env);
  if (route.health) {
    const [apiOk, checkoutOk, adminOk] = await Promise.all([
      checkUpstream(INTERNAL.api), checkUpstream(INTERNAL.checkout), checkUpstream(INTERNAL.admin)
    ]);
    const healthy = apiOk && checkoutOk && adminOk;
    sendJson(res, healthy ? 200 : 503, {
      status: healthy ? 'UP' : 'DEGRADED',
      service: 'lokpravaah-upi-gateway',
      checks: { paymentApi: apiOk, checkoutPortal: checkoutOk, merchantAdmin: adminOk }
    });
    return;
  }
  if (route.landing) {
    sendJson(res, 200, {
      service: 'LokPravaah UPI Gateway',
      status: 'UP',
      endpoints: { checkout: '/checkout/:paymentId', paymentApi: '/api/v1', merchantAdmin: '/admin', health: '/health' }
    });
    return;
  }
  proxyRequest(req, res, route.port, route.path);
});

server.requestTimeout = 120000;
server.headersTimeout = 65000;
server.keepAliveTimeout = 5000;
server.listen(port, '0.0.0.0', () => {
  console.log(`[Render ingress] Listening on 0.0.0.0:${port}`);
  console.log(`[Render ingress] Public base URL: ${publicBase || '(assigned by Render)'}`);
  console.log(`[Render ingress] Checkout: /checkout/:id | API: /api/* | Admin: /admin | Health: /health`);
});

let shuttingDown = false;
const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Render] Received ${signal}; shutting down gateway services...`);
  server.close();
  try { await controlCenter.close(); } catch (error) { console.error('[Render] Shutdown warning:', error.message); }
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
