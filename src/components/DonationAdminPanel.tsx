import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { AlertCircle, CheckCircle2, ExternalLink, Eye, EyeOff, FileCheck, HeartHandshake, LoaderCircle, RefreshCw, RotateCcw, Save, ShieldCheck, Trash2, Wallet, XCircle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import './DonationAdminPanel.css'

type Settings = {
  donations_enabled: boolean
  payment_gateway_enabled: boolean
  gateway_portal_url: string | null
  gateway_api_url: string | null
  gateway_merchant_key: string | null
  upi_vpa: string | null
  upi_payee_name: string | null
  leaderboard_enabled: boolean
  show_public_total: boolean
  show_goal_progress: boolean
  show_recent_donations: boolean
  show_donor_messages: boolean
  campaign_title: string
  campaign_description: string
  campaign_goal_paise: number
  min_amount_paise: number
  max_amount_paise: number
  payment_session_minutes: number
  suggested_amounts: number[]
  thank_you_title: string
  thank_you_message: string
}
type DonationRow = {
  id: string; order_id: string; amount_paise: number; currency: string; donor_user_id: string | null
  donor_name: string | null; donor_email: string | null; is_anonymous: boolean; show_on_leaderboard: boolean; show_message_publicly: boolean
  admin_hidden: boolean; message: string | null; status: string; utr: string | null; gateway_payment_id: string | null
  created_at: string; verified_at: string | null; admin_removed_at?: string | null; admin_removal_note?: string | null
}
type DonationClaim = {
  id: string; donation_id: string; submitted_by: string; order_id: string; amount_paise: number; payment_reference: string | null; user_note: string; evidence_paths: string[]; status: string; admin_note: string | null; reviewed_by: string | null; reviewed_at: string | null; created_at: string; updated_at: string; donation_status: string; donor_name: string
}
type ChangeRequest = { id: string; requested_by: string; changes: Record<string, unknown>; base_settings?: Record<string, unknown> | null; status: string; review_note: string | null; reviewed_by: string | null; reviewed_at: string | null; created_at: string }
type GatewayHealth = { status?: string; service?: string; gateway_version?: string; checks?: Record<string, boolean | null>; diagnostics?: { missing?: string[]; databaseError?: string | null; settingsError?: string | null; note?: string } }
type AdminData = { role: string; settings: Settings; donations: DonationRow[]; change_requests: ChangeRequest[] }

const DEFAULT_SETTINGS: Settings = {
  donations_enabled: true, payment_gateway_enabled: true, gateway_portal_url: null, gateway_api_url: null, gateway_merchant_key: null, upi_vpa: null, upi_payee_name: null,
  leaderboard_enabled: true, show_public_total: true, show_goal_progress: true, show_recent_donations: true, show_donor_messages: true,
  campaign_title: 'Build a stronger civic community', campaign_description: 'Your contribution helps keep LokPravaah available, accessible and improving.',
  campaign_goal_paise: 5000000, min_amount_paise: 100, max_amount_paise: 10000000, payment_session_minutes: 15, suggested_amounts: [51, 101, 251, 501, 1001, 2100],
  thank_you_title: 'Thank you for backing civic action', thank_you_message: 'Your support helps us keep improving LokPravaah for the community.',
}
const rupees = (paise: number) => (Math.max(0, Number(paise) || 0) / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 })
const dateText = (value?: string | null) => { if (!value) return '—'; const d = new Date(value); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) }
const friendlyKey: Record<string, string> = {
  donations_enabled: 'Accept donations', payment_gateway_enabled: 'Enable online UPI checkout', gateway_portal_url: 'Checkout portal URL', gateway_api_url: 'Payment API URL', gateway_merchant_key: 'Public merchant key',
  min_amount_paise: 'Minimum donation', max_amount_paise: 'Maximum donation', campaign_goal_paise: 'Campaign goal', suggested_amounts: 'Suggested amounts', payment_session_minutes: 'UPI session timer', upi_vpa: 'Receiving UPI ID', upi_payee_name: 'Receiving account name',
}
function requestValue(key: string, value: unknown): string {
  if (key.endsWith('_paise') && typeof value === 'number') return rupees(value)
  if (key === 'suggested_amounts' && Array.isArray(value)) return value.map(String).map(v => `₹${v}`).join(', ')
  if (typeof value === 'boolean') return value ? 'On' : 'Off'
  return String(value ?? '(empty)')
}

export default function DonationAdminPanel({ role, notify }: { role: string; notify: (message: string) => void }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [donations, setDonations] = useState<DonationRow[]>([])
  const [claims, setClaims] = useState<DonationClaim[]>([])
  const [requests, setRequests] = useState<ChangeRequest[]>([])
  const [presetText, setPresetText] = useState(DEFAULT_SETTINGS.suggested_amounts.join(', '))
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [lastLoaded, setLastLoaded] = useState('')
  const [recordFilter, setRecordFilter] = useState('review')
  const [recordSearch, setRecordSearch] = useState('')
  const [manualInputs, setManualInputs] = useState<Record<string, { utr: string; note: string }>>({})
  const [claimInputs, setClaimInputs] = useState<Record<string, { utr: string; note: string }>>({})
  const [evidenceUrls, setEvidenceUrls] = useState<Record<string, string>>({})
  const [claimFilter, setClaimFilter] = useState('pending_review')
  const [gatewayHealth, setGatewayHealth] = useState<GatewayHealth | null>(null)
  const [gatewayHealthError, setGatewayHealthError] = useState('')
  const [healthLoading, setHealthLoading] = useState(false)

  const load = useCallback(async () => {
    if (!supabase) { setError('Supabase is not configured.'); setLoading(false); return }
    setLoading(true); setError('')
    const { data, error: rpcError } = await supabase.rpc('janwatch_admin_get_donation_data')
    if (rpcError) {
      setError(`Donation administration data could not load${rpcError.code ? ` (${rpcError.code})` : ''}. Apply the donation SQL migration and confirm your account has the admin role.`)
      setLoading(false); return
    }
    const result = data as Partial<AdminData> | null
    const nextSettings = { ...DEFAULT_SETTINGS, ...(result?.settings ?? {}), suggested_amounts: Array.isArray(result?.settings?.suggested_amounts) ? result!.settings!.suggested_amounts : DEFAULT_SETTINGS.suggested_amounts }
    setSettings(nextSettings)
    setPresetText(nextSettings.suggested_amounts.join(', '))
    setDonations(Array.isArray(result?.donations) ? result!.donations! : [])
    setRequests(Array.isArray(result?.change_requests) ? result!.change_requests! : [])
    const { data: claimData, error: claimError } = await supabase.rpc('janwatch_admin_get_donation_claims')
    if (claimError) {
      setClaims([])
      setError(`Donation records loaded, but payment-proof claims are unavailable. Apply the latest UPI/ticket SQL migration. ${claimError.message || ''}`)
    } else {
      setClaims(Array.isArray(claimData) ? claimData as DonationClaim[] : [])
    }
    setLastLoaded(new Date().toISOString())
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    const suggested = presetText.split(',').map(x => Number(x.trim())).filter(x => Number.isFinite(x))
    if (!suggested.length || suggested.length > 8 || suggested.some(v => !Number.isInteger(v) || v < Number(settings.min_amount_paise) / 100 || v > Number(settings.max_amount_paise) / 100)) {
      setError('Suggested amounts must contain 1–8 whole-rupee values between the chosen minimum and maximum.'); return
    }
    const min = Math.round(Number(settings.min_amount_paise))
    const max = Math.round(Number(settings.max_amount_paise))
    const goal = Math.round(Number(settings.campaign_goal_paise))
    const sessionMinutes = Math.round(Number(settings.payment_session_minutes))
    if (!Number.isInteger(sessionMinutes) || sessionMinutes < 5 || sessionMinutes > 30) { setError('Checkout timer must be between 5 and 30 minutes.'); return }
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 100 || max < min || max > 10000000 || !Number.isInteger(goal) || goal < 10000) {
      setError('Check the minimum, maximum and campaign goal values. Values are stored in paise internally.'); return
    }
    const portal = settings.gateway_portal_url?.trim() || null
    const api = settings.gateway_api_url?.trim() || null
    const receiverVpa = settings.upi_vpa?.trim() || null
    const receiverName = settings.upi_payee_name?.trim() || null
    if ((receiverVpa && !/^[^\s@]+@[^\s@]+$/.test(receiverVpa)) || (receiverName && receiverName.length > 80) || Boolean(receiverVpa) !== Boolean(receiverName)) { setError('Set a valid receiving UPI ID and its payee/account name together, or leave both blank to use server environment values.'); return }
    if ((portal && !/^https:\/\//i.test(portal)) || (api && !/^https:\/\//i.test(api))) { setError('Payment portal and API URLs must use HTTPS.'); return }
    if (!window.confirm(role === 'super_admin' ? 'Save donation configuration? Payment-related changes will apply immediately.' : 'Save donation configuration? Major payment-related changes will be sent to the super administrator for approval.')) return
    setBusy('settings'); setError('')
    const payload = { ...settings, gateway_portal_url: portal, gateway_api_url: api, gateway_merchant_key: settings.gateway_merchant_key?.trim() || null, upi_vpa: receiverVpa, upi_payee_name: receiverName, min_amount_paise: min, max_amount_paise: max, campaign_goal_paise: goal, payment_session_minutes: sessionMinutes, suggested_amounts: suggested }
    const { data, error: saveError } = await supabase.rpc('janwatch_admin_update_donation_settings', { p_settings: payload })
    setBusy('')
    if (saveError) { setError(`Donation settings could not be saved: ${saveError.message || 'check database permissions and values.'}`); return }
    const response = data as { status?: string; message?: string } | null
    notify(response?.message || (response?.status === 'pending_approval' ? 'Major changes submitted for super-admin approval.' : 'Donation settings saved.'))
    await load()
  }

  async function testGatewayHealth() {
    const configured = settings.gateway_api_url?.trim() || (import.meta.env.VITE_DONATION_GATEWAY_API_URL as string | undefined)?.trim() || window.location.origin
    const base = configured.replace(/\/+$/, '')
    setHealthLoading(true); setGatewayHealthError(''); setGatewayHealth(null)
    try {
      const response = await fetch(`${base}/health`, { method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store' })
      const body = await response.json().catch(() => null) as GatewayHealth | null
      if (!body) throw new Error(`Gateway returned HTTP ${response.status} but not a JSON health response. Check the active Worker route.`)
      setGatewayHealth(body)
      if (!body.gateway_version || !body.diagnostics) {
        setGatewayHealthError(`This health response lacks the current gateway version/diagnostics. The domain route may still be serving an older Worker deployment. Deploy the latest cloudflare-upi-worker code and verify both the root-domain route and the Worker workers.dev URL. HTTP ${response.status}.`)
      } else if (!response.ok) setGatewayHealthError(`Health check returned HTTP ${response.status}. Use the diagnostic list below to repair the Worker environment.`)
      else if (body.status !== 'UP') setGatewayHealthError('The Worker responded, but its configuration is not ready.')
      else notify(`Gateway configuration health passed (${body.gateway_version}). Run a controlled end-to-end payment test before enabling donations.`)
    } catch (caught) {
      setGatewayHealthError(caught instanceof Error ? `${caught.message} (URL: ${base}/health)` : `Could not reach ${base}/health. Check the URL, HTTPS and Worker route.`)
    } finally { setHealthLoading(false) }
  }

  async function reviewRequest(request: ChangeRequest, approve: boolean) {
    if (!supabase || role !== 'super_admin') return
    const action = approve ? 'approve' : 'reject'
    const note = notes[request.id]?.trim() || ''
    if (note.length < 5) { setError('Enter a review note of at least 5 characters before approving or rejecting a request.'); return }
    if (!window.confirm(`${approve ? 'Approve and apply' : 'Reject'} this major donation settings change? The decision and review note will be recorded.`)) return
    setBusy(request.id); setError('')
    const { data, error: reviewError } = await supabase.rpc('janwatch_super_admin_review_donation_settings', { p_request_id: request.id, p_approve: approve, p_note: note })
    setBusy('')
    if (reviewError) { setError(`Could not ${action} the request: ${reviewError.message || 'check permissions and refresh.'}`); return }
    notify((data as { message?: string } | null)?.message || `Donation settings request ${action}d.`)
    await load()
  }

  async function setDonationHidden(donation: DonationRow) {
    if (!supabase) return
    const nextHidden = !donation.admin_hidden
    if (!window.confirm(`${nextHidden ? 'Hide this verified donation from public activity?' : 'Restore this donation to public activity if the donor opted in?'}`)) return
    setBusy(donation.id); setError('')
    const { error: visibilityError } = await supabase.rpc('janwatch_admin_set_donation_visibility', { p_donation_id: donation.id, p_hidden: nextHidden })
    setBusy('')
    if (visibilityError) { setError(`Donation visibility could not be changed: ${visibilityError.message || 'please try again.'}`); return }
    notify(nextHidden ? 'Donation hidden from the public feed.' : 'Donation visibility restored; donor opt-in settings are still respected.')
    await load()
  }

  async function prepareEvidenceLink(claim: DonationClaim, path: string) {
    if (!supabase) return
    const key = `${claim.id}:${path}`
    setBusy(key); setError('')
    const { data, error: linkError } = await supabase.storage.from('donation-payment-evidence').createSignedUrl(path, 120)
    setBusy('')
    if (linkError || !data?.signedUrl) { setError(`Evidence link could not be created: ${linkError?.message || 'check private bucket policy and migration.'}`); return }
    setEvidenceUrls(current => ({ ...current, [key]: data.signedUrl }))
  }

  async function reviewPaymentClaim(claim: DonationClaim, approve: boolean) {
    if (!supabase || !['admin','super_admin'].includes(role)) return
    const input = claimInputs[claim.id] || { utr: '', note: '' }
    const utr = input.utr.trim()
    const note = input.note.trim()
    if (note.length < 5 || note.length > 500) { setError('Enter an admin review note/rejection reason of 5–500 characters.'); return }
    if (approve && !/^[A-Za-z0-9_-]{6,80}$/.test(utr)) { setError('For approval, enter the real UTR/bank reference after checking the receiving account statement.'); return }
    if (approve && !window.confirm(`Confirm the receiving bank/account statement shows ₹${(claim.amount_paise / 100).toFixed(2)} for ${claim.order_id} and this exact UTR ${utr}? A screenshot alone is not proof.`)) return
    if (!approve && !window.confirm('Reject this payment claim with the review reason? The donation will remain unverified.')) return
    setBusy(claim.id); setError('')
    const { data, error: reviewError } = await supabase.rpc('janwatch_admin_review_donation_claim', { p_claim_id: claim.id, p_decision: approve ? 'approve' : 'reject', p_utr: approve ? utr : null, p_note: note })
    setBusy('')
    if (reviewError) { setError(`Could not ${approve ? 'approve' : 'reject'} payment claim: ${reviewError.message || 'check role and migration.'}`); return }
    const response = data as { message?: string } | null
    notify(response?.message || (approve ? 'Claim approved after recording verification.' : 'Claim rejected and reason recorded.'))
    setClaimInputs(current => { const next = { ...current }; delete next[claim.id]; return next })
    setEvidenceUrls(current => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${claim.id}:`))))
    await load()
  }

  async function setDonationRemoved(donation: DonationRow) {
    if (!supabase || !['admin','super_admin'].includes(role)) return
    const remove = !donation.admin_removed_at
    const note = window.prompt(remove ? `Reason to remove ${donation.order_id} from public totals/activity (5–500 chars):` : `Reason to restore ${donation.order_id} to public totals/activity (5–500 chars):`, '')?.trim() || ''
    if (note.length < 5 || note.length > 500) { setError('A removal/restore reason of 5–500 characters is required.'); return }
    if (!window.confirm(remove ? 'Remove this donation from public totals, leaderboard and recent activity? Private records will be preserved.' : 'Restore this donation to public totals/activity, respecting the original visibility settings?')) return
    setBusy(`remove:${donation.id}`); setError('')
    const { data, error: removeError } = await supabase.rpc('janwatch_admin_set_donation_removed', { p_donation_id: donation.id, p_removed: remove, p_note: note })
    setBusy('')
    if (removeError) { setError(`Donation removal/restore failed: ${removeError.message || 'check the latest SQL migration.'}`); return }
    const response = data as { message?: string } | null
    notify(response?.message || (remove ? 'Donation removed from public totals.' : 'Donation restored.'))
    await load()
  }

  async function manuallyVerifyDonation(donation: DonationRow) {
    if (!supabase || !['admin', 'super_admin'].includes(role)) return
    const input = manualInputs[donation.id] || { utr: '', note: '' }
    const utr = input.utr.trim()
    const note = input.note.trim()
    if (!/^[A-Za-z0-9_-]{6,80}$/.test(utr)) { setError('Enter the real UTR / bank reference (6–80 letters, numbers, _ or -).'); return }
    if (note.length < 5 || note.length > 500) { setError('Add a review note (5–500 characters) after checking the receiving bank account.'); return }
    if (!window.confirm(`I checked the receiving bank/account statement and confirmed ₹${(donation.amount_paise / 100).toFixed(2)} was received for order ${donation.order_id}. Mark this record verified?`)) return
    setBusy(donation.id); setError('')
    const { data, error: reviewError } = await supabase.rpc('janwatch_admin_manual_verify_donation', { p_donation_id: donation.id, p_utr: utr, p_note: note })
    setBusy('')
    if (reviewError) { setError(`Manual verification failed: ${reviewError.message || 'check UTR uniqueness, migration and administrator role.'}`); return }
    const response = data as { message?: string; status?: string } | null
    notify(response?.message || 'Donation manually verified and review logged.')
    setManualInputs(current => { const next = { ...current }; delete next[donation.id]; return next })
    await load()
  }

  const pendingRequests = requests.filter(item => item.status === 'pending')
  const paid = donations.filter(item => item.status === 'succeeded')
  const pending = donations.filter(item => item.status === 'pending').length
  const paidTotal = paid.reduce((sum, item) => sum + Number(item.amount_paise || 0), 0)
  const visibleDonations = donations.filter(item => {
    const text = `${item.order_id} ${item.utr || ''} ${item.donor_name || ''} ${item.donor_email || ''}`.toLowerCase()
    const statusOk = recordFilter === 'all' ? true : recordFilter === 'review' ? item.status !== 'succeeded' : item.status === recordFilter
    return statusOk && text.includes(recordSearch.trim().toLowerCase())
  })

  return <div className="donation-admin">
    <div className="donation-admin-intro"><div><div className="section-kicker">DONATION OPERATIONS</div><h2>Donations & UPI settings</h2><p>Configure the public fundraiser, review verified payments and govern high-impact changes. Gateway passwords and webhook signing secrets never belong in browser settings.</p></div><button type="button" className="btn btn-secondary" onClick={() => void load()} disabled={loading}><RefreshCw size={14} className={loading ? 'spin' : ''}/> Refresh</button></div>
    {error && <div className="donation-admin-error"><AlertCircle size={17}/><span>{error}</span><button type="button" className="icon-btn" onClick={() => setError('')} aria-label="Dismiss error"><XCircle size={15}/></button></div>}
    <div className="donation-admin-stats"><article><span>Verified donations loaded</span><b>{paid.length}</b><small>Current recent records</small></article><article><span>Verified amount in records</span><b>{rupees(paidTotal)}</b><small>Latest {paid.length} successful records</small></article><article><span>Pending checkout records</span><b>{pending}</b><small>Awaiting payment result</small></article><article><span>Major changes awaiting review</span><b>{pendingRequests.length}</b><small>{role === 'super_admin' ? 'Review below' : 'Super-admin approval'}</small></article></div>

    <section className="panel donation-admin-settings">
      <div className="panel-heading"><div><div className="section-kicker">FUNDRAISER SETTINGS</div><h3>Public page and gateway</h3><p>Normal admins can save presentation changes. Payment enablement, limits, targets and gateway endpoints are major changes and require super-admin approval.</p></div><Wallet size={19}/></div>
      <form className="donation-admin-form" onSubmit={saveSettings}>
        <div className="donation-admin-toggles">
          {([['donations_enabled','Accept new donations'],['payment_gateway_enabled','Enable UPI checkout'],['leaderboard_enabled','Show top supporters leaderboard'],['show_public_total','Show total funds raised'],['show_goal_progress','Show goal progress bar'],['show_recent_donations','Show recent contributions'],['show_donor_messages','Show opted-in donor messages']] as const).map(([key,label]) => <label className="ops-config-toggle" key={key}><input type="checkbox" checked={Boolean(settings[key])} onChange={e => setSettings(v => ({ ...v, [key]: e.target.checked }))}/><span><b>{label}</b><small>{key === 'donations_enabled' ? 'Turning this on/off is a major change.' : key === 'payment_gateway_enabled' ? 'Online payment enablement needs super-admin approval.' : 'Controls what is shown on the public donation page.'}</small></span></label>)}
        </div>
        <div className="donation-admin-config-grid">
          <label>Campaign title<input maxLength={120} value={settings.campaign_title} onChange={e => setSettings(v => ({ ...v, campaign_title: e.target.value }))} required/></label>
          <label>Campaign description<textarea rows={3} maxLength={600} value={settings.campaign_description} onChange={e => setSettings(v => ({ ...v, campaign_description: e.target.value }))} required/></label>
          <label>Minimum amount (₹)<input type="number" min="1" max="100000" step="0.01" value={settings.min_amount_paise / 100} onChange={e => setSettings(v => ({ ...v, min_amount_paise: Math.round(Number(e.target.value) * 100) }))} required/><small>Major change — requires super-admin approval if saved by an admin.</small></label>
          <label>Maximum amount (₹)<input type="number" min="1" max="100000" step="0.01" value={settings.max_amount_paise / 100} onChange={e => setSettings(v => ({ ...v, max_amount_paise: Math.round(Number(e.target.value) * 100) }))} required/><small>Major change — requires super-admin approval if saved by an admin.</small></label>
          <label>Campaign goal (₹)<input type="number" min="100" max="1000000000" step="100" value={settings.campaign_goal_paise / 100} onChange={e => setSettings(v => ({ ...v, campaign_goal_paise: Math.round(Number(e.target.value) * 100) }))} required/><small>Progress is calculated from gateway-verified contributions only.</small></label>
          <label>UPI checkout timer (minutes)<input type="number" min="5" max="30" step="1" value={settings.payment_session_minutes} onChange={e => setSettings(v => ({ ...v, payment_session_minutes: Number(e.target.value) }))} required/><small>Controls the actual server-side session expiry and checkout countdown. Admin changes await super-admin approval.</small></label>
          <label>Suggested amounts (₹)<input value={presetText} onChange={e => setPresetText(e.target.value)} maxLength={100} placeholder="51, 101, 251, 501, 1001, 2100" required/><small>Use 1–8 whole-rupee amounts separated by commas. Major change.</small></label>
          <label>Thank-you title<input maxLength={120} value={settings.thank_you_title} onChange={e => setSettings(v => ({ ...v, thank_you_title: e.target.value }))} required/></label>
          <label>Thank-you message<textarea rows={3} maxLength={600} value={settings.thank_you_message} onChange={e => setSettings(v => ({ ...v, thank_you_message: e.target.value }))} required/></label>
        </div>
        <div className="donation-admin-gateway"><div><HeartHandshake size={18}/><div><b>UPI gateway connection</b><small>These are public checkout configuration values, not secrets. Use HTTPS URLs. Keep webhook signing secrets inside the gateway/Supabase server settings.</small></div></div>
          <label>Checkout portal URL<input type="url" value={settings.gateway_portal_url ?? ''} onChange={e => setSettings(v => ({ ...v, gateway_portal_url: e.target.value }))} placeholder="https://pay.example.com"/></label>
          <label>Payment API URL<input type="url" value={settings.gateway_api_url ?? ''} onChange={e => setSettings(v => ({ ...v, gateway_api_url: e.target.value }))} placeholder="https://pay.example.com"/></label>
          <label>Public merchant ID/key<input autoComplete="off" maxLength={200} value={settings.gateway_merchant_key ?? ''} onChange={e => setSettings(v => ({ ...v, gateway_merchant_key: e.target.value }))} placeholder="Gateway merchant UUID"/><small>Must match the Worker MERCHANT_ID.</small></label>
          <label>Receiving UPI ID (VPA)<input autoComplete="off" maxLength={200} value={settings.upi_vpa ?? ''} onChange={e => setSettings(v => ({ ...v, upi_vpa: e.target.value }))} placeholder="yourname@bank"/><small>Blank uses the server-side UPI_VPA variable. A set value is used by new sessions after approval.</small></label>
          <label>UPI payee / account name<input autoComplete="off" maxLength={80} value={settings.upi_payee_name ?? ''} onChange={e => setSettings(v => ({ ...v, upi_payee_name: e.target.value }))} placeholder="Account holder name"/><small>Must match the receiver account shown in the UPI app. Blank uses UPI_PAYEE_NAME.</small></label>
          <p className="donation-admin-gateway-note">Gateway endpoint, merchant ID, timer and receiving-account changes are queued for super-admin approval when an ordinary admin submits them. Hosting environment variables remain a fallback if the database values are blank.</p>
        </div>
        <section className="donation-admin-health"><div><div><b>Live gateway health check</b><small>Tests the API URL currently entered above (or the public build URL if blank). A 503 means the Worker is reachable but missing server configuration.</small></div><button className="btn btn-secondary" type="button" disabled={healthLoading} onClick={() => void testGatewayHealth()}>{healthLoading ? <LoaderCircle size={14} className="spin"/> : <RefreshCw size={14}/>} {healthLoading ? 'Checking…' : 'Test gateway now'}</button></div>{gatewayHealthError && <p className="donation-admin-health-error" role="alert">{gatewayHealthError}</p>}{gatewayHealth && <><div className="donation-admin-health-status"><b className={gatewayHealth.status === 'UP' ? 'is-good' : 'is-bad'}>{gatewayHealth.status || 'Unknown status'}</b><small>{gatewayHealth.service || 'Gateway'}{gatewayHealth.gateway_version ? ` · ${gatewayHealth.gateway_version}` : ' · VERSION MISSING (possibly stale deployment)'} · endpoint tested: {(settings.gateway_api_url?.trim() || (import.meta.env.VITE_DONATION_GATEWAY_API_URL as string | undefined)?.trim() || (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/+$/, '')}/health</small></div><div className="donation-admin-health-checks">{Object.entries(gatewayHealth.checks ?? {}).map(([key,value]) => <span key={key} className={value === null ? '' : value ? 'is-good' : 'is-bad'}>{value === null ? '○' : value ? '✓' : '✕'} {key.replace(/([A-Z])/g, ' $1')}{value === null ? ' (not checked)' : ''}</span>)}</div>{gatewayHealth.diagnostics?.missing?.length ? <div className="donation-admin-health-missing"><b>Fix these Worker settings</b><ul>{gatewayHealth.diagnostics.missing.map(item => <li key={item}>{item}</li>)}</ul></div> : null}{(gatewayHealth.diagnostics?.databaseError || gatewayHealth.diagnostics?.settingsError) && <p className="donation-admin-health-error">Database diagnostics: {gatewayHealth.diagnostics.databaseError || gatewayHealth.diagnostics.settingsError}</p>}<p className="donation-admin-health-note">{gatewayHealth.diagnostics?.note || 'A healthy endpoint is only a configuration check, not proof that a bank payment completed.'}</p></>}</section>
        {role !== 'super_admin' && <div className="donation-admin-approval-note"><ShieldCheck size={16}/><span><b>Approval rule:</b> your ordinary presentation settings apply immediately; major payment, amount-limit, fundraising-goal, suggested-amount and gateway changes will remain pending until a super administrator approves them.</span></div>}
        <button className="btn btn-primary" type="submit" disabled={busy === 'settings' || loading}>{busy === 'settings' ? <LoaderCircle size={15} className="spin"/> : <Save size={15}/>} Save donation settings</button>
      </form>
    </section>

    {role === 'super_admin' && <section className="panel donation-admin-requests"><div className="panel-heading"><div><div className="section-kicker">GOVERNANCE QUEUE</div><h3>Major change requests</h3><p>Review exactly what will change. Each decision requires a note; stale requests are blocked rather than overwriting newer settings.</p></div><ShieldCheck size={19}/></div>{!pendingRequests.length ? <div className="chat-empty"><CheckCircle2 size={23}/><b>No pending changes</b><span>Major donation changes submitted by administrators will appear here.</span></div> : pendingRequests.map(request => <article className="donation-admin-request" key={request.id}><div className="donation-admin-request-head"><b>Major donation settings request</b><small>{dateText(request.created_at)} · Request ID {request.id.slice(0,8)}</small></div><p className="donation-admin-request-meta">Requested by <code>{request.requested_by}</code>. Submitted values are compared with the current settings before apply.</p><div className="donation-admin-request-changes">{Object.entries(request.changes).map(([key,value]) => <div key={key}><span>{friendlyKey[key] || key.replace(/_/g,' ')}</span><small>Current: {requestValue(key, request.base_settings?.[key])}</small><b>Proposed: {requestValue(key,value)}</b></div>)}</div><label>Required review note (at least 5 characters)<input required value={notes[request.id] ?? ''} maxLength={500} minLength={5} onChange={e => setNotes(v => ({ ...v, [request.id]: e.target.value }))} placeholder="Why approve or reject this change?"/></label><div className="donation-admin-request-actions"><button type="button" className="btn btn-primary" disabled={busy === request.id || (notes[request.id] ?? '').trim().length < 5} onClick={() => void reviewRequest(request,true)}><CheckCircle2 size={15}/> Approve and apply</button><button type="button" className="btn btn-secondary" disabled={busy === request.id || (notes[request.id] ?? '').trim().length < 5} onClick={() => void reviewRequest(request,false)}><XCircle size={15}/> Reject with reason</button></div></article>)}</section>}
    {requests.some(item => item.status !== 'pending') && <section className="panel donation-admin-requests"><div className="panel-heading"><div><div className="section-kicker">CHANGE HISTORY</div><h3>Recent approval decisions</h3><p>Track whether your submitted major changes were approved or rejected.</p></div><ShieldCheck size={19}/></div>{requests.filter(item => item.status !== 'pending').slice(0,10).map(request => <article className="donation-admin-request" key={request.id}><div className="donation-admin-request-head"><b>{request.status === 'approved' ? 'Approved' : 'Rejected'} · {request.id.slice(0,8)}</b><small>Submitted {dateText(request.created_at)} · Reviewed {dateText(request.reviewed_at)}</small></div><div className="donation-admin-request-changes">{Object.entries(request.changes).map(([key,value]) => <div key={key}><span>{friendlyKey[key] || key.replace(/_/g,' ')}</span><b>{requestValue(key,value)}</b></div>)}</div><p className="donation-admin-request-meta">Review note: {request.review_note || 'No note recorded'}{request.reviewed_by ? ` · Reviewer ${request.reviewed_by}` : ''}</p></article>)}</section>}

    <section className="panel donation-admin-claims"><div className="panel-heading"><div><div className="section-kicker">MANUAL PAYMENT RECOVERY</div><h3>Payment proof claims</h3><p>Users upload screenshots when a debit is visible but the website cannot confirm it. Open private evidence, check the receiving bank statement and enter the matching UTR before approval. Do not approve from a screenshot alone.</p></div><FileCheck size={19}/></div>
      <div className="donation-record-filters"><label>Show claims<select value={claimFilter} onChange={e => setClaimFilter(e.target.value)}><option value="pending_review">Needs review</option><option value="all">All claims</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select></label><span>{claims.filter(item => claimFilter === 'all' || item.status === claimFilter).length} claims</span></div>
      {!claims.filter(item => claimFilter === 'all' || item.status === claimFilter).length ? <div className="chat-empty"><FileCheck size={24}/><b>No payment claims here</b><span>When a donor uploads private payment evidence, it will appear in this review queue.</span></div> : claims.filter(item => claimFilter === 'all' || item.status === claimFilter).map(claim => <article className="donation-claim-review" key={claim.id}><div className="donation-claim-review-head"><div><b>{rupees(claim.amount_paise)} · {claim.order_id}</b><small>{claim.donor_name} · Submitted {dateText(claim.created_at)} · Donation state: {claim.donation_status.replaceAll('_',' ')}</small></div><span className={`donation-claim-status claim-${claim.status}`}>{claim.status.replaceAll('_',' ')}</span></div><p className="donation-claim-review-note">{claim.user_note}</p>{claim.payment_reference && <p className="donation-claim-review-note"><b>User supplied UTR/ref (unverified):</b> <code>{claim.payment_reference}</code></p>}<div className="donation-claim-evidence">{(claim.evidence_paths || []).map(path => { const key = `${claim.id}:${path}`; return <div key={path}><span>{path.split('/').pop() || 'Payment evidence'}</span>{evidenceUrls[key] ? <a href={evidenceUrls[key]} target="_blank" rel="noopener noreferrer"><ExternalLink size={13}/> Open private evidence</a> : <button type="button" className="btn btn-secondary" disabled={busy === key} onClick={() => void prepareEvidenceLink(claim,path)}>{busy === key ? <LoaderCircle size={13} className="spin"/> : <Eye size={13}/>} Generate 2-minute secure link</button>}</div>})}</div>{claim.status === 'pending_review' ? <><div className="donation-claim-review-fields"><label>Verified bank UTR (required for approval)<input value={claimInputs[claim.id]?.utr ?? ''} onChange={e => setClaimInputs(current => ({ ...current, [claim.id]: { utr: e.target.value, note: current[claim.id]?.note ?? '' } }))} maxLength={80} placeholder="Check bank statement, then enter UTR"/></label><label>Admin review note / rejection reason<input value={claimInputs[claim.id]?.note ?? ''} onChange={e => setClaimInputs(current => ({ ...current, [claim.id]: { utr: current[claim.id]?.utr ?? '', note: e.target.value } }))} minLength={5} maxLength={500} placeholder="What did you verify? or why reject?"/></label></div><div className="donation-claim-review-actions"><button type="button" className="btn btn-primary" disabled={busy === claim.id || (claimInputs[claim.id]?.note ?? '').trim().length < 5 || !/^[A-Za-z0-9_-]{6,80}$/.test((claimInputs[claim.id]?.utr ?? '').trim())} onClick={() => void reviewPaymentClaim(claim,true)}>{busy === claim.id ? <LoaderCircle size={14} className="spin"/> : <CheckCircle2 size={14}/>} Confirm & approve</button><button type="button" className="btn btn-secondary" disabled={busy === claim.id || (claimInputs[claim.id]?.note ?? '').trim().length < 5} onClick={() => void reviewPaymentClaim(claim,false)}><XCircle size={14}/> Reject claim</button></div></> : <p className="donation-claim-review-note"><b>Review note:</b> {claim.admin_note || '—'} · Reviewed {dateText(claim.reviewed_at)}</p>}</article>)}</section>

    <section className="panel donation-admin-transactions"><div className="panel-heading"><div><div className="section-kicker">PAYMENT RECORDS</div><h3>Latest donations & manual verification</h3><p>Expired, failed, cancelled or pending records stay here for review. Only manually verify after confirming the credit in the receiving bank/account statement; a screenshot alone is not proof.</p></div><button type="button" className="btn btn-secondary" onClick={() => void load()} disabled={loading}><RefreshCw size={16}/> Refresh</button></div>
      <div className="donation-record-filters"><label>Show<select value={recordFilter} onChange={e => setRecordFilter(e.target.value)}><option value="review">Needs review</option><option value="all">All records</option><option value="pending">Pending</option><option value="failed">Failed</option><option value="expired">Expired</option><option value="cancelled">Cancelled</option><option value="suspicious">Suspicious</option><option value="succeeded">Verified</option></select></label><label>Search order / UTR / donor<input value={recordSearch} onChange={e => setRecordSearch(e.target.value)} placeholder="Paste order ID, UTR or donor name"/></label><span>{visibleDonations.length} shown / {donations.length} loaded</span></div>
      {loading ? <div className="ops-loading"><LoaderCircle size={19} className="spin"/> Loading donation records…</div> : !visibleDonations.length ? <div className="chat-empty"><Wallet size={24}/><b>No matching records</b><span>Change the filter or refresh to look for an expired or pending donation.</span></div> : <div className="donation-admin-table-wrap"><table className="donation-admin-table"><thead><tr><th>Amount / status</th><th>Donor details</th><th>Reference</th><th>Created / verified</th><th>Manual review</th><th>Public feed</th></tr></thead><tbody>{visibleDonations.map(donation => <tr key={donation.id}><td><b>{rupees(donation.amount_paise)}</b><span className={`donation-admin-status status-${donation.status}`}>{donation.status.replace('_',' ')}</span></td><td><b>{donation.is_anonymous ? 'Anonymous' : donation.donor_name || 'Name not supplied'}</b><small>{donation.is_anonymous ? 'Details hidden from public' : donation.donor_email || donation.donor_user_id || 'No contact details'}</small>{donation.message && <p>{donation.message}</p>}</td><td><code>{donation.order_id}</code>{donation.utr && <small>UTR: {donation.utr}</small>}{donation.gateway_payment_id && <small>Payment: {donation.gateway_payment_id.slice(0,14)}…</small>}</td><td><small>{dateText(donation.created_at)}</small><small>{donation.verified_at ? `Verified ${dateText(donation.verified_at)}` : 'Not verified'}</small></td><td>{donation.status === 'succeeded' ? <span className="donation-admin-muted">Confirmed</span> : <div className="donation-manual-review"><input aria-label={`UTR for ${donation.order_id}`} value={manualInputs[donation.id]?.utr ?? ''} onChange={e => setManualInputs(v => ({ ...v, [donation.id]: { utr: e.target.value, note: v[donation.id]?.note ?? '' } }))} placeholder="Real UTR / bank ref" maxLength={80}/><textarea aria-label={`Review note for ${donation.order_id}`} value={manualInputs[donation.id]?.note ?? ''} onChange={e => setManualInputs(v => ({ ...v, [donation.id]: { utr: v[donation.id]?.utr ?? '', note: e.target.value } }))} placeholder="What was checked in bank statement?" maxLength={500} rows={2}/><button type="button" className="btn btn-primary" disabled={busy === donation.id || loading} onClick={() => void manuallyVerifyDonation(donation)}>{busy === donation.id ? <LoaderCircle size={14} className="spin"/> : <CheckCircle2 size={14}/>} Verify receipt</button></div>}</td><td><div className="donation-admin-public-actions">{donation.status === 'succeeded' && <button type="button" className="btn btn-secondary donation-admin-visibility" disabled={busy === donation.id} onClick={() => void setDonationHidden(donation)} title="Hide/restore public feed visibility">{donation.admin_hidden ? <Eye size={14}/> : <EyeOff size={14}/>} {donation.admin_hidden ? 'Restore feed' : 'Hide feed'}</button>}<button type="button" className={`btn ${donation.admin_removed_at ? 'btn-primary' : 'btn-secondary'} donation-admin-visibility`} disabled={busy === `remove:${donation.id}` || loading} onClick={() => void setDonationRemoved(donation)} title="Remove/restore this donation from public totals and activity">{busy === `remove:${donation.id}` ? <LoaderCircle size={13} className="spin"/> : donation.admin_removed_at ? <RotateCcw size={13}/> : <Trash2 size={13}/>} {donation.admin_removed_at ? 'Restore totals' : 'Remove totals'}</button>{donation.admin_removed_at && <small className="donation-admin-removed-note">Removed · {donation.admin_removal_note || 'Reason recorded'}</small>}</div></td></tr>)}</tbody></table></div>}</section>
    <div className="donation-admin-footnote"><ShieldCheck size={15}/><span>Last refreshed {dateText(lastLoaded)}. Gateway API secrets and webhook signatures must remain server-side; public leaderboard data is aggregate/sanitised by a database function.</span></div>
  </div>
}
