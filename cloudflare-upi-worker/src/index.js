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
    'Access-Control-Allow-Origin': origin === allowed ? allowed : allowed,
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
  const rows = await sbRequest(env, `upi_gateway_payments?id=eq.${encodeURIComponent(id)}&select=id,merchant_id,order_id,amount_paise,currency,status,queue_position,expires_at,completed_at,bank_reference_number,created_at,receiver_vpa,receiver_name&limit=1`);
  return Array.isArray(rows) ? rows[0] || null : null;
}
async function getPaymentSettings(env) {
  const rows = await sbRequest(env, 'donation_settings?id=eq.true&select=upi_vpa,upi_payee_name,payment_session_minutes,gateway_merchant_key&limit=1');
  const row = Array.isArray(rows) ? rows[0] || {} : {};
  return {
    receiverVpa: String(row.upi_vpa || env.UPI_VPA || '').trim(),
    receiverName: String(row.upi_payee_name || env.UPI_PAYEE_NAME || '').trim(),
    sessionMinutes: Math.max(5, Math.min(30, Number(row.payment_session_minutes || env.PAYMENT_SESSION_MINUTES || 15))),
    merchantId: String(row.gateway_merchant_key || env.MERCHANT_ID || DEFAULT_MERCHANT_ID).trim(),
  };
}
function buildUpiUri(payment, env) {
  const vpa = (payment.receiver_vpa || env.UPI_VPA || '').trim();
  const payee = (payment.receiver_name || env.UPI_PAYEE_NAME || '').trim();
  if (!vpa || !payee || !/^[^\s@]+@[^\s@]+$/.test(vpa)) return null;
  const params = new URLSearchParams({
    pa: vpa,
    pn: payee,
    am: rupees(payment.amount_paise),
    cu: 'INR',
    tn: `LokPravaah ${payment.order_id}`.slice(0, 80),
    tr: payment.id,
  });
  return `upi://pay?${params.toString()}`;
}
function publicPayment(payment, env) {
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
    ...(canPay && buildUpiUri(payment, env) ? { upiUri: buildUpiUri(payment, env) } : {}),
  };
}
async function updateDonationWebhook(env, eventPayload) {
  const secret = (env.LOKPRAVAAH_DONATION_WEBHOOK_SECRET || '').trim();
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
  let bankRef = String(body.bankReferenceNumber || body.utr || '').trim();
  let senderVpa = String(body.senderVpa || '').trim();
  const observedTime = body.observedAt ?? body.timestamp ?? body.createdAt;
  const observedAt = observedTime !== undefined && observedTime !== null ? new Date(observedTime) : new Date();
  const rawText = String(body.body || body.sms || body.rawSms || body.message || body.text || body.rawNotification?.text || '').slice(0, 64 * 1024);

  if ((!amountPaise || !bankRef) && rawText) {
    const lower = rawText.toLowerCase();
    const positive = /\b(credited|credit of|received|deposited|has been credited|payment received|upi\/cr)\b/.test(lower);
    const negative = /\b(debited|debit|sent|paid to|withdrawn|cash withdrawal|purchase)\b/.test(lower);
    if (positive && !negative) {
      const amountMatch = rawText.match(/(?:INR|Rs\.?|₹)\s*([\d,]+(?:\.\d{1,2})?)|([\d,]+(?:\.\d{1,2})?)\s*(?:INR|Rs\.?|₹)/i);
      if (!amountPaise && amountMatch) {
        const numberText = (amountMatch[1] || amountMatch[2]).replace(/,/g, '');
        amountPaise = paiseFromAmount(numberText);
      }
      if (!bankRef) {
        const refMatch = rawText.match(/(?:UTR|UPI\s*(?:Ref(?:erence)?|Txn)(?:\s*(?:No\.?|ID|Number))?|RRN|Transaction\s*(?:ID|Ref(?:erence)?|No\.?))\s*[:#\-]?\s*([A-Za-z0-9_-]{6,80})/i);
        if (refMatch) bankRef = refMatch[1];
      }
    }
  }
  if (!Number.isSafeInteger(amountPaise) || amountPaise < 100 || amountPaise > 10_000_000) amountPaise = null;
  if (!/^[A-Za-z0-9_-]{6,80}$/.test(bankRef)) bankRef = '';
  return { amountPaise, bankRef, senderVpa: senderVpa.slice(0, 200), observedAt: Number.isNaN(observedAt.getTime()) ? new Date() : observedAt, rawText };
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
  let merchantId;
  try { merchantId = (await getPaymentSettings(env)).merchantId; }
  catch (error) {
    console.error('Could not load merchant settings for pairing:', error.message);
    return { response: json(request, env, { error: 'Could not load the configured merchant ID. Apply the latest UPI SQL migration and check Worker settings.' }, 503) };
  }
  const now = Date.now();
  const token = pairingToken();
  const tokenHash = await sha256Hex(token);
  const expiresAt = now + 10 * 60 * 1000;
  await sbRequest(env, 'upi_gateway_pairing_tokens', {
    method: 'POST', prefer: 'return=minimal',
    body: { token_hash: tokenHash, merchant_id: merchantId, expires_at: new Date(expiresAt).toISOString() },
  });
  const payload = {
    type: 'YOUPI_SMS_GATEWAY_PAIR',
    version: 'v1',
    serverUrl: baseFor(request, env),
    gatewayUrl: baseFor(request, env),
    apiBaseUrl: baseFor(request, env),
    enrollmentToken: token,
    merchantId,
    expiresAt,
  };
  const payloadText = JSON.stringify(payload);
  return { response: json(request, env, { expiresAt, pairingPayload: payloadText }) };
}
function checkoutHtml(paymentId, env) {
  const safeId = JSON.stringify(paymentId).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="referrer" content="strict-origin-when-cross-origin"><title>LokPravaah Secure UPI Checkout</title><style>
  :root{color-scheme:light;--ink:#152136;--muted:#63718a;--line:#e2e8f0;--green:#12855c}*{box-sizing:border-box}body{margin:0;background:linear-gradient(145deg,#e9fff5,#f4f7fb 60%,#edf2ff);color:var(--ink);font:15px/1.45 Inter,system-ui,-apple-system,Segoe UI,sans-serif;min-height:100vh;display:grid;place-items:center;padding:16px}.wrap{background:white;border:1px solid #e0e8e6;border-radius:24px;width:min(100%,510px);overflow:hidden;box-shadow:0 22px 65px #1a4c3c1a}.top{padding:24px 24px 20px;background:#0b211d;color:white}.brand{font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#9be7c8;font-weight:800}.top h1{font-size:23px;margin:9px 0 2px}.top p{margin:0;color:#c7d9d4}.content{padding:24px}.amount{font-size:36px;font-weight:850;letter-spacing:-.04em;margin:3px 0 12px}.meta{display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid var(--line);padding:9px 0;color:var(--muted);font-size:13px}.meta strong{color:var(--ink);text-align:right;overflow-wrap:anywhere}.state{margin:18px 0 14px;padding:12px 14px;border-radius:12px;background:#f1f5f9;color:#334155;font-size:14px}.qrbox{display:none;text-align:center;border:1px solid var(--line);border-radius:18px;padding:14px;margin-top:16px}.qrbox img{width:min(100%,250px);height:auto;image-rendering:pixelated}.qrbox small{display:block;color:var(--muted)}.btn{display:block;width:100%;text-align:center;border:0;border-radius:12px;padding:14px 15px;text-decoration:none;font:inherit;font-weight:800;cursor:pointer;margin-top:10px}.primary{background:var(--green);color:white}.secondary{background:#f0f5f4;color:#215d49}.btn[hidden]{display:none!important}.note{font-size:12px;color:var(--muted);margin:16px 0 0}.ref{font:12px ui-monospace,monospace;color:var(--muted);overflow-wrap:anywhere}.spinner{display:inline-block;width:15px;height:15px;border:2px solid #b4c0cf;border-top-color:#12855c;border-radius:50%;animation:spin .8s linear infinite;vertical-align:-2px;margin-right:6px}@keyframes spin{to{transform:rotate(360deg)}}@media(max-width:400px){.content{padding:18px}.top{padding:20px}.amount{font-size:31px}}</style></head><body><main class="wrap"><header class="top"><div class="brand">LOKPRAVAAH · SECURE CHECKOUT</div><h1>Complete your contribution</h1><p>UPI payment directly to the configured receiving account</p></header><section class="content"><div id="amount" class="amount">Loading…</div><div class="meta"><span>Reference</span><strong id="order">—</strong></div><div class="meta"><span>Payment status</span><strong id="statusValue">Loading</strong></div><div class="meta"><span>Time remaining</span><strong id="timer">—</strong></div><div id="notice" class="state" role="status"><span class="spinner"></span> Checking your payment session…</div><div id="qrbox" class="qrbox"><img id="qr" alt="Scan with any UPI app"><small>Scan this QR using your UPI app</small></div><a id="openUpi" class="btn primary" href="#" hidden>Open UPI app</a><button id="cancel" class="btn secondary" type="button">Cancel checkout</button><p class="note">Do not pay if the reference, amount or receiving payee shown in your UPI app looks incorrect. Payment is marked successful only after the receiving-account notification is securely verified. Do not rely on screenshots.</p><p class="ref" id="pid"></p></section></main><script>
  const id=${safeId};let current=null,done=false;const amountEl=document.getElementById('amount'),orderEl=document.getElementById('order'),statusEl=document.getElementById('statusValue'),timerEl=document.getElementById('timer'),notice=document.getElementById('notice'),qrbox=document.getElementById('qrbox'),qr=document.getElementById('qr'),openUpi=document.getElementById('openUpi'),cancel=document.getElementById('cancel'),pid=document.getElementById('pid');pid.textContent='Payment ID: '+id;function parentOrigin(){try{return new URL(document.referrer).origin}catch{return '*'}}function tell(event,data={}){try{window.parent.postMessage({event,data},parentOrigin())}catch{}}
  function terminal(status){return ['SUCCESS','FAILED','SUSPICIOUS','EXPIRED','CANCELLED'].includes(status)}function updateTimer(){if(!current||!timerEl)return;if(current.status==='PROCESSING'){timerEl.textContent='Confirming';return}if(current.status==='QUEUED'){timerEl.textContent='Waiting for slot';return}if(!current.expiresAt){timerEl.textContent='—';return}const remaining=Math.max(0,Math.ceil((new Date(current.expiresAt).getTime()-Date.now())/1000));timerEl.textContent=remaining>0?String(Math.floor(remaining/60)).padStart(2,'0')+':'+String(remaining%60).padStart(2,'0'):'Time expired; checking status';}setInterval(updateTimer,1000);function show(s){current=s;updateTimer();amountEl.textContent='₹'+Number(s.amount||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});orderEl.textContent=s.orderId||'—';statusEl.textContent=s.status||'UNKNOWN';qrbox.style.display='none';openUpi.hidden=true;cancel.hidden=terminal(s.status);if(s.status==='ACTIVE'&&s.upiUri){notice.textContent='Your payment slot is active. Scan the QR or open your UPI app. After payment, wait here while the receiving bank notification is verified.';qrbox.style.display='block';qr.alt='Loading UPI QR code';import('/qr.js').then(m=>{if(!done&&current&&current.status==='ACTIVE'){const svg=m.generateQrSvg(s.upiUri,260);if(qr.dataset.uri!==s.upiUri){if(qr.dataset.blobUrl)URL.revokeObjectURL(qr.dataset.blobUrl);const blobUrl=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));qr.src=blobUrl;qr.dataset.blobUrl=blobUrl;qr.dataset.uri=s.upiUri;}}}).catch(()=>{notice.textContent='QR generation failed on this device. Use the Open UPI app button if available.';});openUpi.href=s.upiUri;openUpi.hidden=false;}else if(s.status==='QUEUED'){notice.innerHTML='<span class="spinner"></span> This legacy session is waiting for activation. Do not pay until its QR appears. If it remains here, close it and contact support.';}else if(s.status==='PROCESSING'){notice.innerHTML='<span class="spinner"></span> Payment notification received. Waiting for signed confirmation. Check your bank status and do not pay again while this is processing.';}else if(s.status==='SUCCESS'){notice.textContent='Payment has been verified by the receiving-account observer. Thank you.';if(!done){done=true;tell('youpi.payment_success',{orderId:s.orderId,amount:Number(s.amount),method:'UPI',completedAt:s.completedAt||new Date().toISOString()});}}else if(s.status==='EXPIRED'){notice.textContent='This payment session expired. Check your bank statement before creating another attempt.';if(!done){done=true;tell('youpi.payment_expired',{orderId:s.orderId});}}else if(s.status==='FAILED'){notice.textContent='The payment was not confirmed. If money was debited, check your bank statement before retrying.';if(!done){done=true;tell('youpi.payment_failed',{orderId:s.orderId,reason:'PAYMENT_NOT_CONFIRMED'});}}else if(s.status==='SUSPICIOUS'){notice.textContent='This transaction needs review. Do not retry until it is checked.';if(!done){done=true;tell('youpi.payment_blocked',{orderId:s.orderId});}}else if(s.status==='CANCELLED'){notice.textContent='Checkout cancelled. Check your bank statement if you had already approved the transfer.';if(!done){done=true;tell('youpi.payment_cancelled',{orderId:s.orderId});}}else{notice.textContent='Payment status: '+String(s.status||'UNKNOWN');}}
  async function poll(){if(done)return;try{const r=await fetch('/api/v1/payments/'+encodeURIComponent(id),{cache:'no-store'});const s=await r.json();if(!r.ok)throw new Error(s.error||'Unable to load payment');show(s);}catch(e){notice.textContent='Connection issue. Retrying status check; do not pay again if your bank shows a debit.';}if(!done)setTimeout(poll,5000);}
  cancel.addEventListener('click',async()=>{cancel.disabled=true;try{const r=await fetch('/api/v1/payments/'+encodeURIComponent(id)+'/cancel',{method:'POST'});const d=await r.json();if(r.ok)show(d);else notice.textContent=d.error||'Could not cancel the session. Close the dialog only after checking payment status.';}catch{notice.textContent='Network issue while cancelling. Check payment status before retrying.'}finally{cancel.disabled=false;}});
  window.addEventListener('message',async e=>{if(e.data&&e.data.event==='youpi.request_cancel'){cancel.click();}});poll();
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

  if (request.method === 'GET' && path === '/health') {
    // Safe, actionable diagnostics: report missing *names*/HTTP codes only, never values or secrets.
    const supabaseUrl = String(env.SUPABASE_URL || '').trim();
    const serviceRoleKey = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    const webhookUrl = String(env.LOKPRAVAAH_DONATION_WEBHOOK_URL || '').trim();
    const webhookSecret = String(env.LOKPRAVAAH_DONATION_WEBHOOK_SECRET || '').trim();
    const config = {
      supabase: Boolean(/^https:\/\//i.test(supabaseUrl) && serviceRoleKey),
      receivingVpa: null,
      webhook: Boolean(/^https:\/\//i.test(webhookUrl) && webhookSecret),
      admin: Boolean(/^https:\/\//i.test(supabaseUrl) && serviceRoleKey),
    };
    const missingEnvironment = [];
    if (!supabaseUrl || !/^https:\/\//i.test(supabaseUrl)) missingEnvironment.push('SUPABASE_URL (Worker variable)');
    if (!serviceRoleKey) missingEnvironment.push('SUPABASE_SERVICE_ROLE_KEY (Worker secret)');
    if (!webhookUrl || !/^https:\/\//i.test(webhookUrl)) missingEnvironment.push('LOKPRAVAAH_DONATION_WEBHOOK_URL (Worker variable)');
    if (!webhookSecret) missingEnvironment.push('LOKPRAVAAH_DONATION_WEBHOOK_SECRET (Worker secret; same value as Supabase DONATION_WEBHOOK_SECRET)');
    let database = false;
    let databaseError = null;
    let settingsError = null;
    try {
      await sbRequest(env, 'upi_gateway_payments?select=id&limit=1');
      database = true;
    } catch (error) {
      const message = String(error?.message || 'DATABASE_CHECK_FAILED');
      databaseError = message === 'SUPABASE_NOT_CONFIGURED' ? 'SUPABASE_URL_OR_SERVICE_ROLE_KEY_MISSING' : /^SUPABASE_HTTP_\d+$/.test(message) ? message : 'SUPABASE_CONNECTION_FAILED';
    }
    if (database) {
      try {
        const settings = await getPaymentSettings(env);
        config.receivingVpa = Boolean(settings.receiverVpa && /^[^\s@]+@[^\s@]+$/.test(settings.receiverVpa) && settings.receiverName && settings.merchantId);
      } catch (error) {
        const message = String(error?.message || 'DONATION_SETTINGS_READ_FAILED');
        settingsError = /^SUPABASE_HTTP_\d+$/.test(message) ? message : 'DONATION_SETTINGS_READ_FAILED';
      }
    }
    if (database && !settingsError && !config.receivingVpa) {
      missingEnvironment.push('A valid receiving UPI ID + payee name in donation_settings or Worker variables UPI_VPA + UPI_PAYEE_NAME');
    }
    const ready = Object.values(config).every(Boolean) && database && !settingsError;
    return json(request, env, {
      status: ready ? 'UP' : 'CONFIGURATION_REQUIRED',
      service: 'lokpravaah-cloudflare-upi-gateway',
      gateway_version: 'lokpravaah-upi-final-2026-10-19',
      checks: { ...config, database },
      diagnostics: {
        missing: [...new Set(missingEnvironment)],
        databaseError,
        settingsError,
        note: ready ? 'Gateway configuration checks passed; perform an end-to-end signed payment test before accepting real donations.' : 'No payment should be assumed successful from this health response. Add the missing Worker variables/secrets, then retry.',
      },
    }, ready ? 200 : 503);
  }

  // The standalone pairing page has been removed. Keep this path dark even on workers.dev.
  if (path.startsWith('/admin')) {
    return json(request, env, { error: 'Not found' }, 404);
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
    const token = String(body.enrollmentToken || body.token || '');
    if (!token || (body.version && body.version !== 'v1') || (body.expiresAt && Date.now() > Number(body.expiresAt))) return json(request, env, { error: 'Invalid or expired pairing token' }, 400);
    const tokenHash = await sha256Hex(token);
    const deviceId = crypto.randomUUID();
    const signingKey = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
    try {
      const result = await rpc(env, 'upi_gateway_pair_device', {
        p_token_hash: tokenHash,
        p_device_id: deviceId,
        p_signing_key: signingKey,
        p_merchant_id: String(body.merchantId || env.MERCHANT_ID || DEFAULT_MERCHANT_ID),
        p_device_name: String(body.deviceName || 'Android Observer').slice(0, 100),
        p_device_model: String(body.deviceModel || 'Android device').slice(0, 100),
        p_expires_at: body.expiresAt ? new Date(Number(body.expiresAt)).toISOString() : null,
      });
      if (result?.paired !== true) return json(request, env, { error: 'Pairing token invalid, expired, or already used' }, 401);
      return json(request, env, { paired: true, deviceId, signingKey, merchantId: body.merchantId || env.MERCHANT_ID || DEFAULT_MERCHANT_ID, message: 'Android SMS Gateway paired successfully.' });
    } catch {
      return json(request, env, { error: 'Device pairing failed. Generate a fresh QR and retry.' }, 401);
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
      const state = publicPayment(payment, env);
      if (result.retainedForVerification) return json(request, env, { ...state, status: 'CANCELLED', retainedForVerification: true });
      return json(request, env, state);
    } catch { return json(request, env, { error: 'Could not cancel payment session' }, 409); }
  }

  if (request.method === 'POST' && path === '/api/v1/payments') {
    const declaredLength = Number(request.headers.get('Content-Length') || 0);
    if (declaredLength > MAX_BODY_BYTES) return json(request, env, { error: 'Payload too large' }, 413);
    let body;
    try { body = await request.json(); } catch { return json(request, env, { error: 'Invalid JSON' }, 400); }
    if (!String(body.orderId || '').trim() || String(body.orderId).length > 80) return json(request, env, { error: 'Missing or invalid orderId' }, 400);
    if (String(body.currency || 'INR').toUpperCase() !== 'INR') return json(request, env, { error: 'Only INR is supported' }, 400);
    const amountPaise = paiseFromAmount(body.amount);
    if (amountPaise === null) return json(request, env, { error: 'Amount must be from ₹1 to ₹1,00,000 with at most two decimal places' }, 400);
    let paymentSettings;
    try { paymentSettings = await getPaymentSettings(env); }
    catch (error) {
      console.error('Could not load donation settings:', error.message);
      return json(request, env, { error: 'Could not load donation payment settings. Apply the latest UPI SQL migration and check the Worker Supabase configuration.' }, 503);
    }
    const merchantId = request.headers.get('X-Merchant-Id') || body.merchantId || '';
    const expectedMerchantId = paymentSettings.merchantId;
    if (!constantTimeEqual(String(merchantId), expectedMerchantId)) return json(request, env, { error: 'Merchant not found or not configured. Check Admin → Donations & UPI → Public merchant ID/key.' }, 400);
    try {
      const configuredEnv = { ...env, UPI_VPA: paymentSettings.receiverVpa, UPI_PAYEE_NAME: paymentSettings.receiverName };
      if (!buildUpiUri({ id: 'validation', order_id: body.orderId, amount_paise: amountPaise }, configuredEnv)) return json(request, env, { error: 'Receiving UPI ID/payee name is missing or invalid. Set both in Admin → Donations & UPI or Worker variables.' }, 503);
      const paymentId = crypto.randomUUID();
      const idempotencyKey = (request.headers.get('Idempotency-Key') || body.idempotencyKey || '').slice(0, 150) || null;
      const result = await rpc(env, 'upi_gateway_create_payment', {
        p_payment_id: paymentId,
        p_order_id: String(body.orderId).trim(),
        p_amount_paise: amountPaise,
        p_merchant_id: expectedMerchantId,
        p_idempotency_key: idempotencyKey,
        p_session_minutes: paymentSettings.sessionMinutes,
        p_receiver_vpa: paymentSettings.receiverVpa,
        p_receiver_name: paymentSettings.receiverName,
      });
      if (!result?.paymentId) return json(request, env, { error: 'Unable to create payment session' }, 409);
      const payment = await getPayment(env, result.paymentId);
      if (!payment) return json(request, env, { error: 'Payment session could not be loaded' }, 500);
      return json(request, env, { ...publicPayment(payment, env), checkoutUrl: `${baseFor(request, env)}/checkout/${payment.id}` }, 201);
    } catch (error) {
      const status = [400, 404, 409, 422].includes(Number(error?.status)) ? Number(error.status) : 502;
      console.error('Payment session creation failed:', error.message);
      return json(request, env, { error: status === 404 ? 'Donation reference not found' : 'Could not create a session for this donation reference. Check the Supabase gateway migration and ensure the intent is pending with the same amount.', code: String(error?.details || error?.message || 'PAYMENT_SESSION_CREATE_FAILED').replace(/[\r\n]+/g, ' ').slice(0, 120) }, status);
    }
  }

  const paymentMatch = path.match(/^\/api\/v1\/payments\/([a-f0-9-]{36})$/i);
  if (request.method === 'GET' && paymentMatch) {
    try {
      await rpc(env, 'upi_gateway_tick', {});
      const payment = await getPayment(env, paymentMatch[1]);
      if (!payment) return json(request, env, { error: 'Payment session not found' }, 404);
      return json(request, env, publicPayment(payment, env));
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
      return json(request, env, publicPayment(payment, env));
    } catch { return json(request, env, { error: 'Payment status unavailable' }, 503); }
  }
  const qrMatch = path.match(/^\/checkout\/([a-f0-9-]{36})\/qr\.svg$/i);
  if (request.method === 'GET' && qrMatch) {
    try {
      const payment = await getPayment(env, qrMatch[1]);
      if (!payment) return text(request, env, 'Payment session not found', 404);
      if (payment.status !== 'ACTIVE') return text(request, env, 'QR is only available when this payment has the active queue slot.', 409);
      const uri = buildUpiUri(payment, env);
      if (!uri) return text(request, env, 'Receiver UPI details are not configured.', 503);
      return text(request, env, 'QR codes are generated client-side by the hosted checkout. Open /checkout/' + payment.id + ' in a browser.', 410);
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
