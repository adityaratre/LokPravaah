/**
 * Canonical Cloudflare Tunnel and Runtime URL Resolution Engine.
 * Single source of truth for runtime mode, derived hostnames, and service mappings.
 */

export const SERVICE_PORTS = Object.freeze({
  CHECKOUT: 7000,
  API: 6100,
  ADMIN: 6001,
  GMAIL: 6003
});

/**
 * Derives public hostnames and Cloudflare published application mappings.
 * @param {{ domain?: string, prefix?: string }} config
 * @returns {Array<{
 *   role: string,
 *   name: string,
 *   publicHostname: string,
 *   publicUrl: string,
 *   serviceUrl: string,
 *   port: number,
 *   purpose: string,
 *   optional: boolean
 * }>}
 */
export function deriveCloudflareRoutes(config = {}) {
  const rawDomain = (config.domain || config.domainTld || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const rawPrefix = (config.prefix || config.domainPrefix || 'pay').trim().toLowerCase().replace(/[^a-z0-9-_]/g, '') || 'pay';

  if (!rawDomain) {
    return [];
  }

  return [
    {
      role: 'checkout',
      name: 'Checkout',
      publicHostname: `${rawPrefix}.${rawDomain}`,
      publicUrl: `https://${rawPrefix}.${rawDomain}`,
      serviceUrl: `http://localhost:${SERVICE_PORTS.CHECKOUT}`,
      port: SERVICE_PORTS.CHECKOUT,
      purpose: 'Customer checkout / checkout portal',
      optional: false
    },
    {
      role: 'api',
      name: 'Payment API',
      publicHostname: `${rawPrefix}-api.${rawDomain}`,
      publicUrl: `https://${rawPrefix}-api.${rawDomain}`,
      serviceUrl: `http://localhost:${SERVICE_PORTS.API}`,
      port: SERVICE_PORTS.API,
      purpose: 'Payment API / merchant API / SSE / observer ingestion',
      optional: false
    },
    {
      role: 'admin',
      name: 'Merchant Admin',
      publicHostname: `${rawPrefix}-admin.${rawDomain}`,
      publicUrl: `https://${rawPrefix}-admin.${rawDomain}`,
      serviceUrl: `http://localhost:${SERVICE_PORTS.ADMIN}`,
      port: SERVICE_PORTS.ADMIN,
      purpose: 'Merchant/Admin panel',
      optional: false
    },
    {
      role: 'gmail',
      name: 'Gmail OAuth / Gmail Observer',
      publicHostname: `${rawPrefix}-gmail.${rawDomain}`,
      publicUrl: `https://${rawPrefix}-gmail.${rawDomain}`,
      serviceUrl: `http://localhost:${SERVICE_PORTS.GMAIL}`,
      port: SERVICE_PORTS.GMAIL,
      purpose: 'Gmail OAuth callback and Gmail observation service',
      optional: false
    },
  ];
}

/**
 * Resolves authoritative runtime URLs for all system components.
 * @param {{
 *   envMode?: string,
 *   domain?: string,
 *   domainTld?: string,
 *   prefix?: string,
 *   domainPrefix?: string
 * }} options
 */
export function resolveRuntimeUrls(options = {}) {
  // Render uses one public ingress and path-based routing. Its platform mode is
  // authoritative so stale merchant branding cannot generate localhost checkout URLs.
  const forcedMode = String(process.env.YOUPI_MODE || '').toLowerCase();
  let mode = forcedMode === 'render' ? 'render' : options.envMode;
  if (!mode) {
    if (process.env.YOUPI_MODE) {
      mode = process.env.YOUPI_MODE;
    } else if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
      mode = 'localhost';
    } else if (process.env.CLOUDFLARE_DOMAIN) {
      mode = 'production';
    } else {
      mode = 'localhost';
    }
  }
  mode = String(mode).toLowerCase();
  const domain = (options.domain || options.domainTld || process.env.CLOUDFLARE_DOMAIN || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const prefix = (options.prefix || options.domainPrefix || process.env.DEPLOYMENT_PREFIX || 'pay').trim().toLowerCase().replace(/[^a-z0-9-_]/g, '') || 'pay';

  // Render deploys the complete gateway behind one public ingress. Optional custom
  // subdomains can be supplied through BASE_*_URL; same-origin paths work by default.
  if (mode === 'render') {
    const baseRaw = (process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || '').trim().replace(/\/+$/, '');
    let base = baseRaw;
    try {
      if (baseRaw) {
        const parsed = new URL(baseRaw);
        if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('unsupported protocol');
        base = parsed.origin;
      }
    } catch {
      throw new Error('Render runtime requires PUBLIC_BASE_URL or RENDER_EXTERNAL_URL to be a valid absolute HTTP(S) URL.');
    }
    const checkoutUrl = (process.env.BASE_CHECKOUT_URL || base || 'http://localhost:7000').replace(/\/+$/, '');
    const apiUrl = (process.env.BASE_PAYMENT_API_URL || base || 'http://localhost:6100').replace(/\/+$/, '');
    const adminUrl = (process.env.BASE_ADMIN_URL || (base ? `${base}/admin` : 'http://localhost:6001')).replace(/\/+$/, '');
    const gmailUrl = (process.env.BASE_GMAIL_URL || (base ? `${base}/gmail` : 'http://localhost:6003')).replace(/\/+$/, '');
    const checkoutHost = (() => { try { return new URL(checkoutUrl).host; } catch { return checkoutUrl; } })();
    const apiHost = (() => { try { return new URL(apiUrl).host; } catch { return apiUrl; } })();
    const adminHost = (() => { try { return new URL(adminUrl).host; } catch { return adminUrl; } })();
    const gmailHost = (() => { try { return new URL(gmailUrl).host; } catch { return gmailUrl; } })();
    return {
      mode: 'render', isProduction: true, domain: (() => { try { return new URL(base).host; } catch { return 'render'; } })(), prefix: '',
      routes: [
        { role: 'checkout', name: 'Checkout', publicHostname: checkoutHost, publicUrl: checkoutUrl, serviceUrl: `http://localhost:${SERVICE_PORTS.CHECKOUT}`, port: SERVICE_PORTS.CHECKOUT, purpose: 'Customer checkout / checkout portal', optional: false },
        { role: 'api', name: 'Payment API', publicHostname: apiHost, publicUrl: apiUrl, serviceUrl: `http://localhost:${SERVICE_PORTS.API}`, port: SERVICE_PORTS.API, purpose: 'Payment API / merchant API / SSE / observer ingestion', optional: false },
        { role: 'admin', name: 'Merchant Admin', publicHostname: adminHost, publicUrl: adminUrl, serviceUrl: `http://localhost:${SERVICE_PORTS.ADMIN}`, port: SERVICE_PORTS.ADMIN, purpose: 'Merchant/Admin panel', optional: false },
        { role: 'gmail', name: 'Gmail OAuth / Gmail Observer', publicHostname: gmailHost, publicUrl: gmailUrl, serviceUrl: `http://localhost:${SERVICE_PORTS.GMAIL}`, port: SERVICE_PORTS.GMAIL, purpose: 'Gmail OAuth callback and Gmail observation service', optional: true }
      ],
      checkoutUrl, checkoutHostname: checkoutHost, apiUrl, apiHostname: apiHost, adminUrl, adminHostname: adminHost, gmailUrl, gmailHostname: gmailHost
    };
  }

  if (mode === 'production') {
    if (!domain) {
      if ((process.env.NODE_ENV === 'test' || process.env.YOUPI_MODE === 'localhost') && options.envMode !== 'production') {
        mode = 'localhost';
      } else {
        throw new Error('Production Configuration Incomplete: Cloudflare Domain is required when running in PRODUCTION mode.');
      }
    }
  }

  if (mode === 'production') {

    const routes = deriveCloudflareRoutes({ domain, prefix });
    const getRoute = (role) => routes.find(r => r.role === role);

    return {
      mode: 'production',
      isProduction: true,
      domain,
      prefix,
      routes,
      checkoutUrl: getRoute('checkout')?.publicUrl || `https://${prefix}.${domain}`,
      checkoutHostname: getRoute('checkout')?.publicHostname || `${prefix}.${domain}`,
      apiUrl: getRoute('api')?.publicUrl || `https://${prefix}-api.${domain}`,
      apiHostname: getRoute('api')?.publicHostname || `${prefix}-api.${domain}`,
      adminUrl: getRoute('admin')?.publicUrl || `https://${prefix}-admin.${domain}`,
      adminHostname: getRoute('admin')?.publicHostname || `${prefix}-admin.${domain}`,
      gmailUrl: getRoute('gmail')?.publicUrl || `https://${prefix}-gmail.${domain}`,
      gmailHostname: getRoute('gmail')?.publicHostname || `${prefix}-gmail.${domain}`
    };
  }

  // Localhost / Development Mode
  return {
    mode: 'localhost',
    isProduction: false,
    domain: domain || 'localhost',
    prefix: prefix || 'pay',
    routes: [
      { role: 'checkout', name: 'Checkout', publicHostname: 'localhost:7000', publicUrl: 'http://localhost:7000', serviceUrl: 'http://localhost:7000', port: 7000, purpose: 'Customer checkout / checkout portal', optional: false },
      { role: 'api', name: 'Payment API', publicHostname: 'localhost:6100', publicUrl: 'http://localhost:6100', serviceUrl: 'http://localhost:6100', port: 6100, purpose: 'Payment API / merchant API / SSE / observer ingestion', optional: false },
      { role: 'admin', name: 'Merchant Admin', publicHostname: 'localhost:6001', publicUrl: 'http://localhost:6001', serviceUrl: 'http://localhost:6001', port: 6001, purpose: 'Merchant/Admin panel', optional: false },
      { role: 'gmail', name: 'Gmail OAuth / Gmail Observer', publicHostname: 'localhost:6003', publicUrl: 'http://localhost:6003', serviceUrl: 'http://localhost:6003', port: 6003, purpose: 'Gmail OAuth callback and Gmail observation service', optional: false }
    ],
    checkoutUrl: 'http://localhost:7000',
    checkoutHostname: 'localhost:7000',
    apiUrl: 'http://localhost:6100',
    apiHostname: 'localhost:6100',
    adminUrl: 'http://localhost:6001',
    adminHostname: 'localhost:6001',
    gmailUrl: 'http://localhost:6003',
    gmailHostname: 'localhost:6003'
  };
}

/**
 * Generates structured SMS Gateway QR pairing payload according to Part C1 & C2.
 */
export function createPairingPayload(options = {}) {
  const {
    serverUrl,
    sessionId = `pair_sess_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    token = `tok_${Math.random().toString(36).substring(2, 12)}`,
    merchantId = '00000000-0000-0000-0000-000000000001',
    ttlMs = 10 * 60 * 1000 // 10 minutes default
  } = options;

  return {
    version: 'v1',
    type: 'YOUPI_SMS_GATEWAY_PAIR',
    serverUrl: serverUrl || 'http://localhost:6100',
    sessionId,
    token,
    merchantId,
    expiresAt: Date.now() + ttlMs,
    issuedAt: Date.now()
  };
}

/**
 * Validates pairing payload according to Part C5.
 */
export function validatePairingPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return { valid: false, error: 'INVALID YOUPI PAIRING QR' };
  }
  if (payload.type !== 'YOUPI_SMS_GATEWAY_PAIR') {
    return { valid: false, error: 'INVALID YOUPI PAIRING QR' };
  }
  if (payload.version !== 'v1') {
    return { valid: false, error: 'INVALID YOUPI PAIRING QR VERSION' };
  }
  if (!payload.serverUrl || !payload.token || !payload.sessionId) {
    return { valid: false, error: 'MALFORMED YOUPI PAIRING QR: Missing required fields' };
  }
  if (!payload.serverUrl.startsWith('http://') && !payload.serverUrl.startsWith('https://')) {
    return { valid: false, error: 'INVALID SERVER URL PROTOCOL' };
  }
  if (payload.expiresAt && Date.now() > payload.expiresAt) {
    return { valid: false, error: 'PAIRING QR EXPIRED' };
  }
  return { valid: true };
}

/**
 * Resolves active runtime pairing API URL.
 */
export function resolvePairingUrl(options = {}) {
  const urls = resolveRuntimeUrls(options);
  return urls.apiUrl || 'http://localhost:6100';
}

/**
 * OAuth redirect URI for the Gmail observer. `GMAIL_REDIRECT_URI` wins; otherwise it is derived
 * from the configured domain, falling back to the local observer port.
 * @param {object} [branding]
 */
export function resolveGmailRedirectUri(branding = {}) {
  if (process.env.GMAIL_REDIRECT_URI) return process.env.GMAIL_REDIRECT_URI;
  try {
    return `${resolveRuntimeUrls(branding || {}).gmailUrl}/oauth/callback`;
  } catch {
    return `http://localhost:${process.env.GMAIL_OBSERVER_PORT || 6003}/oauth/callback`;
  }
}
