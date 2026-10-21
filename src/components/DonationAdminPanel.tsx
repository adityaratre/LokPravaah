import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { AlertCircle, CheckCircle2, Eye, EyeOff, ExternalLink, HeartHandshake, LoaderCircle, RefreshCw, Save, ShieldCheck, Wallet, XCircle } from 'lucide-react'
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
  admin_hidden: boolean; admin_removed?: boolean; admin_removal_note?: string | null
  record_source?: string; recorded_by?: string | null
  message: string | null; status: string; utr: string | null; gateway_payment_id: string | null
  created_at: string; verified_at: string | null
}
type ChangeRequest = { id: string; requested_by: string; changes: Record<string, unknown>; status: string; review_note: string | null; reviewed_by: string | null; reviewed_at: string | null; created_at: string }
type ReceiverRequest = { id: string; requested_by: string; receiving_vpa: string; payee_name: string; status: string; review_note: string | null; reviewed_by: string | null; reviewed_at: string | null; created_at: string }
type ActiveReceiver = { receivingVpa?: string | null; payeeName?: string | null; updatedAt?: string | null; updatedBy?: string | null }
type ManualReview = {
  id: string; donation_intent_id: string; order_id: string; donation_amount_paise: number
  donation_status: string; donor_name: string | null; donor_email: string | null; user_id: string
  claimed_utr: string | null; claimed_amount_paise: number | null; payment_timestamp: string | null
  user_note: string | null; screenshot_path: string; evidence_paths?: string[]; status: 'pending_review' | 'confirmed' | 'rejected'
  admin_review_note: string | null; reviewed_by: string | null; reviewed_at: string | null; created_at: string
}
type AdminData = { role: string; settings: Settings; donations: DonationRow[]; change_requests: ChangeRequest[]; manual_reviews?: ManualReview[] }

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
  const [manualReviews, setManualReviews] = useState<ManualReview[]>([])
  const [manualScreenshotUrls, setManualScreenshotUrls] = useState<Record<string, { path: string; url: string }[]>>({})
  const [selectedEvidence, setSelectedEvidence] = useState<{ url: string; orderId: string; isImage: boolean } | null>(null)
  const [verifiedUtrs, setVerifiedUtrs] = useState<Record<string, string>>({})
  const [manualReviewNotes, setManualReviewNotes] = useState<Record<string, string>>({})
  const [requests, setRequests] = useState<ChangeRequest[]>([])
  const [presetText, setPresetText] = useState(DEFAULT_SETTINGS.suggested_amounts.join(', '))
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  // Synchronous locks prevent duplicate admin mutations before React updates disabled buttons.
  const actionLocksRef = useRef(new Set<string>())
  const [error, setError] = useState('')
  const [lastLoaded, setLastLoaded] = useState('')
  const [receiverForm, setReceiverForm] = useState({ receivingVpa: '', payeeName: '' })
  const [activeReceiver, setActiveReceiver] = useState<ActiveReceiver | null>(null)
  const [receiverRequests, setReceiverRequests] = useState<ReceiverRequest[]>([])
  const [receiverNotes, setReceiverNotes] = useState<Record<string, string>>({})
  const [receiverBusy, setReceiverBusy] = useState('')
  const [receiverError, setReceiverError] = useState('')
  const [receiverNotice, setReceiverNotice] = useState('')
  const [manualAmount, setManualAmount] = useState('')
  const [manualDonorName, setManualDonorName] = useState('')
  const [manualDonorEmail, setManualDonorEmail] = useState('')
  const [manualMessage, setManualMessage] = useState('')
  const [manualSource, setManualSource] = useState<'manual_cash' | 'manual_bank' | 'manual_upi' | 'manual_other'>('manual_cash')
  const [manualReceivedAt, setManualReceivedAt] = useState(() => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16))
  const [manualAnonymous, setManualAnonymous] = useState(false)
  const [manualLeaderboard, setManualLeaderboard] = useState(true)
  const [manualPublicMessage, setManualPublicMessage] = useState(false)
  const [manualAuditNote, setManualAuditNote] = useState('')

  const load = useCallback(async () => {
    if (!supabase) { setError('Supabase is not configured.'); setLoading(false); setReceiverError('Supabase is not configured.'); return }
    const client = supabase
    setLoading(true); setError('')
    const [donationResult, receiverResult] = await Promise.all([
      client.rpc('janwatch_admin_get_donation_data'),
      client.rpc('janwatch_admin_get_upi_receiver_settings'),
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
      const claims = Array.isArray(result?.manual_reviews) ? result!.manual_reviews! : []
      setManualReviews(claims)
      const signedUrls = await Promise.all(claims.map(async claim => {
        const paths = Array.isArray(claim.evidence_paths) && claim.evidence_paths.length
          ? claim.evidence_paths
          : claim.screenshot_path ? [claim.screenshot_path] : []
        const urls = await Promise.all(paths.map(async path => {
          const { data, error: signedUrlError } = await client.storage.from('donation-payment-evidence').createSignedUrl(path, 600)
          return !signedUrlError && data?.signedUrl ? { path, url: data.signedUrl } : null
        }))
        const valid = urls.filter((entry): entry is { path: string; url: string } => Boolean(entry))
        return valid.length ? [claim.id, valid] as const : null
      }))
      setManualScreenshotUrls(Object.fromEntries(signedUrls.filter((entry): entry is readonly [string, { path: string; url: string }[]] => Boolean(entry))))
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

  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load() }, 30_000)
    return () => window.clearInterval(timer)
  }, [load])

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (actionLocksRef.current.has('save-settings')) return;
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
    actionLocksRef.current.add('save-settings');
    const payload = { ...settings, gateway_portal_url: portal, gateway_api_url: api, gateway_merchant_key: settings.gateway_merchant_key?.trim() || null, min_amount_paise: min, max_amount_paise: max, campaign_goal_paise: goal, suggested_amounts: suggested }
    const { data, error: saveError } = await Promise.resolve(supabase.rpc('janwatch_admin_update_donation_settings', { p_settings: payload })).finally(() => actionLocksRef.current.delete('save-settings'))
    setBusy('')
    if (saveError) { setError(`Donation settings could not be saved: ${saveError.message || 'check database permissions and values.'}`); return }
    const response = data as { status?: string; message?: string } | null
    notify(response?.message || (response?.status === 'pending_approval' ? 'Major changes submitted for super-admin approval.' : 'Donation settings saved.'))
    await load()
  }

  async function reviewRequest(request: ChangeRequest, approve: boolean) {
    if (actionLocksRef.current.has(`settings-request:${request.id}`)) return;
    if (!supabase || role !== 'super_admin') return
    const action = approve ? 'approve' : 'reject'
    if (!window.confirm(`${approve ? 'Approve and apply' : 'Reject'} this major donation settings change?`)) return
    setBusy(request.id); setError('')
    actionLocksRef.current.add(`settings-request:${request.id}`);
    const { data, error: reviewError } = await Promise.resolve(supabase.rpc('janwatch_super_admin_review_donation_settings', { p_request_id: request.id, p_approve: approve, p_note: notes[request.id]?.trim() || null })).finally(() => actionLocksRef.current.delete(`settings-request:${request.id}`))
    setBusy('')
    if (reviewError) { setError(`Could not ${action} the request: ${reviewError.message || 'check permissions and refresh.'}`); return }
    notify((data as { message?: string } | null)?.message || `Donation settings request ${action}d.`)
    await load()
  }


  async function saveReceiverSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (actionLocksRef.current.has('save-receiver')) return;
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
    actionLocksRef.current.add('save-receiver');
    const { data, error: saveError } = await Promise.resolve(supabase.rpc('janwatch_admin_set_upi_receiver_settings', {
      p_receiving_vpa: receivingVpa,
      p_payee_name: payeeName,
    })).finally(() => actionLocksRef.current.delete('save-receiver'))
    setReceiverBusy('')
    if (saveError) { setReceiverError(`Receiving-account settings could not be saved: ${saveError.message || 'check your role and try again.'}`); return }
    const result = data as { status?: string; message?: string } | null
    setReceiverNotice(result?.message || (result?.status === 'pending_approval' ? 'Change submitted for super-admin approval.' : 'Receiving-account settings saved.'))
    notify(result?.message || 'Receiving-account settings saved.')
    await load()
  }

  async function reviewReceiverRequest(request: ReceiverRequest, approve: boolean) {
    if (actionLocksRef.current.has(`receiver-request:${request.id}`)) return;
    if (!supabase || role !== 'super_admin') return
    const action = approve ? 'approve' : 'reject'
    if (!window.confirm(`${approve ? 'Approve and activate' : 'Reject'} receiving account ${request.receiving_vpa} / ${request.payee_name}?`)) return
    setReceiverBusy(request.id); setReceiverError(''); setReceiverNotice('')
    actionLocksRef.current.add(`receiver-request:${request.id}`);
    const { data, error: reviewError } = await Promise.resolve(supabase.rpc('janwatch_super_admin_review_upi_receiver_request', {
      p_request_id: request.id,
      p_approve: approve,
      p_note: receiverNotes[request.id]?.trim() || null,
    })).finally(() => actionLocksRef.current.delete(`receiver-request:${request.id}`))
    setReceiverBusy('')
    if (reviewError) { setReceiverError(`Could not ${action} the receiving-account request: ${reviewError.message || 'please refresh and retry.'}`); return }
    const result = data as { message?: string } | null
    setReceiverNotice(result?.message || `Receiving-account request ${action}d.`)
    notify(result?.message || `Receiving-account request ${action}d.`)
    await load()
  }

  async function reviewManualDonation(claim: ManualReview, action: 'confirm' | 'reject') {
    if (actionLocksRef.current.has(`manual-review:${claim.id}`)) return;
    const client = supabase
    if (!client || !['admin', 'super_admin'].includes(role)) return
    const verifiedUtr = String(verifiedUtrs[claim.id] || '').trim()
    const note = String(manualReviewNotes[claim.id] || '').trim()
    if (action === 'confirm' && !/^[A-Za-z0-9_-]{6,80}$/.test(verifiedUtr)) {
      setError('Enter the actual bank UTR after checking the receiving-bank statement. Do not copy it blindly from the user claim.')
      return
    }
    if (note.length < 3 || note.length > 1000) {
      setError(action === 'confirm' ? 'Add a bank-statement review note of at least 3 characters.' : 'Add a rejection reason of at least 3 characters.')
      return
    }
    if (!window.confirm(action === 'confirm'
      ? 'Confirm this donation only after matching the UTR with the receiving-bank statement?'
      : 'Reject this payment-proof claim?')) return
    setBusy(claim.id); setError('')
    actionLocksRef.current.add(`manual-review:${claim.id}`);
    const { data, error: reviewError } = await Promise.resolve(client.rpc('janwatch_admin_review_manual_donation', {
      p_claim_id: claim.id,
      p_action: action,
      p_note: note,
      p_verified_utr: action === 'confirm' ? verifiedUtr : null,
    })).finally(() => actionLocksRef.current.delete(`manual-review:${claim.id}`))
    setBusy('')
    if (reviewError) { setError(`Could not ${action} this donation: ${reviewError.message || 'refresh and try again.'}`); return }
    const result = data as { message?: string } | null
    notify(result?.message || (action === 'confirm' ? 'Donation verified after manual review.' : 'Payment claim rejected.'))
    await load()
  }

  async function addManualDonation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (actionLocksRef.current.has('manual-donation')) return;
    if (!supabase) return
    const rawAmount = manualAmount.trim()
    if (!/^\d{1,6}(?:\.\d{1,2})?$/.test(rawAmount)) { setError('Enter an amount from ₹1 to ₹100,000 with at most 2 decimal places.'); return }
    const amountPaise = Math.round(Number(rawAmount) * 100)
    if (!Number.isSafeInteger(amountPaise) || amountPaise < 100 || amountPaise > 10000000) { setError('Amount must be between ₹1 and ₹100,000.'); return }
    const receivedDate = new Date(manualReceivedAt)
    if (Number.isNaN(receivedDate.getTime()) || receivedDate.getTime() > Date.now() + 5 * 60 * 1000) { setError('Choose a valid received date/time that is not in the future.'); return }
    if (manualAuditNote.trim().length < 3) { setError('Add an audit note explaining when/how the money was received.'); return }
    if (!window.confirm('Record this as money already received outside online checkout? The public fundraising total and enabled leaderboard will update.')) return

    setBusy('manual-donation'); setError('')
    actionLocksRef.current.add('manual-donation');
    const { data, error: createError } = await Promise.resolve(supabase.rpc('janwatch_admin_create_manual_donation', {
      p_amount_paise: amountPaise,
      p_donor_name: manualAnonymous ? null : (manualDonorName.trim() || null),
      p_donor_email: manualAnonymous ? null : (manualDonorEmail.trim() || null),
      p_message: manualMessage.trim() || null,
      p_received_at: receivedDate.toISOString(),
      p_record_source: manualSource,
      p_is_anonymous: manualAnonymous,
      p_show_on_leaderboard: manualLeaderboard,
      p_show_message_publicly: manualPublicMessage,
      p_admin_note: manualAuditNote.trim(),
    })).finally(() => actionLocksRef.current.delete('manual-donation'))
    setBusy('')
    if (createError) { setError(`Offline donation could not be recorded: ${createError.message || 'check the SQL migration and administrator role.'}`); return }
    const result = data as { order_id?: string; message?: string } | null
    notify(`${result?.message || 'Offline donation recorded.'}${result?.order_id ? ` Reference: ${result.order_id}` : ''}`)
    setManualAmount(''); setManualDonorName(''); setManualDonorEmail(''); setManualMessage('')
    setManualSource('manual_cash')
    setManualReceivedAt(new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16))
    setManualAnonymous(false); setManualLeaderboard(true); setManualPublicMessage(false); setManualAuditNote('')
    await load()
  }

  async function setDonationRemoved(donation: DonationRow) {
    if (!supabase) return
    const nextRemoved = !Boolean(donation.admin_removed)
    const promptedNote = window.prompt(nextRemoved
      ? (donation.status === 'succeeded'
          ? 'Reason for excluding this received donation from public totals/leaderboard (record retained for audit):'
          : 'Reason for archiving this pending/failed checkout record (record retained for audit):')
      : 'Optional note for restoring this record:',
      nextRemoved ? 'Incorrect duplicate / entry correction' : '')
    if (promptedNote === null) return
    const note = promptedNote.trim()
    if (nextRemoved && note.length < 3) { setError('A reason of at least 3 characters is required.'); return }
    if (!window.confirm(nextRemoved
      ? (donation.status === 'succeeded'
          ? 'Exclude this received donation from public totals, recent activity and leaderboard? The original financial record remains auditable.'
          : 'Archive this unsuccessful/pending checkout record from the active history? The original record remains auditable.')
      : 'Restore this donation record to active history and public totals where applicable?')) return
    setBusy(donation.id); setError('')
    const { data, error: removeError } = await supabase.rpc('janwatch_admin_set_donation_removed', {
      p_donation_id: donation.id, p_removed: nextRemoved, p_note: note || null,
    })
    setBusy('')
    if (removeError) { setError(`Donation ${nextRemoved ? 'removal' : 'restore'} failed: ${removeError.message || 'refresh and try again.'}`); return }
    notify((data as { message?: string } | null)?.message || (nextRemoved ? 'Donation excluded from public totals.' : 'Donation restored.'))
    await load()
  }

  async function setDonationHidden(donation: DonationRow) {
    const client = supabase
    if (!client) return
    const nextHidden = !donation.admin_hidden
    if (!window.confirm(`${nextHidden ? 'Hide this verified donation from public activity?' : 'Restore this donation to public activity if the donor opted in?'}`)) return
    setBusy(donation.id); setError('')
    const { error: visibilityError } = await client.rpc('janwatch_admin_set_donation_visibility', { p_donation_id: donation.id, p_hidden: nextHidden })
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

    <details className="panel donation-admin-manual-reviews donation-admin-collapsible">
      <summary className="donation-admin-collapse-summary"><div className="panel-heading"><div><div className="section-kicker">PAYMENT PROOF REVIEW</div><h3>UTR & screenshot review queue</h3><p>Open only when you need to review donor payment proofs.</p></div><ShieldCheck size={19}/></div><span className="donation-admin-collapse-indicator" aria-hidden="true">⌄</span></summary>
      <div className="donation-admin-collapsible-content">
      {loading ? <div className="ops-loading"><LoaderCircle size={19} className="spin"/> Loading payment proof…</div> : !manualReviews.some(claim => claim.status === 'pending_review') ? <div className="chat-empty"><HeartHandshake size={23}/><b>No pending manual payment claims</b><span>New UTR and receipt submissions will appear here. Verified and rejected items remain in the donation records/review history.</span></div> : <div className="donation-admin-manual-list">{manualReviews.filter(claim => claim.status === 'pending_review').map(claim => <article className="donation-admin-manual-claim" key={claim.id}>
        <div className="donation-admin-manual-head"><div><span className={`donation-admin-status status-${claim.status}`}>{claim.status.replace(/_/g, ' ')}</span><h4>{rupees(claim.donation_amount_paise)} · {claim.donor_name || 'Donor'}</h4><small>{dateText(claim.created_at)} · {claim.order_id}</small></div><b>Reported: {rupees(claim.claimed_amount_paise || 0)}</b></div>
        <div className="donation-admin-manual-details"><div><span>Claimed UTR</span><code>{claim.claimed_utr || 'Not provided'}</code></div><div><span>Payment time</span><b>{dateText(claim.payment_timestamp)}</b></div><div><span>Donation status</span><b>{claim.donation_status}</b></div><div><span>Donor account</span><code>{claim.user_id}</code></div></div>
        {claim.user_note && <p className="donation-admin-manual-note">{claim.user_note}</p>}
        {(claim.evidence_paths?.length || claim.screenshot_path) && <div className="donation-admin-manual-evidence">
          {manualScreenshotUrls[claim.id]?.map((evidence, index) => {
            const isImage = /\.(jpe?g|png|webp)$/i.test(evidence.path)
            return <div className="donation-admin-evidence-item" key={evidence.path}>
              {index === 0 && isImage && <button type="button" className="donation-admin-evidence-preview" onClick={() => setSelectedEvidence({ url: evidence.url, orderId: claim.order_id, isImage: true })} aria-label={`Preview payment proof for ${claim.order_id}`}><img src={evidence.url} alt={`Private payment proof for ${claim.order_id}`}/><span>Tap to enlarge</span></button>}
              <button type="button" className="donation-admin-evidence-open" onClick={() => setSelectedEvidence({ url: evidence.url, orderId: claim.order_id, isImage })}><ExternalLink size={14}/> {isImage ? 'Preview' : 'Open PDF'} receipt {index + 1}</button>
            </div>
          })}
          {!manualScreenshotUrls[claim.id]?.length && <span>Receipt URL unavailable; refresh the admin panel to generate a secure link.</span>}
        </div>}
        {claim.status === 'pending_review' ? <div className="donation-admin-manual-decision">
          <label>Verified bank UTR <small>(enter after checking the receiving-bank statement)</small><input value={verifiedUtrs[claim.id] ?? ''} onChange={e => setVerifiedUtrs(v => ({ ...v, [claim.id]: e.target.value }))} autoComplete="off" spellCheck={false} maxLength={80} placeholder="Bank-confirmed UTR / RRN"/></label>
          <label>Review note / rejection reason<textarea rows={2} value={manualReviewNotes[claim.id] ?? ''} onChange={e => setManualReviewNotes(v => ({ ...v, [claim.id]: e.target.value }))} maxLength={1000} placeholder="e.g. matched amount and UTR with receiving bank statement"/></label>
          <div className="donation-admin-manual-actions"><button type="button" className="btn btn-primary" disabled={busy === claim.id} onClick={() => void reviewManualDonation(claim, 'confirm')}><CheckCircle2 size={15}/> Verify from bank record</button><button type="button" className="btn btn-secondary" disabled={busy === claim.id} onClick={() => void reviewManualDonation(claim, 'reject')}><XCircle size={15}/> Reject claim</button></div>
        </div> : <div className="donation-admin-manual-reviewed"><b>{claim.status === 'confirmed' ? 'Verified manually' : 'Claim rejected'}</b><p>{claim.admin_review_note || 'No reviewer note recorded.'}</p><small>{claim.reviewed_at ? dateText(claim.reviewed_at) : ''}</small></div>}
      </article>)}</div>}
      </div>
    </details>

    <details className="panel donation-admin-manual-entry donation-admin-collapsible">
      <summary className="donation-admin-collapse-summary"><div className="panel-heading"><div><div className="section-kicker">MANUAL PAYMENT CONFIRMATION</div><h3>Add an offline/direct donation</h3><p>Open only when you need to record cash, bank transfer, or direct UPI money already received.</p></div><HeartHandshake size={19}/></div><span className="donation-admin-collapse-indicator" aria-hidden="true">⌄</span></summary>
      <div className="donation-admin-collapsible-content">
      <div className="panel-heading"><div><div className="section-kicker">OFFLINE / DIRECT CONTRIBUTIONS</div><h3>Add donation received outside checkout</h3><p>Record cash, bank transfer, or direct UPI donations that you have actually received. This adds an audited record and does not pretend to be a gateway transaction.</p></div><HeartHandshake size={19}/></div>
      <form className="donation-admin-form" onSubmit={addManualDonation}>
        <div className="donation-admin-config-grid">
          <label>Amount received (₹)<input type="number" inputMode="decimal" min="1" max="100000" step="0.01" value={manualAmount} onChange={e => setManualAmount(e.target.value)} required placeholder="e.g. 251"/></label>
          <label>Contribution type<select value={manualSource} onChange={e => setManualSource(e.target.value as typeof manualSource)}><option value="manual_cash">Cash / offline event</option><option value="manual_bank">Bank transfer</option><option value="manual_upi">Direct UPI received</option><option value="manual_other">Other direct contribution</option></select></label>
          <label>Donor name<input maxLength={80} value={manualDonorName} onChange={e => setManualDonorName(e.target.value)} disabled={manualAnonymous} placeholder="Name (optional)"/></label>
          <label>Donor email (optional)<input type="email" maxLength={254} value={manualDonorEmail} onChange={e => setManualDonorEmail(e.target.value)} disabled={manualAnonymous} placeholder="name@example.com"/></label>
          <label>Received date and time<input type="datetime-local" value={manualReceivedAt} onChange={e => setManualReceivedAt(e.target.value)} required/></label>
          <label>Donor message (optional)<textarea rows={2} maxLength={300} value={manualMessage} onChange={e => setManualMessage(e.target.value)} placeholder="Thank-you note (optional)"/></label>
          <label>Internal audit note (required)<textarea rows={2} minLength={3} maxLength={500} value={manualAuditNote} onChange={e => setManualAuditNote(e.target.value)} required placeholder="e.g. cash received in person at community meetup"/></label>
        </div>
        <div className="donation-admin-toggles">
          <label className="ops-config-toggle"><input type="checkbox" checked={manualAnonymous} onChange={e => { setManualAnonymous(e.target.checked); if (e.target.checked) { setManualDonorName(''); setManualDonorEmail(''); setManualLeaderboard(false); setManualPublicMessage(false) } }}/><span><b>Anonymous supporter</b><small>Anonymous records do not store the donor name/email.</small></span></label>
          <label className="ops-config-toggle"><input type="checkbox" checked={manualLeaderboard} disabled={manualAnonymous} onChange={e => setManualLeaderboard(e.target.checked)}/><span><b>Include in leaderboard</b><small>Only enable if the donor opted in.</small></span></label>
          <label className="ops-config-toggle"><input type="checkbox" checked={manualPublicMessage} disabled={manualAnonymous || !manualMessage.trim()} onChange={e => setManualPublicMessage(e.target.checked)}/><span><b>Show message publicly</b><small>Requires a non-empty message and donor opt-in.</small></span></label>
        </div>
        <div className="donation-admin-receiver-warning"><ShieldCheck size={16}/><span><b>Accounting rule:</b> only enter money actually received. Public total and leaderboard recalculate through the donation database function; gateway payment references remain unchanged.</span></div>
        <button type="submit" className="btn btn-primary" disabled={busy === 'manual-donation' || loading}>{busy === 'manual-donation' ? <LoaderCircle size={15} className="spin"/> : <Save size={15}/>} Add received donation</button>
      </form>
      </div>
    </details>

    <details className="panel donation-admin-transactions donation-admin-collapsible">
      <summary className="donation-admin-collapse-summary"><div className="panel-heading"><div><div className="section-kicker">PAYMENT RECORDS</div><h3>Latest donations <span className="donation-admin-record-count">{donations.length}</span></h3><p>Open to inspect, search through, or manage the full payment history.</p></div><RefreshCw size={18}/></div><span className="donation-admin-collapse-indicator" aria-hidden="true">⌄</span></summary>
      <div className="donation-admin-collapsible-content">{loading ? <div className="ops-loading"><LoaderCircle size={19} className="spin"/> Loading donation records…</div> : !donations.length ? <div className="chat-empty"><Wallet size={24}/><b>No donation records yet</b><span>Donation attempts will appear here as the public donation page is used.</span></div> : <div className="donation-admin-table-wrap"><table className="donation-admin-table"><thead><tr><th>Amount / status</th><th>Donor details</th><th>Reference</th><th>Created / verified</th><th>Public visibility & totals</th></tr></thead><tbody>{donations.map(donation => <tr key={donation.id}><td><b>{rupees(donation.amount_paise)}</b><span className={`donation-admin-status status-${donation.status}`}>{donation.status.replace('_',' ')}</span>{donation.admin_removed && <span className="donation-admin-status status-removed">removed from totals</span>}</td><td><b>{donation.is_anonymous ? 'Anonymous' : donation.donor_name || 'Name not supplied'}</b><small>{donation.is_anonymous ? 'Details hidden from public' : donation.donor_email || donation.donor_user_id || 'No contact details'}</small>{donation.message && <p>{donation.message}</p>}</td><td><code>{donation.order_id}</code>{donation.utr && <small>UTR: {donation.utr}</small>}{donation.gateway_payment_id && <small>Payment: {donation.gateway_payment_id.slice(0,14)}…</small>}</td><td><small>{dateText(donation.created_at)}</small><small>{donation.verified_at ? `Verified ${dateText(donation.verified_at)}` : 'Not verified'}</small><small>{({gateway:'Online gateway',manual_cash:'Offline cash',manual_bank:'Offline bank',manual_upi:'Offline UPI',manual_other:'Offline / other'} as Record<string,string>)[donation.record_source || 'gateway'] || 'Online gateway'}</small></td><td><div className="donation-admin-visibility-actions">{donation.status === 'succeeded' && <button type="button" className="btn btn-secondary donation-admin-visibility" disabled={busy === donation.id} onClick={() => void setDonationHidden(donation)} title="Hide/restore public feed visibility">{donation.admin_hidden ? <Eye size={14}/> : <EyeOff size={14}/>} {donation.admin_hidden ? 'Show feed' : 'Hide feed'}</button>}<button type="button" className={'btn ' + (donation.admin_removed ? 'btn-primary' : 'btn-danger') + ' donation-admin-visibility'} disabled={busy === donation.id} onClick={() => void setDonationRemoved(donation)} title={donation.admin_removed ? 'Restore this record' : (donation.status === 'succeeded' ? 'Exclude from public totals/leaderboard; keep audit record' : 'Archive this unsuccessful/pending record; keep audit record')}>{donation.admin_removed ? 'Restore record' : (donation.status === 'succeeded' ? 'Remove from totals' : 'Archive record')}</button>{donation.admin_removed && <small className="donation-admin-removed-note">{donation.status === 'succeeded' ? 'Excluded from total' : 'Archived record'}{donation.admin_removal_note ? ': ' + donation.admin_removal_note : ''}</small>}</div></td></tr>)}</tbody></table></div>}
      </div>
    </details>
    {selectedEvidence && <div className="donation-evidence-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setSelectedEvidence(null) }}><section className="donation-evidence-modal" role="dialog" aria-modal="true" aria-label={`Payment evidence for ${selectedEvidence.orderId}`}><header><div><span>PRIVATE PAYMENT EVIDENCE</span><h3>{selectedEvidence.orderId}</h3></div><button type="button" className="btn btn-secondary" onClick={() => setSelectedEvidence(null)} aria-label="Close evidence preview">✕</button></header><div className="donation-evidence-modal-content">{selectedEvidence.isImage ? <img src={selectedEvidence.url} alt={`Payment evidence for ${selectedEvidence.orderId}`}/> : <div className="donation-evidence-document"><ExternalLink size={26}/><p>This receipt is a PDF or document.</p><a href={selectedEvidence.url} target="_blank" rel="noreferrer">Open document in a new tab</a></div>}</div><footer><a href={selectedEvidence.url} target="_blank" rel="noreferrer"><ExternalLink size={14}/> Open original</a><span>Secure link expires automatically.</span></footer></section></div>}
    <div className="donation-admin-footnote"><ShieldCheck size={15}/><span>Last refreshed {dateText(lastLoaded)}. Gateway API secrets and webhook signatures must remain server-side; public leaderboard data is aggregate/sanitised by a database function.</span></div>
  </div>
}
