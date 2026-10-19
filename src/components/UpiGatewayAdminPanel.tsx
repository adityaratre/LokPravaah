import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-react'

type GatewayHealth = {
  status?: string
  service?: string
  checks?: {
    supabase?: boolean
    supabaseUrlConfigured?: boolean
    serviceRoleKeyConfigured?: boolean
    receivingVpa?: boolean
    receiverSettingsSource?: string
    webhook?: boolean
    webhookConfigured?: boolean
    manualReviewOnly?: boolean
    automaticObserverEnabled?: boolean
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
  const [health, setHealth] = useState<GatewayHealth | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [checkedAt, setCheckedAt] = useState('')
  const apiBase = gatewayBaseUrl()

  const refreshGatewayHealth = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch(apiBase + '/health', { cache: 'no-store' })
      const data = await response.json() as GatewayHealth
      setHealth(data)
      setCheckedAt(new Date().toISOString())
      if (!response.ok) {
        const message = data.status === 'CONFIGURATION_REQUIRED'
          ? 'Gateway reachable, but a required setting is missing or unavailable.'
          : 'Gateway health check returned HTTP ' + response.status + '.'
        setError(message)
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Could not reach the payment gateway.'
      setError(message)
      notify('UPI gateway diagnostics failed: ' + message)
    } finally {
      setLoading(false)
    }
  }, [apiBase, notify])

  useEffect(() => {
    void refreshGatewayHealth()
  }, [refreshGatewayHealth])

  const manualModeActive = health?.checks?.manualReviewOnly === true && health?.checks?.automaticObserverEnabled === false
  const checks: Array<[string, boolean | undefined]> = [
    ['Supabase project URL', health?.checks?.supabaseUrlConfigured],
    ['Server-side database key', health?.checks?.serviceRoleKeyConfigured],
    ['Supabase database access', health?.checks?.database],
    ['Receiver UPI ID and payee name', health?.checks?.receivingVpa],
    ['Manual-only review mode', health?.checks?.manualReviewOnly],
    ['Automatic payment detection disabled', health?.checks?.automaticObserverEnabled === false],
  ]

  return <section className="panel" style={{ marginBottom: 16 }}>
    <div className="panel-heading">
      <div>
        <div className="section-kicker">MANUAL BANK-RECORD REVIEW</div>
        <h3>UPI gateway diagnostics</h3>
        <p>Custom-amount UPI QR checkout remains available. Payment confirmation is deliberately manual; an administrator must check the real bank credit and submitted UTR.</p>
      </div>
      <ShieldCheck size={19}/>
    </div>

    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 11px', borderRadius: 999, border: '1px solid var(--line, #dbe3ed)', fontSize: 12, fontWeight: 800 }}>
        <span style={{ width: 8, height: 8, borderRadius: 999, background: health?.status === 'UP' && manualModeActive ? '#20a674' : '#d18b24' }}/>
        {loading && !health ? 'Checking gateway…' : health?.status === 'UP' && manualModeActive ? 'Gateway online · Manual review' : health ? 'Check configuration below' : 'Status unavailable'}
      </span>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {checkedAt && <small className="ops-help">Checked {new Date(checkedAt).toLocaleTimeString()}</small>}
        <button className="btn btn-secondary" type="button" onClick={() => void refreshGatewayHealth()} disabled={loading}>
          {loading ? <LoaderCircle size={14} className="spin"/> : <RefreshCw size={14}/>} Refresh diagnostics
        </button>
      </div>
    </div>

    <div style={{ marginTop: 14, display: 'flex', alignItems: 'flex-start', gap: 10, padding: 13, borderRadius: 12, border: '1px solid #20a67455', background: '#20a6740c' }}>
      <ShieldCheck size={18} color="#20a674" style={{ flex: '0 0 auto' }}/>
      <div style={{ display: 'grid', gap: 5 }}>
        <b style={{ fontSize: 12 }}>Automatic pairing and confirmation are disabled</b>
        <small className="ops-help">Do not use the legacy Android observer app. Users enter their UTR and upload the receipt inside the checkout modal; an administrator checks the actual credit and approves the claim. The QR and custom donation amount are still supported.</small>
      </div>
    </div>

    {error && <div className="ops-error" role="alert" style={{ marginTop: 12 }}><AlertCircle size={16}/><span>{error}</span></div>}
    {health?.checks && <div className="gateway-health-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,220px),1fr))', gap: 9, marginTop: 14 }}>
      {checks.map(([label, ok]) => <div key={label} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: 11, border: '1px solid var(--line, #dbe3ed)', borderRadius: 12 }}>
        {ok === true ? <CheckCircle2 size={16} color="#20a674"/> : <AlertCircle size={16} color="#d18b24"/>}
        <div style={{ display: 'grid', gap: 3 }}>
          <b style={{ fontSize: 12 }}>{label}</b>
          <small className="ops-help">{ok === true ? 'Ready' : ok === false ? 'Not ready' : 'Waiting for health response'}</small>
        </div>
      </div>)}
    </div>}
    {health?.checks?.receiverSettingsSource && <small className="ops-help" style={{ display: 'block', marginTop: 10 }}>Receiver settings source: {health.checks.receiverSettingsSource}.</small>}
    {health?.checks?.receivingVpa === false && <div className="ops-error" role="alert" style={{ marginTop: 12 }}><AlertCircle size={16}/><span>Open Donations &amp; UPI → Receiving UPI account and set the real UPI ID and payee name. New QR codes cannot be created until those values are valid.</span></div>}
    {health?.checks?.database === false && <div className="ops-error" role="alert" style={{ marginTop: 12 }}><AlertCircle size={16}/><span>Supabase storage could not be reached. Check the server-only Cloudflare Worker secret and gateway database migrations.</span></div>}
    <div className="ops-help" style={{ marginTop: 14 }}>Signed payment webhooks are intentionally not used in manual-review mode. The only approval path is the secure admin review action, which checks the bank reference, prevents duplicate UTRs, and stores an audit note.</div>
  </section>
}
