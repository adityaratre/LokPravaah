/**
 * LokPravaah UPI Gateway — compatible checkout SDK
 *
 * Official Distributable Browser Script (youpi.js / youpi-checkout.js)
 * Provides zero-JavaScript button configuration [data-youpi-pay] and programmatic Youpi.pay({...})
 * Launches the responsive iframe checkout modal with background blur.
 * Emits normalized browser payment events and manages checkout modal lifecycle.
 *
 * IMPORTANT SECURITY NOTE:
 * Browser events and client-side callbacks are strictly for UI and user experience.
 * For LokPravaah manual-only donations, only the administrator's bank-statement/UTR review is authoritative. Browser callbacks, QR state and screenshots alone never verify payment.
 */

(function (globalScope) {
  'use strict';

  // Prevent multiple initializations
  if (globalScope.__YOUPI_SDK_INITIALIZED__) {
    return;
  }
  globalScope.__YOUPI_SDK_INITIALIZED__ = true;

  const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';

  /**
   * Helper: extract configuration from the <script> tag loading this file.
   */
  function getScriptConfig() {
    if (!isBrowser) return {};

    const script = document.currentScript ||
      document.querySelector('script[src*="youpi.js"], script[src*="youpi-checkout.js"]');

    if (!script) return {};

    let scriptUrl = '';
    try {
      scriptUrl = new URL(script.src, window.location.href);
    } catch (e) { }

    const origin = scriptUrl ? scriptUrl.origin : (window.location.protocol + '//' + window.location.hostname + ':7000');

    return {
      key: script.getAttribute('data-youpi-key') || script.getAttribute('data-key') || script.getAttribute('data-merchant-id') || '',
      apiUrl: script.getAttribute('data-api-url') || origin,
      portalUrl: script.getAttribute('data-portal-url') || script.getAttribute('data-checkout-url') || origin,
      currency: script.getAttribute('data-currency') || 'INR',
      name: script.getAttribute('data-name') || 'Merchant Store',
      themeColor: script.getAttribute('data-theme-color') || '#0b63e5',
      successUrl: script.getAttribute('data-success-url') || '',
      failedUrl: script.getAttribute('data-failed-url') || '',
      suspiciousUrl: script.getAttribute('data-suspicious-url') || '',
      expiredUrl: script.getAttribute('data-expired-url') || '',
      cancelledUrl: script.getAttribute('data-cancelled-url') || ''
    };
  }

  const scriptConfig = getScriptConfig();

  /**
   * YoupiCheckout class
   */
  class YoupiCheckout {
    /**
     * @param {{
     *   key?: string,
     *   order_id?: string,
     *   orderId?: string,
     *   amount?: number | string,
     *   currency?: string,
     *   name?: string,
     *   description?: string,
     *   customer?: { name?: string, email?: string, phone?: string },
     *   metadata?: Record<string, any>,
     *   paymentId?: string,
     *   checkoutUrl?: string,
     *   portalUrl?: string,
     *   apiUrl?: string,
     *   theme?: { color?: string },
     *   handler?: (result: any) => void,
     *   onSuccess?: (result: any) => void,
     *   onFailed?: (result: any) => void,
     *   onPaymentFailed?: (result: any) => void,
     *   onSuspicious?: (result: any) => void,
     *   onExpired?: (result: any) => void,
     *   onCancelled?: (result: any) => void,
     *   onManualPaymentRequest?: (result: any) => void,
     *   onClose?: () => void,
     *   successUrl?: string,
     *   failedUrl?: string,
     *   suspiciousUrl?: string,
     *   expiredUrl?: string,
     *   cancelledUrl?: string
     * }} options
     */
    constructor(options = {}) {
      const defaultPortal = isBrowser
        ? (scriptConfig.portalUrl || (window.location.protocol + '//' + window.location.hostname + ':7000'))
        : 'http://localhost:7000';

      const defaultApi = isBrowser
        ? (scriptConfig.apiUrl || defaultPortal)
        : 'http://localhost:6100';

      this.options = Object.assign({
        key: scriptConfig.key || '',
        order_id: '',
        orderId: '',
        amount: 0,
        currency: scriptConfig.currency || 'INR',
        name: scriptConfig.name || 'Merchant Store',
        description: 'Order Payment',
        customer: {},
        metadata: {},
        paymentId: '',
        checkoutUrl: '',
        portalUrl: defaultPortal,
        apiUrl: defaultApi,
        theme: { color: scriptConfig.themeColor || '#0b63e5' },
        handler: null,
        onSuccess: null,
        onFailed: null,
        onPaymentFailed: null,
        onSuspicious: null,
        onExpired: null,
        onCancelled: null,
        onManualPaymentRequest: null,
        onClose: null,
        successUrl: scriptConfig.successUrl || '',
        failedUrl: scriptConfig.failedUrl || '',
        suspiciousUrl: scriptConfig.suspiciousUrl || '',
        expiredUrl: scriptConfig.expiredUrl || '',
        cancelledUrl: scriptConfig.cancelledUrl || ''
      }, options);

      // Normalize order ID
      if (!this.options.orderId && this.options.order_id) {
        this.options.orderId = this.options.order_id;
      }
      if (!this.options.order_id && this.options.orderId) {
        this.options.order_id = this.options.orderId;
      }

      this.isOpen = false;
      this.backdrop = null;
      this.container = null;
      this.iframe = null;
      this.manualPanel = null;

      this._handleMessage = this._handleMessage.bind(this);
    }

    /**
     * Primary static programmatic entry point: Youpi.pay(options)
     */
    static async pay(options = {}) {
      const instance = new YoupiCheckout(options);

      // If checkoutUrl is already provided, open modal directly
      if (instance.options.checkoutUrl) {
        instance.open();
        return instance;
      }

      // If paymentId is already provided, construct checkoutUrl and open
      if (instance.options.paymentId) {
        instance.options.checkoutUrl = `${instance.options.portalUrl}/checkout/${instance.options.paymentId}`;
        instance.open();
        return instance;
      }

      // Otherwise, create the payment session through the configured gateway
      try {
        const orderId = instance.options.orderId || `ORDER-${Date.now()}`;
        instance.options.orderId = orderId;
        instance.options.order_id = orderId;

        const customer = instance.options.customer || {};
        const custPayload = {
          fullName: customer.name || customer.fullName || '',
          email: customer.email || '',
          phoneNumber: customer.phone || customer.phoneNumber || customer.mobileNumber || ''
        };

        const createRes = await fetch(`${instance.options.apiUrl}/api/v1/payments`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(instance.options.key ? { 'X-Merchant-Id': instance.options.key } : {})
          },
          body: JSON.stringify({
            orderId: orderId,
            amount: instance.options.amount,
            currency: instance.options.currency || 'INR',
            customer: (custPayload.email || custPayload.phoneNumber || custPayload.fullName) ? custPayload : undefined,
            description: instance.options.description,
            metadata: instance.options.metadata,
            returnUrl: instance.options.successUrl || undefined
          })
        });

        const data = await createRes.json();
        if (!createRes.ok || !data.checkoutUrl) {
          const errMsg = data.error || data.message || `Failed to create payment session (HTTP ${createRes.status})`;
          const failResult = {
            status: 'FAILED',
            order_id: orderId,
            reason: errMsg,
            error: errMsg
          };
          YoupiCheckout._emitEvent('youpi:payment:failed', failResult);
          YoupiCheckout._emitEvent('youpi:payment:result', failResult);
          if (typeof instance.options.onFailed === 'function') instance.options.onFailed(failResult);
          if (typeof instance.options.onPaymentFailed === 'function') instance.options.onPaymentFailed(failResult);
          throw new Error(errMsg);
        }

        instance.options.paymentId = data.paymentId;
        instance.options.checkoutUrl = data.checkoutUrl;
        instance.open();
        return instance;
      } catch (err) {
        console.error('[LokPravaah Checkout SDK] Payment initialization error:', err.message);
        throw err;
      }
    }

    /**
     * Backward-compatible static entry point: YoupiCheckout.open(options)
     */
    static open(options) {
      const instance = new YoupiCheckout(options);
      instance.open();
      return instance;
    }

    /**
     * Opens the responsive iframe checkout modal
     */
    open() {
      if (!isBrowser) {
        console.warn('YoupiCheckout.open() can only be invoked in a browser DOM environment.');
        return;
      }
      if (this.isOpen) return;
      this.isOpen = true;

      YoupiCheckout._ensureStyles();

      let targetUrl = '';
      if (this.options.checkoutUrl) {
        targetUrl = this.options.checkoutUrl;
      } else if (this.options.paymentId) {
        targetUrl = `${this.options.portalUrl}/checkout/${this.options.paymentId}`;
      } else {
        targetUrl = `${this.options.portalUrl}/checkout/demo`;
      }

      // If running on localhost / 127.0.0.1 and targetUrl points to remote domain, normalize to localhost host
      if (isBrowser && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
        if (targetUrl.includes('gauravtesting.online')) {
          try {
            const parsed = new URL(targetUrl);
            targetUrl = `${window.location.protocol}//${window.location.host}${parsed.pathname}${parsed.search}`;
          } catch {}
        }
      }

      // Add embedded flag and custom params
      const sep = targetUrl.includes('?') ? '&' : '?';
      targetUrl = `${targetUrl}${sep}embedded=1`;

      if (this.options.amount) {
        targetUrl += `&customAmount=${encodeURIComponent(this.options.amount)}`;
      }
      if (this.options.name) {
        targetUrl += `&customName=${encodeURIComponent(this.options.name)}`;
      }

      this._injectModal(targetUrl);
      window.addEventListener('message', this._handleMessage);
    }

    /**
     * Closes the checkout modal
     */
    close(callback) {
      if (!isBrowser || !this.isOpen) return;
      this.isOpen = false;

      window.removeEventListener('message', this._handleMessage);

      if (this.container) {
        this.container.classList.remove('active');
        this.container.classList.add('closing');
      }
      if (this.backdrop) {
        this.backdrop.classList.remove('active');
      }

      setTimeout(() => {
        if (this.backdrop && this.backdrop.parentNode) {
          this.backdrop.parentNode.removeChild(this.backdrop);
        }
        this.backdrop = null;
        this.container = null;
        this.iframe = null;
        this.manualPanel = null;

        if (typeof this.options.onClose === 'function') {
          this.options.onClose();
        }
        if (typeof callback === 'function') {
          callback();
        }
      }, 350);
    }

    _injectModal(targetUrl) {
      const backdrop = document.createElement('div');
      backdrop.className = 'youpi-checkout-backdrop';

      const container = document.createElement('div');
      container.className = 'youpi-checkout-container';

      const closeBtn = document.createElement('button');
      closeBtn.className = 'youpi-checkout-close-btn';
      closeBtn.innerHTML = '✕';
      closeBtn.title = 'Close Checkout';
      closeBtn.type = 'button';
      // Closing the modal hides it but leaves the payment session reusable.
      // True cancellation is still an explicit action inside the hosted checkout.
      closeBtn.onclick = () => this.close();

      const iframe = document.createElement('iframe');
      iframe.className = 'youpi-checkout-iframe';
      iframe.src = targetUrl;
      // Only messages from this exact iframe/origin are trusted (see _handleMessage).
      this._iframe = iframe;
      try { this._iframeOrigin = new URL(targetUrl, window.location.href).origin; } catch { this._iframeOrigin = null; }
      iframe.allow = 'payment';

      container.appendChild(closeBtn);
      container.appendChild(iframe);
      backdrop.appendChild(container);
      document.body.appendChild(backdrop);

      backdrop.classList.add('active');
      container.classList.add('active');

      this.backdrop = backdrop;
      this.container = container;
      this.iframe = iframe;

      // Invariant: ONLY the cross (X) button exits the payment gateway!
      // Prevent outside touch/click on backdrop from closing the checkout modal.
      const stopOutsideDismiss = (e) => {
        if (e.target === backdrop) {
          e.preventDefault();
          e.stopPropagation();
          if (e.stopImmediatePropagation) e.stopImmediatePropagation();
          return false;
        }
      };
      backdrop.addEventListener('click', stopOutsideDismiss, true);
      backdrop.addEventListener('touchstart', stopOutsideDismiss, { passive: false, capture: true });
      backdrop.addEventListener('touchend', stopOutsideDismiss, { passive: false, capture: true });
      backdrop.addEventListener('touchmove', stopOutsideDismiss, { passive: false, capture: true });
      backdrop.addEventListener('pointerdown', stopOutsideDismiss, true);
      backdrop.addEventListener('pointerup', stopOutsideDismiss, true);
      backdrop.addEventListener('mousedown', stopOutsideDismiss, true);
      backdrop.addEventListener('mouseup', stopOutsideDismiss, true);
    }

    _isSafeRedirect(url) {
      try {
        const u = new URL(url, window.location.href);
        return u.protocol === 'http:' || u.protocol === 'https:';
      } catch {
        return false;
      }
    }

    _handleMessage(e) {
      // Ignore messages from any window other than our checkout iframe (spoofed success events).
      if (!this._iframe || e.source !== this._iframe.contentWindow) return;
      if (!this._iframeOrigin || e.origin !== this._iframeOrigin) return;
      if (!e.data || typeof e.data !== 'object') return;

      const event = e.data.event;
      const rawData = e.data.data || e.data;

      if (event === 'youpi.manual_payment_request') {
        const payload = rawData || {};
        const result = {
          status: 'PENDING_REVIEW',
          order_id: payload.orderId || this.options.orderId || this.options.order_id,
          amount_received: Number(payload.amount || this.options.amount || 0),
          paymentId: this.options.paymentId || payload.paymentId || '',
          raw: payload
        };
        YoupiCheckout._emitEvent('youpi:payment:manual_review', result);
        this._showManualPaymentForm(result);
      } else if (event === 'youpi.payment_success') {
        const payload = e.data.data || {};
        const result = {
          status: 'SUCCESS',
          order_id: payload.orderId || this.options.orderId || this.options.order_id,
          payment_mode: payload.method || 'UPI',
          amount_received: Number(payload.amount || this.options.amount || 0),
          utr: payload.bankRef || payload.utr || payload.reference || '',
          timestamp: payload.completedAt || new Date().toISOString(),
          metadata: payload.metadata || this.options.metadata || {},
          raw: payload
        };

        YoupiCheckout._emitEvent('youpi:payment:success', result);
        YoupiCheckout._emitEvent('youpi:payment:result', result);

        if (typeof this.options.handler === 'function') {
          this.options.handler(result);
        }
        if (typeof this.options.onSuccess === 'function') {
          this.options.onSuccess(result);
        }

        setTimeout(() => {
          this.close(() => {
            if (this.options.successUrl) {
              const delim = this.options.successUrl.includes('?') ? '&' : '?';
              window.location.href = `${this.options.successUrl}${delim}order_id=${encodeURIComponent(result.order_id)}&amount=${encodeURIComponent(result.amount_received)}&utr=${encodeURIComponent(result.utr)}`;
            }
          });
        }, 1500);
      } else if (event === 'youpi.payment_failed') {
        const payload = e.data.data || e.data || {};
        const result = {
          status: 'FAILED',
          order_id: payload.orderId || this.options.orderId || this.options.order_id,
          payment_mode: payload.method || 'UPI',
          amount_received: 0,
          utr: '',
          reason: payload.reason || payload.status || 'PAYMENT_FAILED',
          timestamp: new Date().toISOString(),
          metadata: payload.metadata || this.options.metadata || {},
          raw: payload
        };

        YoupiCheckout._emitEvent('youpi:payment:failed', result);
        YoupiCheckout._emitEvent('youpi:payment:result', result);

        if (typeof this.options.onFailed === 'function') {
          try { this.options.onFailed(result); } catch (err) { }
        }
        if (typeof this.options.onPaymentFailed === 'function') {
          try { this.options.onPaymentFailed(result); } catch (err) { }
        }

        this.close(() => {
          if (this.options.failedUrl) {
            const delim = this.options.failedUrl.includes('?') ? '&' : '?';
            window.location.href = `${this.options.failedUrl}${delim}order_id=${encodeURIComponent(result.order_id)}&reason=${encodeURIComponent(result.reason)}`;
          } else if (payload.redirectUrl && this._isSafeRedirect(payload.redirectUrl) && payload.redirectUrl !== window.location.href && !payload.redirectUrl.includes('/checkout')) {
            window.location.href = payload.redirectUrl;
          }
        });
      } else if (event === 'youpi.payment_blocked' || event === 'youpi.payment_blocked_exit') {
        const payload = e.data.data || e.data || {};
        const result = {
          status: 'SUSPICIOUS',
          order_id: payload.orderId || this.options.orderId || this.options.order_id,
          payment_mode: payload.method || 'UPI',
          amount_received: 0,
          utr: '',
          reason: 'SECURITY_REVIEW_FLAGGED',
          timestamp: new Date().toISOString(),
          metadata: payload.metadata || this.options.metadata || {},
          raw: payload
        };

        YoupiCheckout._emitEvent('youpi:payment:suspicious', result);
        YoupiCheckout._emitEvent('youpi:payment:result', result);

        if (typeof this.options.onSuspicious === 'function') {
          try { this.options.onSuspicious(result); } catch (err) { }
        }

        this.close(() => {
          if (this.options.suspiciousUrl) {
            const delim = this.options.suspiciousUrl.includes('?') ? '&' : '?';
            window.location.href = `${this.options.suspiciousUrl}${delim}order_id=${encodeURIComponent(result.order_id)}&reason=SUSPICIOUS`;
          }
        });
      } else if (event === 'youpi.payment_expired') {
        const payload = e.data.data || e.data || {};
        const result = {
          status: 'EXPIRED',
          order_id: payload.orderId || this.options.orderId || this.options.order_id,
          timestamp: new Date().toISOString()
        };

        YoupiCheckout._emitEvent('youpi:payment:expired', result);
        YoupiCheckout._emitEvent('youpi:payment:result', result);

        if (typeof this.options.onExpired === 'function') {
          try { this.options.onExpired(result); } catch (err) { }
        }

        this.close(() => {
          if (this.options.expiredUrl) {
            const delim = this.options.expiredUrl.includes('?') ? '&' : '?';
            window.location.href = `${this.options.expiredUrl}${delim}order_id=${encodeURIComponent(result.order_id)}`;
          }
        });
      } else if (event === 'youpi.modal_close' || event === 'youpi.close' || event === 'youpi.cancel' || event === 'youpi.payment_cancelled') {
        this._dispatchCancelled();
        const redirectUrl = e.data.redirectUrl;
        this.close(() => {
          if (this.options.cancelledUrl) {
            const delim = this.options.cancelledUrl.includes('?') ? '&' : '?';
            window.location.href = `${this.options.cancelledUrl}${delim}order_id=${encodeURIComponent(this.options.orderId || '')}`;
          } else if (redirectUrl && this._isSafeRedirect(redirectUrl) && redirectUrl !== window.location.href && !redirectUrl.includes('/checkout')) {
            window.location.href = redirectUrl;
          }
        });
      }
    }


    _showManualPaymentForm(baseResult) {
      if (!this.container || !this.iframe || this.manualPanel) return;
      const panel = document.createElement('section');
      panel.className = 'youpi-manual-proof-panel';
      panel.setAttribute('aria-label', 'Submit donation payment proof');
      panel.innerHTML = [
        '<div class="youpi-manual-proof-head">',
        '<span class="youpi-manual-proof-kicker">LOKPRAVAAH · MANUAL REVIEW</span>',
        '<h2>Submit payment proof</h2>',
        '<p>Stay in this checkout. Enter the transaction UTR and attach your receipt; the team will match it with the receiving-bank statement.</p>',
        '</div>',
        '<div class="youpi-manual-proof-summary">',
        '<div><span>Donation reference</span><strong data-proof-order></strong></div>',
        '<div><span>QR amount</span><strong data-proof-expected></strong></div>',
        '</div>',
        '<form class="youpi-manual-proof-form">',
        '<label>UPI transaction ID / UTR <input name="utr" required minlength="6" maxlength="80" pattern="[A-Za-z0-9_-]{6,80}" autocomplete="off" spellcheck="false" placeholder="Enter UTR / bank reference"></label>',
        '<label>Amount actually paid (₹) <input name="amount" required type="number" min="1" max="100000" step="0.01" inputmode="decimal"></label>',
        '<label>Payment date &amp; time <span class="youpi-manual-optional">(optional)</span><input name="paymentTime" type="datetime-local"></label>',
        '<label>Receipt screenshot / PDF <input name="receipt" required type="file" accept="image/jpeg,image/png,image/webp,application/pdf"><small>Private upload · JPG, PNG, WebP or PDF · up to 10 MB. Never share a UPI PIN or OTP.</small></label>',
        '<label>Note for the reviewer <span class="youpi-manual-optional">(optional)</span><textarea name="note" rows="3" maxlength="2000" placeholder="What happened after you paid?"></textarea></label>',
        '<p class="youpi-manual-error" role="alert" hidden></p>',
        '<div class="youpi-manual-actions"><button type="button" class="youpi-manual-back">Back to QR</button><button type="submit" class="youpi-manual-submit">Submit for review</button></div>',
        '<small class="youpi-manual-foot">Submitting proof does not automatically mark your donation successful. Do not pay twice while a claim is under review.</small>',
        '</form>'
      ].join('');
      const stylesheet = document.createElement('style');
      stylesheet.textContent = [
        '.youpi-manual-proof-panel{position:absolute;inset:0;z-index:8;display:flex;flex-direction:column;overflow:auto;background:radial-gradient(ellipse at 85% 0%,#55d8a112,transparent 42%),linear-gradient(145deg,#101d25,#0b1218);color:#edf4f5;padding:clamp(20px,4vw,34px);padding-top:56px;font:14px/1.5 'DM Sans',Inter,system-ui,-apple-system,Segoe UI,sans-serif;overscroll-behavior:contain}',
        '.youpi-manual-proof-head{padding:0 0 16px;border-bottom:1px solid #29434a}',
        '.youpi-manual-proof-kicker{font-size:10px;font-weight:850;letter-spacing:.13em;color:#8be8c4}',
        '.youpi-manual-proof-head h2{font-size:25px;line-height:1.15;margin:8px 0;color:#f4fbf8;letter-spacing:-.6px}',
        '.youpi-manual-proof-head p{font-size:13px;color:#a9b8bd;line-height:1.65;margin:0}',
        '.youpi-manual-proof-summary{display:grid;grid-template-columns:minmax(0,1fr) minmax(90px,.55fr);gap:9px;margin:14px 0}',
        '.youpi-manual-proof-summary>div{min-width:0;padding:11px;border:1px solid #29434a;border-radius:12px;background:#15222b;display:grid;gap:4px}',
        '.youpi-manual-proof-summary span{font-size:10px;color:#9aadb4}',
        '.youpi-manual-proof-summary strong{font-size:12px;overflow-wrap:anywhere;color:#edf4f5}',
        '.youpi-manual-proof-form{display:grid;gap:12px;padding-bottom:18px}',
        '.youpi-manual-proof-form label{display:grid;gap:6px;font-size:12px;font-weight:750;color:#dce8e8}',
        '.youpi-manual-proof-form input:not([type=file]),.youpi-manual-proof-form textarea,.youpi-manual-proof-form input[type=file]{width:100%;min-width:0;box-sizing:border-box;padding:11px 12px;border:1px solid #30464f;border-radius:11px;background:#0b151c;color:#edf4f5;font:inherit;font-weight:500;color-scheme:dark;transition:border-color .16s,box-shadow .16s}',
        '.youpi-manual-proof-form input[type=file]{font-size:11px;padding:9px;background:#111f27}',
        '.youpi-manual-proof-form small{font-size:10px;line-height:1.55;color:#9aadb4;font-weight:500}',
        '.youpi-manual-optional{font-size:10px;font-weight:500;color:#9aadb4}',
        '.youpi-manual-actions{display:grid;grid-template-columns:minmax(0,.8fr) minmax(0,1.2fr);gap:8px}',
        '.youpi-manual-actions button{border:0;border-radius:10px;min-height:44px;padding:11px;font:inherit;font-size:12px;font-weight:800;cursor:pointer}',
        '.youpi-manual-back{background:#1a2b34;color:#dce8e8;border:1px solid #30464f!important}',
        '.youpi-manual-submit{background:#55d8a1;color:#08251a;box-shadow:0 8px 22px #55d8a11c}',
        '.youpi-manual-submit:disabled{opacity:.65;cursor:wait}',
        '.youpi-manual-error{margin:0;padding:10px 12px;border-radius:10px;background:#3a1d22;border:1px solid #7d3942;color:#ffc5ca;font-size:12px}',
        '.youpi-manual-foot{display:block;margin-top:0}',
        /* Explicit high-specificity theme lock prevents host-page/browser styles from turning the proof panel white. */
        '.youpi-manual-proof-panel{background:radial-gradient(ellipse at 85% 0%,#55d8a112,transparent 42%),linear-gradient(145deg,#101d25,#0b1218)!important;color:#edf4f5!important;color-scheme:dark!important}',
        '.youpi-manual-proof-panel,.youpi-manual-proof-panel *{box-sizing:border-box}',
        '.youpi-manual-proof-panel .youpi-manual-proof-head h2,.youpi-manual-proof-panel .youpi-manual-proof-summary strong,.youpi-manual-proof-panel .youpi-manual-proof-form label{color:#edf4f5!important}',
        '.youpi-manual-proof-panel .youpi-manual-proof-head p,.youpi-manual-proof-panel .youpi-manual-proof-summary span,.youpi-manual-proof-panel .youpi-manual-proof-form small,.youpi-manual-proof-panel .youpi-manual-optional,.youpi-manual-proof-panel .youpi-manual-foot{color:#a9b8bd!important}',
        '.youpi-manual-proof-panel .youpi-manual-proof-summary>div{background:#15222b!important;border-color:#29434a!important}',
        '.youpi-manual-proof-panel .youpi-manual-proof-form input:not([type=file]),.youpi-manual-proof-panel .youpi-manual-proof-form textarea,.youpi-manual-proof-panel .youpi-manual-proof-form input[type=file]{background:#0b151c!important;color:#edf4f5!important;border-color:#30464f!important;color-scheme:dark!important;box-shadow:none!important}',
        '.youpi-manual-proof-panel .youpi-manual-proof-form input::placeholder,.youpi-manual-proof-panel .youpi-manual-proof-form textarea::placeholder{color:#82979f!important;opacity:1!important}',
        '.youpi-manual-proof-panel .youpi-manual-back{background:#1a2b34!important;color:#dce8e8!important;border:1px solid #30464f!important}',
        '.youpi-manual-proof-panel .youpi-manual-submit{background:#55d8a1!important;color:#08251a!important}',
        '.youpi-manual-proof-panel .youpi-manual-error{background:#3a1d22!important;color:#ffc5ca!important;border-color:#7d3942!important}',
        '.youpi-manual-success{margin:auto 0;display:grid;gap:12px;text-align:center;padding:22px 0}',
        '.youpi-manual-success-icon{width:58px;height:58px;border-radius:19px;margin:0 auto;background:#55d8a11c;border:1px solid #55d8a144;color:#8be8c4;display:grid;place-items:center;font-size:30px}',
        '.youpi-manual-success h2{font-size:24px;margin:0;color:#f4fbf8}',
        '.youpi-manual-success p{font-size:13px;color:#a9b8bd;line-height:1.6;margin:0}',
        '.youpi-manual-returning{margin-top:2px;color:#8be8c4;font-size:11px;font-weight:800;letter-spacing:.02em}',
        '.youpi-manual-success button{border:0;background:#55d8a1;color:#08251a;border-radius:11px;padding:12px 18px;font-weight:800;margin-top:8px}',
        '@media(max-width:390px){.youpi-manual-proof-panel{padding:16px;padding-top:52px}.youpi-manual-proof-head h2{font-size:22px}.youpi-manual-proof-summary{grid-template-columns:1fr}.youpi-manual-actions{grid-template-columns:1fr}}'
      ].join('');
      panel.appendChild(stylesheet);
      this.container.appendChild(panel);
      this.manualPanel = panel;
      this.iframe.style.display = 'none';
      const money = value => {
        const n = Number(value);
        return Number.isFinite(n) ? n.toLocaleString('en-IN', { style:'currency', currency:'INR', maximumFractionDigits:2 }) : '—';
      };
      panel.querySelector('[data-proof-order]').textContent = String(baseResult.order_id || '—');
      panel.querySelector('[data-proof-expected]').textContent = money(baseResult.amount_received);
      panel.querySelector('[name="amount"]').value = Number(baseResult.amount_received || this.options.amount || 0).toFixed(2);

      panel.querySelector('.youpi-manual-back').addEventListener('click', () => {
        this.manualPanel?.remove();
        this.manualPanel = null;
        if (this.iframe) {
          this.iframe.style.display = '';
          this.iframe.contentWindow?.postMessage({ event: 'youpi.reset_manual_payment_request' }, this._iframeOrigin || '*');
        }
      });

      const form = panel.querySelector('form');
      form.addEventListener('submit', async event => {
        event.preventDefault();
        const formData = new FormData(form);
        const utr = String(formData.get('utr') || '').trim();
        const amount = Number(formData.get('amount'));
        const fileInput = panel.querySelector('[name="receipt"]');
        const evidenceFile = fileInput?.files?.[0] || null;
        const timeText = String(formData.get('paymentTime') || '');
        const note = String(formData.get('note') || '').trim();
        const errorBox = panel.querySelector('.youpi-manual-error');
        const submit = panel.querySelector('.youpi-manual-submit');
        const back = panel.querySelector('.youpi-manual-back');
        if (!/^[A-Za-z0-9_-]{6,80}$/.test(utr)) {
          errorBox.textContent = 'Enter the UTR from the payment receipt (6–80 letters or numbers).';
          errorBox.hidden = false; return;
        }
        if (!Number.isFinite(amount) || amount < 1 || amount > 100000 || Math.round(amount * 100) !== amount * 100) {
          errorBox.textContent = 'Enter a valid amount between ₹1 and ₹1,00,000 with up to two decimals.';
          errorBox.hidden = false; return;
        }
        if (!evidenceFile || !['image/jpeg','image/png','image/webp','application/pdf'].includes(evidenceFile.type) || evidenceFile.size > 10 * 1024 * 1024) {
          errorBox.textContent = 'Attach a JPG, PNG, WebP image or PDF receipt up to 10 MB.';
          errorBox.hidden = false; return;
        }
        if (note.length > 2000) {
          errorBox.textContent = 'Keep the note under 2,000 characters.';
          errorBox.hidden = false; return;
        }
        submit.disabled = true;
        submit.textContent = 'Uploading securely…';
        back.disabled = true;
        errorBox.hidden = true;
        const claim = { ...baseResult, utr, amount_received:amount, payment_timestamp:timeText || null, user_note:note, evidenceFile };
        let outcome = { success:false, message:'Could not submit payment proof. Please retry.' };
        try {
          if (typeof this.options.onManualPaymentRequest !== 'function') throw new Error('Manual review submission is not configured.');
          const response = await this.options.onManualPaymentRequest(claim);
          if (response && typeof response === 'object') outcome = { success:response.success === true, message:String(response.message || '') };
          else if (response === undefined) outcome = { success:true, message:'Payment proof submission was started. You can close this window and track the review in My donations.' };
        } catch (error) {
          outcome = { success:false, message:error instanceof Error ? error.message : 'Payment proof could not be submitted. Please retry.' };
        }
        if (outcome.success) {
          panel.innerHTML = '';
          panel.appendChild(stylesheet);
          const success = document.createElement('div');
          success.className = 'youpi-manual-success';
          success.innerHTML = '<div class="youpi-manual-success-icon">✓</div><h2>Thank you for your donation</h2><p></p><small>Your payment proof is <b>under review</b>. An administrator will compare the UTR and amount with the receiving bank statement before confirming it. Please do not pay again while this claim is being checked.</small><div class="youpi-manual-returning">Returning to LokPravaah…</div><button type="button">Return now</button>';
          success.querySelector('p').textContent = outcome.message || 'Your proof was submitted to the administrator review queue.';
          success.querySelector('button').addEventListener('click', () => this.close());
          // The React donation page now shows its branded thank-you/review screen underneath.
          // Close the checkout automatically instead of leaving users on a white/light modal.
          window.setTimeout(() => { if (this.isOpen) this.close(); }, 1800);
          return;
        }
        errorBox.hidden = false;
        errorBox.textContent = outcome.message || 'Payment proof could not be submitted. Please retry.';
        submit.disabled = false;
        submit.textContent = 'Submit for review';
        back.disabled = false;
      });
    }

    _dispatchCancelled() {
      const result = {
        status: 'CANCELLED',
        order_id: this.options.orderId || this.options.order_id || '',
        timestamp: new Date().toISOString()
      };
      YoupiCheckout._emitEvent('youpi:payment:cancelled', result);
      YoupiCheckout._emitEvent('youpi:payment:result', result);

      if (typeof this.options.onCancelled === 'function') {
        try { this.options.onCancelled(result); } catch (e) { }
      }
    }

    static _emitEvent(name, detail) {
      if (!isBrowser) return;
      try {
        const ev = new CustomEvent(name, { detail, bubbles: true, cancelable: true });
        window.dispatchEvent(ev);
        document.dispatchEvent(ev);
      } catch (e) { }
    }

    /**
     * Handles clicks on elements with [data-youpi-pay] attribute
     */
    static handleButtonClick(btn) {
      if (!btn) return;

      const orderId = btn.getAttribute('data-order-id') || `ORDER-${Date.now()}`;
      const amount = btn.getAttribute('data-amount') || '0';
      const currency = btn.getAttribute('data-currency') || scriptConfig.currency || 'INR';
      const name = btn.getAttribute('data-name') || scriptConfig.name || 'Merchant Store';
      const description = btn.getAttribute('data-description') || 'Order Payment';

      // Customer info
      const customer = {
        name: btn.getAttribute('data-customer-name') || '',
        email: btn.getAttribute('data-customer-email') || '',
        phone: btn.getAttribute('data-customer-phone') || btn.getAttribute('data-customer-mobile') || ''
      };

      // Metadata parsing
      let metadata = {};
      const rawMeta = btn.getAttribute('data-metadata');
      if (rawMeta) {
        try {
          metadata = JSON.parse(rawMeta);
        } catch (e) {
          metadata = { raw: rawMeta };
        }
      }
      // Gather any data-meta-* attributes
      for (const attr of btn.attributes) {
        if (attr.name.startsWith('data-meta-')) {
          const key = attr.name.slice(10);
          metadata[key] = attr.value;
        }
      }

      const checkoutUrl = btn.getAttribute('data-checkout-url') || '';
      const paymentId = btn.getAttribute('data-payment-id') || '';
      const successUrl = btn.getAttribute('data-success-url') || scriptConfig.successUrl || '';
      const failedUrl = btn.getAttribute('data-failed-url') || scriptConfig.failedUrl || '';
      const suspiciousUrl = btn.getAttribute('data-suspicious-url') || scriptConfig.suspiciousUrl || '';
      const expiredUrl = btn.getAttribute('data-expired-url') || scriptConfig.expiredUrl || '';
      const cancelledUrl = btn.getAttribute('data-cancelled-url') || scriptConfig.cancelledUrl || '';

      YoupiCheckout.pay({
        order_id: orderId,
        orderId: orderId,
        amount: amount,
        currency: currency,
        name: name,
        description: description,
        customer: customer,
        metadata: metadata,
        checkoutUrl: checkoutUrl,
        paymentId: paymentId,
        successUrl: successUrl,
        failedUrl: failedUrl,
        suspiciousUrl: suspiciousUrl,
        expiredUrl: expiredUrl,
        cancelledUrl: cancelledUrl
      }).catch(err => {
        console.error('[LokPravaah Checkout SDK] Pay error:', err);
      });
    }

    static _ensureStyles() {
      if (!isBrowser) return;
      let styleEl = document.getElementById('youpi-checkout-styles');
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'youpi-checkout-styles';
        document.head.appendChild(styleEl);
      }
      styleEl.textContent = `
        .youpi-checkout-backdrop {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          width: 100%;
          height: 100vh;
          height: 100dvh;
          height: 100%;
          background: rgba(12, 35, 64, 0.76);
          backdrop-filter: blur(6px);
          -webkit-backdrop-filter: blur(6px);
          z-index: 2147483640;
          display: flex;
          align-items: center;
          justify-content: center;
          opacity: 0;
          transition: opacity 0.25s ease-out;
          touch-action: pan-y;
          overscroll-behavior: contain;
          user-select: none;
          -webkit-user-select: none;
          -webkit-tap-highlight-color: transparent;
        }
        .youpi-checkout-backdrop.active {
          opacity: 1;
        }
        .youpi-checkout-container {
          position: relative;
          width: 440px;
          max-width: 95vw;
          height: 680px;
          max-height: 92vh;
          background: #ffffff;
          border-radius: 14px;
          box-shadow: 0 25px 65px rgba(0, 0, 0, 0.5);
          overflow: hidden;
          transform: translateY(20px) scale(0.98);
          transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
          display: flex;
          flex-direction: column;
          touch-action: auto !important;
          user-select: auto !important;
          -webkit-user-select: auto !important;
        }
        .youpi-checkout-container.active {
          transform: translateY(0) scale(1);
        }
        .youpi-checkout-container.closing {
          transform: translateY(20px) scale(0.96);
        }
        .youpi-checkout-iframe {
          width: 100%;
          height: 100%;
          border: none;
          flex: 1;
          background: #ffffff;
          touch-action: auto !important;
        }
        .youpi-checkout-close-btn {
          position: absolute;
          top: 14px;
          right: 14px;
          width: 28px;
          height: 28px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.2);
          border: none;
          color: #ffffff;
          font-size: 14px;
          cursor: pointer;
          z-index: 10;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background 0.15s;
        }
        .youpi-checkout-close-btn:hover {
          background: rgba(255, 255, 255, 0.4);
        }

        /* DESKTOP / PC MODAL STYLES (Razorpay 2-Column Exact Layout) */
        @media (min-width: 768px) {
          .youpi-checkout-container {
            width: 900px;
            max-width: 95vw;
            height: 600px;
            max-height: 92vh;
            border-radius: 16px;
            box-shadow: 0 30px 80px rgba(0, 0, 0, 0.45);
          }
          .youpi-checkout-close-btn {
            display: none; /* Native in-modal close button inside the checkout header bar */
          }
        }

        /* MOBILE BOTTOM DRAWER / BOTTOM SHEET STYLES */
        @media (max-width: 767px) {
          .youpi-checkout-backdrop {
            position: fixed !important;
            inset: 0 !important;
            top: 0 !important;
            left: 0 !important;
            right: 0 !important;
            bottom: 0 !important;
            width: 100vw !important;
            height: 100vh !important;
            display: flex !important;
            align-items: flex-end !important;
            justify-content: center !important;
            padding: 0 !important;
            margin: 0 !important;
          }
          .youpi-checkout-container {
            width: 100vw !important;
            max-width: 100vw !important;
            height: 90vh !important;
            height: 90dvh !important;
            max-height: 94vh !important;
            border-bottom-left-radius: 0 !important;
            border-bottom-right-radius: 0 !important;
            border-top-left-radius: 20px !important;
            border-top-right-radius: 20px !important;
            margin: 0 !important;
            transform: translateY(0) !important;
            box-shadow: 0 -10px 40px rgba(0, 0, 0, 0.6) !important;
            touch-action: auto !important;
            overflow: hidden !important;
          }
          .youpi-checkout-container.closing {
            transform: translateY(100%) !important;
          }
        }
      `;
    }
  }

  // Auto-bind click listener for all [data-youpi-pay] buttons on page
  if (isBrowser) {
    document.addEventListener('click', function (e) {
      const btn = e.target && e.target.closest && e.target.closest('[data-youpi-pay]');
      if (btn) {
        e.preventDefault();
        YoupiCheckout.handleButtonClick(btn);
      }
    });
  }

  // Export globals
  globalScope.YoupiCheckout = YoupiCheckout;
  globalScope.Youpi = YoupiCheckout;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = YoupiCheckout;
    module.exports.YoupiCheckout = YoupiCheckout;
    module.exports.Youpi = YoupiCheckout;
  }
})(typeof window !== 'undefined' ? window : globalThis);
