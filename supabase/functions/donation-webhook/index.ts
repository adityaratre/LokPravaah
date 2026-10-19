// Manual-only donation mode.
// Automatic server-to-server payment confirmation is intentionally disabled. The QR/session API may
// still initiate a payment, but only an administrator can mark it successful after checking the
// amount and UTR against the receiving-bank statement.
const jsonHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders })
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'content-type, x-gateway-event, x-gateway-signature, x-gateway-delivery-id, x-gateway-timestamp',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Cache-Control': 'no-store',
      },
    })
  }

  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  // Deliberately short-circuit before reading payloads or accessing service-role credentials.
  // This prevents old gateway deployments/retries from auto-verifying donation records.
  return json({
    error: 'Automatic donation confirmation is disabled. Submit the UTR and receipt for manual administrator review.',
    code: 'MANUAL_REVIEW_ONLY',
    manualReviewEnabled: true,
  }, 410)
})
