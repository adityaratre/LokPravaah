# LokPravaah UPI URI compatibility fix

## Root-cause finding in the reviewed source

`cloudflare-upi-worker/src/index.js` was generating the dynamic UPI URI with `tr=<payment UUID>`. A normal UUID is 36 characters including hyphens. NPCI's UPI Linking guidance limits the transaction reference field to 35 characters. The source also used form-style `+` space encoding for the payee name and used a long note based on the order ID. These are interoperability risks for stricter UPI PSP apps.

## Changes in this patch

- Use the donation `order_id` as `tr` when it is valid and no more than 35 characters; otherwise derive a compact reference from the payment UUID.
- Always set `cu=INR`.
- Percent-encode query values with `%20` for spaces.
- Keep `tn` at or below 50 characters.
- Apply the same required currency/reference/note conventions to the shared UPI URI builders in the Node service.
- Extend the Worker regression test to parse the generated UPI URI and validate payee, amount, currency, reference length, note length, and space encoding.

## Verification performed

Run from `cloudflare-upi-worker`:

```bash
npm test
```

The 12 Worker tests pass, including the updated UPI URI assertions.

## Important operational limitation

This fixes a code-level URI compliance issue found in the reviewed source. It does **not** prove that a live transfer will be accepted by PhonePe, Paytm, the remitter bank, or the beneficiary bank. The screenshot's generic “technical issue” message does not include the PSP response code, and health status `UP` only confirms configuration/database reachability. After deploying this patch, inspect the UPI app's transaction details and gateway/observer logs. Verify that the receiving VPA is able to receive payments and that a signed receiving-bank notification reaches the webhook. Do not mark a donation successful from a QR scan, redirect, screenshot, or client-side callback alone.

Before replacing project files, make a commit/backup. The patch does not alter the payment queue or manual-review policy.
