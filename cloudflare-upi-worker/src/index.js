import { qrcode } from '../public/qr-lib.js';

const DEFAULT_MERCHANT_ID = '00000000-0000-0000-0000-000000000001';
const MAX_BODY_BYTES = 16 * 1024;
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

function originFor(request, env) {
  return (env.LOKPRAVAAH_FRONTEND_ORIGIN || 'https://lokpravaah.online').trim().replace(/\/$/, '');
}
function baseFor(request, env) {
  return (env.PUBLIC_BASE_URL || new URL(request.url).origin).trim().replace(/\/$/, '');
}
function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = originFor(request, env);
  return {
    // Never grant browser read access to responses requested by an untrusted origin.
    // Requests without an Origin (for example, native clients) do not need CORS.
    ...(origin && origin === allowed ? { 'Access-Control-Allow-Origin': allowed } : {}),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Idempotency-Key, X-Merchant-Id, X-Device-Id, X-Timestamp, X-Signature',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}
function json(request, env, body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...SECURITY_HEADERS,
      ...corsHeaders(request, env),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}
function text(request, env, body, status = 200, contentType = 'text/plain; charset=utf-8', extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: {
      ...SECURITY_HEADERS,
      ...corsHeaders(request, env),
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}
function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}
function paiseFromAmount(amount) {
  if (typeof amount !== 'string' && typeof amount !== 'number') return null;
  const raw = String(amount).trim();
  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(raw)) return null;
  const [whole, fraction = ''] = raw.split('.');
  const value = Number(whole) * 100 + Number((fraction + '00').slice(0, 2));
  return Number.isSafeInteger(value) && value >= 100 && value <= 10_000_000 ? value : null;
}
function rupees(paise) { return (Number(paise) / 100).toFixed(2); }
function generateQrSvg(value, boxSize = 260) {
  const qr = qrcode(0, 'M');
  qr.addData(value);
  qr.make();
  const count = qr.getModuleCount();
  const moduleSize = boxSize / count;
  let rects = '';
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) {
        const x = (col * moduleSize).toFixed(2);
        const y = (row * moduleSize).toFixed(2);
        const size = (moduleSize + 0.05).toFixed(2);
        rects += `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="#0f172a"/>`;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${boxSize} ${boxSize}" width="${boxSize}" height="${boxSize}" shape-rendering="crispEdges"><rect width="${boxSize}" height="${boxSize}" fill="#fff"/>${rects}</svg>`;
}
function hex(bytes) { return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join(''); }
async function sha256Hex(value) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}
async function hmacHex(secret, value) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
}
async function verifyDeviceSignature(rawText, request, signingKey) {
  const ts = request.headers.get('X-Timestamp') || '';
  const signature = (request.headers.get('X-Signature') || '').toLowerCase();
  if (!/^\d{10,13}$/.test(ts) || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const tsNumber = Number(ts);
  if (!Number.isFinite(tsNumber) || Math.abs(Date.now() - tsNumber) > 60_000) return false;
  const expected = await hmacHex(signingKey, `${rawText}:${ts}`);
  return constantTimeEqual(expected, signature);
}
function supabaseConfig(env) {
  const url = (env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const key = (env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key || !/^https:\/\//i.test(url)) throw new Error('SUPABASE_NOT_CONFIGURED');
  return { url, key };
}
async function sbRequest(env, path, options = {}) {
  const { url, key } = supabaseConfig(env);
  const response = await fetch(`${url}/rest/v1/${path}`, {
    method: options.method || 'GET',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(options.prefer ? { Prefer: options.prefer } : {}),
      ...(options.headers || {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const bodyText = await response.text();
  let body = null;
  if (bodyText) {
    try { body = JSON.parse(bodyText); } catch { body = bodyText; }
  }
  if (!response.ok) {
    const error = new Error(`SUPABASE_HTTP_${response.status}`);
    error.status = response.status;
    error.details = typeof body === 'object' && body ? (body.message || body.details || body.hint || body.code) : undefined;
    throw error;
  }
  return body;
}
async function rpc(env, name, args) {
  return sbRequest(env, `rpc/${name}`, { method: 'POST', body: args });
}
async function getPayment(env, id) {
  const rows = await sbRequest(env, `upi_gateway_payments?id=eq.${encodeURIComponent(id)}&select=id,merchant_id,order_id,amount_paise,currency,status,queue_position,expires_at,completed_at,bank_reference_number,receiver_vpa,receiver_name,created_at&limit=1`);
  return Array.isArray(rows) ? rows[0] || null : null;
}
async function getReceiverSettings(env) {
  // Prefer approved DB settings so Admin → Donations & UPI cannot silently diverge
  // from the actual beneficiary encoded into a hosted payment link.
  try {
    const saved = await rpc(env, 'upi_gateway_get_receiver_settings', {});
    const receivingVpa = String(saved?.receivingVpa || saved?.receiving_vpa || '').trim();
    const payeeName = String(saved?.payeeName || saved?.payee_name || '').trim();
    if (receivingVpa || payeeName) return { receivingVpa, payeeName, source: 'admin_settings' };
  } catch { /* Existing installs can still use Worker environment settings as fallback. */ }
  return {
    receivingVpa: String(env.UPI_VPA || '').trim(),
    payeeName: String(env.UPI_PAYEE_NAME || '').trim(),
    source: 'worker_environment',
  };
}
function isValidReceiver(receiver) {
  return Boolean(receiver
    && /^[A-Za-z0-9._-]{2,256}@[A-Za-z0-9.-]{2,64}$/.test(String(receiver.receivingVpa || '').trim())
    && String(receiver.payeeName || '').trim()
    && String(receiver.payeeName).trim().length <= 99);
}
function buildUpiUri(payment, env, receiver = null) {
  // When a receiver settings object is supplied, treat it as authoritative.
  // Never mix a partial admin-configured beneficiary with Worker env values:
  // the SQL payment row snapshots this same receiver and must match the QR/intent.
  const vpa = String(receiver ? receiver.receivingVpa || '' : env.UPI_VPA || '').trim();
  const payee = String(receiver ? receiver.payeeName || '' : env.UPI_PAYEE_NAME || '').trim();
  // UPI app parsers vary. Reject malformed receiver config before showing a QR.
  if (!/^[A-Za-z0-9._-]{2,256}@[A-Za-z0-9.-]{2,64}$/.test(vpa) || !payee || payee.length > 99) return null;

  // NPCI's merchant transaction reference is limited to 35 digits. The old
  // implementation sent a UUID with 36 chars (hyphens included); that is out of
  // spec and some PSP apps fail with a generic technical error. Prefer an order
  // ID only when it is already numeric and compliant. Otherwise derive a stable,
  // 35-digit numeric reference from the stored payment UUID (no truncation).
  const orderRef = String(payment.order_id || '').trim();
  const idHex = String(payment.id || '').replace(/-/g, '');
  let txnRef = /^\d{1,35}$/.test(orderRef) ? orderRef : '';
  if (!txnRef && /^[a-f0-9]{32}$/i.test(idHex)) {
    const min = 10n ** 34n;
    const range = 9n * min;
    txnRef = (min + (BigInt(`0x${idHex}`) % range)).toString();
  }
  if (!/^\d{1,35}$/.test(txnRef)) return null;

  const params = new URLSearchParams();
  params.set('pa', vpa);
  params.set('pn', payee);
  params.set('am', rupees(payment.amount_paise));
  params.set('cu', 'INR');
  // Keep the human note short; transaction references belong in `tr`, not `tn`.
  params.set('tn', `LokPravaah ${orderRef}`.slice(0, 50));
  params.set('tr', txnRef);
  // URLSearchParams uses '+' for spaces (HTML form encoding). Percent-encode
  // spaces as %20 for compatibility with UPI intent/QR parsers.
  return `upi://pay?${params.toString().replace(/\+/g, '%20')}`;
}
function publicPayment(payment, env, receiver = null) {
  const canPay = payment.status === 'ACTIVE';
  return {
    paymentId: payment.id,
    orderId: payment.order_id,
    amount: rupees(payment.amount_paise),
    amountPaise: String(payment.amount_paise),
    currency: payment.currency,
    status: payment.status,
    method: 'UPI',
    queuePosition: payment.status === 'QUEUED' ? Number(payment.queue_position || 1) : 0,
    expiresAt: payment.expires_at,
    completedAt: payment.completed_at,
    checkoutUrl: `${(env.PUBLIC_BASE_URL || '').replace(/\/$/, '')}/checkout/${payment.id}`,
    ...(canPay && buildUpiUri(payment, env, receiver) ? { upiUri: buildUpiUri(payment, env, receiver) } : {}),
  };
}
async function updateDonationWebhook(env, eventPayload) {
  // Prefer a dedicated signing secret; the server-only Supabase key is a secure
  // compatibility fallback for existing deployments that have not provisioned one.
  const secret = (env.LOKPRAVAAH_DONATION_WEBHOOK_SECRET || env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const target = (env.LOKPRAVAAH_DONATION_WEBHOOK_URL || '').trim();
  if (!secret || !target || !/^https:\/\//i.test(target)) throw new Error('WEBHOOK_NOT_CONFIGURED');
  const raw = JSON.stringify(eventPayload);
  const signature = await hmacHex(secret, raw);
  const response = await fetch(target, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Gateway-Event': String(eventPayload.event || ''),
      'X-Gateway-Signature': `sha256=${signature}`,
      'X-Gateway-Delivery-Id': crypto.randomUUID(),
    },
    body: raw,
  });
  const responseText = await response.text();
  if (!response.ok) {
    const error = new Error(`DONATION_WEBHOOK_HTTP_${response.status}`);
    error.status = response.status;
    error.details = responseText.slice(0, 240);
    throw error;
  }
  let result = {};
  try { result = responseText ? JSON.parse(responseText) : {}; } catch {}
  return result;
}
function extractBankPayment(body) {
  let amountPaise = Number.isSafeInteger(Number(body.amountPaise)) ? Number(body.amountPaise) : null;
  let bankRef = String(body.bankReferenceNumber || body.utr || body.transactionReference || body.transactionId || '').trim();
  let senderVpa = String(body.senderVpa || body.senderVpaAddress || '').trim();
  const observedTime = body.observedAt ?? body.timestamp ?? body.createdAt ?? body.postedAt;
  const observedAt = observedTime !== undefined && observedTime !== null ? new Date(observedTime) : new Date();

  // Android notification/SMS bridges vary in field names. Combine only text fields, never
  // persist or log this raw content; it is used in-memory for credit classification.
  const textCandidates = [
    body.body, body.sms, body.rawSms, body.message, body.text, body.notificationText,
    body.notificationBody, body.contentText, body.tickerText,
    body.rawNotification?.title, body.rawNotification?.text, body.rawNotification?.bigText,
    body.notification?.title, body.notification?.text, body.notification?.bigText,
    body.notificationTitle, body.notification?.body,
  ];
  const rawText = [...new Set(textCandidates.filter(value => typeof value === 'string').map(value => value.trim()).filter(Boolean))]
    .join(' ').slice(0, 64 * 1024);
  const lower = rawText.toLowerCase();
  const direction = String(body.direction || body.transactionDirection || body.transactionType || body.creditDebit || body.credit_debit || '').toLowerCase();
  const explicitCredit = body.isCredit === true || body.isIncoming === true
    || /^(credit|credited|incoming|inbound|received|upi_credit|bank_credit)$/.test(direction);
  const explicitDebit = body.isDebit === true || body.isOutgoing === true
    || /^(debit|debited|outgoing|outbound|sent|upi_debit|bank_debit)$/.test(direction);
  const positive = /\b(credited|credit of|credit to|credit received|received|deposited|has been credited|payment received|money received|upi\/cr|\bcr\b)\b/i.test(rawText);
  const negative = /\b(debited|debit|sent from|sent to|paid to|withdrawn|cash withdrawal|purchase|deducted|upi\/dr|\bdr\b)\b/i.test(rawText);

  // A clear debit/outgoing notification must never be treated as proof of receiving money,
  // even when the client supplies amount/reference fields alongside the text.
  if (explicitDebit || negative || (rawText && !positive && !explicitCredit)) {
    amountPaise = null;
    bankRef = '';
  } else if ((!amountPaise || !bankRef) && rawText) {
    const amountPatterns = [
      /(?:credited|received|deposited|credit(?:ed)? of|payment received|money received)[^\d₹]{0,28}(?:INR|Rs\.?|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i,
      /(?:INR|Rs\.?|₹)\s*([\d,]+(?:\.\d{1,2})?)/i,
      /([\d,]+(?:\.\d{1,2})?)\s*(?:INR|Rs\.?|₹)/i,
    ];
    if (!amountPaise) {
      for (const pattern of amountPatterns) {
        const match = rawText.match(pattern);
        if (!match) continue;
        amountPaise = paiseFromAmount(match[1].replace(/,/g, ''));
        if (amountPaise !== null) break;
      }
    }
    if (!bankRef) {
      const referencePatterns = [
        /\b(?:UTR|RRN)\s*[:#\-]?\s*([A-Za-z0-9_-]{6,80})\b/i,
        /\bUPI[\s/_-]*(?:REF(?:ERENCE)?|TXN|TRANSACTION)[\s/_-]*(?:NO\.?|ID|NUMBER)?\s*[:#\-]?\s*([A-Za-z0-9_-]{6,80})\b/i,
        /\b(?:TRANSACTION|TXN)[\s/_-]*(?:ID|REF(?:ERENCE)?|NO\.?)\s*[:#\-]?\s*([A-Za-z0-9_-]{6,80})\b/i,
        /\bUPI[/#-]([A-Za-z0-9_-]{6,80})\b/i,
      ];
      for (const pattern of referencePatterns) {
        const match = rawText.match(pattern);
        if (match) { bankRef = match[1]; break; }
      }
    }
  }

  if (!Number.isSafeInteger(amountPaise) || amountPaise < 100 || amountPaise > 10_000_000) amountPaise = null;
  if (!/^[A-Za-z0-9_-]{6,80}$/.test(bankRef)) bankRef = '';
  return { amountPaise, bankRef, senderVpa: senderVpa.slice(0, 200), observedAt: Number.isNaN(observedAt.getTime()) ? new Date() : observedAt, rawText };
}
function parsePairingExpiry(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number' || /^\d{10,13}$/.test(String(value).trim())) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : NaN;
  }
  const parsed = Date.parse(String(value).trim());
  return Number.isFinite(parsed) ? parsed : NaN;
}
function pairingToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
async function authorizeConsoleSuperAdmin(request, env) {
  const header = request.headers.get('Authorization') || '';
  const accessToken = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!accessToken || accessToken.length > 8192) return { authorized: false, status: 401 };

  // Verify the signed-in Supabase session with Auth; never trust a role sent by the browser.
  const { url, key } = supabaseConfig(env);
  const userResponse = await fetch(`${url}/auth/v1/user`, {
    method: 'GET',
    headers: { apikey: key, Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (!userResponse.ok) return { authorized: false, status: 401 };
  let authUser;
  try { authUser = await userResponse.json(); } catch { return { authorized: false, status: 401 }; }
  if (!authUser?.id || typeof authUser.id !== 'string') return { authorized: false, status: 401 };

  // Read trusted roles server-side with the service-role key. Only super_admin may pair devices.
  const rows = await sbRequest(env, `user_roles?user_id=eq.${encodeURIComponent(authUser.id)}&select=role&limit=20`);
  const authorized = Array.isArray(rows) && rows.some(row => row?.role === 'super_admin');
  return { authorized, status: authorized ? 200 : 403 };
}
async function makePairing(request, env) {
  const authorization = await authorizeConsoleSuperAdmin(request, env);
  if (!authorization.authorized) {
    const status = authorization.status === 403 ? 403 : 401;
    return { response: json(request, env, { error: status === 403 ? 'Super administrator access required' : 'Sign in again to continue' }, status) };
  }
  const now = Date.now();
  const token = pairingToken();
  const tokenHash = await sha256Hex(token);
  const expiresAt = now + 10 * 60 * 1000;
  await sbRequest(env, 'upi_gateway_pairing_tokens', {
    method: 'POST', prefer: 'return=minimal',
    body: { token_hash: tokenHash, merchant_id: env.MERCHANT_ID || DEFAULT_MERCHANT_ID, expires_at: new Date(expiresAt).toISOString() },
  });
  const payload = {
    type: 'YOUPI_SMS_GATEWAY_PAIR',
    version: 'v1',
    serverUrl: baseFor(request, env),
    gatewayUrl: baseFor(request, env),
    apiBaseUrl: baseFor(request, env),
    enrollmentToken: token,
    merchantId: env.MERCHANT_ID || DEFAULT_MERCHANT_ID,
    expiresAt,
  };
  const payloadText = JSON.stringify(payload);
  return { response: json(request, env, { expiresAt, pairingPayload: payloadText }) };
}
function checkoutHtml(paymentId, env) {
  const safeId = JSON.stringify(paymentId).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="referrer" content="strict-origin-when-cross-origin"><title>LokPravaah Secure UPI Checkout</title><style>
  :root{color-scheme:light;--ink:#152136;--muted:#63718a;--line:#e2e8f0;--green:#12855c}*{box-sizing:border-box}body{margin:0;background:linear-gradient(145deg,#e9fff5,#f4f7fb 60%,#edf2ff);color:var(--ink);font:15px/1.45 Inter,system-ui,-apple-system,Segoe UI,sans-serif;min-height:100vh;display:grid;place-items:center;padding:16px}.wrap{background:white;border:1px solid #e0e8e6;border-radius:24px;width:min(100%,510px);overflow:hidden;box-shadow:0 22px 65px #1a4c3c1a}.top{padding:24px 24px 20px;background:#0b211d;color:white}.brand{font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#9be7c8;font-weight:800}.top h1{font-size:23px;margin:9px 0 2px}.top p{margin:0;color:#c7d9d4}.content{padding:24px}.amount{font-size:36px;font-weight:850;letter-spacing:-.04em;margin:3px 0 12px}.meta{display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid var(--line);padding:9px 0;color:var(--muted);font-size:13px}.meta strong{color:var(--ink);text-align:right;overflow-wrap:anywhere}.state{margin:18px 0 14px;padding:12px 14px;border-radius:12px;background:#f1f5f9;color:#334155;font-size:14px}.qrbox{display:none;text-align:center;border:1px solid var(--line);border-radius:18px;padding:14px;margin-top:16px}.qrbox img{width:min(100%,250px);height:auto;image-rendering:pixelated}.qrbox small{display:block;color:var(--muted)}.btn{display:block;width:100%;text-align:center;border:0;border-radius:12px;padding:14px 15px;text-decoration:none;font:inherit;font-weight:800;cursor:pointer;margin-top:10px}.primary{background:var(--green);color:white}.secondary{background:#f0f5f4;color:#215d49}.btn[hidden]{display:none!important}.note{font-size:12px;color:var(--muted);margin:16px 0 0}.ref{font:12px ui-monospace,monospace;color:var(--muted);overflow-wrap:anywhere}.spinner{display:inline-block;width:15px;height:15px;border:2px solid #b4c0cf;border-top-color:#12855c;border-radius:50%;animation:spin .8s linear infinite;vertical-align:-2px;margin-right:6px}@keyframes spin{to{transform:rotate(360deg)}}@media(max-width:400px){.content{padding:18px}.top{padding:20px}.amount{font-size:31px}}</style></head><body><main class="wrap"><header class="top"><div class="brand">LOKPRAVAAH · SECURE CHECKOUT</div><h1>Complete your contribution</h1><p>UPI payment directly to the configured receiving account</p></header><section class="content"><div id="amount" class="amount">Loading…</div><div class="meta"><span>Reference</span><strong id="order">—</strong></div><div class="meta"><span>Payment status</span><strong id="statusValue">Loading</strong></div><div id="notice" class="state" role="status"><span class="spinner"></span> Checking your payment session…</div><div id="qrbox" class="qrbox"><img id="qr" alt="Scan with any UPI app"><small>Scan this QR using your UPI app</small></div><a id="openUpi" class="btn primary" href="#" hidden>Open UPI app</a><button id="manualConfirm" class="btn secondary" type="button" hidden>I paid — enter UTR / upload proof</button><button id="cancel" class="btn secondary" type="button">Cancel checkout</button><p class="note">Do not pay if the reference, amount or receiving payee shown in your UPI app looks incorrect. Payment is marked successful only after administrator verification against the receiving-bank statement and UTR. Screenshots alone do not verify payment.</p><p class="ref" id="pid"></p></section></main><script>
  const id=${safeId};let current=null,done=false;const amountEl=document.getElementById('amount'),orderEl=document.getElementById('order'),statusEl=document.getElementById('statusValue'),notice=document.getElementById('notice'),qrbox=document.getElementById('qrbox'),qr=document.getElementById('qr'),openUpi=document.getElementById('openUpi'),manualConfirm=document.getElementById('manualConfirm'),cancel=document.getElementById('cancel'),pid=document.getElementById('pid');pid.textContent='Payment ID: '+id;function parentOrigin(){try{return new URL(document.referrer).origin}catch{return '*'}}function tell(event,data={}){try{window.parent.postMessage({event,data},parentOrigin())}catch{}}
  function terminal(status){return ['SUCCESS','FAILED','SUSPICIOUS','EXPIRED','CANCELLED'].includes(String(status||'').toUpperCase())}function show(s){current=s;amountEl.textContent='₹'+Number(s.amount||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});orderEl.textContent=s.orderId||'—';statusEl.textContent=s.status||'UNKNOWN';qrbox.style.display='none';openUpi.hidden=true;manualConfirm.hidden=!['ACTIVE','PROCESSING','SUSPICIOUS','EXPIRED','FAILED','CANCELLED'].includes(String(s.status||'').toUpperCase());cancel.hidden=terminal(s.status);if(s.status==='ACTIVE'&&s.upiUri){notice.textContent='Your payment session is active. Scan the QR or open your UPI app. After payment, choose “I paid — enter UTR / upload proof” to submit your receipt without leaving this checkout. Do not pay again while it is under review.';qrbox.style.display='block';qr.alt='Loading UPI QR code';import('/qr.js').then(m=>{if(!done&&current&&current.status==='ACTIVE'){const svg=m.generateQrSvg(s.upiUri,260);if(qr.dataset.uri!==s.upiUri){if(qr.dataset.blobUrl)URL.revokeObjectURL(qr.dataset.blobUrl);const blobUrl=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));qr.src=blobUrl;qr.dataset.blobUrl=blobUrl;qr.dataset.uri=s.upiUri;}}}).catch(()=>{notice.textContent='QR generation failed on this device. Use the Open UPI app button if available.';});openUpi.href=s.upiUri;openUpi.target='_top';openUpi.hidden=false;}else if(s.status==='QUEUED'){notice.innerHTML='<span class="spinner"></span> You are in the secure payment queue. Do not send any payment yet. Queue position: '+String(Number(s.queuePosition||1)) +'.';}else if(s.status==='PROCESSING'){notice.innerHTML='<span class="spinner"></span> Session is processing. If money was debited, submit the UTR and receipt for manual administrator review.';}else if(s.status==='SUCCESS'){notice.textContent='Donation verified after administrator bank-record review. Check My donations for the successful record and receipt details.';done=true;}else if(s.status==='EXPIRED'){notice.textContent='This payment session expired. Check your bank statement before creating another attempt.';if(!done){done=true;tell('youpi.payment_expired',{orderId:s.orderId});}}else if(s.status==='FAILED'){notice.textContent='The payment was not confirmed. If money was debited, check your bank statement before retrying.';if(!done){done=true;tell('youpi.payment_failed',{orderId:s.orderId,reason:'PAYMENT_NOT_CONFIRMED'});}}else if(s.status==='SUSPICIOUS'){notice.textContent='This transaction needs review. Do not retry until it is checked.';if(!done){done=true;tell('youpi.payment_blocked',{orderId:s.orderId});}}else if(s.status==='CANCELLED'){notice.textContent='Checkout cancelled. Check your bank statement if you had already approved the transfer.';if(!done){done=true;tell('youpi.payment_cancelled',{orderId:s.orderId});}}else{notice.textContent='Payment status: '+String(s.status||'UNKNOWN');}}
  async function poll(){if(done)return;try{const r=await fetch('/api/v1/payments/'+encodeURIComponent(id),{cache:'no-store'});const s=await r.json();if(!r.ok)throw new Error(s.error||'Unable to load payment');show(s);}catch(e){notice.textContent='Connection issue. Retrying status check; do not pay again if your bank shows a debit.';}if(!done)setTimeout(poll,5000);}
  manualConfirm.addEventListener('click',()=>{
    if(!current||!['ACTIVE','PROCESSING','SUCCESS','SUSPICIOUS','EXPIRED','FAILED','CANCELLED'].includes(String(current.status||'').toUpperCase()))return;
    manualConfirm.disabled=true;
    notice.textContent='Returning to the donation page to submit your UTR and payment receipt…';
    tell('youpi.manual_payment_request',{orderId:current.orderId||'',paymentId:id,amount:Number(current.amount||0),status:current.status});
  });
  cancel.addEventListener('click',async()=>{
    cancel.disabled=true;
    try{
      const r=await fetch('/api/v1/payments/'+encodeURIComponent(id)+'/cancel',{method:'POST'});
      const d=await r.json();
      if(r.ok)show(d);else notice.textContent=d.error||'Could not cancel the session. Check payment status before retrying.';
    }catch{notice.textContent='Network issue while cancelling. Check payment status before retrying.'}
    finally{cancel.disabled=false;}
  });
  window.addEventListener('message',async e=>{if(e.data&&e.data.event==='youpi.request_cancel'){cancel.click();}else if(e.data&&e.data.event==='youpi.reset_manual_payment_request'){manualConfirm.disabled=false;notice.textContent='Your payment session is still open. Scan the same QR or use your UPI app; submit proof here only after your bank confirms the debit.';}});poll();
</script></body></html>`;
}
async function respondAsset(request, env) {
  if (!env.ASSETS) return text(request, env, 'Worker asset binding is missing. Check wrangler.jsonc.', 500);
  const assetResponse = await env.ASSETS.fetch(new Request(new URL(new URL(request.url).pathname, request.url), { method: 'GET' }));
  if (assetResponse.status === 404) return text(request, env, 'Not found', 404);
  const headers = new Headers(assetResponse.headers);
  Object.entries(SECURITY_HEADERS).forEach(([k, v]) => headers.set(k, v));
  headers.set('Access-Control-Allow-Origin', '*');
  if (new URL(request.url).pathname === '/youpi.js') headers.set('Cache-Control', 'public, max-age=300');
  return new Response(assetResponse.body, { status: assetResponse.status, headers });
}
async function issueDonationSuccessWebhook(env, payment, bankRef, observedAt) {
  return updateDonationWebhook(env, {
    event: 'SUCCESS',
    paymentId: payment.id,
    orderId: payment.order_id,
    amountPaise: Number(payment.amount_paise),
    currency: 'INR',
    utr: bankRef,
    completedAt: observedAt,
  });
}
async function finishObservation(env, match, bankRef, senderVpa, observedAt) {
  if (!match || !match.paymentId || !match.orderId) return { accepted: true, matched: false, status: 'UNMATCHED' };
  if (match.status === 'SUCCESS') return { accepted: true, matched: true, alreadyProcessed: true, paymentId: match.paymentId };
  // The SQL RPC holds the payment in PROCESSING until the webhook is accepted. Retrying the same
  // bank reference is idempotent because the donation webhook rejects mismatched order/amounts.
  const payment = await getPayment(env, match.paymentId);
  if (!payment) throw new Error('MATCHED_PAYMENT_NOT_FOUND');
  await issueDonationSuccessWebhook(env, payment, bankRef, observedAt);
  await rpc(env, 'upi_gateway_finalize_success', {
    p_payment_id: payment.id,
    p_bank_reference_number: bankRef,
    p_sender_vpa: senderVpa || null,
    p_observed_at: observedAt,
  });
  return { accepted: true, matched: true, status: 'SUCCESS', paymentId: payment.id, orderId: payment.order_id };
}
async function handleObserverEvent(request, env, rawBody) {
  let body;
  try { body = JSON.parse(rawBody); } catch { return json(request, env, { error: 'Invalid JSON' }, 400); }
  const deviceId = request.headers.get('X-Device-Id') || String(body.deviceId || '');
  if (!deviceId) return json(request, env, { error: 'Missing device ID' }, 400);
  const devices = await sbRequest(env, `upi_gateway_devices?id=eq.${encodeURIComponent(deviceId)}&is_active=eq.true&select=id,merchant_id,signing_key&limit=1`);
  const device = Array.isArray(devices) ? devices[0] : null;
  if (!device?.signing_key) return json(request, env, { error: 'Device unauthorized or inactive' }, 403);
  if (!(await verifyDeviceSignature(rawBody, request, device.signing_key))) return json(request, env, { error: 'Invalid signature or timestamp; event rejected' }, 401);

  const parsed = extractBankPayment(body);
  await sbRequest(env, `upi_gateway_devices?id=eq.${encodeURIComponent(deviceId)}`, {
    method: 'PATCH', prefer: 'return=minimal',
    body: { last_heartbeat_at: new Date().toISOString(), last_observation_at: new Date().toISOString() },
  });
  if (!parsed.amountPaise || !parsed.bankRef) {
    return json(request, env, { accepted: true, matched: false, status: 'PROCESSED_NON_BANK', message: 'Notification was authenticated but did not contain a supported amount and unique bank reference.' });
  }

  const result = await rpc(env, 'upi_gateway_prepare_observation', {
    p_observation_id: crypto.randomUUID(),
    p_device_id: deviceId,
    p_amount_paise: parsed.amountPaise,
    p_bank_reference_number: parsed.bankRef,
    p_sender_vpa: parsed.senderVpa || null,
    p_observed_at: parsed.observedAt.toISOString(),
  });
  if (!result || result.matched !== true) {
    return json(request, env, { accepted: true, matched: false, status: result?.status || 'UNMATCHED', message: 'No active session matched this exact amount and observed-at time; no donation was confirmed.' });
  }
  const done = await finishObservation(env, result, parsed.bankRef, parsed.senderVpa, parsed.observedAt.toISOString());
  return json(request, env, done);
}

async function handler(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...SECURITY_HEADERS, ...corsHeaders(request, env) } });

  // Manual-only donation mode: keep custom-amount QR/session creation and checkout available,
  // but disable the Android pairing/notification pipeline so a phone event cannot auto-verify money.
  const disabledObserverPaths = new Set([
    '/api/v1/admin/sms-gateway/pair-qr',
    '/api/v1/pollers/android/pair',
    '/api/v1/pollers/android/events',
    '/api/v1/observers/sms',
    '/api/v1/pollers/android/heartbeat',
    '/api/v1/pollers/heartbeat',
    '/api/v1/observers/heartbeat',
  ]);
  if (disabledObserverPaths.has(path)) {
    return json(request, env, {
      error: 'Automatic UPI observer/pairing is disabled. Submit UTR and receipt for manual administrator review.',
      code: 'MANUAL_REVIEW_MODE',
      manualReviewEnabled: true,
    }, 410);
  }

  if (request.method === 'GET' && path === '/health') {
    const receiverSettings = await getReceiverSettings(env);
    const supabaseUrlConfigured = Boolean((env.SUPABASE_URL || '').trim() && /^https:\/\//i.test((env.SUPABASE_URL || '').trim()));
    const serviceRoleKeyConfigured = Boolean((env.SUPABASE_SERVICE_ROLE_KEY || '').trim());
    const supabase = supabaseUrlConfigured && serviceRoleKeyConfigured;
    const config = {
      supabase,
      supabaseUrlConfigured,
      serviceRoleKeyConfigured,
      manualReviewOnly: true,
      automaticObserverEnabled: false,
      receivingVpa: isValidReceiver(receiverSettings),
      receiverSettingsSource: receiverSettings.source,
      // Signed payment webhooks are intentionally not used in manual-only mode.
      webhook: false,
      webhookConfigured: Boolean(((env.LOKPRAVAAH_DONATION_WEBHOOK_SECRET || env.SUPABASE_SERVICE_ROLE_KEY || '').trim())
        && /^https:\/\//i.test((env.LOKPRAVAAH_DONATION_WEBHOOK_URL || '').trim())),
      admin: supabase,
    };
    let database = false;
    let databaseError = '';
    try { await sbRequest(env, 'upi_gateway_payments?select=id&limit=1'); database = true; }
    catch (error) { databaseError = error?.message === 'SUPABASE_NOT_CONFIGURED' ? 'SUPABASE_NOT_CONFIGURED' : error?.message || 'DATABASE_CHECK_FAILED'; }
    const ready = supabase && config.receivingVpa && database;
    return json(request, env, { status: ready ? 'UP' : 'CONFIGURATION_REQUIRED', service: 'lokpravaah-cloudflare-upi-gateway', checks: { ...config, database, ...(databaseError ? { databaseError } : {}) } }, ready ? 200 : 503);
  }

  // The standalone pairing page has been removed. Keep this path dark even on workers.dev.
  if (path.startsWith('/admin')) {
    return json(request, env, { error: 'Not found' }, 404);
  }
  if (request.method === 'GET' && path === '/api/v1/merchant/receiver-settings') {
    const receiver = await getReceiverSettings(env);
    return json(request, env, {
      receivingVpa: receiver.receivingVpa,
      payeeName: receiver.payeeName,
      source: receiver.source,
      configured: isValidReceiver(receiver),
    });
  }
  if (request.method === 'GET' && path === '/youpi.js') return respondAsset(request, env);
  if (path === '/api/v1/admin/sms-gateway/pair-qr') {
    if (request.method !== 'POST') return json(request, env, { error: 'Method not allowed' }, 405, { Allow: 'POST' });
    const made = await makePairing(request, env);
    return made.response;
  }
  if (request.method === 'POST' && path === '/api/v1/pollers/android/pair') {
    let body;
    try { body = await request.json(); } catch { return json(request, env, { error: 'Invalid JSON' }, 400); }

    // Manual entry and QR scanning may serialize the same enrollment payload slightly
    // differently. Normalize whitespace and accept known legacy token field aliases.
    const token = String(body.enrollmentToken || body.enrollment_token || body.enrollmentSecretToken || body.token || '').replace(/\s+/g, '').trim();
    if (!/^[a-f0-9]{64}$/i.test(token)) {
      return json(request, env, { error: 'Enrollment token must be a 64-character hexadecimal token. Generate a fresh pairing QR if needed.', code: 'INVALID_ENROLLMENT_TOKEN_FORMAT' }, 400);
    }
    if (body.version && String(body.version).trim() !== 'v1') {
      return json(request, env, { error: 'Unsupported pairing payload version. Generate a fresh pairing QR.', code: 'UNSUPPORTED_PAIRING_VERSION' }, 400);
    }

    const expiry = parsePairingExpiry(body.expiresAt);
    if (Number.isNaN(expiry) || (expiry !== null && Date.now() > expiry)) {
      return json(request, env, { error: 'Pairing QR has expired. Generate a fresh QR and connect within 10 minutes.', code: 'PAIRING_TOKEN_EXPIRED' }, 400);
    }

    const tokenHash = await sha256Hex(token);
    const deviceId = crypto.randomUUID();
    const signingKey = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
    try {
      // Old observer builds always sent the compile-time default merchant ID even when
      // a deployment had a different configured merchant. Treat that known placeholder
      // as omitted; the one-time token's database-bound merchant still decides the result.
      const requestedMerchantId = String(body.merchantId || body.merchant_id || '').trim();
      const configuredMerchantId = String(env.MERCHANT_ID || DEFAULT_MERCHANT_ID).trim();
      const merchantId = !requestedMerchantId || requestedMerchantId === DEFAULT_MERCHANT_ID
        ? configuredMerchantId
        : requestedMerchantId;
      const result = await rpc(env, 'upi_gateway_pair_device', {
        p_token_hash: tokenHash,
        p_device_id: deviceId,
        p_signing_key: signingKey,
        p_merchant_id: merchantId,
        p_device_name: String(body.deviceName || body.device_name || 'Android Observer').trim().slice(0, 100),
        p_device_model: String(body.deviceModel || body.device_model || body.model || 'Android device').trim().slice(0, 100),
        p_expires_at: expiry === null ? null : new Date(expiry).toISOString(),
      });
      if (result?.paired !== true) {
        return json(request, env, { error: 'Pairing token is invalid, expired, already used, or belongs to a different merchant. Generate a fresh pairing QR.', code: 'PAIRING_TOKEN_REJECTED' }, 401);
      }
      return json(request, env, { paired: true, deviceId, signingKey, merchantId, message: 'Android SMS Gateway paired successfully.' });
    } catch (error) {
      // Keep the raw token and signing key out of logs. Emit only the sanitized backend code.
      console.error('Android device pairing failed', { status: Number(error?.status || 0), reason: String(error?.message || 'PAIRING_BACKEND_ERROR').slice(0, 100) });
      return json(request, env, { error: 'Pairing service could not complete the request. Generate a fresh pairing QR and retry; if it repeats, check the gateway database migration.', code: 'PAIRING_BACKEND_ERROR' }, 503);
    }
  }
  if (request.method === 'POST' && (path === '/api/v1/pollers/android/events' || path === '/api/v1/observers/sms')) {
    const declaredLength = Number(request.headers.get('Content-Length') || 0);
    if (declaredLength > MAX_BODY_BYTES) return json(request, env, { error: 'Payload too large' }, 413);
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) return json(request, env, { error: 'Payload too large' }, 413);
    return handleObserverEvent(request, env, rawBody);
  }
  if (request.method === 'POST' && (path === '/api/v1/pollers/android/heartbeat' || path === '/api/v1/pollers/heartbeat' || path === '/api/v1/observers/heartbeat')) {
    let body;
    try { body = await request.json(); } catch { return json(request, env, { error: 'Invalid JSON' }, 400); }
    const deviceId = request.headers.get('X-Device-Id') || String(body.deviceId || '');
    if (!deviceId) return json(request, env, { error: 'Missing device ID' }, 400);
    const result = await sbRequest(env, `upi_gateway_devices?id=eq.${encodeURIComponent(deviceId)}&is_active=eq.true`, {
      method: 'PATCH', prefer: 'return=representation', body: { last_heartbeat_at: new Date().toISOString() },
    });
    if (!Array.isArray(result) || result.length === 0) return json(request, env, { error: 'Device unauthorized or inactive' }, 403);
    return json(request, env, { status: 'HEARTBEAT_ACK', timestamp: Date.now() });
  }

  const cancelMatch = path.match(/^\/api\/v1\/payments\/([a-f0-9-]{36})\/cancel$/i);
  if (request.method === 'POST' && cancelMatch) {
    try {
      const result = await rpc(env, 'upi_gateway_cancel_payment', { p_payment_id: cancelMatch[1] });
      if (!result?.paymentId) return json(request, env, { error: 'Payment session not found or no longer cancellable' }, 409);
      const payment = await getPayment(env, cancelMatch[1]);
      if (!payment) return json(request, env, { error: 'Payment session not found' }, 404);
      const receiver = await getReceiverSettings(env);
      const state = publicPayment(payment, env, payment.receiver_vpa && payment.receiver_name
        ? { receivingVpa: payment.receiver_vpa, payeeName: payment.receiver_name, source: 'payment_snapshot' }
        : receiver);
      if (result.retainedForVerification) return json(request, env, { ...state, status: 'CANCELLED', retainedForVerification: true });
      return json(request, env, state);
    } catch { return json(request, env, { error: 'Could not cancel payment session' }, 409); }
  }

  if (request.method === 'POST' && path === '/api/v1/payments') {
    const declaredLength = Number(request.headers.get('Content-Length') || 0);
    if (declaredLength > MAX_BODY_BYTES) return json(request, env, { error: 'Payload too large' }, 413);
    let body;
    try { body = await request.json(); } catch { return json(request, env, { error: 'Invalid JSON' }, 400); }
    const merchantId = request.headers.get('X-Merchant-Id') || body.merchantId || '';
    const expectedMerchantId = String(env.MERCHANT_ID || DEFAULT_MERCHANT_ID);
    if (!constantTimeEqual(String(merchantId), expectedMerchantId)) return json(request, env, { error: 'Merchant not found or not configured' }, 400);
    if (!String(body.orderId || '').trim() || String(body.orderId).length > 80) return json(request, env, { error: 'Missing or invalid orderId' }, 400);
    if (String(body.currency || 'INR').toUpperCase() !== 'INR') return json(request, env, { error: 'Only INR is supported' }, 400);
    const amountPaise = paiseFromAmount(body.amount);
    if (amountPaise === null) return json(request, env, { error: 'Amount must be from ₹1 to ₹1,00,000 with at most two decimal places' }, 400);
    const receiver = await getReceiverSettings(env);
    if (!buildUpiUri({ id: '123e4567-e89b-12d3-a456-426614174000', order_id: body.orderId, amount_paise: amountPaise }, env, receiver)) return json(request, env, { error: 'Real receiving UPI VPA and payee name are not configured' }, 503);
    try {
      const paymentId = crypto.randomUUID();
      const idempotencyKey = (request.headers.get('Idempotency-Key') || body.idempotencyKey || '').slice(0, 150) || null;
      const createArgs = {
        p_payment_id: paymentId,
        p_order_id: String(body.orderId).trim(),
        p_amount_paise: amountPaise,
        p_merchant_id: expectedMerchantId,
        p_idempotency_key: idempotencyKey,
        p_session_minutes: Math.max(5, Math.min(30, Number(env.PAYMENT_SESSION_MINUTES || 15))),
        p_receiver_vpa: receiver.receivingVpa,
        p_receiver_name: receiver.payeeName,
      };
      let result;
      try {
        result = await rpc(env, 'upi_gateway_create_payment', createArgs);
      } catch (error) {
        // Existing Supabase projects may still have only the original 6-argument
        // SQL function. PostgREST returns PGRST202/404 for the 8-argument call.
        // Keep legacy installs working only when the receiver came from Worker
        // environment variables; admin-selected receiver settings must fail closed
        // until the receiver-aware SQL overload is installed.
        const missingReceiverOverload = error.status === 404
          && /PGRST202|could not find the function|schema cache/i.test(String(error.details || ''));
        if (!missingReceiverOverload || receiver.source !== 'worker_environment') throw error;
        const { p_receiver_vpa, p_receiver_name, ...legacyArgs } = createArgs;
        result = await rpc(env, 'upi_gateway_create_payment', legacyArgs);
      }
      if (!result?.paymentId) return json(request, env, { error: 'Unable to create payment session' }, 409);
      const payment = await getPayment(env, result.paymentId);
      if (!payment) return json(request, env, { error: 'Payment session could not be loaded' }, 500);
      return json(request, env, { ...publicPayment(payment, env, payment.receiver_vpa && payment.receiver_name
        ? { receivingVpa: payment.receiver_vpa, payeeName: payment.receiver_name, source: 'payment_snapshot' }
        : receiver), checkoutUrl: `${baseFor(request, env)}/checkout/${payment.id}` }, 201);
    } catch (error) {
      console.error('Payment session creation failed:', error.message, error.code || '', error.details || '');
      const diagnostic = String(error.details || error.message || '').toUpperCase();
      if (diagnostic.includes('DONATION_INTENT_NOT_FOUND')) {
        return json(request, env, { error: 'Donation reference not found.', code: 'DONATION_INTENT_NOT_FOUND' }, 404);
      }
      if (diagnostic.includes('DONATION_AMOUNT_MISMATCH')) {
        return json(request, env, { error: 'Donation amount does not match the recorded amount.', code: 'DONATION_AMOUNT_MISMATCH' }, 409);
      }
      if (diagnostic.includes('DONATION_INTENT_NOT_PENDING')) {
        return json(request, env, { error: 'This donation reference has already been used. Start a fresh donation attempt.', code: 'DONATION_INTENT_NOT_PENDING' }, 409);
      }
      const status = error.status === 404 ? 404 : error.status === 409 || error.code === '23505' ? 409 : error.status === 400 ? 400 : 502;
      return json(request, env, { error: 'Could not create this payment session. Verify the UPI gateway SQL migration and pending donation intent.', code: 'PAYMENT_SESSION_CREATION_FAILED', retryable: status >= 500 }, status);
    }
  }

  const paymentMatch = path.match(/^\/api\/v1\/payments\/([a-f0-9-]{36})$/i);
  if (request.method === 'GET' && paymentMatch) {
    try {
      await rpc(env, 'upi_gateway_tick', {});
      const payment = await getPayment(env, paymentMatch[1]);
      if (!payment) return json(request, env, { error: 'Payment session not found' }, 404);
      const receiver = await getReceiverSettings(env);
      return json(request, env, publicPayment(payment, env, payment.receiver_vpa && payment.receiver_name
        ? { receivingVpa: payment.receiver_vpa, payeeName: payment.receiver_name, source: 'payment_snapshot' }
        : receiver));
    } catch (error) {
      console.error('Payment status lookup failed:', error.message);
      return json(request, env, { error: 'Payment status is temporarily unavailable' }, 503);
    }
  }
  const stateMatch = path.match(/^\/api\/v1\/checkout\/([a-f0-9-]{36})\/state$/i);
  if (request.method === 'GET' && stateMatch) {
    try {
      await rpc(env, 'upi_gateway_tick', {});
      const payment = await getPayment(env, stateMatch[1]);
      if (!payment) return json(request, env, { error: 'Payment session not found' }, 404);
      const receiver = await getReceiverSettings(env);
      return json(request, env, publicPayment(payment, env, receiver));
    } catch { return json(request, env, { error: 'Payment status unavailable' }, 503); }
  }
  const qrMatch = path.match(/^\/checkout\/([a-f0-9-]{36})\/qr\.svg$/i);
  if (request.method === 'GET' && qrMatch) {
    try {
      const payment = await getPayment(env, qrMatch[1]);
      if (!payment) return text(request, env, 'Payment session not found', 404);
      if (payment.status !== 'ACTIVE') return text(request, env, 'QR is only available when this payment has the active queue slot.', 409);
      const receiver = await getReceiverSettings(env);
      const uri = buildUpiUri(payment, env, payment.receiver_vpa && payment.receiver_name
        ? { receivingVpa: payment.receiver_vpa, payeeName: payment.receiver_name, source: 'payment_snapshot' }
        : receiver);
      if (!uri) return text(request, env, 'Receiver UPI details are not configured.', 503);
      return text(request, env, generateQrSvg(uri, 260), 200, 'image/svg+xml; charset=utf-8');
    } catch { return text(request, env, 'QR temporarily unavailable', 503); }
  }
  const checkoutMatch = path.match(/^\/checkout\/([a-f0-9-]{36})$/i);
  if (request.method === 'GET' && checkoutMatch) {
    return text(request, env, checkoutHtml(checkoutMatch[1], env), 200, 'text/html; charset=utf-8', {
      'Content-Security-Policy': `default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors ${originFor(request, env)}; base-uri 'none'; object-src 'none'`,
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    });
  }

  if (request.method === 'GET') return respondAsset(request, env);
  return json(request, env, { error: 'Not found' }, 404);
}

export default {
  async fetch(request, env) {
    try { return await handler(request, env); }
    catch (error) {
      console.error('Gateway request failed:', error.message, error.status || '');
      const status = error.message === 'SUPABASE_NOT_CONFIGURED' ? 503 : 500;
      return json(request, env, { error: status === 503 ? 'Gateway storage is not configured' : 'Gateway request failed. Check server configuration and migration status.' }, status);
    }
  },
};
