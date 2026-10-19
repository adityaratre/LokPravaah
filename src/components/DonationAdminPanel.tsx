import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { AlertCircle, CheckCircle2, Eye, EyeOff, FileImage, HeartHandshake, LoaderCircle, RefreshCw, Save, ShieldCheck, Wallet, XCircle, Trash2, ExternalLink, Clock3 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import './DonationAdminPanel.css'

type Settings = {
  donations_enabled: boolean
  payment_gateway_enabled: boolean
  gateway_portal_url: string | null
  gateway_api_url: string | null
  gateway_merchant_key: string | null
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
  suggested_amounts: number[]
  thank_you_title: string
  thank_you_message: string
  payment_session_minutes: number
}
type DonationRow = {
  id: string; order_id: string; amount_paise: number; currency: string; donor_user_id: string | null
  donor_name: string | null; donor_email: string | null; is_anonymous: boolean; show_on_leaderboard: boolean; show_message_publicly: boolean
  admin_hidden: boolean; message: string | null; status: string; utr: string | null; gateway_payment_id: string | null
  created_at: string; verified_at: string | null
}
type ChangeRequest = { id: string; requested_by: string; changes: Record<string, unknown>; status: string; review_note: string | null; reviewed_by: string | null; reviewed_at: string | null; created_at: string }
type AdminData = { role: string; settings: Settings; donations: DonationRow[]; change_requests: ChangeRequest[] }
type PaymentDiagnostics = { gatewayVersion?: string; database?: boolean; databaseDiagnostics?: Record<string, unknown> | null; observer?: { pairedDevices?: number; recentlyOnline?: boolean; lastHeartbeatAt?: string | null }; webhookEndpointReachable?: boolean; webhookSignatureAccepted?: boolean; webhookResult?: { httpStatus?: number; signatureAccepted?: boolean; response?: Record<string, unknown> }; payments?: Record<string, number>; readyForAutomaticVerification?: boolean; errors?: string[] }
type PaymentReview = { id: string; order_id: string; evidence_path: string; note: string | null; status: 'pending_review' | 'confirmed' | 'rejected'; verified_utr: string | null; admin_note: string | null; submitted_by: string | null; reviewed_by: string | null; created_at: string; reviewed_at: string | null }
type ReceiverChangeRequest = { id: string; requested_by: string | null; receiving_vpa: string; payee_name: string; status: 'pending' | 'approved' | 'rejected'; review_note: string | null; reviewed_by: string | null; reviewed_at: string | null; created_at: string }
type ReceiverAdminPayload = { active?: { receivingVpa?: string; payeeName?: string }; requests?: ReceiverChangeRequest[] }

const DEFAULT_SETTINGS: Settings = {
  donations_enabled: true, payment_gateway_enabled: true, gateway_portal_url: null, gateway_api_url: null, gateway_merchant_key: null,
  leaderboard_enabled: true, show_public_total: true, show_goal_progress: true, show_recent_donations: true, show_donor_messages: true,
  campaign_title: 'Build a stronger civic community', campaign_description: 'Your contribution helps keep LokPravaah available, accessible and improving.',
  campaign_goal_paise: 5000000, min_amount_paise: 100, max_amount_paise: 10000000, suggested_amounts: [51, 101, 251, 501, 1001, 2100],
  thank_you_title: 'Thank you for backing civic action', thank_you_message: 'Your support helps us keep improving LokPravaah for the community.', payment_session_minutes: 15,
}
const rupees = (paise: number) => (Math.max(0, Number(paise) || 0) / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 })
const dateText = (value?: string | null) => { if (!value) return '—'; const d = new Date(value); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) }
const friendlyKey: Record<string, string> = {
  donations_enabled: 'Accept donations', payment_gateway_enabled: 'Enable online UPI checkout', gateway_portal_url: 'Checkout portal URL', gateway_api_url: 'Payment API URL', gateway_merchant_key: 'Public merchant key',
  min_amount_paise: 'Minimum donation', max_amount_paise: 'Maximum donation', campaign_goal_paise: 'Campaign goal', suggested_amounts: 'Suggested amounts',
}
function requestValue(key: string, value: unknown): string {
  if (key.endsWith('_paise') && typeof value === 'number') return rupees(value)
  if (key === 'suggested_amounts' && Array.isArray(value)) return value.map(String).map(v => `₹${v}`).join(', ')
  if (key === 'payment_session_minutes') return `${String(value)} minutes`
  if (typeof value === 'boolean') return value ? 'On' : 'Off'
  return String(value ?? '(empty)')
}

export default function DonationAdminPanel({ role, notify }: { role: string; notify: (message: string) => void }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [donations, setDonations] = useState<DonationRow[]>([])
  const [requests, setRequests] = useState<ChangeRequest[]>([])
  const [paymentReviews, setPaymentReviews] = useState<PaymentReview[]>([])
  const [receiverVpa, setReceiverVpa] = useState('')
  const [receiverPayeeName, setReceiverPayeeName] = useState('')
  const [receiverRequests, setReceiverRequests] = useState<ReceiverChangeRequest[]>([])
  const [reviewUtrs, setReviewUtrs] = useState<Record<string, string>>({})
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({})
  const [evidenceUrls, setEvidenceUrls] = useState<Record<string, string>>({})
  const [timerMinutes, setTimerMinutes] = useState('15')
  const [paymentDiagnostics, setPaymentDiagnostics] = useState<PaymentDiagnostics | null>(null)
  const [diagnosticsBusy, setDiagnosticsBusy] = useState(false)
  const [presetText, setPresetText] = useState(DEFAULT_SETTINGS.suggested_amounts.join(', '))
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [lastLoaded, setLastLoaded] = useState('')

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
    setTimerMinutes(String(nextSettings.payment_session_minutes || 15))
    const receiverAdminResult = await supabase.rpc('janwatch_admin_get_upi_receiver_settings')
    if (!receiverAdminResult.error && receiverAdminResult.data) {
      const receiverPayload = receiverAdminResult.data as ReceiverAdminPayload
      setReceiverVpa(String(receiverPayload.active?.receivingVpa || ''))
      setReceiverPayeeName(String(receiverPayload.active?.payeeName || ''))
      setReceiverRequests(Array.isArray(receiverPayload.requests) ? receiverPayload.requests : [])
    } else if (receiverAdminResult.error) {
      setReceiverRequests([])
    }
    // The currently effective receiver might still come from the Worker's environment fallback.
    // VPA and payee name are public payment details, so the public diagnostic endpoint can fill the form.
    try {
      const gatewayBase = (nextSettings.gateway_api_url?.trim() || nextSettings.gateway_portal_url?.trim() || (import.meta.env.VITE_DONATION_GATEWAY_API_URL as string | undefined)?.trim() || window.location.origin).replace(/\/+$/, '')
      const receiverResponse = await fetch(`${gatewayBase}/api/v1/merchant/receiver-settings`, { cache: 'no-store' })
      if (receiverResponse.ok) {
        const activeReceiver = await receiverResponse.json() as { receivingVpa?: string; payeeName?: string; configured?: boolean }
        if (activeReceiver.configured) { setReceiverVpa(String(activeReceiver.receivingVpa || '')); setReceiverPayeeName(String(activeReceiver.payeeName || '')) }
      }
    } catch { /* Worker values remain editable through the separate form if the endpoint is temporarily offline. */ }
    const reviewQuery = await supabase.from('donation_payment_reviews').select('id,order_id,evidence_path,note,status,verified_utr,admin_note,submitted_by,reviewed_by,created_at,reviewed_at').order('created_at', { ascending: false }).limit(100)
    if (reviewQuery.error) {
      setPaymentReviews([])
      setError(`Manual payment review is not available yet: ${reviewQuery.error.message}. Apply the payment reliability SQL migration and refresh.`)
    } else setPaymentReviews((reviewQuery.data || []) as PaymentReview[])
    setDonations(Array.isArray(result?.donations) ? result!.donations! : [])
    setRequests(Array.isArray(result?.change_requests) ? result!.change_requests! : [])
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
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 100 || max < min || max > 10000000 || !Number.isInteger(goal) || goal < 10000) {
      setError('Check the minimum, maximum and campaign goal values. Values are stored in paise internally.'); return
    }
    const portal = settings.gateway_portal_url?.trim() || null
    const api = settings.gateway_api_url?.trim() || null
    if ((portal && !/^https:\/\//i.test(portal)) || (api && !/^https:\/\//i.test(api))) { setError('Payment portal and API URLs must use HTTPS.'); return }
    if (!window.confirm(role === 'super_admin' ? 'Save donation configuration? Payment-related changes will apply immediately.' : 'Save donation configuration? Major payment-related changes will be sent to the super administrator for approval.')) return
    setBusy('settings'); setError('')
    const payload = { ...settings, gateway_portal_url: portal, gateway_api_url: api, gateway_merchant_key: settings.gateway_merchant_key?.trim() || null, min_amount_paise: min, max_amount_paise: max, campaign_goal_paise: goal, suggested_amounts: suggested }
    const { data, error: saveError } = await supabase.rpc('janwatch_admin_update_donation_settings', { p_settings: payload })
    setBusy('')
    if (saveError) { setError(`Donation settings could not be saved: ${saveError.message || 'check database permissions and values.'}`); return }
    const response = data as { status?: string; message?: string } | null
    notify(response?.message || (response?.status === 'pending_approval' ? 'Major changes submitted for super-admin approval.' : 'Donation settings saved.'))
    await load()
  }

  async function reviewRequest(request: ChangeRequest, approve: boolean) {
    if (!supabase || role !== 'super_admin') return
    const action = approve ? 'approve' : 'reject'
    if (!window.confirm(`${approve ? 'Approve and apply' : 'Reject'} this major donation settings change?`)) return
    setBusy(request.id); setError('')
    const { data, error: reviewError } = await supabase.rpc('janwatch_super_admin_review_donation_settings', { p_request_id: request.id, p_approve: approve, p_note: notes[request.id]?.trim() || null })
    setBusy('')
    if (reviewError) { setError(`Could not ${action} the request: ${reviewError.message || 'check permissions and refresh.'}`); return }
    notify((data as { message?: string } | null)?.message || `Donation settings request ${action}d.`)
    await load()
  }

  async function setDonationRemoved(donation: DonationRow) {
    if (!supabase) return
    const nextRemoved = !donation.admin_hidden
    const note = window.prompt(nextRemoved ? 'Reason for removing this donation from public totals/feed (private admin note):' : 'Reason for restoring this donation (optional):', '')
    if (note === null) return
    if (nextRemoved && !note.trim()) { setError('Please enter a brief reason before removing a donation.'); return }
    setBusy(donation.id); setError('')
    const { error: visibilityError } = await supabase.rpc('janwatch_admin_set_donation_removed', { p_donation_id: donation.id, p_removed: nextRemoved, p_note: note.trim() || null })
    setBusy('')
    if (visibilityError) { setError(`Donation removal state could not be changed: ${visibilityError.message || 'apply the payment reliability migration, then retry.'}`); return }
    notify(nextRemoved ? 'Donation removed from public totals/activity; the private admin record is retained.' : 'Donation restored; only verified donations with public-consent settings appear publicly.')
    await load()
  }

  async function runPaymentDiagnostics() {
    if (!supabase) return
    const apiBase = (settings.gateway_api_url?.trim() || settings.gateway_portal_url?.trim() || (import.meta.env.VITE_DONATION_GATEWAY_API_URL as string | undefined)?.trim() || 'https://lokpravaah.online').replace(/\/+$/, '')
    setDiagnosticsBusy(true); setError('')
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
      if (sessionError) throw sessionError
      const token = sessionData.session?.access_token
      if (!token) throw new Error('Your admin session is not available. Sign in again and retry.')
      const response = await fetch(`${apiBase}/api/v1/admin/payment-diagnostics`, { headers: { Authorization: `Bearer ${token}` } })
      const result = await response.json().catch(() => ({})) as PaymentDiagnostics & { error?: string }
      setPaymentDiagnostics(result)
      if (!response.ok) throw new Error(result.error || `Gateway diagnostics returned HTTP ${response.status}. Confirm the active Worker URL and your super-admin role.`)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Payment diagnostics failed. Verify the gateway URL and try again.')
    } finally { setDiagnosticsBusy(false) }
  }

  async function saveReceiverSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    const vpa = receiverVpa.trim().toLowerCase()
    const payeeName = receiverPayeeName.trim()
    if (!/^[^\s@]+@[^\s@]+$/.test(vpa)) { setError('Enter a valid receiving UPI ID (VPA), for example yourname@bank.'); return }
    if (!payeeName || payeeName.length > 99) { setError('Enter the exact receiving-account payee name (1–99 characters).'); return }
    if (!window.confirm(role === 'super_admin' ? 'Activate these receiving UPI details for new sessions? Verify this exact UPI ID/payee in a UPI app before collecting money.' : 'Submit these receiving UPI details for super-admin approval? The current receiving details will remain active until approved.')) return
    setBusy('receiver'); setError('')
    const { data, error: receiverError } = await supabase.rpc('janwatch_admin_set_upi_receiver_settings', { p_receiving_vpa: vpa, p_payee_name: payeeName })
    setBusy('')
    if (receiverError) { setError(`Receiving-account settings could not be saved: ${receiverError.message}`); return }
    notify((data as { message?: string } | null)?.message || 'Receiving-account settings submitted.')
    await load()
  }

  async function reviewReceiverRequest(request: ReceiverChangeRequest, approve: boolean) {
    if (!supabase || role !== 'super_admin') return
    if (!window.confirm(`${approve ? 'Approve and activate' : 'Reject'} the proposed receiving UPI ID and payee name?`)) return
    setBusy(`receiver-request:${request.id}`); setError('')
    const { data, error: requestError } = await supabase.rpc('janwatch_super_admin_review_upi_receiver_request', { p_request_id: request.id, p_approve: approve, p_note: notes[request.id]?.trim() || null })
    setBusy('')
    if (requestError) { setError(`Could not ${approve ? 'approve' : 'reject'} receiving-account change: ${requestError.message}`); return }
    notify((data as { message?: string } | null)?.message || `Receiving-account change ${approve ? 'approved' : 'rejected'}.`)
    await load()
  }

  async function saveTimer() {
    if (!supabase) return
    const minutes = Number(timerMinutes)
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 30) { setError('Payment session duration must be between 5 and 30 minutes.'); return }
    if (!window.confirm(role === 'super_admin' ? `Set new UPI checkout sessions to expire after ${minutes} minutes? Existing sessions keep their current expiry.` : `Request super-admin approval to set the UPI checkout timer to ${minutes} minutes?`)) return
    setBusy('timer'); setError('')
    const { data, error: timerError } = await supabase.rpc('janwatch_admin_set_payment_session_minutes', { p_minutes: minutes })
    setBusy('')
    if (timerError) { setError(`Payment timer could not be saved: ${timerError.message}`); return }
    notify((data as { message?: string } | null)?.message || 'Payment timer setting saved.')
    await load()
  }

  async function openEvidence(review: PaymentReview) {
    if (!supabase) return
    setBusy(`evidence:${review.id}`); setError('')
    const { data, error: signedError } = await supabase.storage.from('donation-payment-evidence').createSignedUrl(review.evidence_path, 300)
    setBusy('')
    if (signedError || !data?.signedUrl) { setError(`Could not open private screenshot: ${signedError?.message || 'signed URL unavailable'}`); return }
    setEvidenceUrls(v => ({ ...v, [review.id]: data.signedUrl }))
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  async function reviewPayment(review: PaymentReview, decision: 'confirm' | 'reject') {
    if (!supabase) return
    const utr = reviewUtrs[review.id]?.trim() || ''
    if (decision === 'confirm' && utr.length < 6) { setError('Before confirming, enter the UTR/reference you verified against the actual receiving bank statement. A screenshot alone is not proof of receipt.'); return }
    const prompt = decision === 'confirm' ? 'Confirm this donation after reconciling the amount and UTR with the receiving bank statement?' : 'Reject this manual payment claim? The donation will remain unverified.'
    if (!window.confirm(prompt)) return
    setBusy(`review:${review.id}`); setError('')
    const { data, error: reviewError } = await supabase.rpc('janwatch_admin_review_donation_payment', { p_review_id: review.id, p_decision: decision, p_utr: decision === 'confirm' ? utr : null, p_note: reviewNotes[review.id]?.trim() || null })
    setBusy('')
    if (reviewError) { setError(`Could not ${decision} the payment claim: ${reviewError.message}`); return }
    notify((data as { message?: string } | null)?.message || `Payment claim ${decision}ed.`)
    await load()
  }

  const pendingRequests = requests.filter(item => item.status === 'pending')
  const pendingReceiverRequests = receiverRequests.filter(item => item.status === 'pending')
  const paid = donations.filter(item => item.status === 'succeeded')
  const pending = donations.filter(item => item.status === 'pending').length
  const paidTotal = paid.reduce((sum, item) => sum + Number(item.amount_paise || 0), 0)

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
          <label>Suggested amounts (₹)<input value={presetText} onChange={e => setPresetText(e.target.value)} maxLength={100} placeholder="51, 101, 251, 501, 1001, 2100" required/><small>Use 1–8 whole-rupee amounts separated by commas. Major change.</small></label>
          <label>Thank-you title<input maxLength={120} value={settings.thank_you_title} onChange={e => setSettings(v => ({ ...v, thank_you_title: e.target.value }))} required/></label>
          <label>Thank-you message<textarea rows={3} maxLength={600} value={settings.thank_you_message} onChange={e => setSettings(v => ({ ...v, thank_you_message: e.target.value }))} required/></label>
        </div>
        <div className="donation-admin-gateway"><div><HeartHandshake size={18}/><div><b>UPI gateway connection</b><small>These are public checkout configuration values, not secrets. Use HTTPS URLs. Keep webhook signing secrets inside the gateway/Supabase server settings.</small></div></div>
          <label>Checkout portal URL<input type="url" value={settings.gateway_portal_url ?? ''} onChange={e => setSettings(v => ({ ...v, gateway_portal_url: e.target.value }))} placeholder="https://pay.example.com"/></label>
          <label>Payment API URL<input type="url" value={settings.gateway_api_url ?? ''} onChange={e => setSettings(v => ({ ...v, gateway_api_url: e.target.value }))} placeholder="https://pay.example.com"/></label>
          <label>Public merchant ID/key<input autoComplete="off" maxLength={200} value={settings.gateway_merchant_key ?? ''} onChange={e => setSettings(v => ({ ...v, gateway_merchant_key: e.target.value }))} placeholder="Gateway merchant UUID"/></label>
          <p className="donation-admin-gateway-note">Gateway endpoint or merchant-ID changes are queued for super-admin approval when an admin submits them. Hosting environment variables remain a fallback if the database values are blank.</p>
        </div>
        {role !== 'super_admin' && <div className="donation-admin-approval-note"><ShieldCheck size={16}/><span><b>Approval rule:</b> your ordinary presentation settings apply immediately; major payment, amount-limit, fundraising-goal, suggested-amount and gateway changes will remain pending until a super administrator approves them.</span></div>}
        <button className="btn btn-primary" type="submit" disabled={busy === 'settings' || loading}>{busy === 'settings' ? <LoaderCircle size={15} className="spin"/> : <Save size={15}/>} Save donation settings</button>
      </form>
    </section>

    {role === 'super_admin' && <section className="panel donation-admin-diagnostics"><div className="panel-heading"><div><div className="section-kicker">LIVE PAYMENT DIAGNOSTICS</div><h3>Why a payment may be failing</h3><p>Checks the deployed Worker version, database migration, Android observer heartbeat and whether the configured webhook secret is accepted. This does not move money or confirm a donation.</p></div><ShieldCheck size={19}/></div><button type="button" className="btn btn-secondary" onClick={() => void runPaymentDiagnostics()} disabled={diagnosticsBusy}>{diagnosticsBusy ? <LoaderCircle size={15} className="spin"/> : <RefreshCw size={15}/>} Run live diagnostics</button>{paymentDiagnostics && <div className="donation-diag-results"><div className="donation-diag-grid"><article><small>Deployed Worker</small><b>{paymentDiagnostics.gatewayVersion || 'Unknown'}</b></article><article><small>Database</small><b>{paymentDiagnostics.database ? 'Reachable' : 'Failed'}</b></article><article><small>Observer device</small><b>{paymentDiagnostics.observer?.recentlyOnline ? 'Recently online' : 'Not recently online'}</b><small>{paymentDiagnostics.observer?.pairedDevices ?? 0} paired device(s) · last heartbeat {dateText(paymentDiagnostics.observer?.lastHeartbeatAt)}</small></article><article><small>Webhook signature</small><b>{paymentDiagnostics.webhookSignatureAccepted ? 'Accepted' : paymentDiagnostics.webhookEndpointReachable ? 'Rejected / not verified' : 'Unreachable'}</b><small>HTTP {paymentDiagnostics.webhookResult?.httpStatus ?? '—'}</small></article><article><small>Automatic verification</small><b>{paymentDiagnostics.readyForAutomaticVerification ? 'Ready for controlled test' : 'Not ready'}</b></article><article><small>Active / processing / queued</small><b>{paymentDiagnostics.payments?.active ?? 0} / {paymentDiagnostics.payments?.processing ?? 0} / {paymentDiagnostics.payments?.queued ?? 0}</b><small>Stuck processing: {paymentDiagnostics.payments?.stuckProcessing ?? 0}</small></article></div>{paymentDiagnostics.databaseDiagnostics && <pre>{JSON.stringify(paymentDiagnostics.databaseDiagnostics,null,2)}</pre>}{Boolean(paymentDiagnostics.errors?.length) && <ul>{paymentDiagnostics.errors?.map((item,index)=><li key={`${item}-${index}`}>{item}</li>)}</ul>}<p className="donation-admin-gateway-note">Automatic matching stays unsafe when multiple concurrent donations have the same amount/time window; ambiguous credits must be reconciled manually against the receiver bank statement.</p></div>}</section>}

    <section className="panel donation-admin-timer"><div className="panel-heading"><div><div className="section-kicker">PAYMENT SESSION</div><h3>UPI checkout timer</h3><p>New checkout sessions use this duration. Existing active sessions keep their original expiry. Regular admins submit a request for super-admin approval.</p></div><Clock3 size={19}/></div><div className="donation-admin-timer-row"><label>Session duration<select value={timerMinutes} onChange={e => setTimerMinutes(e.target.value)}><option value="5">5 minutes</option><option value="10">10 minutes</option><option value="15">15 minutes</option><option value="20">20 minutes</option><option value="25">25 minutes</option><option value="30">30 minutes</option></select></label><button type="button" className="btn btn-primary" disabled={busy === 'timer' || loading} onClick={() => void saveTimer()}>{busy === 'timer' ? <LoaderCircle size={15} className="spin"/> : <Save size={15}/>} {role === 'super_admin' ? 'Save timer' : 'Request timer change'}</button></div></section>

    <section className="panel donation-admin-settings donation-admin-receiver-settings">
      <div className="panel-heading"><div><div className="section-kicker">RECEIVING ACCOUNT</div><h3>UPI ID and payee name</h3><p>The approved values are used to generate UPI QR/intent details for new checkouts. Verify the name displayed by a UPI app before enabling real payments. Non-super-admin changes require approval.</p></div><Wallet size={19}/></div>
      <form className="donation-admin-config-grid" onSubmit={saveReceiverSettings}>
        <label>Receiving UPI ID (VPA)<input autoComplete="off" maxLength={120} value={receiverVpa} onChange={e => setReceiverVpa(e.target.value)} placeholder="yourname@bank" required/><small>This is the actual account that receives contributions, not the public merchant ID.</small></label>
        <label>Exact bank/UPI payee name<input autoComplete="off" maxLength={99} value={receiverPayeeName} onChange={e => setReceiverPayeeName(e.target.value)} placeholder="Name displayed in the UPI app" required/><small>Must match the name shown by the receiving account's UPI app.</small></label>
        <div className="donation-admin-form-actions"><button type="submit" className="btn btn-primary" disabled={busy === 'receiver' || loading}>{busy === 'receiver' ? <LoaderCircle size={15} className="spin"/> : <Save size={15}/>} {role === 'super_admin' ? 'Save receiving account' : 'Request approval'}</button></div>
      </form>
      {pendingReceiverRequests.length > 0 && <div className="donation-admin-receiver-requests"><h4>Receiving-account approval queue {role === 'super_admin' ? '' : '(awaiting super-admin)'}</h4>{pendingReceiverRequests.map(request => <article className="donation-admin-request" key={request.id}><div className="donation-admin-request-head"><b>{request.receiving_vpa} · {request.payee_name}</b><small>Submitted {dateText(request.created_at)} · {request.id.slice(0,8)}</small></div>{role === 'super_admin' && <><label>Review note (optional)<input value={notes[request.id] ?? ''} maxLength={500} onChange={e => setNotes(v => ({ ...v, [request.id]: e.target.value }))} placeholder="Reason for approval/rejection"/></label><div className="donation-admin-request-actions"><button type="button" className="btn btn-primary" disabled={busy === `receiver-request:${request.id}`} onClick={() => void reviewReceiverRequest(request,true)}><CheckCircle2 size={15}/> Approve & activate</button><button type="button" className="btn btn-secondary" disabled={busy === `receiver-request:${request.id}`} onClick={() => void reviewReceiverRequest(request,false)}><XCircle size={15}/> Reject</button></div></>}</article>)}</div>}
      {receiverRequests.filter(r => r.status !== 'pending').slice(0,5).map(request => <p className="donation-admin-footnote" key={request.id}><span>Previous receiving-account request: {request.receiving_vpa} · {request.payee_name} · {request.status}{request.review_note ? ` — ${request.review_note}` : ''}</span></p>)}
    </section>

    {role === 'super_admin' && <section className="panel donation-admin-requests"><div className="panel-heading"><div><div className="section-kicker">GOVERNANCE QUEUE</div><h3>Major change requests</h3><p>Approval applies the queued payment settings. Every request has a permanent status and reviewer record.</p></div><ShieldCheck size={19}/></div>{!pendingRequests.length ? <div className="chat-empty"><CheckCircle2 size={23}/><b>No pending changes</b><span>Major donation changes submitted by administrators will appear here.</span></div> : pendingRequests.map(request => <article className="donation-admin-request" key={request.id}><div className="donation-admin-request-head"><b>Major donation settings request</b><small>{dateText(request.created_at)} · Request ID {request.id.slice(0,8)}</small></div><div className="donation-admin-request-changes">{Object.entries(request.changes).map(([key,value]) => <div key={key}><span>{friendlyKey[key] || key.replace(/_/g,' ')}</span><b>{requestValue(key,value)}</b></div>)}</div><label>Review note (optional)<input value={notes[request.id] ?? ''} maxLength={500} onChange={e => setNotes(v => ({ ...v, [request.id]: e.target.value }))} placeholder="Reason for approval/rejection"/></label><div className="donation-admin-request-actions"><button type="button" className="btn btn-primary" disabled={busy === request.id} onClick={() => void reviewRequest(request,true)}><CheckCircle2 size={15}/> Approve changes</button><button type="button" className="btn btn-secondary" disabled={busy === request.id} onClick={() => void reviewRequest(request,false)}><XCircle size={15}/> Reject</button></div></article>)}</section>}

    <section className="panel donation-admin-review-queue"><div className="panel-heading"><div><div className="section-kicker">MANUAL VERIFICATION</div><h3>Payment evidence review</h3><p>Only confirm when the amount and UTR match the actual receiving-account statement. The screenshot is evidence for review, not standalone proof.</p></div><FileImage size={19}/></div>{loading ? <div className="ops-loading"><LoaderCircle size={19} className="spin"/> Loading payment evidence…</div> : !paymentReviews.length ? <div className="chat-empty"><FileImage size={24}/><b>No screenshot claims awaiting review</b><span>When a donor uploads evidence after an unconfirmed payment, the request appears here.</span></div> : <div className="donation-review-list">{paymentReviews.map(review => { const donation = donations.find(item => item.order_id === review.order_id); return <article className="donation-review-item" key={review.id}><div className="donation-review-top"><div><b>{review.order_id}</b><small>{rupees(donation?.amount_paise || 0)} · submitted {dateText(review.created_at)}</small></div><span className={`donation-admin-status status-${review.status}`}>{review.status.replace('_',' ')}</span></div>{review.note && <p className="donation-review-note">{review.note}</p>}<div className="donation-review-actions"><button type="button" className="btn btn-secondary" disabled={busy === `evidence:${review.id}`} onClick={() => void openEvidence(review)}>{busy === `evidence:${review.id}` ? <LoaderCircle size={14} className="spin"/> : <ExternalLink size={14}/>} View private screenshot</button>{evidenceUrls[review.id] && <a href={evidenceUrls[review.id]} target="_blank" rel="noopener noreferrer">Open screenshot again</a>}</div>{review.status === 'pending_review' ? <><label className="donation-review-label">Bank UTR / transaction reference (required to confirm)<input value={reviewUtrs[review.id] ?? ''} onChange={e => setReviewUtrs(v => ({ ...v, [review.id]: e.target.value }))} minLength={6} maxLength={100} placeholder="Enter the UTR you checked in the bank statement"/></label><label className="donation-review-label">Admin decision note<input value={reviewNotes[review.id] ?? ''} onChange={e => setReviewNotes(v => ({ ...v, [review.id]: e.target.value }))} maxLength={1000} placeholder="Optional internal review note"/></label><div className="donation-review-actions"><button type="button" className="btn btn-primary" disabled={busy === `review:${review.id}`} onClick={() => void reviewPayment(review,'confirm')}><CheckCircle2 size={14}/> Confirm received</button><button type="button" className="btn btn-secondary" disabled={busy === `review:${review.id}`} onClick={() => void reviewPayment(review,'reject')}><XCircle size={14}/> Reject claim</button></div></> : <p className="donation-review-decision">{review.status === 'confirmed' ? `Confirmed with UTR ${review.verified_utr || 'recorded'}` : `Rejected${review.admin_note ? `: ${review.admin_note}` : ''}`} · {dateText(review.reviewed_at)}</p>}</article> })}</div>}</section>

    <section className="panel donation-admin-transactions"><div className="panel-heading"><div><div className="section-kicker">PAYMENT RECORDS</div><h3>Latest donations</h3><p>Payment references and donor contact details are visible only in this administrator console. Never treat pending records as received funds.</p></div><RefreshCw size={18}/></div>{loading ? <div className="ops-loading"><LoaderCircle size={19} className="spin"/> Loading donation records…</div> : !donations.length ? <div className="chat-empty"><Wallet size={24}/><b>No donation records yet</b><span>Donation attempts will appear here as the public donation page is used.</span></div> : <div className="donation-admin-table-wrap"><table className="donation-admin-table"><thead><tr><th>Amount / status</th><th>Donor details</th><th>Reference</th><th>Created / verified</th><th>Public feed</th></tr></thead><tbody>{donations.map(donation => <tr key={donation.id}><td><b>{rupees(donation.amount_paise)}</b><span className={`donation-admin-status status-${donation.status}`}>{donation.status.replace('_',' ')}</span></td><td><b>{donation.is_anonymous ? 'Anonymous' : donation.donor_name || 'Name not supplied'}</b><small>{donation.is_anonymous ? 'Details hidden from public' : donation.donor_email || donation.donor_user_id || 'No contact details'}</small>{donation.message && <p>{donation.message}</p>}</td><td><code>{donation.order_id}</code>{donation.utr && <small>UTR: {donation.utr}</small>}{donation.gateway_payment_id && <small>Payment: {donation.gateway_payment_id.slice(0,14)}…</small>}</td><td><small>{dateText(donation.created_at)}</small><small>{donation.verified_at ? `Verified ${dateText(donation.verified_at)}` : 'Not verified'}</small></td><td><button type="button" className="btn btn-secondary donation-admin-visibility" disabled={busy === donation.id} onClick={() => void setDonationRemoved(donation)} title={donation.admin_hidden ? 'Restore from public totals/activity' : 'Remove from public totals/activity; keep private audit record'}>{donation.admin_hidden ? <Eye size={14}/> : <Trash2 size={14}/>} {donation.admin_hidden ? 'Restore' : 'Remove'}</button></td></tr>)}</tbody></table></div>}</section>
    <div className="donation-admin-footnote"><ShieldCheck size={15}/><span>Last refreshed {dateText(lastLoaded)}. Gateway API secrets and webhook signatures must remain server-side; public leaderboard data is aggregate/sanitised by a database function.</span></div>
  </div>
}
