import { toRupeesString } from './money.js';

/**
 * Validates whether a given string is a syntactically valid UPI Virtual Payment Address (VPA).
 * Format: username@bank
 * @param {string} vpa
 * @returns {boolean}
 */
export function isValidVpa(vpa) {
  if (!vpa || typeof vpa !== 'string') return false;
  const clean = vpa.trim();
  return /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z0-9.\-_]{2,64}$/.test(clean);
}

/**
 * Builds a canonical upi://pay URI dynamically from server-validated parameters.
 * Amount is derived exclusively from server-side integer paise.
 * @param {{
 *   payeeVpa: string,
 *   payeeName: string,
 *   amountPaise: bigint,
 *   transactionRef: string,
 *   transactionNote?: string,
 *   currency?: string
 * }} options
 * @returns {string}
 */
export function buildUpiUri(options) {
  if (!isValidVpa(options.payeeVpa)) {
    throw new Error(`Invalid payee VPA: ${options.payeeVpa}`);
  }
  const payeeName = String(options.payeeName || '').trim();
  if (!payeeName) throw new Error('Payee name is required');
  const amountStr = toRupeesString(options.amountPaise);
  const rawRef = String(options.transactionRef || '').trim();
  const safeRef = /^[A-Za-z0-9.-]{1,35}$/.test(rawRef)
    ? rawRef
    : rawRef.replace(/[^A-Za-z0-9.-]/g, '').slice(-35);
  if (!safeRef) throw new Error('A valid UPI transaction reference of at most 35 characters is required');
  const note = String(options.transactionNote || `Payment ${safeRef}`).trim().slice(0, 50);
  const encode = value => encodeURIComponent(String(value)).replace(/[!'()*]/g, ch => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
  const params = [
    ['pa', options.payeeVpa.trim()],
    ['pn', payeeName],
    ['am', amountStr],
    ['cu', 'INR'],
    ['tr', safeRef],
    ['tn', note],
  ].map(([key, value]) => `${key}=${encode(value)}`).join('&');
  return `upi://pay?${params}`;
}

/**
 * Builds an Android intent URI for launching a specific UPI application.
 * Format: intent://pay?<UPI_PARAMS>#Intent;scheme=upi;package=<PACKAGE>;end
 * @param {{
 *   payeeVpa: string,
 *   payeeName: string,
 *   amountPaise: bigint,
 *   transactionRef?: string,
 *   transactionNote?: string,
 *   currency?: string,
 *   packageName: string
 * }} options
 * @returns {string}
 */
export function buildUpiIntentUri(options) {
  if (!options.packageName || !options.packageName.trim()) {
    throw new Error('Package name is required for Android UPI intent URI');
  }
  const upiUri = buildUpiUri(options);
  const query = upiUri.split('?')[1] || '';
  const cleanPackage = options.packageName.trim();
  return `intent://pay?${query}#Intent;scheme=upi;package=${cleanPackage};end`;
}
