import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { createHmac } from 'node:crypto';

const defaultEnv = {
  SUPABASE_URL: 'https://demo.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  LOKPRAVAAH_DONATION_WEBHOOK_SECRET: 'test-secret',
  LOKPRAVAAH_DONATION_WEBHOOK_URL: 'https://demo.supabase.co/functions/v1/donation-webhook',
  LOKPRAVAAH_FRONTEND_ORIGIN: 'https://lokpravaah.online',
  MERCHANT_ID: '00000000-0000-0000-0000-000000000001',
  PUBLIC_BASE_URL: 'https://lokpravaah.online',
  UPI_VPA: 'verified.test@upi',
  UPI_PAYEE_NAME: 'Verified Test Account',
  ASSETS: { fetch: async () => new Response('SDK', { headers: { 'Content-Type': 'application/javascript' } }) },
};

const sampleDbPayment = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  merchant_id: defaultEnv.MERCHANT_ID,
  order_id: 'LPDON-TEST-ORDER-123456',
  amount_paise: 25100,
  currency: 'INR',
  status: 'ACTIVE',
  queue_position: 0,
  expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  completed_at: null,
  bank_reference_number: null,
  created_at: new Date().toISOString(),
};

function req(path, init = {}) {
  return new Request(`https://lokpravaah.online${path}`, {
    ...init,
    headers: { Origin: 'https://lokpravaah.online', ...(init.headers || {}) },
  });
}

test('health is not UP without private configuration', async () => {
  const response = await worker.fetch(req('/health'), {}, {});
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.status, 'CONFIGURATION_REQUIRED');
});

test('health verifies configuration and Supabase table reachability', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async input => {
    assert.match(String(input), /\/rest\/v1\/upi_gateway_payments\?select=id&limit=1$/);
    return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const response = await worker.fetch(req('/health'), defaultEnv, {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, 'UP');
  assert.equal(body.checks.database, true);
});

test('standalone /admin page is not exposed', async () => {
  const response = await worker.fetch(req('/admin'), defaultEnv, {});
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.equal(body.error, 'Not found');
});

test('pairing API rejects unauthenticated requests and requires POST', async () => {
  const missingToken = await worker.fetch(req('/api/v1/admin/sms-gateway/pair-qr', { method: 'POST' }), defaultEnv, {});
  assert.equal(missingToken.status, 401);
  const wrongMethod = await worker.fetch(req('/api/v1/admin/sms-gateway/pair-qr', { method: 'GET' }), defaultEnv, {});
  assert.equal(wrongMethod.status, 405);
});

test('pairing API verifies the signed-in Supabase user and super_admin role', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const authToken = 'signed-in-test-session';
  let sawAuthUser = false;
  let sawRoleCheck = false;
  let sawTokenInsert = false;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/auth/v1/user')) {
      sawAuthUser = true;
      assert.equal(new Headers(init.headers).get('Authorization'), `Bearer ${authToken}`);
      return new Response(JSON.stringify({ id: 'super-admin-user-id' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname.endsWith('/rest/v1/user_roles') && url.search === '?user_id=eq.super-admin-user-id&select=role&limit=20') {
      sawRoleCheck = true;
      return new Response(JSON.stringify([{ role: 'super_admin' }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname.endsWith('/rest/v1/upi_gateway_pairing_tokens')) {
      sawTokenInsert = true;
      assert.equal(init.method, 'POST');
      return new Response(null, { status: 201 });
    }
    throw new Error(`Unexpected test fetch: ${url.pathname}${url.search}`);
  };
  const response = await worker.fetch(req('/api/v1/admin/sms-gateway/pair-qr', {
    method: 'POST', headers: { Authorization: `Bearer ${authToken}` },
  }), defaultEnv, {});
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(sawAuthUser, true);
  assert.equal(sawRoleCheck, true);
  assert.equal(sawTokenInsert, true);
  assert.ok(result.pairingPayload.includes('YOUPI_SMS_GATEWAY_PAIR'));
  assert.ok(result.expiresAt > Date.now());
});

test('pairing API denies a signed-in non-super-admin', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let insertedPairing = false;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: 'regular-user-id' }), { status: 200 });
    if (url.pathname.endsWith('/rest/v1/user_roles')) return new Response(JSON.stringify([{ role: 'admin' }]), { status: 200 });
    if (url.pathname.endsWith('/rest/v1/upi_gateway_pairing_tokens')) insertedPairing = true;
    throw new Error(`Unexpected test fetch: ${url.pathname}${url.search}`);
  };
  const response = await worker.fetch(req('/api/v1/admin/sms-gateway/pair-qr', {
    method: 'POST', headers: { Authorization: 'Bearer regular-user-session' },
  }), defaultEnv, {});
  assert.equal(response.status, 403);
  assert.equal(insertedPairing, false);
});

test('payment creation requires the expected public merchant identifier', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let touchedDb = false;
  globalThis.fetch = async () => { touchedDb = true; return new Response('[]'); };
  const response = await worker.fetch(req('/api/v1/payments', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Merchant-Id': 'wrong' },
    body: JSON.stringify({ orderId: sampleDbPayment.order_id, amount: 251, currency: 'INR' }),
  }), defaultEnv, {});
  assert.equal(response.status, 400);
  assert.equal(touchedDb, false);
});

test('valid creation validates through Supabase RPC and returns checkout URL', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let sawRpc = false;
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/rpc/upi_gateway_create_payment')) {
      sawRpc = true;
      return new Response(JSON.stringify({ paymentId: sampleDbPayment.id }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname.endsWith('/upi_gateway_payments')) {
      return new Response(JSON.stringify([sampleDbPayment]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`Unexpected test fetch: ${url.pathname}`);
  };
  const response = await worker.fetch(req('/api/v1/payments', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Merchant-Id': defaultEnv.MERCHANT_ID },
    body: JSON.stringify({ orderId: sampleDbPayment.order_id, amount: 251, currency: 'INR' }),
  }), defaultEnv, {});
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(sawRpc, true);
  assert.equal(body.paymentId, sampleDbPayment.id);
  assert.equal(body.status, 'ACTIVE');
  assert.equal(body.checkoutUrl, `https://lokpravaah.online/checkout/${sampleDbPayment.id}`);
  assert.match(body.upiUri, /^upi:\/\/pay\?/);
  const upi = new URL(body.upiUri.replace(/^upi:\/\//, 'https://'));
  assert.equal(upi.searchParams.get('pa'), defaultEnv.UPI_VPA);
  assert.equal(upi.searchParams.get('pn'), defaultEnv.UPI_PAYEE_NAME);
  assert.equal(upi.searchParams.get('am'), '251.00');
  assert.equal(upi.searchParams.get('cu'), 'INR');
  assert.equal(upi.searchParams.get('tr'), sampleDbPayment.order_id);
  assert.ok((upi.searchParams.get('tr') || '').length <= 35);
  assert.ok((upi.searchParams.get('tn') || '').length <= 50);
  assert.match(body.upiUri, /pn=Verified%20Test%20Account/);
});

test('checkout never exposes QR for a queued payment', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/upi_gateway_payments')) return new Response(JSON.stringify([{ ...sampleDbPayment, status: 'QUEUED' }]), { status: 200 });
    throw new Error(`Unexpected test fetch: ${url.pathname}`);
  };
  const response = await worker.fetch(req(`/checkout/${sampleDbPayment.id}/qr.svg`), defaultEnv, {});
  assert.equal(response.status, 409);
});


test('Android observer can pair without sending QR expiry back in its enrollment request', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let args;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/rpc/upi_gateway_pair_device')) {
      args = JSON.parse(init.body || '{}');
      return new Response(JSON.stringify({ paired: true, deviceId: 'paired-device' }), { status: 200 });
    }
    throw new Error(`Unexpected test fetch: ${url.pathname}`);
  };
  const response = await worker.fetch(req('/api/v1/pollers/android/pair', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enrollmentToken: 'one-time-token', merchantId: defaultEnv.MERCHANT_ID, deviceName: 'Receiving phone' }),
  }), defaultEnv, {});
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.paired, true);
  assert.ok(payload.signingKey);
  assert.equal(args.p_expires_at, null);
});

test('checkout CSP allows the client-side QR module and blob QR image', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/upi_gateway_payments')) return new Response(JSON.stringify([sampleDbPayment]), { status: 200 });
    throw new Error(`Unexpected test fetch: ${url.pathname}`);
  };
  const response = await worker.fetch(req(`/checkout/${sampleDbPayment.id}`), defaultEnv, {});
  assert.equal(response.status, 200);
  const csp = response.headers.get('Content-Security-Policy') || '';
  assert.match(csp, /script-src 'self' 'unsafe-inline'/);
  assert.match(csp, /img-src 'self' data: blob:/);
});


test('a valid signed receiving-bank notification updates donation only through the signed webhook path', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const deviceId = 'device-test-001';
  const signingKey = 'device-test-signing-key';
  const payment = { ...sampleDbPayment, status: 'PROCESSING', bank_reference_number: 'UTR123456789' };
  let webhookPayload = null;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/upi_gateway_devices') && init.method === 'PATCH') return new Response(null, { status: 204 });
    if (url.pathname.endsWith('/upi_gateway_devices')) {
      return new Response(JSON.stringify([{ id: deviceId, merchant_id: defaultEnv.MERCHANT_ID, signing_key: signingKey }]), { status: 200 });
    }
    if (url.pathname.endsWith('/rpc/upi_gateway_prepare_observation')) {
      return new Response(JSON.stringify({ matched: true, status: 'PROCESSING', paymentId: payment.id, orderId: payment.order_id, amountPaise: '25100' }), { status: 200 });
    }
    if (url.pathname.endsWith('/upi_gateway_payments')) return new Response(JSON.stringify([payment]), { status: 200 });
    if (url.pathname.endsWith('/functions/v1/donation-webhook')) {
      const raw = String(init.body || '');
      const supplied = new Headers(init.headers).get('X-Gateway-Signature');
      const expected = 'sha256=' + createHmac('sha256', defaultEnv.LOKPRAVAAH_DONATION_WEBHOOK_SECRET).update(raw).digest('hex');
      assert.equal(supplied, expected);
      webhookPayload = JSON.parse(raw);
      return new Response(JSON.stringify({ received: true, status: 'succeeded' }), { status: 200 });
    }
    if (url.pathname.endsWith('/rpc/upi_gateway_finalize_success')) return new Response(JSON.stringify({ paymentId: payment.id, status: 'SUCCESS' }), { status: 200 });
    throw new Error(`Unexpected test fetch: ${url.pathname}`);
  };

  const payload = {
    deviceId,
    amountPaise: 25100,
    amount: 251,
    bankReferenceNumber: 'UTR123456789',
    senderVpa: 'sender@upi',
    observedAt: new Date().toISOString(),
    rawNotification: { title: 'Payment received', text: 'INR 251.00 credited UTR UTR123456789' },
  };
  const rawBody = JSON.stringify(payload);
  const timestamp = String(Date.now());
  const signature = createHmac('sha256', signingKey).update(`${rawBody}:${timestamp}`).digest('hex');
  const response = await worker.fetch(req('/api/v1/pollers/android/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': deviceId, 'X-Timestamp': timestamp, 'X-Signature': signature },
    body: rawBody,
  }), defaultEnv, {});
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.status, 'SUCCESS');
  assert.equal(webhookPayload.event, 'SUCCESS');
  assert.equal(webhookPayload.orderId, payment.order_id);
  assert.equal(webhookPayload.amountPaise, 25100);
  assert.equal(webhookPayload.utr, 'UTR123456789');
});
