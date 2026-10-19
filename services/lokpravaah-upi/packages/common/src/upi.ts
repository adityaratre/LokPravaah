import { toRupeesString } from './money.js';

export interface BuildUpiUriOptions {
  payeeVpa: string;
  payeeName: string;
  amountPaise: bigint;
  transactionRef: string;
  transactionRefFallback?: string;
  transactionNote?: string;
  currency?: string;
}

/**
 * Validates whether a given string is a syntactically valid UPI Virtual Payment Address (VPA).
 * Format: username@bank
 */
export function isValidVpa(vpa: string): boolean {
  if (!vpa || typeof vpa !== 'string') return false;
  const clean = vpa.trim();
  return /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z0-9.\-_]{2,64}$/.test(clean);
}

/**
 * Builds a canonical upi://pay URI dynamically from server-validated parameters.
 * Amount is derived exclusively from server-side integer paise.
 */
export function buildUpiUri(options: BuildUpiUriOptions): string {
  if (!isValidVpa(options.payeeVpa)) {
    throw new Error(`Invalid payee VPA: ${options.payeeVpa}`);
  }

  const amountStr = toRupeesString(options.amountPaise);
  const requestedRef = String(options.transactionRef || '').trim();
  const fallbackHex = String(options.transactionRefFallback || '').replace(/-/g, '');
  const validRef = (value: string) => /^\d{1,35}$/.test(value);
  // NPCI merchant references are safest as 1–35 digits across UPI PSP apps.
  // Keep a numeric order ref when available; otherwise derive a stable 35-digit
  // reference from the payment UUID. Never truncate IDs, because that can collide.
  let fallbackRef = '';
  if (/^[a-f0-9]{32}$/i.test(fallbackHex)) {
    const min = 10n ** 34n;
    const range = 9n * min;
    fallbackRef = (min + (BigInt(`0x${fallbackHex}`) % range)).toString();
  }
  const transactionRef = validRef(requestedRef) ? requestedRef : fallbackRef;
  if (!validRef(transactionRef)) {
    throw new Error('UPI transaction reference must contain 1–35 digits');
  }
  if (options.currency && options.currency.toUpperCase() !== 'INR') {
    throw new Error('UPI payments support INR only');
  }
  const payeeName = options.payeeName.trim();
  if (!payeeName || payeeName.length > 99) throw new Error('UPI payee name must contain 1–99 characters');

  const params = new URLSearchParams();
  params.set('pa', options.payeeVpa.trim());
  params.set('pn', payeeName);
  params.set('am', amountStr);
  params.set('cu', 'INR');
  params.set('tn', String(options.transactionNote || 'LokPravaah donation').trim().slice(0, 50));
  params.set('tr', transactionRef);

  return `upi://pay?${params.toString().replace(/\+/g, '%20')}`;
}

export interface BuildUpiIntentUriOptions extends BuildUpiUriOptions {
  packageName: string;
}

/**
 * Builds an Android intent URI for launching a specific UPI application.
 * Format: intent://pay?<UPI_PARAMS>#Intent;scheme=upi;package=<PACKAGE>;end
 */
export function buildUpiIntentUri(options: BuildUpiIntentUriOptions): string {
  if (!options.packageName || !options.packageName.trim()) {
    throw new Error('Package name is required for Android UPI intent URI');
  }
  const upiUri = buildUpiUri(options);
  const query = upiUri.split('?')[1] || '';
  const cleanPackage = options.packageName.trim();
  return `intent://pay?${query}#Intent;scheme=upi;package=${cleanPackage};end`;
}
