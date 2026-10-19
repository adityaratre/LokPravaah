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
}
type DonationRow = {
  id: string; order_id: string; amount_paise: number; currency: string; donor_user_id: string | null
  donor_name: string | null; donor_email: string | null; is_anonymous: boolean; show_on_leaderboard: boolean; show_message_publicly: boolean
  admin_hidden: boolean; message: string | null; status: string; utr: string | null; gateway_payment_id: string | null
  created_at: string; verified_at: string | null
}
type ChangeRequest = { id: string; requested_by: string; changes: Record<string, unknown>; status: string; review_note: string | null; reviewed_by: string | null; reviewed_at: string | null; created_at: string }
type ReceiverRequest = { id: string; requested_by: string; receiving_vpa: string; payee_name: string; status: string; review_note: string | null; reviewed_by: string | null; reviewed_at: string | null; created_at: string }
type ActiveReceiver = { receivingVpa?: string | null; payeeName?: string | null; updatedAt?: string | null; updatedBy?: string | null }
type AdminData = { role: string; settings: Settings; donations: DonationRow[]; change_requests: ChangeRequest[] }

const DEFAULT_SETTINGS: Settings = {
  donations_enabled: true, payment_gateway_enabled: true, gateway_portal_url: null, gateway_api_url: null, gateway_merchant_key: null,
  leaderboard_enabled: true, show_public_total: true, show_goal_progress: true, show_recent_donations: true, show_donor_messages: true,
  campaign_title: 'Build a stronger civic community', campaign_description: 'Your contribution helps keep LokPravaah available, accessible and improving.',
  campaign_goal_paise: 5000000, min_amount_paise: 100, max_amount_paise: 10000000, suggested_amounts: [51, 101, 251, 501, 1001, 2100],
  thank_you_title: 'Thank you for backing civic action', thank_you_message: 'Your support helps us keep improving LokPravaah for the community.',
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
  if (typeof value === 'boolean') return value ? 'On' : 'Off'
  return String(value ?? '(empty)')
}

export default function DonationAdminPanel({ role, notify }: { role: string; notify: (message: string) => void }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [donations, setDonations] = useState<DonationRow[]>([])
  const [requests, setRequests] = useState<ChangeRequest[]>([])
  const [presetText, setPresetText] = useState(DEFAULT_SETTINGS.suggested_amounts.join(', '))
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [lastLoaded, setLastLoaded] = useState('')
  const [receiverForm, setReceiverForm] = useState({ receivingVpa: '', payeeName: '' })
  const [activeReceiver, setActiveReceiver] = useState<ActiveReceiver | null>(null)
  const [receiverRequests, setReceiverRequests] = useState<ReceiverRequest[]>([])
  const [receiverNotes, setReceiverNotes] = useState<Record<string, string>>({})
  const [receiverBusy, setReceiverBusy] = useState('')
  const [receiverError, setReceiverError] = useState('')
  const [receiverNotice, setReceiverNotice] = useState('')

  const load = useCallback(async () => {
    if (!supabase) { setError('Supabase is not configured.'); setLoading(false); setReceiverError('Supabase is not configured.'); return }
    setLoading(true); setError('')
    const [donationResult, receiverResult] = await Promise.all([
      supabase.rpc('janwatch_admin_get_donation_data'),
      supabase.rpc('janwatch_admin_get_upi_receiver_settings'),
    ])
    if (donationResult.error) {
      setError(`Donation administration data could not load${donationResult.error.code ? ` (${donationResult.error.code})` : ''}. Apply the donation SQL migration and confirm your account has the admin role.`)
    } else {
      const result = donationResult.data as Partial<AdminData> | null
      const nextSettings = { ...DEFAULT_SETTINGS, ...(result?.settings ?? {}), suggested_amounts: Array.isArray(result?.settings?.suggested_amounts) ? result!.settings!.suggested_amounts : DEFAULT_SETTINGS.suggested_amounts }
      setSettings(nextSettings)
      setPresetText(nextSettings.suggested_amounts.join(', '))
      setDonations(Array.isArray(result?.donations) ? result!.donations! : [])
      setRequests(Array.isArray(result?.change_requests) ? result!.change_requests! : [])
      setLastLoaded(new Date().toISOString())
    }
    if (receiverResult.error) {
      setReceiverError(`Receiving-account settings could not load: ${receiverResult.error.message || 'check the UPI settings migration and administrator role.'}`)
    } else {
      const receiverData = receiverResult.data as { active?: ActiveReceiver; requests?: ReceiverRequest[] } | null
      const active = receiverData?.active || {}
      setActiveReceiver(active)
      setReceiverForm({ receivingVpa: String(active.receivingVpa || ''), payeeName: String(active.payeeName || '') })
      setReceiverRequests(Array.isArray(receiverData?.requests) ? receiverData!.requests! : [])
      setReceiverError('')
    }
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


  async function saveReceiverSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    const receivingVpa = receiverForm.receivingVpa.trim().toLowerCase()
    const payeeName = receiverForm.payeeName.trim()
    if (!/^[A-Za-z0-9._-]{2,256}@[A-Za-z0-9.-]{2,64}$/.test(receivingVpa)) {
      setReceiverError('Enter a valid receiving UPI ID, for example name@bank.')
      return
    }
    if (payeeName.length < 1 || payeeName.length > 99) {
      setReceiverError('Payee name must contain 1–99 characters.')
      return
    }
    const prompt = role === 'super_admin'
      ? `Set ${receivingVpa} / ${payeeName} as the active receiving account for new UPI sessions? Verify this account is yours before continuing.`
      : `Submit ${receivingVpa} / ${payeeName} for super-admin approval? Current checkout settings will remain active until approval.`
    if (!window.confirm(prompt)) return
    setReceiverBusy('save'); setReceiverError(''); setReceiverNotice('')
    const { data, error: saveError } = await supabase.rpc('janwatch_admin_set_upi_receiver_settings', {
      p_receiving_vpa: receivingVpa,
      p_payee_name: payeeName,
    })
    setReceiverBusy('')
    if (saveError) { setReceiverError(`Receiving-account settings could not be saved: ${saveError.message || 'check your role and try again.'}`); return }
    const result = data as { status?: string; message?: string } | null
    setReceiverNotice(result?.message || (result?.status === 'pending_approval' ? 'Change submitted for super-admin approval.' : 'Receiving-account settings saved.'))
    notify(result?.message || 'Receiving-account settings saved.')
    await load()
  }

  async function reviewReceiverRequest(request: ReceiverRequest, approve: boolean) {
    if (!supabase || role !== 'super_admin') return
    const action = approve ? 'approve' : 'reject'
    if (!window.confirm(`${approve ? 'Approve and activate' : 'Reject'} receiving account ${request.receiving_vpa} / ${request.payee_name}?`)) return
    setReceiverBusy(request.id); setReceiverError(''); setReceiverNotice('')
    const { data, error: reviewError } = await supabase.rpc('janwatch_super_admin_review_upi_receiver_request', {
      p_request_id: request.id,
      p_approve: approve,
      p_note: receiverNotes[request.id]?.trim() || null,
    })
    setReceiverBusy('')
    if (reviewError) { setReceiverError(`Could not ${action} the receiving-account request: ${reviewError.message || 'please refresh and retry.'}`); return }
    const result = data as { message?: string } | null
    setReceiverNotice(result?.message || `Receiving-account request ${action}d.`)
    notify(result?.message || `Receiving-account request ${action}d.`)
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

  const pendingRequests = requests.filter(item => item.status === 'pending')
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


    <section className="panel donation-admin-settings donation-admin-receiver-settings">
      <div className="panel-heading"><div><div className="section-kicker">ACTUAL CHECKOUT BENEFICIARY</div><h3>Receiving UPI account</h3><p>The VPA and payee name in this section are the values encoded into new UPI payment links. Confirm the payee shown by your UPI app before taking live payments.</p></div><ShieldCheck size={19}/></div>
      {receiverError && <div className="donation-admin-error" role="alert"><AlertCircle size={17}/><span>{receiverError}</span></div>}
      {receiverNotice && <div className="donation-admin-receiver-notice" role="status"><CheckCircle2 size={16}/><span>{receiverNotice}</span></div>}
      <div className="donation-admin-receiver-current">
        <div><span>Currently active receiving VPA</span><b>{activeReceiver?.receivingVpa || 'Not configured'}</b></div>
        <div><span>Currently active payee name</span><b>{activeReceiver?.payeeName || 'Not configured'}</b></div>
        <div><span>Last changed</span><b>{dateText(activeReceiver?.updatedAt)}</b></div>
      </div>
      <form className="donation-admin-form" onSubmit={saveReceiverSettings}>
        <div className="donation-admin-config-grid">
          <label>Receiving UPI ID / VPA<input autoComplete="off" spellCheck={false} maxLength={320} value={receiverForm.receivingVpa} onChange={e => setReceiverForm(v => ({ ...v, receivingVpa: e.target.value }))} placeholder="yourname@bank" required/></label>
          <label>Payee / account holder name<input autoComplete="organization" maxLength={99} value={receiverForm.payeeName} onChange={e => setReceiverForm(v => ({ ...v, payeeName: e.target.value }))} placeholder="Name shown by your UPI app" required/></label>
        </div>
        <div className="donation-admin-receiver-warning"><ShieldCheck size={16}/><span><b>Important:</b> this changes the receiver used for new checkout sessions. Use only a VPA you control and verify the displayed beneficiary in a UPI app first. Webhook secrets and service-role keys do not belong here.</span></div>
        <div className="donation-admin-receiver-actions">
          <button className="btn btn-primary" type="submit" disabled={receiverBusy === 'save' || loading}>{receiverBusy === 'save' ? <LoaderCircle size={15} className="spin"/> : <Save size={15}/>} {role === 'super_admin' ? 'Save active receiver' : 'Request receiver change'}</button>
          <button className="btn btn-secondary" type="button" onClick={() => void load()} disabled={loading || Boolean(receiverBusy)}><RefreshCw size={14} className={loading ? 'spin' : ''}/> Refresh receiver</button>
        </div>
      </form>
      {role === 'super_admin' && <div className="donation-admin-receiver-requests"><div className="panel-heading"><div><div className="section-kicker">SUPER-ADMIN REVIEW</div><h3>Receiver change requests</h3><p>Changes requested by regular admins do not become active until approved here.</p></div><ShieldCheck size={18}/></div>
        {!receiverRequests.filter(item => item.status === 'pending').length ? <div className="chat-empty"><CheckCircle2 size={21}/><b>No pending receiver changes</b></div> : receiverRequests.filter(item => item.status === 'pending').map(request => <article className="donation-admin-request" key={request.id}>
          <div className="donation-admin-request-head"><b>{request.receiving_vpa} · {request.payee_name}</b><small>{dateText(request.created_at)} · {request.id.slice(0, 8)}</small></div>
          <label>Review note (optional)<input value={receiverNotes[request.id] ?? ''} maxLength={500} onChange={e => setReceiverNotes(v => ({ ...v, [request.id]: e.target.value }))} placeholder="Reason for approval/rejection"/></label>
          <div className="donation-admin-request-actions"><button type="button" className="btn btn-primary" disabled={receiverBusy === request.id} onClick={() => void reviewReceiverRequest(request, true)}><CheckCircle2 size={15}/> Approve & activate</button><button type="button" className="btn btn-secondary" disabled={receiverBusy === request.id} onClick={() => void reviewReceiverRequest(request, false)}><XCircle size={15}/> Reject</button></div>
        </article>)}
      </div>}
      <p className="donation-admin-gateway-note">The active receiver above is the canonical source for the hosted checkout. Legacy VPA fields, if present, are retained for compatibility and do not override this setting.</p>
    </section>

    {role === 'super_admin' && <section className="panel donation-admin-requests"><div className="panel-heading"><div><div className="section-kicker">GOVERNANCE QUEUE</div><h3>Major change requests</h3><p>Approval applies the queued payment settings. Every request has a permanent status and reviewer record.</p></div><ShieldCheck size={19}/></div>{!pendingRequests.length ? <div className="chat-empty"><CheckCircle2 size={23}/><b>No pending changes</b><span>Major donation changes submitted by administrators will appear here.</span></div> : pendingRequests.map(request => <article className="donation-admin-request" key={request.id}><div className="donation-admin-request-head"><b>Major donation settings request</b><small>{dateText(request.created_at)} · Request ID {request.id.slice(0,8)}</small></div><div className="donation-admin-request-changes">{Object.entries(request.changes).map(([key,value]) => <div key={key}><span>{friendlyKey[key] || key.replace(/_/g,' ')}</span><b>{requestValue(key,value)}</b></div>)}</div><label>Review note (optional)<input value={notes[request.id] ?? ''} maxLength={500} onChange={e => setNotes(v => ({ ...v, [request.id]: e.target.value }))} placeholder="Reason for approval/rejection"/></label><div className="donation-admin-request-actions"><button type="button" className="btn btn-primary" disabled={busy === request.id} onClick={() => void reviewRequest(request,true)}><CheckCircle2 size={15}/> Approve changes</button><button type="button" className="btn btn-secondary" disabled={busy === request.id} onClick={() => void reviewRequest(request,false)}><XCircle size={15}/> Reject</button></div></article>)}</section>}

    <section className="panel donation-admin-transactions"><div className="panel-heading"><div><div className="section-kicker">PAYMENT RECORDS</div><h3>Latest donations</h3><p>Payment references and donor contact details are visible only in this administrator console. Never treat pending records as received funds.</p></div><RefreshCw size={18}/></div>{loading ? <div className="ops-loading"><LoaderCircle size={19} className="spin"/> Loading donation records…</div> : !donations.length ? <div className="chat-empty"><Wallet size={24}/><b>No donation records yet</b><span>Donation attempts will appear here as the public donation page is used.</span></div> : <div className="donation-admin-table-wrap"><table className="donation-admin-table"><thead><tr><th>Amount / status</th><th>Donor details</th><th>Reference</th><th>Created / verified</th><th>Public feed</th></tr></thead><tbody>{donations.map(donation => <tr key={donation.id}><td><b>{rupees(donation.amount_paise)}</b><span className={`donation-admin-status status-${donation.status}`}>{donation.status.replace('_',' ')}</span></td><td><b>{donation.is_anonymous ? 'Anonymous' : donation.donor_name || 'Name not supplied'}</b><small>{donation.is_anonymous ? 'Details hidden from public' : donation.donor_email || donation.donor_user_id || 'No contact details'}</small>{donation.message && <p>{donation.message}</p>}</td><td><code>{donation.order_id}</code>{donation.utr && <small>UTR: {donation.utr}</small>}{donation.gateway_payment_id && <small>Payment: {donation.gateway_payment_id.slice(0,14)}…</small>}</td><td><small>{dateText(donation.created_at)}</small><small>{donation.verified_at ? `Verified ${dateText(donation.verified_at)}` : 'Not verified'}</small></td><td>{donation.status === 'succeeded' ? <button type="button" className="btn btn-secondary donation-admin-visibility" disabled={busy === donation.id} onClick={() => void setDonationHidden(donation)} title="Hide/restore public feed visibility">{donation.admin_hidden ? <Eye size={14}/> : <EyeOff size={14}/>} {donation.admin_hidden ? 'Restore' : 'Hide'}</button> : <span className="donation-admin-muted">—</span>}</td></tr>)}</tbody></table></div>}</section>
    <div className="donation-admin-footnote"><ShieldCheck size={15}/><span>Last refreshed {dateText(lastLoaded)}. Gateway API secrets and webhook signatures must remain server-side; public leaderboard data is aggregate/sanitised by a database function.</span></div>
  </div>
}
