import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Download, LoaderCircle, QrCode, ShieldCheck, Smartphone } from 'lucide-react'
import { supabase } from '../lib/supabase'

type PairQrResponse = { expiresAt: number; pairingPayload: string; error?: string }
type QrModule = { generateQrSvg: (value: string, size: number) => string }
type GatewayHealth = {
  status?: string
  checks?: {
    supabase?: boolean
    supabaseUrlConfigured?: boolean
    serviceRoleKeyConfigured?: boolean
    receivingVpa?: boolean
    receiverSettingsSource?: string
    webhook?: boolean
    database?: boolean
    databaseError?: string
  }
}

const configuredGatewayUrl = (import.meta.env.VITE_DONATION_GATEWAY_API_URL as string | undefined)?.trim().replace(/\/+$/, '')
function gatewayBaseUrl() {
  if (configuredGatewayUrl) return configuredGatewayUrl
  return typeof window !== 'undefined' ? window.location.origin.replace(/\/+$/, '') : 'https://lokpravaah.online'
}

export default function UpiGatewayAdminPanel({ notify }: { notify: (message: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [qrUrl, setQrUrl] = useState('')
  const [expiresAt, setExpiresAt] = useState<number | null>(null)
  const [health, setHealth] = useState<GatewayHealth | null>(null)
  const [healthLoading, setHealthLoading] = useState(false)
  const [healthError, setHealthError] = useState('')
  const [healthCheckedAt, setHealthCheckedAt] = useState('')
  const apiBase = gatewayBaseUrl()

  const refreshGatewayHealth = useCallback(async () => {
    setHealthLoading(true); setHealthError('')
    try {
      const response = await fetch(`${apiBase}/health`, { cache: 'no-store' })
      const data = await response.json() as GatewayHealth
      setHealth(data)
      setHealthCheckedAt(new Date().toISOString())
    } catch (caught) {
      setHealthError(caught instanceof Error ? caught.message : 'Could not reach the payment gateway.')
    } finally { setHealthLoading(false) }
  }, [apiBase])

  useEffect(() => {
    void refreshGatewayHealth()
  }, [refreshGatewayHealth])

  useEffect(() => {
    return () => { if (qrUrl.startsWith('blob:')) URL.revokeObjectURL(qrUrl) }
  }, [qrUrl])

  async function generatePairingQr() {
    if (!supabase) { setError('Supabase login is not configured on this website.'); return }
    setBusy(true); setError(''); setStatus('Checking your signed-in administrator session…')
    if (qrUrl.startsWith('blob:')) URL.revokeObjectURL(qrUrl)
    setQrUrl(''); setExpiresAt(null)
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
      const accessToken = sessionData.session?.access_token
      if (sessionError || !accessToken) throw new Error('Your session has expired. Sign in again, then reopen the Admin Console.')

      setStatus('Requesting a one-time pairing code…')
      const response = await fetch(`${apiBase}/api/v1/admin/sms-gateway/pair-qr`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      })
      const result = await response.json().catch(() => ({})) as Partial<PairQrResponse>
      if (!response.ok) {
        if (response.status === 401) throw new Error('Your administrator session could not be verified. Sign in again and retry.')
        if (response.status === 403) throw new Error('Only the super administrator can pair the receiving-account device.')
        throw new Error(result.error || `Gateway request failed (${response.status}). Check the Worker deployment and configuration.`)
      }
      if (!result.pairingPayload || !result.expiresAt) throw new Error('The gateway returned an incomplete pairing response. Retry after checking the Worker logs.')

      const qrModuleUrl = `${apiBase}/qr.js`
      const qrModule = await import(/* @vite-ignore */ qrModuleUrl) as QrModule
      const svg = qrModule.generateQrSvg(result.pairingPayload, 320)
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
      setQrUrl(url); setExpiresAt(result.expiresAt)
      setStatus('Pairing QR ready. Scan it now using the receiving-account Android phone.')
      notify('A one-time UPI observer pairing QR was created. It expires in 10 minutes.')
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Could not generate the pairing QR. Please retry.'
      setError(message); setStatus('')
    } finally { setBusy(false) }
  }

  return <section className="panel ops-form-panel upi-pairing-panel">
    <div className="panel-heading"><div><div className="section-kicker">PRIVATE RECEIVING DEVICE</div><h3><Smartphone size={18} style={{ verticalAlign: '-3px', marginRight: 7 }}/>UPI observer pairing</h3><p>Pair the Android phone that receives real bank-credit notifications for the configured UPI account. This control is available only to super administrators.</p></div><ShieldCheck size={19}/></div>

    <section className="panel ops-form-panel gateway-health-panel" style={{ marginBottom: 16 }}>
      <div className="panel-heading"><div><div className="section-kicker">LIVE CHECKS</div><h3>UPI gateway diagnostics</h3><p>This status checks the deployed Worker configuration and whether it can reach Supabase. A green check does not replace a real bank-credit test.</p></div><ShieldCheck size={19}/></div>
      <div className="ops-inline-actions" style={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 999, border: '1px solid var(--line, #dbe3ed)', fontSize: 12, fontWeight: 750 }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: health?.status === 'UP' ? '#20a674' : '#d18b24' }}/>
            {healthLoading && !health ? 'Checking gateway…' : health?.status === 'UP' ? 'Gateway online' : health ? 'Configuration problem' : 'Status unavailable'}
          </span>
          {healthCheckedAt && <small className="ops-help">Checked {new Date(healthCheckedAt).toLocaleTimeString()}</small>}
        </div>
        <button className="btn btn-secondary" type="button" onClick={() => void refreshGatewayHealth()} disabled={healthLoading}>
          {healthLoading ? <LoaderCircle size={14} className="spin"/> : <RefreshCw size={14}/>} Refresh diagnostics
        </button>
      </div>
      {healthError && <div className="ops-error" role="alert" style={{ marginTop: 12 }}><AlertCircle size={16}/><span>Could not reach `/health`: {healthError}</span></div>}
      {health?.checks && <div className="gateway-health-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,220px),1fr))', gap: 9, marginTop: 14 }}>
        {([
          ['Supabase project URL', health.checks.supabaseUrlConfigured],
          ['Server-side service-role key', health.checks.serviceRoleKeyConfigured],
          ['Supabase database access', health.checks.database],
          ['Admin receiver VPA and payee', health.checks.receivingVpa],
          ['Signed donation webhook', health.checks.webhook],
        ] as const).map(([label, ok]) => <div key={label} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: 11, border: '1px solid var(--line, #dbe3ed)', borderRadius: 12 }}>
          {ok === true ? <CheckCircle2 size={16} color="#20a674"/> : <AlertCircle size={16} color="#d18b24"/>}
          <div style={{ display: 'grid', gap: 3 }}><b style={{ fontSize: 12 }}>{label}</b><small className="ops-help">{ok === true ? 'Configured' : ok === false ? 'Missing or not reachable' : 'Worker has not returned this check yet'}</small></div>
        </div>)}
      </div>}
      {health?.checks?.serviceRoleKeyConfigured === false && <div className="ops-error" role="alert" style={{ marginTop: 12 }}><AlertCircle size={16}/><span>Fix “Gateway storage is not configured”: add the `SUPABASE_SERVICE_ROLE_KEY` as a secret in Cloudflare Workers → `lokpravaah-upi-gateway` → Settings → Variables and Secrets. Never add it to `VITE_*` variables.</span></div>}
      {health?.checks?.supabaseUrlConfigured === false && <div className="ops-error" role="alert" style={{ marginTop: 12 }}><AlertCircle size={16}/><span>`SUPABASE_URL` is missing. The deployment now defaults to this project's Supabase URL; publish the latest Worker build and refresh this check.</span></div>}
      {health?.checks?.receivingVpa === false && <div className="ops-error" role="alert" style={{ marginTop: 12 }}><AlertCircle size={16}/><span>Open Donations & UPI → Receiving UPI account and set the real VPA and payee name. The active receiver, not a QR generated from the old VPA, is used for new sessions.</span></div>}
      {health?.checks?.database === false && health?.checks?.serviceRoleKeyConfigured !== false && <div className="ops-error" role="alert" style={{ marginTop: 12 }}><AlertCircle size={16}/><span>Supabase storage could not be reached{health.checks.databaseError ? ` (${health.checks.databaseError})` : ''}. Check the Worker secret, table migration and project's network/API status.</span></div>}
    </section>

    <div className="ops-help" style={{ marginBottom: 16 }}>No public pairing page or admin token is used. The Worker verifies your signed-in Supabase session and checks your role server-side before issuing a single-use QR.</div>
    {error && <div className="ops-error"><AlertCircle size={17}/><span>{error}</span></div>}
    {status && !error && <div className="ops-help" role="status" style={{ marginBottom: 12 }}><CheckCircle2 size={16} style={{ verticalAlign: '-3px', marginRight: 6 }}/>{status}</div>}
    <div className="ops-inline-actions" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
      <button className="btn btn-primary" type="button" onClick={() => void generatePairingQr()} disabled={busy}>
        {busy ? <LoaderCircle size={15} className="spin"/> : <QrCode size={15}/>} {busy ? 'Generating secure QR…' : qrUrl ? 'Generate fresh pairing QR' : 'Generate pairing QR'}
      </button>
      <a className="btn btn-secondary" href={`${apiBase}/youpi-sms-gateway.apk`} download="youpi-sms-gateway.apk" target="_blank" rel="noopener noreferrer"><Download size={15}/> Download Android app</a>
    </div>
    {qrUrl && <div className="ops-upi-pair-qr" style={{ marginTop: 20, padding: 18, border: '1px solid var(--line, #dbe3ed)', borderRadius: 18, background: '#fff', color: '#142238', maxWidth: 390, textAlign: 'center' }}>
      <img src={qrUrl} alt="One-time Android observer pairing QR" style={{ width: 'min(100%, 320px)', height: 'auto', display: 'block', margin: '0 auto' }}/>
      <b style={{ display: 'block', marginTop: 8 }}>Scan now · one use only</b>
      <p style={{ margin: '5px 0 0', color: '#5b6678', fontSize: 13 }}>Expires {expiresAt ? new Date(expiresAt).toLocaleString() : 'in 10 minutes'}. Generate a fresh QR if it expires or pairing fails.</p>
      <p style={{ margin: '8px 0 0', color: '#5b6678', fontSize: 13 }}>Open the YOUPI observer app on the receiving-account phone and choose “Scan Pairing QR”.</p>
    </div>}
    <div className="ops-help" style={{ marginTop: 15 }}>For auto-verification, keep this phone online, enable the app's required notification access, and allow background operation. The QR is only for device pairing; a donation is marked successful only after a signed bank notification is verified.</div>
  </section>
}
