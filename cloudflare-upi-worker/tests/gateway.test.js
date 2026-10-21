import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';

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

test('database migration has no global active-session unique index and avoids ambiguous auto-match', async () => {
  const sqlUrl = new URL('../../supabase/lokpravaah_cloudflare_gateway.sql', import.meta.url);
  const migration = await readFile(sqlUrl, 'utf8');
  assert.doesNotMatch(migration, /create\s+unique\s+index[^;]*upi_gateway_single_active_slot_uq/i);
  assert.match(migration, /v_candidate_count\s*<>\s*1/i);
  assert.match(migration, /AMBIGUOUS_AMOUNT_MATCH/);
  assert.match(migration, /concurrentSessions',\s*true/i);
});

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
  assert.equal(body.checks.supabaseUrlConfigured, true);
  assert.equal(body.checks.serviceRoleKeyConfigured, true);
  assert.equal(body.checks.receivingVpa, true);
});

test('CORS grants browser access only to the configured frontend origin', async () => {
  const allowed = await worker.fetch(req('/admin'), defaultEnv, {});
  assert.equal(allowed.headers.get('Access-Control-Allow-Origin'), 'https://lokpravaah.online');

  const untrusted = await worker.fetch(req('/admin', {
    headers: { Origin: 'https://attacker.example' },
  }), defaultEnv, {});
  assert.equal(untrusted.headers.get('Access-Control-Allow-Origin'), null);

  const preflight = await worker.fetch(req('/api/v1/payments', {
    method: 'OPTIONS',
    headers: { Origin: 'https://attacker.example', 'Access-Control-Request-Method': 'POST' },
  }), defaultEnv, {});
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), null);
});

test('hosted checkout launches UPI deep links from the top-level browsing context', async () => {
  const workerUrl = new URL('../src/index.js', import.meta.url);
  const source = await readFile(workerUrl, 'utf8');
  assert.match(source, /openUpi\.href=s\.upiUri;openUpi\.target='_top';openUpi\.hidden=false;/);
});

test('standalone /admin page is not exposed', async () => {
  const response = await worker.fetch(req('/admin'), defaultEnv, {});
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.equal(body.error, 'Not found');
});

test('manual-only mode disables admin QR pairing endpoint for every method', async () => {
  for (const method of ['GET','POST']) {
    const response = await worker.fetch(req('/api/v1/admin/sms-gateway/pair-qr', { method }), defaultEnv, {});
    assert.equal(response.status, 410);
    const body = await response.json();
    assert.equal(body.code, 'MANUAL_REVIEW_MODE');
    assert.equal(body.manualReviewEnabled, true);
  }
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
  let sawReceiverSettings = false;
  let paymentRpcArgs = {};
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/rpc/upi_gateway_get_receiver_settings')) {
      sawReceiverSettings = true;
      return new Response(JSON.stringify({
        receivingVpa: 'admin.receiver@upi',
        payeeName: 'Admin Approved Receiver',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname.endsWith('/rpc/upi_gateway_create_payment')) {
      sawRpc = true;
      paymentRpcArgs = JSON.parse(String(init.body || '{}'));
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
  assert.equal(sawReceiverSettings, true);
  assert.equal(paymentRpcArgs.p_receiver_vpa, 'admin.receiver@upi', 'payment RPC must call the receiver-aware SQL overload');
  assert.equal(paymentRpcArgs.p_receiver_name, 'Admin Approved Receiver', 'payment RPC must snapshot the approved payee name');
  assert.equal(body.paymentId, sampleDbPayment.id);
  assert.equal(body.status, 'ACTIVE');
  assert.equal(body.checkoutUrl, `https://lokpravaah.online/checkout/${sampleDbPayment.id}`);
  assert.match(body.upiUri, /^upi:\/\/pay\?/);
  const upi = new URL(body.upiUri);
  assert.equal(upi.searchParams.get('cu'), 'INR');
  assert.equal(upi.searchParams.get('am'), '251.00');
  assert.equal(upi.searchParams.get('pa'), 'admin.receiver@upi', 'approved Admin receiver must override the Worker environment fallback');
  assert.equal(upi.searchParams.get('pn'), 'Admin Approved Receiver');
  assert.match(upi.searchParams.get('tn') || '', /^LokPravaah /);
  assert.ok((upi.searchParams.get('tn') || '').length <= 50);
  assert.match(upi.searchParams.get('tr') || '', /^\d{1,35}$/);
  assert.equal((upi.searchParams.get('tr') || '').length, 35, 'merchant transaction ref is 35 numeric digits');
  assert.ok(!body.upiUri.includes('+'), 'UPI values use %20 rather than plus-space encoding');
});

test('long order references fall back to a compact UPI-safe payment reference', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const longOrderId = 'LPDON-' + 'X'.repeat(60);
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/rpc/upi_gateway_create_payment')) {
      const args = await Promise.resolve({});
      void args;
      return new Response(JSON.stringify({ paymentId: sampleDbPayment.id }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname.endsWith('/upi_gateway_payments')) {
      return new Response(JSON.stringify([{ ...sampleDbPayment, order_id: longOrderId }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`Unexpected test fetch: ${url.pathname}`);
  };
  const response = await worker.fetch(req('/api/v1/payments', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Merchant-Id': defaultEnv.MERCHANT_ID },
    body: JSON.stringify({ orderId: longOrderId, amount: 251, currency: 'INR' }),
  }), defaultEnv, {});
  assert.equal(response.status, 201);
  const body = await response.json();
  const upi = new URL(body.upiUri);
  assert.match(upi.searchParams.get('tr') || '', /^\d{35}$/);
  assert.ok((upi.searchParams.get('tr') || '').length <= 35);
});

test('active checkout QR endpoint returns a real SVG even without hosted checkout UI', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/upi_gateway_payments')) {
      return new Response(JSON.stringify([sampleDbPayment]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname.endsWith('/rpc/upi_gateway_get_receiver_settings')) {
      return new Response(JSON.stringify({ message: 'function unavailable in legacy test schema' }), { status: 404 });
    }
    throw new Error(`Unexpected test fetch: ${url.pathname}`);
  };
  const response = await worker.fetch(req(`/checkout/${sampleDbPayment.id}/qr.svg`), defaultEnv, {});
  assert.equal(response.status, 200);
  assert.ok((response.headers.get('Content-Type') || '').includes('image/svg+xml'));
  const svg = await response.text();
  assert.match(svg, /^<svg /);
  assert.match(svg, /<rect /);
  assert.match(svg, /viewBox="0 0 260 260"/);
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


test('manual-only mode disables Android pairing, notification and heartbeat routes', async () => {
  const paths = [
    '/api/v1/pollers/android/pair',
    '/api/v1/pollers/android/events',
    '/api/v1/observers/sms',
    '/api/v1/pollers/android/heartbeat',
    '/api/v1/pollers/heartbeat',
    '/api/v1/observers/heartbeat',
  ];
  for (const path of paths) {
    const response = await worker.fetch(req(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: 'old-paired-device' }),
    }), defaultEnv, {});
    assert.equal(response.status, 410, path);
    const body = await response.json();
    assert.equal(body.code, 'MANUAL_REVIEW_MODE', path);
    assert.equal(body.manualReviewEnabled, true, path);
  }
});

test('checkout exposes manual payment confirmation without cancelling the active session', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/upi_gateway_payments')) return new Response(JSON.stringify([sampleDbPayment]), { status: 200 });
    throw new Error(`Unexpected test fetch: ${url.pathname}`);
  };
  const response = await worker.fetch(req(`/checkout/${sampleDbPayment.id}`), defaultEnv, {});
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /id="manualConfirm"/);
  assert.match(html, /youpi\.manual_payment_request/);
  assert.match(html, /I paid — enter UTR \/ upload proof/);
  assert.match(html, /administrator verification against the receiving-bank statement/);
  assert.doesNotMatch(html, /tell\('youpi\.payment_success'/);
  const manualHandler = html.indexOf("manualConfirm.addEventListener('click'");
  const cancelHandler = html.indexOf("cancel.addEventListener('click'");
  assert.ok(manualHandler >= 0 && cancelHandler >= 0 && manualHandler < cancelHandler,
    'manual confirmation must have its own click listener, registered before the cancellation handler');
  const cancellationSection = html.slice(cancelHandler, html.indexOf("window.addEventListener('message'", cancelHandler));
  assert.doesNotMatch(cancellationSection, /manualConfirm\.addEventListener/,
    'manual confirmation must not be nested inside the cancel button handler');
});

test('checkout SDK closes without sending a cancellation request and supports manual confirmation', async () => {
  const sdkSource = await readFile(new URL('../public/youpi.js', import.meta.url), 'utf8');
  assert.match(sdkSource, /closeBtn\.onclick = \(\) => this\.close\(\)/);
  assert.match(sdkSource, /youpi\.manual_payment_request/);
  assert.match(sdkSource, /onManualPaymentRequest/);
  assert.match(sdkSource, /_showManualPaymentForm\(result\)/);
  assert.match(sdkSource, /Submit for review/);
  assert.doesNotMatch(sdkSource, /this\.close\(\);\s*}\s*else if \(event === 'youpi\.payment_success'/);
});


test('partial admin receiver settings never mix with Worker environment beneficiary values', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  globalThis.fetch = async input => {
    calls += 1;
    assert.match(String(input), /\/rest\/v1\/rpc\/upi_gateway_get_receiver_settings$/);
    return new Response(JSON.stringify({
      receivingVpa: 'admin.receiver@upi',
      payeeName: '',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const response = await worker.fetch(req('/api/v1/payments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Merchant-Id': defaultEnv.MERCHANT_ID },
    body: JSON.stringify({ orderId: sampleDbPayment.order_id, amount: 251, currency: 'INR' }),
  }), defaultEnv, {});

  assert.equal(response.status, 503);
  assert.equal(calls, 1, 'must reject incomplete DB receiver settings before creating a payment row');
  const body = await response.json();
  assert.match(body.error, /UPI VPA and payee name are not configured/);
});


test('legacy six-argument SQL RPC remains compatible when receiver settings use Worker env', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let createAttempts = 0;
  let legacyArgs = null;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/rpc/upi_gateway_get_receiver_settings')) {
      return new Response(JSON.stringify({ code: 'PGRST202', message: 'Could not find the function public.upi_gateway_get_receiver_settings in the schema cache' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname.endsWith('/rpc/upi_gateway_create_payment')) {
      createAttempts += 1;
      const args = JSON.parse(String(init.body || '{}'));
      if (createAttempts === 1) {
        assert.ok('p_receiver_vpa' in args, 'first attempt uses receiver-aware RPC');
        return new Response(JSON.stringify({ code: 'PGRST202', message: 'Could not find the function public.upi_gateway_create_payment with receiver arguments in the schema cache' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
      }
      legacyArgs = args;
      assert.ok(!('p_receiver_vpa' in args));
      assert.ok(!('p_receiver_name' in args));
      return new Response(JSON.stringify({ paymentId: sampleDbPayment.id }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname.endsWith('/upi_gateway_payments')) {
      return new Response(JSON.stringify([sampleDbPayment]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`Unexpected test fetch: ${url.pathname}`);
  };

  const response = await worker.fetch(req('/api/v1/payments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Merchant-Id': defaultEnv.MERCHANT_ID },
    body: JSON.stringify({ orderId: sampleDbPayment.order_id, amount: 251, currency: 'INR' }),
  }), defaultEnv, {});

  assert.equal(response.status, 201);
  assert.equal(createAttempts, 2, 'must retry exactly once with the legacy signature');
  assert.ok(legacyArgs);
  const body = await response.json();
  assert.equal(body.paymentId, sampleDbPayment.id);
  assert.equal(new URL(body.upiUri).searchParams.get('pa'), defaultEnv.UPI_VPA);
});


test('checkout state uses the beneficiary snapshot even if admin receiver settings later change', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const storedPayment = {
    ...sampleDbPayment,
    receiver_vpa: 'original.receiver@upi',
    receiver_name: 'Original Approved Receiver',
  };
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/rpc/upi_gateway_tick')) {
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname.endsWith('/rpc/upi_gateway_get_receiver_settings')) {
      return new Response(JSON.stringify({
        receivingVpa: 'new.receiver@upi',
        payeeName: 'New Admin Receiver',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname.endsWith('/upi_gateway_payments')) {
      assert.match(url.searchParams.get('select') || '', /receiver_vpa,receiver_name/);
      return new Response(JSON.stringify([storedPayment]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`Unexpected test fetch: ${url.pathname}`);
  };

  const response = await worker.fetch(req(`/api/v1/checkout/${sampleDbPayment.id}/state`), defaultEnv, {});
  assert.equal(response.status, 200);
  const body = await response.json();
  const upi = new URL(body.upiUri);
  assert.equal(upi.searchParams.get('pa'), 'original.receiver@upi');
  assert.equal(upi.searchParams.get('pn'), 'Original Approved Receiver');
});

test('payment status uses the beneficiary snapshot even if admin receiver settings later change', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const storedPayment = {
    ...sampleDbPayment,
    receiver_vpa: 'original.receiver@upi',
    receiver_name: 'Original Approved Receiver',
  };
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/rpc/upi_gateway_tick')) {
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname.endsWith('/rpc/upi_gateway_get_receiver_settings')) {
      return new Response(JSON.stringify({
        receivingVpa: 'new.receiver@upi',
        payeeName: 'New Admin Receiver',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname.endsWith('/upi_gateway_payments')) {
      assert.match(url.searchParams.get('select') || '', /receiver_vpa,receiver_name/);
      return new Response(JSON.stringify([storedPayment]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`Unexpected test fetch: ${url.pathname}`);
  };

  const response = await worker.fetch(req(`/api/v1/payments/${sampleDbPayment.id}`), defaultEnv, {});
  assert.equal(response.status, 200);
  const body = await response.json();
  const upi = new URL(body.upiUri);
  assert.equal(upi.searchParams.get('pa'), 'original.receiver@upi');
  assert.equal(upi.searchParams.get('pn'), 'Original Approved Receiver');
});


test('scheduled cleanup ticks payment-session expiry without a browser request', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const calls = [];
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    if (url.pathname.endsWith('/rpc/upi_gateway_tick')) {
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`Unexpected scheduled cleanup request: ${url.pathname}`);
  };
  let waited = Promise.resolve();
  const ctx = { waitUntil(promise) { waited = promise; } };
  await worker.scheduled({ scheduledTime: Date.now(), cron: '*/5 * * * *' }, defaultEnv, ctx);
  await waited;
  assert.deepEqual(calls, ['/rest/v1/rpc/upi_gateway_tick']);
});

test('scheduled cleanup does not throw when the database is unavailable', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response('database unavailable', { status: 503 });
  let waited = Promise.resolve();
  const ctx = { waitUntil(promise) { waited = promise; } };
  await worker.scheduled({ scheduledTime: Date.now(), cron: '*/5 * * * *' }, defaultEnv, ctx);
  await assert.doesNotReject(() => waited);
});
