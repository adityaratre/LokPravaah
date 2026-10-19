import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { AlertCircle, CheckCircle2, Eye, EyeOff, HeartHandshake, LoaderCircle, RefreshCw, Save, ShieldCheck, Wallet, XCircle } from 'lucide-react'
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
  receiving_upi_vpa: string | null
  receiving_payee_name: string | null
}
type DonationRow = {
  id: string; order_id: string; amount_paise: number; currency: string; donor_user_id: string | null
  donor_name: string | null; donor_email: string | null; is_anonymous: boolean; show_on_leaderboard: boolean; show_message_publicly: boolean
  admin_hidden: boolean; admin_removed: boolean; message: string | null; status: string; utr: string | null; gateway_payment_id: string | null
  created_at: string; verified_at: string | null
}
type ChangeRequest = { id: string; requested_by: string; changes: Record<string, unknown>; status: string; review_note: string | null; reviewed_by: string | null; reviewed_at: string | null; created_at: string }
type ManualReview = { id: string; donation_intent_id: string; order_id: string; donation_amount_paise: number; donation_status: string; donor_name: string | null; donor_email: string | null; user_id: string; claimed_utr: string | null; claimed_amount_paise: number | null; payment_timestamp: string | null; user_note: string | null; screenshot_path: string; status: string; admin_review_note: string | null; created_at: string }
type AdminData = { role: string; settings: Settings; donations: DonationRow[]; change_requests: ChangeRequest[]; manual_reviews: ManualReview[] }

const DEFAULT_SETTINGS: Settings = {
  donations_enabled: true, payment_gateway_enabled: true, gateway_portal_url: null, gateway_api_url: null, gateway_merchant_key: null,
  leaderboard_enabled: true, show_public_total: true, show_goal_progress: true, show_recent_donations: true, show_donor_messages: true,
  campaign_title: 'Build a stronger civic community', campaign_description: 'Your contribution helps keep LokPravaah available, accessible and improving.',
  campaign_goal_paise: 5000000, min_amount_paise: 100, max_amount_paise: 10000000, suggested_amounts: [51, 101, 251, 501, 1001, 2100],
  thank_you_title: 'Thank you for backing civic action', thank_you_message: 'Your support helps us keep improving LokPravaah for the community.', payment_session_minutes: 15, receiving_upi_vpa: null, receiving_payee_name: null,
}
const rupees = (paise: number) => (Math.max(0, Number(paise) || 0) / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 })
const dateText = (value?: string | null) => { if (!value) return '—'; const d = new Date(value); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) }
const friendlyKey: Record<string, string> = {
  donations_enabled: 'Accept donations', payment_gateway_enabled: 'Enable online UPI checkout', gateway_portal_url: 'Checkout portal URL', gateway_api_url: 'Payment API URL', gateway_merchant_key: 'Public merchant key',
  min_amount_paise: 'Minimum donation', max_amount_paise: 'Maximum donation', campaign_goal_paise: 'Campaign goal', suggested_amounts: 'Suggested amounts', payment_session_minutes: 'Payment session timer (minutes)', receiving_upi_vpa: 'Receiving UPI ID/VPA', receiving_payee_name: 'UPI payee name',
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
  const [requests, setRequests] = useState<ChangeRequest[]>([])
  const [manualReviews, setManualReviews] = useState<ManualReview[]>([])
  const [claimUtrs, setClaimUtrs] = useState<Record<string, string>>({})
  const [claimNotes, setClaimNotes] = useState<Record<string, string>>({})
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
    setDonations(Array.isArray(result?.donations) ? result!.donations! : [])
    setRequests(Array.isArray(result?.change_requests) ? result!.change_requests! : [])
    setManualReviews(Array.isArray(result?.manual_reviews) ? result!.manual_reviews! : [])
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
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 100 || max < min || max > 10000000 || !Number.isInteger(goal) || goal < 10000 || !Number.isInteger(sessionMinutes) || sessionMinutes < 5 || sessionMinutes > 30) {
      setError('Check the minimum, maximum and campaign goal values. Values are stored in paise internally.'); return
    }
    const portal = settings.gateway_portal_url?.trim() || null
    const api = settings.gateway_api_url?.trim() || null
    if ((portal && !/^https:\/\//i.test(portal)) || (api && !/^https:\/\//i.test(api))) { setError('Payment portal and API URLs must use HTTPS.'); return }
    if (!window.confirm(role === 'super_admin' ? 'Save donation configuration? Payment-related changes will apply immediately.' : 'Save donation configuration? Major payment-related changes will be sent to the super administrator for approval.')) return
    setBusy('settings'); setError('')
    const payload = { ...settings, payment_session_minutes: sessionMinutes, gateway_portal_url: portal, gateway_api_url: api, gateway_merchant_key: settings.gateway_merchant_key?.trim() || null, min_amount_paise: min, max_amount_paise: max, campaign_goal_paise: goal, suggested_amounts: suggested }
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


  async function openManualEvidence(claim: ManualReview) {
    if (!supabase) return
    setBusy(`evidence-${claim.id}`); setError('')
    const { data, error: evidenceError } = await supabase.storage.from('donation-payment-evidence').createSignedUrl(claim.screenshot_path, 300)
    setBusy('')
    if (evidenceError || !data?.signedUrl) { setError(`Evidence could not be opened: ${evidenceError?.message || 'secure URL unavailable'}`); return }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  async function reviewManualClaim(claim: ManualReview, action: 'confirm' | 'reject') {
    if (!supabase || !['admin','super_admin'].includes(role)) return
    const verifiedUtr = claimUtrs[claim.id]?.trim() || ''
    if (action === 'confirm') {
      if (!verifiedUtr) { setError('Actual bank UTR/reference required. Check the receiving bank statement before confirming.'); return }
      if (!window.confirm('Confirm only if this exact amount and UTR are visible as CREDITED in the receiving bank account. A screenshot alone is not proof. Continue?')) return
    } else if (!window.confirm('Reject this user’s payment claim? The donation will remain unverified.')) return
    setBusy(`claim-${claim.id}`); setError('')
    const { data, error: reviewError } = await supabase.rpc('janwatch_admin_review_manual_donation', {
      p_claim_id: claim.id, p_action: action, p_note: claimNotes[claim.id]?.trim() || null,
      p_verified_utr: action === 'confirm' ? verifiedUtr : null,
    })
    setBusy('')
    if (reviewError) { setError(`Could not ${action} payment claim: ${reviewError.message || 'refresh and try again.'}`); return }
    notify((data as { message?: string } | null)?.message || `Payment claim ${action === 'confirm' ? 'confirmed' : 'rejected'}.`)
    await load()
  }

  async function setDonationRemoved(donation: DonationRow) {
    if (!supabase) return
    const nextRemoved = !donation.admin_removed
    if (!window.confirm(`${nextRemoved ? 'Remove this donation from public totals, leaderboard and recent activity?' : 'Restore this donation to public totals if donor visibility settings allow it?'} The financial record will be retained for audit.`)) return
    setBusy(`remove-${donation.id}`); setError('')
    const { error: removeError } = await supabase.rpc('janwatch_admin_set_donation_removed', { p_donation_id: donation.id, p_removed: nextRemoved })
    setBusy('')
    if (removeError) { setError(`Donation visibility in totals could not be changed: ${removeError.message || 'please try again.'}`); return }
    notify(nextRemoved ? 'Donation removed from public totals; audit record retained.' : 'Donation restored to public totals, subject to donor display settings.')
    await load()
  }

  const pendingRequests = requests.filter(item => item.status === 'pending')
  const pendingClaims = manualReviews.filter(item => item.status === 'pending_review')
  const paid = donations.filter(item => item.status === 'succeeded')
  const pending = donations.filter(item => item.status === 'pending').length
  const paidTotal = paid.reduce((sum, item) => sum + Number(item.amount_paise || 0), 0)

  return <div className="donation-admin">
    <div className="donation-admin-intro"><div><div className="section-kicker">DONATION OPERATIONS</div><h2>Donations & UPI settings</h2><p>Configure the public fundraiser, review verified payments and govern high-impact changes. Gateway passwords and webhook signing secrets never belong in browser settings.</p></div><button type="button" className="btn btn-secondary" onClick={() => void load()} disabled={loading}><RefreshCw size={14} className={loading ? 'spin' : ''}/> Refresh</button></div>
    {error && <div className="donation-admin-error"><AlertCircle size={17}/><span>{error}</span><button type="button" className="icon-btn" onClick={() => setError('')} aria-label="Dismiss error"><XCircle size={15}/></button></div>}
    <div className="donation-admin-stats"><article><span>Verified donations loaded</span><b>{paid.length}</b><small>Current recent records</small></article><article><span>Verified amount in records</span><b>{rupees(paidTotal)}</b><small>Latest {paid.length} successful records</small></article><article><span>Pending checkout records</span><b>{pending}</b><small>Awaiting payment result</small></article><article><span>Payment claims awaiting review</span><b>{pendingClaims.length}</b><small>Screenshot claims require bank-statement verification</small></article></div>

    <section className="panel donation-admin-settings">
      <div className="panel-heading"><div><div className="section-kicker">FUNDRAISER SETTINGS</div><h3>Public page and gateway</h3><p>Normal admins can save presentation changes. Payment enablement, receiving UPI ID/name, session timer, limits, targets and gateway endpoints are major changes and require super-admin approval.</p></div><Wallet size={19}/></div>
      <form className="donation-admin-form" onSubmit={saveSettings}>
        <div className="donation-admin-toggles">
          {([['donations_enabled','Accept new donations'],['payment_gateway_enabled','Enable UPI checkout'],['leaderboard_enabled','Show top supporters leaderboard'],['show_public_total','Show total funds raised'],['show_goal_progress','Show goal progress bar'],['show_recent_donations','Show recent contributions'],['show_donor_messages','Show opted-in donor messages']] as const).map(([key,label]) => <label className="ops-config-toggle" key={key}><input type="checkbox" checked={Boolean(settings[key])} onChange={e => setSettings(v => ({ ...v, [key]: e.target.checked }))}/><span><b>{label}</b><small>{key === 'donations_enabled' ? 'Turning this on/off is a major change.' : key === 'payment_gateway_enabled' ? 'Online payment enablement needs super-admin approval.' : 'Controls what is shown on the public donation page.'}</small></span></label>)}
        </div>
        <div className="donation-admin-config-grid">
          <label>Campaign title<input maxLength={120} value={settings.campaign_title} onChange={e => setSettings(v => ({ ...v, campaign_title: e.target.value }))} required/></label>
          <label>Campaign description<textarea rows={3} maxLength={600} value={settings.campaign_description} onChange={e => setSettings(v => ({ ...v, campaign_description: e.target.value }))} required/></label>
          <label>Minimum amount (₹)<input type="number" min="1" max="100000" step="0.01" value={settings.min_amount_paise / 100} onChange={e => setSettings(v => ({ ...v, min_amount_paise: Math.round(Number(e.target.value) * 100) }))} required/><small>Major change — requires super-admin approval if saved by an admin.</small></label>
          <label>Maximum amount (₹)<input type="number" min="1" max="100000" step="0.01" value={settings.max_amount_paise / 100} onChange={e => setSettings(v => ({ ...v, max_amount_paise: Math.round(Number(e.target.value) * 100) }))} required/><small>Major change — requires super-admin approval if saved by an admin.</small></label>
          <label>Payment session timer (minutes)<input type="number" min="5" max="30" step="1" value={settings.payment_session_minutes} onChange={e => setSettings(v => ({ ...v, payment_session_minutes: Number(e.target.value) }))} required/><small>Session countdown for new checkouts: 5–30 minutes. Normal admin changes wait for super-admin approval.</small></label>
          <label>Campaign goal (₹)<input type="number" min="100" max="1000000000" step="100" value={settings.campaign_goal_paise / 100} onChange={e => setSettings(v => ({ ...v, campaign_goal_paise: Math.round(Number(e.target.value) * 100) }))} required/><small>Progress is calculated from gateway-verified contributions only.</small></label>
          <label>Suggested amounts (₹)<input value={presetText} onChange={e => setPresetText(e.target.value)} maxLength={100} placeholder="51, 101, 251, 501, 1001, 2100" required/><small>Use 1–8 whole-rupee amounts separated by commas. Major change.</small></label>
          <label>Thank-you title<input maxLength={120} value={settings.thank_you_title} onChange={e => setSettings(v => ({ ...v, thank_you_title: e.target.value }))} required/></label>
          <label>Thank-you message<textarea rows={3} maxLength={600} value={settings.thank_you_message} onChange={e => setSettings(v => ({ ...v, thank_you_message: e.target.value }))} required/></label>
        </div>
        <div className="donation-admin-gateway"><div><HeartHandshake size={18}/><div><b>UPI gateway connection</b><small>These are public checkout configuration values, not secrets. Use HTTPS URLs. Keep webhook signing secrets inside the gateway/Supabase server settings.</small></div></div>
          <label>Receiving UPI ID / VPA<input autoComplete="off" maxLength={320} value={settings.receiving_upi_vpa ?? ''} onChange={e => setSettings(v => ({ ...v, receiving_upi_vpa: e.target.value }))} placeholder="example@bank"/><small>Uses this receiving account after approval. Leave both receiver fields blank to use the Worker’s secure server configuration.</small></label>
          <label>UPI payee / account name<input autoComplete="off" maxLength={99} value={settings.receiving_payee_name ?? ''} onChange={e => setSettings(v => ({ ...v, receiving_payee_name: e.target.value }))} placeholder="Name as shown by your UPI app"/><small>Must match the account name displayed in the payer’s UPI app.</small></label>
          <label>Checkout portal URL<input type="url" value={settings.gateway_portal_url ?? ''} onChange={e => setSettings(v => ({ ...v, gateway_portal_url: e.target.value }))} placeholder="https://pay.example.com"/></label>
          <label>Payment API URL<input type="url" value={settings.gateway_api_url ?? ''} onChange={e => setSettings(v => ({ ...v, gateway_api_url: e.target.value }))} placeholder="https://pay.example.com"/></label>
          <label>Public merchant ID/key<input autoComplete="off" maxLength={200} value={settings.gateway_merchant_key ?? ''} onChange={e => setSettings(v => ({ ...v, gateway_merchant_key: e.target.value }))} placeholder="Gateway merchant UUID"/></label>
          <p className="donation-admin-gateway-note">Gateway endpoint or merchant-ID changes are queued for super-admin approval when an admin submits them. Hosting environment variables remain a fallback if the database values are blank.</p>
        </div>
        {role !== 'super_admin' && <div className="donation-admin-approval-note"><ShieldCheck size={16}/><span><b>Approval rule:</b> your ordinary presentation settings apply immediately; major payment, amount-limit, fundraising-goal, suggested-amount and gateway changes will remain pending until a super administrator approves them.</span></div>}
        <button className="btn btn-primary" type="submit" disabled={busy === 'settings' || loading}>{busy === 'settings' ? <LoaderCircle size={15} className="spin"/> : <Save size={15}/>} Save donation settings</button>
      </form>
    </section>

    {role === 'super_admin' && <section className="panel donation-admin-requests"><div className="panel-heading"><div><div className="section-kicker">GOVERNANCE QUEUE</div><h3>Major change requests</h3><p>Approval applies the queued payment settings. Every request has a permanent status and reviewer record.</p></div><ShieldCheck size={19}/></div>{!pendingRequests.length ? <div className="chat-empty"><CheckCircle2 size={23}/><b>No pending changes</b><span>Major donation changes submitted by administrators will appear here.</span></div> : pendingRequests.map(request => <article className="donation-admin-request" key={request.id}><div className="donation-admin-request-head"><b>Major donation settings request</b><small>{dateText(request.created_at)} · Request ID {request.id.slice(0,8)}</small></div><div className="donation-admin-request-changes">{Object.entries(request.changes).map(([key,value]) => <div key={key}><span>{friendlyKey[key] || key.replace(/_/g,' ')}</span><b>{requestValue(key,value)}</b></div>)}</div><label>Review note (optional)<input value={notes[request.id] ?? ''} maxLength={500} onChange={e => setNotes(v => ({ ...v, [request.id]: e.target.value }))} placeholder="Reason for approval/rejection"/></label><div className="donation-admin-request-actions"><button type="button" className="btn btn-primary" disabled={busy === request.id} onClick={() => void reviewRequest(request,true)}><CheckCircle2 size={15}/> Approve changes</button><button type="button" className="btn btn-secondary" disabled={busy === request.id} onClick={() => void reviewRequest(request,false)}><XCircle size={15}/> Reject</button></div></article>)}</section>}

    <section className="panel donation-admin-requests donation-admin-manual-claims">
      <div className="panel-heading"><div><div className="section-kicker">PAYMENT DISPUTES</div><h3>Manual payment verification</h3><p>Users may submit a screenshot when they believe money was debited but automatic confirmation failed. Confirm only after matching the credit and UTR in the receiving bank statement.</p></div><ShieldCheck size={19}/></div>
      {!pendingClaims.length ? <div className="chat-empty"><CheckCircle2 size={23}/><b>No pending payment claims</b><span>Submitted claims will appear here for review.</span></div> : pendingClaims.map(claim => <article className="donation-admin-request donation-admin-claim" key={claim.id}>
        <div className="donation-admin-request-head"><b>Recorded amount {rupees(Number(claim.donation_amount_paise || 0))} · Payment claim</b><small>{dateText(claim.created_at)} · Order {claim.order_id} · current record: {claim.donation_status}</small></div>
        <div className="donation-admin-request-changes"><div><span>User-claimed amount</span><b>{claim.claimed_amount_paise == null ? 'Not provided' : rupees(Number(claim.claimed_amount_paise))}</b></div><div><span>Claimed UTR</span><b>{claim.claimed_utr || 'Not provided'}</b></div><div><span>Payment time</span><b>{dateText(claim.payment_timestamp)}</b></div><div><span>Donor / account</span><b>{claim.donor_name || 'Name not supplied'} · {claim.donor_email || claim.user_id}</b></div><div><span>User note</span><b>{claim.user_note || 'No note provided'}</b></div></div>
        <div className="donation-admin-claim-actions"><button type="button" className="btn btn-secondary" onClick={() => void openManualEvidence(claim)} disabled={busy === `evidence-${claim.id}`}><Eye size={14}/> {busy === `evidence-${claim.id}` ? 'Opening…' : 'View private screenshot'}</button></div>
        <label>Actual UTR/reference from the receiving bank statement<input value={claimUtrs[claim.id] ?? claim.claimed_utr ?? ''} onChange={e => setClaimUtrs(v => ({ ...v, [claim.id]: e.target.value }))} maxLength={80} placeholder="Enter bank-verified UTR — required to confirm" /></label>
        <label>Admin review note<input value={claimNotes[claim.id] ?? ''} onChange={e => setClaimNotes(v => ({ ...v, [claim.id]: e.target.value }))} maxLength={1000} placeholder="What did you verify or why are you rejecting?" /></label>
        <div className="donation-admin-request-actions"><button type="button" className="btn btn-primary" disabled={busy === `claim-${claim.id}`} onClick={() => void reviewManualClaim(claim,'confirm')}><CheckCircle2 size={15}/> Confirm credited payment</button><button type="button" className="btn btn-secondary" disabled={busy === `claim-${claim.id}`} onClick={() => void reviewManualClaim(claim,'reject')}><XCircle size={15}/> Reject claim</button></div>
      </article>)}
    </section>

    <section className="panel donation-admin-transactions"><div className="panel-heading"><div><div className="section-kicker">PAYMENT RECORDS</div><h3>Latest donations</h3><p>Payment references and donor contact details are visible only in this administrator console. Never treat pending records as received funds.</p></div><RefreshCw size={18}/></div>{loading ? <div className="ops-loading"><LoaderCircle size={19} className="spin"/> Loading donation records…</div> : !donations.length ? <div className="chat-empty"><Wallet size={24}/><b>No donation records yet</b><span>Donation attempts will appear here as the public donation page is used.</span></div> : <div className="donation-admin-table-wrap"><table className="donation-admin-table"><thead><tr><th>Amount / status</th><th>Donor details</th><th>Reference</th><th>Created / verified</th><th>Public feed / totals</th></tr></thead><tbody>{donations.map(donation => <tr key={donation.id}><td><b>{rupees(donation.amount_paise)}</b><span className={`donation-admin-status status-${donation.status}`}>{donation.status.replace('_',' ')}</span></td><td><b>{donation.is_anonymous ? 'Anonymous' : donation.donor_name || 'Name not supplied'}</b><small>{donation.is_anonymous ? 'Details hidden from public' : donation.donor_email || donation.donor_user_id || 'No contact details'}</small>{donation.message && <p>{donation.message}</p>}</td><td><code>{donation.order_id}</code>{donation.utr && <small>UTR: {donation.utr}</small>}{donation.gateway_payment_id && <small>Payment: {donation.gateway_payment_id.slice(0,14)}…</small>}</td><td><small>{dateText(donation.created_at)}</small><small>{donation.verified_at ? `Verified ${dateText(donation.verified_at)}` : 'Not verified'}</small></td><td>{donation.status === 'succeeded' ? <div className="donation-admin-row-actions"><button type="button" className="btn btn-secondary donation-admin-visibility" disabled={busy === donation.id} onClick={() => void setDonationHidden(donation)} title="Hide/restore public feed visibility">{donation.admin_hidden ? <Eye size={14}/> : <EyeOff size={14}/>} {donation.admin_hidden ? 'Restore feed' : 'Hide feed'}</button><button type="button" className="btn btn-secondary donation-admin-visibility" disabled={busy === `remove-${donation.id}`} onClick={() => void setDonationRemoved(donation)} title="Remove from or restore public total">{donation.admin_removed ? 'Restore totals' : 'Remove totals'}</button>{donation.admin_removed && <small>Excluded from public sums</small>}</div> : <span className="donation-admin-muted">—</span>}</td></tr>)}</tbody></table></div>}</section>
    <div className="donation-admin-footnote"><ShieldCheck size={15}/><span>Last refreshed {dateText(lastLoaded)}. Gateway API secrets and webhook signatures must remain server-side; public leaderboard data is aggregate/sanitised by a database function.</span></div>
  </div>
}
