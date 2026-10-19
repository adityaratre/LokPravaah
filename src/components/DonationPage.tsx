import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  ArrowRight, Award, BadgeCheck, CircleAlert, CircleCheck, Clock3, Crown, HandHeart,
  Heart, HeartHandshake, LoaderCircle, LockKeyhole, Medal, RefreshCw, ShieldCheck,
  Sparkles, Target, Trophy, Users, Wallet,
} from 'lucide-react'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import './DonationPage.css'
import DonationPaymentClaim from './DonationPaymentClaim'

type CheckoutResult = {
  status?: string
  order_id?: string
  amount_received?: number | string
  utr?: string
  paymentId?: string
  reason?: string
  error?: string
}
type CheckoutOptions = {
  key: string
  order_id: string
  amount: number
  currency: 'INR'
  name: string
  description: string
  customer?: { name?: string; email?: string }
  metadata: Record<string, string | number | boolean>
  portalUrl: string
  apiUrl: string
  theme: { color: string }
  successUrl?: string
  handler: (result: CheckoutResult) => void
  onSuccess?: (result: CheckoutResult) => void
  onFailed?: (result: CheckoutResult) => void
  onSuspicious?: (result: CheckoutResult) => void
  onExpired?: (result: CheckoutResult) => void
  onCancelled?: (result: CheckoutResult) => void
  onClose?: () => void
}
declare global { interface Window { Youpi?: { pay: (options: CheckoutOptions) => Promise<unknown> } } }

type Props = { userId?: string | null; userName?: string }
type GatewayState = 'not-configured' | 'loading' | 'ready' | 'error'
type DonationSettings = {
  donations_enabled: boolean
  payment_gateway_enabled: boolean
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
  gateway_portal_url: string | null
  gateway_api_url: string | null
  gateway_merchant_key: string | null
}
type Donor = { rank: number; donor_name: string; total_paise: number; donations_count: number }
type RecentDonation = { display_name: string; amount_paise: number; verified_at: string; message?: string | null }
type DonationAttempt = { orderId: string; amountPaise: number; status: string; createdAt: number }
type DonationPublicData = { settings: DonationSettings; total_raised_paise: number; successful_donations: number; top_donors: Donor[]; recent_donations: RecentDonation[]; refreshed_at?: string }

const DEFAULT_SETTINGS: DonationSettings = {
  donations_enabled: true,
  payment_gateway_enabled: true,
  leaderboard_enabled: true,
  show_public_total: true,
  show_goal_progress: true,
  show_recent_donations: true,
  show_donor_messages: true,
  campaign_title: 'Build a stronger civic community',
  campaign_description: 'Your contribution helps keep LokPravaah available, accessible and improving.',
  campaign_goal_paise: 5_000_000,
  min_amount_paise: 100,
  max_amount_paise: 10_000_000,
  payment_session_minutes: 15,
  suggested_amounts: [51, 101, 251, 501, 1001, 2100],
  thank_you_title: 'Thank you for backing civic action',
  thank_you_message: 'Your support helps us keep improving LokPravaah for the community.',
  gateway_portal_url: null,
  gateway_api_url: null,
  gateway_merchant_key: null,
}
const envGatewayPortalUrl = (import.meta.env.VITE_DONATION_GATEWAY_PORTAL_URL as string | undefined)?.trim().replace(/\/+$/, '') ?? ''
const envGatewayApiUrl = (import.meta.env.VITE_DONATION_GATEWAY_API_URL as string | undefined)?.trim().replace(/\/+$/, '') ?? ''
const envMerchantKey = (import.meta.env.VITE_DONATION_MERCHANT_KEY as string | undefined)?.trim() ?? ''

function makeOrderId(): string {
  const random = typeof window !== 'undefined' && window.crypto?.randomUUID
    ? window.crypto.randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase()
    : Math.random().toString(36).slice(2, 18).toUpperCase()
  return `LPDON-${Date.now().toString(36).toUpperCase()}-${random}`
}
function money(paise: number): string {
  return (Math.max(0, Number(paise) || 0) / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 })
}
function niceDate(value?: string): string {
  if (!value) return 'Just now'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Recently'
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}
function amountLabel(paise: number): string { return money(paise) }

const DONATION_ATTEMPTS_KEY = 'lokpravaah.donationAttempts.v1'
function readDonationAttempts(): DonationAttempt[] {
  try {
    const raw = window.sessionStorage.getItem(DONATION_ATTEMPTS_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
    return parsed.filter((item): item is DonationAttempt => item && typeof item.orderId === 'string' && /^LPDON-[A-Z0-9-]{8,80}$/.test(item.orderId) && Number.isSafeInteger(item.amountPaise) && item.amountPaise >= 100 && typeof item.status === 'string' && Number.isFinite(item.createdAt) && item.createdAt >= cutoff).slice(-5)
  } catch { return [] }
}


export default function DonationPage({ userId = null, userName = '' }: Props) {
  const [settings, setSettings] = useState<DonationSettings>(DEFAULT_SETTINGS)
  const [publicData, setPublicData] = useState<DonationPublicData | null>(null)
  const [feedLoading, setFeedLoading] = useState(true)
  const [feedError, setFeedError] = useState('')
  const [amountText, setAmountText] = useState('251')
  const [selectedPreset, setSelectedPreset] = useState<number | null>(251)
  const [donorName, setDonorName] = useState(userName)
  const [donorEmail, setDonorEmail] = useState('')
  const [anonymous, setAnonymous] = useState(false)
  const [showOnLeaderboard, setShowOnLeaderboard] = useState(false)
  const [showMessagePublicly, setShowMessagePublicly] = useState(false)
  const [message, setMessage] = useState('')
  const [gatewayState, setGatewayState] = useState<GatewayState>('loading')
  const [launching, setLaunching] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'info' | 'success' | 'warning' | 'error'; title: string; body: string } | null>(null)
  const [lastOrderId, setLastOrderId] = useState('')
  const [donationAttempts, setDonationAttempts] = useState<DonationAttempt[]>(() => readDonationAttempts())
  const intentCreatedRef = useRef(false)

  const parsedAmount = useMemo(() => {
    if (!amountText.trim() || !/^\d+(?:\.\d{0,2})?$/.test(amountText.trim())) return null
    const value = Number(amountText)
    if (!Number.isFinite(value)) return null
    return Math.round(value * 100)
  }, [amountText])
  const amountValid = parsedAmount !== null && parsedAmount >= settings.min_amount_paise && parsedAmount <= settings.max_amount_paise
  const gatewayPortalUrl = (settings.gateway_portal_url?.trim() || envGatewayPortalUrl).replace(/\/+$/, '')
  const gatewayApiUrl = (settings.gateway_api_url?.trim() || envGatewayApiUrl || gatewayPortalUrl).replace(/\/+$/, '')
  const merchantKey = settings.gateway_merchant_key?.trim() || envMerchantKey
  const gatewayConfigured = Boolean(gatewayPortalUrl && gatewayApiUrl && merchantKey)
  const paymentReady = gatewayState === 'ready' && isSupabaseConfigured && Boolean(supabase) && settings.donations_enabled && settings.payment_gateway_enabled && gatewayConfigured
  const goalPercent = settings.campaign_goal_paise > 0 && publicData ? Math.min(100, Math.round(publicData.total_raised_paise / settings.campaign_goal_paise * 100)) : 0

  const loadPublicData = useCallback(async () => {
    if (!supabase || !isSupabaseConfigured) {
      setFeedLoading(false)
      setFeedError('Connect Supabase and apply the donation migration to show verified public activity.')
      return
    }
    try {
      const { data, error } = await supabase.rpc('janwatch_get_public_donation_data')
      if (error) throw error
      const payload = data as Partial<DonationPublicData> | null
      if (!payload?.settings) throw new Error('Donation settings are not available yet.')
      const mergedSettings = { ...DEFAULT_SETTINGS, ...payload.settings, suggested_amounts: Array.isArray(payload.settings.suggested_amounts) ? payload.settings.suggested_amounts.filter((v): v is number => Number.isInteger(v) && v > 0).slice(0, 8) : DEFAULT_SETTINGS.suggested_amounts }
      setSettings(mergedSettings)
      setPublicData({ settings: mergedSettings, total_raised_paise: Number(payload.total_raised_paise || 0), successful_donations: Number(payload.successful_donations || 0), top_donors: Array.isArray(payload.top_donors) ? payload.top_donors : [], recent_donations: Array.isArray(payload.recent_donations) ? payload.recent_donations : [], refreshed_at: payload.refreshed_at })
      setFeedError('')
    } catch (error) {
      setFeedError(error instanceof Error ? error.message : 'Live donation activity is temporarily unavailable.')
    } finally { setFeedLoading(false) }
  }, [])

  useEffect(() => {
    void loadPublicData()
    const interval = window.setInterval(() => void loadPublicData(), 30_000)
    const onFocus = () => void loadPublicData()
    window.addEventListener('focus', onFocus)
    return () => { window.clearInterval(interval); window.removeEventListener('focus', onFocus) }
  }, [loadPublicData])

  useEffect(() => {
    try { window.sessionStorage.setItem(DONATION_ATTEMPTS_KEY, JSON.stringify(donationAttempts.slice(-5))) } catch { /* session storage may be disabled */ }
  }, [donationAttempts])

  function trackAttempt(orderId: string, amountPaise: number, status: string) {
    setDonationAttempts(current => {
      const existing = current.find(item => item.orderId === orderId)
      const nextAttempt: DonationAttempt = { orderId, amountPaise, status, createdAt: existing?.createdAt ?? Date.now() }
      return [...current.filter(item => item.orderId !== orderId), nextAttempt].slice(-5)
    })
  }

  useEffect(() => { if (userName && !donorName) setDonorName(userName) }, [userName, donorName])
  useEffect(() => {
    if (feedLoading) return
    if (!gatewayConfigured) { setGatewayState('not-configured'); return }
    if (!/^https:\/\//i.test(gatewayPortalUrl) || !/^https:\/\//i.test(gatewayApiUrl)) { setGatewayState('error'); return }
    if (window.Youpi?.pay) { setGatewayState('ready'); return }
    let disposed = false
    const selector = 'script[data-lokpravaah-donation-sdk="true"]'
    let script = document.querySelector<HTMLScriptElement>(selector)
    const onLoad = () => { if (!disposed) setGatewayState(window.Youpi?.pay ? 'ready' : 'error') }
    const onError = () => { if (!disposed) setGatewayState('error') }
    if (script) {
      script.addEventListener('load', onLoad); script.addEventListener('error', onError)
      if (window.Youpi?.pay) setGatewayState('ready')
    } else {
      script = document.createElement('script')
      script.src = `${gatewayPortalUrl}/youpi.js`
      script.async = true
      script.dataset.lokpravaahDonationSdk = 'true'
      script.dataset.youpiKey = merchantKey
      script.dataset.apiUrl = gatewayApiUrl
      script.dataset.portalUrl = gatewayPortalUrl
      script.dataset.currency = 'INR'
      script.dataset.name = 'LokPravaah'
      script.dataset.themeColor = '#55d8a1'
      script.addEventListener('load', onLoad); script.addEventListener('error', onError)
      document.head.appendChild(script)
    }
    return () => { disposed = true; script?.removeEventListener('load', onLoad); script?.removeEventListener('error', onError) }
  }, [feedLoading, gatewayConfigured, gatewayPortalUrl, gatewayApiUrl, merchantKey])

  function selectPreset(value: number) { setSelectedPreset(value); setAmountText(String(value)); setNotice(null) }

  async function startDonation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setNotice(null)
    if (!amountValid || parsedAmount === null) {
      setNotice({ tone: 'error', title: 'Check the amount', body: `Enter an amount from ${money(settings.min_amount_paise)} to ${money(settings.max_amount_paise)}, with up to two decimal places.` }); return
    }
    if (!settings.donations_enabled) { setNotice({ tone: 'warning', title: 'Donations are temporarily paused', body: 'The LokPravaah team has paused new contributions. Please check back later.' }); return }
    if (!settings.payment_gateway_enabled) { setNotice({ tone: 'warning', title: 'Online payments are temporarily paused', body: 'The payment service is temporarily unavailable. Please try again later.' }); return }
    if (!gatewayConfigured || gatewayState !== 'ready' || !window.Youpi?.pay) {
      setNotice({ tone: 'warning', title: 'UPI checkout is not connected yet', body: 'The website page is available, but the administrator still needs to deploy/configure the LokPravaah payment service and public merchant settings.' }); return
    }
    if (!supabase || !isSupabaseConfigured) { setNotice({ tone: 'error', title: 'Donation records are unavailable', body: 'The database is not configured, so checkout has been stopped before any payment session was created.' }); return }
    if (donorEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(donorEmail.trim())) { setNotice({ tone: 'error', title: 'Check the email address', body: 'Enter a valid email address or leave the field blank.' }); return }

    setLaunching(true)
    intentCreatedRef.current = false
    const orderId = makeOrderId(); setLastOrderId(orderId)
    try {
      // Detect misrouted/stale gateway configuration before creating a pending intent.
      // Health is only a configuration check; it is not treated as payment confirmation.
      const healthResponse = await fetch(`${gatewayApiUrl}/health`, { method: 'GET', cache: 'no-store', headers: { Accept: 'application/json' } })
      const healthText = await healthResponse.text()
      type HealthPayload = { status?: string; error?: string; diagnostics?: { missing?: string[]; databaseError?: string | null; settingsError?: string | null; note?: string } }
      let healthPayload: HealthPayload = {}
      try { healthPayload = JSON.parse(healthText) as HealthPayload } catch { /* report an actionable endpoint error below */ }
      if (!healthResponse.ok || healthPayload.status !== 'UP') {
        const diagnosticParts = [
          ...(healthPayload.diagnostics?.missing?.length ? [`Missing Worker settings: ${healthPayload.diagnostics.missing.join('; ')}`] : []),
          ...(healthPayload.diagnostics?.databaseError ? [`Database: ${healthPayload.diagnostics.databaseError}`] : []),
          ...(healthPayload.diagnostics?.settingsError ? [`Donation settings: ${healthPayload.diagnostics.settingsError}`] : []),
          ...(healthPayload.diagnostics?.note ? [healthPayload.diagnostics.note] : []),
        ]
        const detail = diagnosticParts.join('. ') || healthPayload.error || (healthText && !healthText.trimStart().startsWith('<') ? healthText.slice(0, 180) : 'The endpoint did not return the gateway health JSON.')
        throw new Error(`Payment gateway health check failed (HTTP ${healthResponse.status}) at ${gatewayApiUrl}/health. ${detail} Confirm Admin → Donations & UPI uses the active Worker URL and that its /health route returns status UP.`)
      }
      const { error } = await supabase.from('donation_intents').insert({
        order_id: orderId, donor_user_id: anonymous ? null : userId, amount_paise: parsedAmount, currency: 'INR',
        donor_name: anonymous ? null : (donorName.trim().slice(0, 80) || null), donor_email: anonymous ? null : (donorEmail.trim().slice(0, 254) || null),
        is_anonymous: anonymous, show_on_leaderboard: !anonymous && showOnLeaderboard, show_message_publicly: !anonymous && showOnLeaderboard && showMessagePublicly && Boolean(message.trim()), message: message.trim().slice(0, 300) || null, status: 'pending',
      })
      if (error) throw new Error(`Could not create a donation record: ${error.message}`)
      intentCreatedRef.current = true
      trackAttempt(orderId, parsedAmount, 'checkout_opening')
      setNotice({ tone: 'info', title: 'Opening secure UPI checkout…', body: `Reference: ${orderId}. The contribution will appear in the live totals after the server verifies it.` })
      await window.Youpi.pay({
        key: merchantKey, order_id: orderId, amount: Number((parsedAmount / 100).toFixed(2)), currency: 'INR', name: 'LokPravaah',
        description: 'Voluntary contribution to support LokPravaah development and operating costs',
        customer: anonymous ? undefined : { name: donorName.trim().slice(0, 80), email: donorEmail.trim().slice(0, 254) },
        metadata: { purpose: 'lokpravaah_donation', order_id: orderId, amount_paise: parsedAmount }, portalUrl: gatewayPortalUrl, apiUrl: gatewayApiUrl, theme: { color: '#55d8a1' },
        handler: () => {
          trackAttempt(orderId, parsedAmount, 'pending_confirmation')
          setNotice({ tone: 'info', title: 'Payment is being verified', body: `Checkout returned a result for ${orderId}. This does not prove that money arrived. Wait for server verification or submit payment proof below if your bank shows a debit.` })
          setLaunching(false); void loadPublicData()
        },
        onSuccess: () => {
          trackAttempt(orderId, parsedAmount, 'pending_confirmation')
          setNotice({ tone: 'info', title: 'Payment is being verified', body: `Reference ${orderId} is awaiting verified confirmation. The browser callback is not proof of payment. If the bank shows a debit and this remains pending, submit payment proof below.` })
          setLaunching(false); window.setTimeout(() => void loadPublicData(), 3500)
        },
        onFailed: result => { trackAttempt(orderId, parsedAmount, 'failed'); setNotice({ tone: 'error', title: 'Payment was not confirmed', body: `${result.reason || result.error || 'The checkout could not confirm this payment.'} If your bank shows a debit, upload the payment screenshot below and wait for a manual review. Avoid paying again until you check the bank status.` }); setLaunching(false) },
        onSuspicious: () => { trackAttempt(orderId, parsedAmount, 'suspicious'); setNotice({ tone: 'warning', title: 'Payment needs review', body: `Reference ${orderId} has been flagged for review. Do not repeat payment until its status has been checked. You can submit a screenshot below if your bank shows a debit.` }); setLaunching(false) },
        onExpired: () => { trackAttempt(orderId, parsedAmount, 'expired'); setNotice({ tone: 'warning', title: 'Checkout session expired', body: `Reference ${orderId} expired before confirmation. If you already paid and your bank shows a debit, upload proof below instead of paying again.` }); setLaunching(false) },
        onCancelled: () => { trackAttempt(orderId, parsedAmount, 'cancelled'); setNotice({ tone: 'info', title: 'Checkout cancelled', body: `Reference ${orderId} was cancelled in checkout. If you approved a transfer in your UPI app and your bank shows a debit, submit proof below.` }); setLaunching(false) },
        onClose: () => setLaunching(false),
      })
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown checkout initialization error.'
      if (intentCreatedRef.current) trackAttempt(orderId, parsedAmount, 'failed')
      setNotice(current => current?.title === 'Payment was not confirmed'
        ? current
        : { tone: 'error', title: 'Could not start UPI checkout', body: `${detail} Reference: ${orderId}. If this repeats, open Admin → Donations & UPI and use the active HTTPS Worker URL for both checkout portal and payment API. No bank debit should be inferred from this message.` })
      setLaunching(false)
    }
  }

  const topThree = publicData?.top_donors.slice(0, 3) ?? []
  const remainingLeaders = publicData?.top_donors.slice(3) ?? []

  return <div className="donation-page">
    <section className="donation-hero">
      <div className="donation-orb donation-orb-one" aria-hidden="true"/><div className="donation-orb donation-orb-two" aria-hidden="true"/>
      <div className="donation-hero-copy">
        <div className="donation-eyebrow"><span className="donation-eyebrow-dot"/> COMMUNITY-SUPPORTED DEVELOPMENT</div>
        <h1>{settings.campaign_title || 'Help keep civic action'} <em>within reach.</em></h1>
        <p>{settings.campaign_description}</p>
        <div className="donation-hero-points"><span><ShieldCheck size={15}/> Independent civic-tech project</span><span><Heart size={15}/> Every contribution is voluntary</span></div>
      </div>
      <div className="donation-hero-art" aria-hidden="true"><div className="donation-art-ring ring-a"/><div className="donation-art-ring ring-b"/><div className="donation-art-center"><HandHeart size={45}/></div><span className="donation-art-spark spark-a">✦</span><span className="donation-art-spark spark-b">✳</span><div className="donation-art-tag tag-a"><Heart size={14}/> Your support matters</div><div className="donation-art-tag tag-b"><Sparkles size={14}/> Built for the community</div></div>
    </section>

    <section className="donation-impact-strip" aria-label="Live donation impact">
      {settings.show_public_total && <article><span><HandHeart size={17}/></span><div><small>Verified funds raised</small><strong>{feedLoading ? '…' : money(publicData?.total_raised_paise ?? 0)}</strong></div></article>}
      <article><span><Users size={17}/></span><div><small>Verified contributions</small><strong>{feedLoading ? '…' : (publicData?.successful_donations ?? 0).toLocaleString('en-IN')}</strong></div></article>
      {settings.show_goal_progress && <article><span><Target size={17}/></span><div><small>Campaign target</small><strong>{money(settings.campaign_goal_paise)}</strong></div></article>}
      <article className="donation-live-indicator"><span className="donation-live-dot"/><div><small>Live board</small><strong>{feedError ? 'Connecting' : 'Auto-refreshes'}</strong></div></article>
    </section>

    {settings.show_goal_progress && <section className="donation-progress-card"><div className="donation-progress-heading"><div><span className="donation-section-kicker">COMMUNITY MILESTONE</span><h2>{Math.min(100, goalPercent)}% of the target reached</h2></div><b>{money(publicData?.total_raised_paise ?? 0)} <span>of {money(settings.campaign_goal_paise)}</span></b></div><div className="donation-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={goalPercent} aria-label="Campaign goal progress"><span style={{ width: `${goalPercent}%` }}/></div><div className="donation-progress-footer"><span>{(publicData?.successful_donations ?? 0).toLocaleString('en-IN')} verified contributions</span><span>{money(Math.max(0, settings.campaign_goal_paise - (publicData?.total_raised_paise ?? 0)))} to go</span></div></section>}

    <div className="donation-layout">
      <section className="donation-form-card">
        <div className="donation-card-header"><div className="donation-icon"><Wallet size={20}/></div><div><span className="donation-section-kicker">MAKE A CONTRIBUTION</span><h2>Choose your amount</h2><p>UPI checkout · One-time contribution · INR</p></div></div>
        {!settings.donations_enabled && <div className="donation-inline-warning"><CircleAlert size={16}/><span>Donations are temporarily paused by the LokPravaah administrators.</span></div>}
        <form onSubmit={startDonation}>
          <div className="donation-presets" aria-label="Suggested amounts">{settings.suggested_amounts.map(value => <button type="button" key={value} className={`donation-preset ${selectedPreset === value ? 'selected' : ''}`} onClick={() => selectPreset(value)}>{amountLabel(value * 100)}{value === settings.suggested_amounts[0] && <small>Start here</small>}</button>)}</div>
          <label className="donation-field"><span>Custom amount (₹)</span><div className="donation-amount-input"><span>₹</span><input type="number" inputMode="decimal" min={settings.min_amount_paise / 100} max={settings.max_amount_paise / 100} step="0.01" value={amountText} onChange={e => { setAmountText(e.target.value); setSelectedPreset(settings.suggested_amounts.find(v => String(v) === e.target.value) ?? null); setNotice(null) }} aria-describedby="donation-amount-help" required/><span className="donation-inr-pill">INR</span></div><small id="donation-amount-help">Minimum {money(settings.min_amount_paise)} · Maximum {money(settings.max_amount_paise)} · up to 2 decimals</small></label>
          <div className="donation-field-grid"><label className="donation-field"><span>Name <small>(optional)</small></span><input type="text" maxLength={80} value={donorName} onChange={e => setDonorName(e.target.value)} disabled={anonymous} placeholder="Your name" autoComplete="name"/></label><label className="donation-field"><span>Email <small>(optional)</small></span><input type="email" maxLength={254} value={donorEmail} onChange={e => setDonorEmail(e.target.value)} disabled={anonymous} placeholder="you@example.com" autoComplete="email"/></label></div>
          <label className="donation-anonymous"><input type="checkbox" checked={anonymous} onChange={e => setAnonymous(e.target.checked)}/><span><b>Keep my contribution anonymous</b><small>Your name and email will not be attached to this donation record or shown publicly.</small></span></label>
          <label className="donation-anonymous"><input type="checkbox" checked={showOnLeaderboard && !anonymous} disabled={anonymous} onChange={e => setShowOnLeaderboard(e.target.checked)}/><span><b>Include me on the supporter leaderboard</b><small>Only your display name and verified contribution total are public. Your message is private unless you separately opt in. Email, UPI details and payment references are never shown.</small></span></label>
          <label className="donation-field"><span>Message <small>(optional)</small></span><textarea rows={2} maxLength={300} value={message} onChange={e => setMessage(e.target.value)} placeholder="Leave a note of support (max 300 characters)"/></label>
          <label className="donation-anonymous"><input type="checkbox" checked={showMessagePublicly && !anonymous && showOnLeaderboard} disabled={anonymous || !showOnLeaderboard || !message.trim()} onChange={e => setShowMessagePublicly(e.target.checked)}/><span><b>Show my message in public activity</b><small>Your message is private by default. This is separate from showing your name on the leaderboard.</small></span></label>
          <div className="donation-summary"><span>Your one-time contribution</span><strong>{amountValid && parsedAmount !== null ? money(parsedAmount) : '—'}</strong></div>
          <div className="donation-session-info"><Clock3 size={14}/> Payment session lasts up to {Math.max(5, Math.min(30, Number(settings.payment_session_minutes) || 15))} minutes. The on-screen countdown starts when secure checkout opens.</div>
          <button className="donation-submit" type="submit" disabled={!paymentReady || !amountValid || launching}>{launching ? <><LoaderCircle size={17} className="donation-spin"/> Preparing checkout…</> : <><Heart size={17}/> Donate {amountValid && parsedAmount !== null ? money(parsedAmount) : 'now'} <ArrowRight size={16}/></>}</button>
          {!isSupabaseConfigured && <div className="donation-inline-warning"><CircleAlert size={16}/><span>Supabase is not configured. Donation history and verified totals are unavailable until the database is enabled.</span></div>}
          {gatewayState === 'not-configured' && <div className="donation-inline-warning"><CircleAlert size={16}/><span>The donation page is live, but UPI checkout must be connected in hosting settings before payments can be accepted.</span></div>}
          {gatewayState === 'loading' && <div className="donation-gateway-state"><LoaderCircle size={15} className="donation-spin"/> Connecting to UPI checkout…</div>}
          {gatewayState === 'error' && <div className="donation-inline-warning"><CircleAlert size={16}/><span>The UPI checkout SDK could not be loaded. Check the gateway service URL and its availability.</span></div>}
          {!feedLoading && feedError && <div className="donation-inline-warning"><CircleAlert size={16}/><span>Live activity is unavailable. Apply the donation SQL migration, then refresh this page.</span></div>}
          {notice && <div className={`donation-notice notice-${notice.tone}`} role="status"><div className="donation-notice-icon">{notice.tone === 'success' ? <CircleCheck size={19}/> : notice.tone === 'error' || notice.tone === 'warning' ? <CircleAlert size={19}/> : <BadgeCheck size={19}/>}</div><div><b>{notice.title}</b><p>{notice.body}</p>{lastOrderId && <code>Reference: {lastOrderId}</code>}</div></div>}
        </form>
        {donationAttempts.length > 0 && <section className="donation-recovery-list" aria-label="Recent donation payment attempts"><h3>Payment confirmation help</h3><p>Saved in this browser tab so you can recover the references after a refresh. Upload evidence only if your bank shows a debit or a real completed UPI transfer.</p>{donationAttempts.slice().reverse().map(attempt => <DonationPaymentClaim key={attempt.orderId} orderId={attempt.orderId} amountPaise={attempt.amountPaise} initialStatus={attempt.status} defaultOpen={['failed','expired','cancelled','suspicious','pending_confirmation','claim_submitted'].includes(attempt.status)} onSubmitted={() => trackAttempt(attempt.orderId, attempt.amountPaise, 'claim_submitted')} />)}</section>}
        <div className="donation-security-note"><LockKeyhole size={15}/><span>Payments appear in public totals only after the gateway's signed server webhook verifies the amount and order. Do not share your UPI PIN or OTP.</span></div>
      </section>

      <aside className="donation-info-column">
        {settings.leaderboard_enabled && <section className="donation-info-card donation-leaderboard-card"><div className="donation-panel-heading"><div><div className="donation-info-icon"><Trophy size={19}/></div><h3>Community champions</h3><p>Top verified supporters by total contribution.</p></div><span className="donation-live-pill"><i/> LIVE</span></div>
          {feedLoading ? <div className="donation-feed-empty"><LoaderCircle size={17} className="donation-spin"/> Loading supporters…</div> : topThree.length ? <><div className="donation-podium">{topThree.map((donor, index) => <article className={`donation-podium-item podium-${donor.rank}`} key={`${donor.rank}-${donor.donor_name}`}><div className="donation-podium-icon">{donor.rank === 1 ? <Crown size={21}/> : donor.rank === 2 ? <Medal size={20}/> : <Award size={20}/>}</div><span className="donation-podium-rank">#{donor.rank}</span><b title={donor.donor_name}>{donor.donor_name}</b><strong>{money(donor.total_paise)}</strong><small>{donor.donations_count} {donor.donations_count === 1 ? 'contribution' : 'contributions'}</small></article>)}</div>
          {remainingLeaders.length > 0 && <div className="donation-leaderboard-list">{remainingLeaders.map(donor => <article key={`${donor.rank}-${donor.donor_name}`}><span className="donation-rank-number">{donor.rank}</span><span className="donation-leader-name">{donor.donor_name}<small>{donor.donations_count} contributions</small></span><b>{money(donor.total_paise)}</b></article>)}</div>}</> : <div className="donation-feed-empty"><HeartHandshake size={23}/><b>Be a founding supporter</b><span>Make the first verified contribution and appear among the community champions (with leaderboard visibility enabled).</span></div>}
          <p className="donation-live-note"><RefreshCw size={12}/> Automatically refreshes every 30 seconds.</p>
        </section>}
        {settings.show_recent_donations && <section className="donation-info-card donation-recent-card"><div className="donation-info-icon"><Clock3 size={19}/></div><h3>Recent contributions</h3><p>Verified donations from the community.</p>{feedLoading ? <div className="donation-feed-empty"><LoaderCircle size={16} className="donation-spin"/> Loading activity…</div> : publicData?.recent_donations.length ? <div className="donation-recent-list">{publicData.recent_donations.map((item, index) => <article key={`${item.verified_at}-${index}`}><span className="donation-recent-avatar"><Heart size={14}/></span><span className="donation-recent-who"><b>{item.display_name}</b><small>{niceDate(item.verified_at)}{item.message ? ` · “${item.message}”` : ''}</small></span><strong>{money(item.amount_paise)}</strong></article>)}</div> : <div className="donation-feed-empty"><Heart size={21}/><span>Verified contributions will appear here as they arrive.</span></div>}</section>}
        <section className="donation-info-card"><div className="donation-info-icon"><Sparkles size={19}/></div><h3>What your support helps with</h3><div className="donation-use-row"><span>01</span><div><b>Keep the service available</b><p>Hosting, infrastructure and routine maintenance.</p></div></div><div className="donation-use-row"><span>02</span><div><b>Make the platform easier to use</b><p>Accessibility, usability improvements and language support.</p></div></div><div className="donation-use-row"><span>03</span><div><b>Keep improving civic tools</b><p>Responsible development, moderation and platform reliability.</p></div></div></section>
        <section className="donation-info-card donation-transparency"><div className="donation-info-icon"><ShieldCheck size={19}/></div><h3>Transparent by design</h3><p>Contributions are voluntary and do not guarantee a particular report outcome or government response. LokPravaah is an independent civic-tech project, not a government portal.</p><div className="donation-transparency-foot"><BadgeCheck size={15}/><span>No tax-deduction promise is made. Keep your own bank/payment record.</span></div></section>
      </aside>
    </div>
    <div className="donation-thanks-strip"><HeartHandshake size={22}/><div><b>Every contribution helps build shared civic infrastructure.</b><span>{settings.thank_you_message}</span></div><a href="#donate-top" onClick={e => { e.preventDefault(); document.querySelector('.donation-form-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}>Support the project <ArrowRight size={15}/></a></div>
    <p className="donation-footer-note">Please donate only through the checkout opened from this page. No person from LokPravaah will ask for a UPI PIN, password or OTP.</p>
  </div>
}
