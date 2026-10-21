import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  ArrowRight, Award, BadgeCheck, CircleAlert, CircleCheck, Clock3, Crown, HandHeart,
  Heart, HeartHandshake, LoaderCircle, LockKeyhole, Medal, RefreshCw, ShieldCheck,
  Sparkles, Target, Ticket, Trophy, Users, Wallet, Upload,
} from 'lucide-react'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import './DonationPage.css'

type CheckoutResult = {
  status?: string
  order_id?: string
  amount_received?: number | string
  utr?: string
  paymentId?: string
  reason?: string
  error?: string
  payment_timestamp?: string | null
  user_note?: string
  evidenceFile?: File
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
  paymentId?: string
  checkoutUrl?: string
  theme: { color: string }
  successUrl?: string
  handler: (result: CheckoutResult) => void
  onSuccess?: (result: CheckoutResult) => void
  onFailed?: (result: CheckoutResult) => void
  onSuspicious?: (result: CheckoutResult) => void
  onExpired?: (result: CheckoutResult) => void
  onCancelled?: (result: CheckoutResult) => void
  onManualPaymentRequest?: (result: CheckoutResult) => void | Promise<{ success: boolean; message: string } | void>
  onClose?: () => void
}
type CheckoutHandle = { options?: { paymentId?: string; checkoutUrl?: string } }
type ManualClaimStatus = 'pending_review' | 'confirmed' | 'rejected'
type ActiveDonation = {
  orderId: string
  paymentId: string
  amountPaise: number
  status: string
  upiUri?: string
  upiVpa?: string
  payeeName?: string
  checkoutMethod?: 'gateway' | 'upi_qr'
  claimStatus?: ManualClaimStatus
  claimedUtr?: string
  adminReviewNote?: string | null
}
type ProofNotice = { tone: 'info' | 'success' | 'error'; title: string; body: string }
type MyDonationRow = {
  id: string; order_id: string; amount_paise: number; currency: string; status: string; is_anonymous: boolean
  donor_name?: string | null; record_source?: string | null; utr?: string | null; created_at: string; verified_at?: string | null
  claim_status?: ManualClaimStatus | null; claimed_utr?: string | null; claimed_amount_paise?: number | null
  payment_timestamp?: string | null; admin_review_note?: string | null; reviewed_at?: string | null
  ticket_number?: number | null; ticket_status?: string | null
}
declare global {
  interface Window {
    Youpi?: { pay: (options: CheckoutOptions) => Promise<CheckoutHandle> }
    QRCode?: new (element: HTMLElement, options: { text: string; width: number; height: number; colorDark?: string; colorLight?: string }) => unknown
  }
}

type Props = { userId?: string | null; userName?: string; onOpenSupportTickets?: () => void }
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
  suggested_amounts: number[]
  thank_you_title: string
  thank_you_message: string
  gateway_portal_url: string | null
  gateway_api_url: string | null
  gateway_merchant_key: string | null
}
type Donor = { rank: number; donor_name: string; total_paise: number; donations_count: number }
type RecentDonation = { display_name: string; amount_paise: number; verified_at: string; message?: string | null }
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

/** UPI transaction references must be numeric and no longer than 35 characters.
 * Keep a stable numeric reference derived from the random order suffix so it can
 * be matched to the internal donation order without sending an invalid LPDON-... value.
 */
function makeUpiTransactionRef(orderId: string): string {
  const suffix = orderId.replace(/-/g, '').slice(-16)
  if (/^[a-f0-9]{16}$/i.test(suffix)) return BigInt('0x' + suffix).toString()
  const digits = orderId.replace(/\D/g, '').slice(-35)
  return digits || String(Date.now())
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

const activeDonationStorageKey = (userId: string) => `lokpravaah.activeDonation.${userId}`
function readSavedDonation(userId?: string | null): ActiveDonation | null {
  if (!userId || typeof window === 'undefined') return null
  try {
    const value = JSON.parse(window.localStorage.getItem(activeDonationStorageKey(userId)) || 'null') as ActiveDonation | null
    if (!value || typeof value.orderId !== 'string' || typeof value.paymentId !== 'string' || !Number.isFinite(Number(value.amountPaise))) return null
    const storedStatus = String(value.status || 'ACTIVE').toUpperCase()
    // A previous UI callback could mark the local session successful. Never trust local storage as payment evidence.
    return { ...value, amountPaise: Number(value.amountPaise), status: storedStatus === 'SUCCESS' ? 'PENDING_REVIEW' : storedStatus }
  } catch { return null }
}
function evidenceFileName(name: string): string {
  return name.normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-100) || 'payment-proof'
}
const TERMINAL_PAYMENT_STATUSES = new Set(['SUCCESS', 'SUSPICIOUS', 'EXPIRED', 'FAILED', 'CANCELLED'])

export default function DonationPage({ userId = null, userName = '', onOpenSupportTickets }: Props) {
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
  const [upiVpa, setUpiVpa] = useState('')
  const [upiPayeeName, setUpiPayeeName] = useState('LokPravaah')
  const upiQrRef = useRef<HTMLDivElement>(null)
  const [launching, setLaunching] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'info' | 'success' | 'warning' | 'error'; title: string; body: string } | null>(null)
  const [lastOrderId, setLastOrderId] = useState('')
  const [activeDonation, setActiveDonation] = useState<ActiveDonation | null>(() => readSavedDonation(userId))
  const activeDonationOwnerRef = useRef<string | null>(userId)
  // Ignore donation-history responses started under a previous signed-in account.
  const currentUserIdRef = useRef(userId)
  currentUserIdRef.current = userId
  const skipNextDonationPersistRef = useRef(false)
  const [proofOpen, setProofOpen] = useState(false)
  const [proofUtr, setProofUtr] = useState('')
  const [proofAmountText, setProofAmountText] = useState('')
  const [proofTime, setProofTime] = useState('')
  const [proofNote, setProofNote] = useState('PhonePe did not automatically confirm my payment.')
  const [proofFile, setProofFile] = useState<File | null>(null)
  const [proofBusy, setProofBusy] = useState(false)
  const [proofNotice, setProofNotice] = useState<ProofNotice | null>(null)
  const [proofSubmission, setProofSubmission] = useState<{ orderId: string; amountPaise: number; submittedAt: string } | null>(null)
  const manualProofSubmittedRef = useRef(false)
  const [myDonations, setMyDonations] = useState<MyDonationRow[]>([])
  // Prevent the previous account's history from rendering during auth transitions.
  const [myDonationsOwner, setMyDonationsOwner] = useState<string | null>(null)
  const [myDonationsLoading, setMyDonationsLoading] = useState(false)
  const [myDonationsError, setMyDonationsError] = useState('')
  const [donationHistoryFilter, setDonationHistoryFilter] = useState<'all' | 'pending' | 'successful'>('all')
  const [ticketDraftId, setTicketDraftId] = useState<string | null>(null)
  const [ticketSubject, setTicketSubject] = useState('Payment status clarification')
  const [ticketDescription, setTicketDescription] = useState('')
  const [ticketBusy, setTicketBusy] = useState(false)
  const [ticketNotice, setTicketNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)

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
  const paymentReady = isSupabaseConfigured && Boolean(supabase) && settings.donations_enabled && settings.payment_gateway_enabled &&
    ((gatewayState === 'ready' && gatewayConfigured && Boolean(window.Youpi?.pay)) || Boolean(upiVpa))
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
      try {
        const { data: checkoutConfig, error: checkoutConfigError } = await supabase.rpc('janwatch_get_public_donation_checkout_config')
        if (!checkoutConfigError && checkoutConfig && typeof checkoutConfig === 'object') {
          const config = checkoutConfig as { upi_vpa?: string | null; upi_payee_name?: string | null }
          setUpiVpa(String(config.upi_vpa || '').trim())
          setUpiPayeeName(String(config.upi_payee_name || 'LokPravaah').trim() || 'LokPravaah')
        }
      } catch { /* campaign totals remain available if the public UPI configuration is temporarily unavailable */ }
      setFeedError('')
    } catch (error) {
      setFeedError(error instanceof Error ? error.message : 'Live donation activity is temporarily unavailable.')
    } finally { setFeedLoading(false) }
  }, [])


  const loadMyDonations = useCallback(async () => {
    if (!supabase || !userId || !isSupabaseConfigured) {
      setMyDonations([])
      setMyDonationsOwner(null)
      setMyDonationsLoading(false)
      setMyDonationsError(userId ? 'Donation history is temporarily unavailable.' : 'Sign in to view your donation history.')
      return
    }
    setMyDonationsLoading(true)
    try {
      const { data, error } = await supabase.rpc('janwatch_get_my_donations')
      if (error) throw error
      // A request can finish after sign-out/account switching. Never let the previous
      // account's donation history or status update the currently visible account.
      if (currentUserIdRef.current !== userId) return
      const result = data as { donations?: MyDonationRow[] } | null
      const rows = Array.isArray(result?.donations) ? result!.donations! : []
      setMyDonations(rows)
      setMyDonationsOwner(userId)
      setActiveDonation(current => {
        if (!current) return current
        const row = rows.find(item => item.order_id === current.orderId)
        if (!row) return current
        if (row.status === 'succeeded' || row.claim_status === 'confirmed') {
          return { ...current, status: 'SUCCESS', claimStatus: row.claim_status || 'confirmed', claimedUtr: row.claimed_utr || current.claimedUtr, adminReviewNote: row.admin_review_note || null }
        }
        if (row.claim_status === 'pending_review') {
          return { ...current, status: 'PENDING_REVIEW', claimStatus: 'pending_review', claimedUtr: row.claimed_utr || current.claimedUtr, adminReviewNote: row.admin_review_note || null }
        }
        if (row.claim_status === 'rejected') {
          return { ...current, status: 'PENDING_REVIEW', claimStatus: 'rejected', claimedUtr: row.claimed_utr || current.claimedUtr, adminReviewNote: row.admin_review_note || null }
        }
        return current
      })
      setMyDonationsError('')
    } catch (caught) {
      if (currentUserIdRef.current === userId) {
        setMyDonationsError(caught instanceof Error ? caught.message : 'Could not load your donation history. Please refresh.')
      }
    } finally {
      if (currentUserIdRef.current === userId) setMyDonationsLoading(false)
    }
  }, [userId])

  useEffect(() => {
    void loadMyDonations()
    const interval = window.setInterval(() => void loadMyDonations(), 30_000)
    const onFocus = () => void loadMyDonations()
    const onVisibilityChange = () => { if (document.visibilityState === 'visible') void loadMyDonations() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [loadMyDonations])

  useEffect(() => {
    void loadPublicData()
    const interval = window.setInterval(() => void loadPublicData(), 15_000)
    const onFocus = () => void loadPublicData()
    const onVisibilityChange = () => { if (document.visibilityState === 'visible') void loadPublicData() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [loadPublicData])

  // Restore the matching user's pending checkout when auth finishes or the account changes.
  // Skip one persistence pass so the previous account's in-memory session is never written
  // into the newly authenticated account's storage key.
  useEffect(() => {
    if (activeDonationOwnerRef.current === userId) return
    activeDonationOwnerRef.current = userId
    skipNextDonationPersistRef.current = true
    // Hide old-account donation history immediately; the new account gets its own
    // history only after its authenticated RPC request resolves.
    setMyDonations([])
    setMyDonationsOwner(null)
    setMyDonationsError('')
    setActiveDonation(readSavedDonation(userId))
  }, [userId])

  // Persist the payment ID—not donor details—so the same session can be reopened.
  useEffect(() => {
    if (!userId) return
    if (skipNextDonationPersistRef.current) {
      skipNextDonationPersistRef.current = false
      return
    }
    if (activeDonationOwnerRef.current !== userId) return
    try {
      if (activeDonation) window.localStorage.setItem(activeDonationStorageKey(userId), JSON.stringify(activeDonation))
      else window.localStorage.removeItem(activeDonationStorageKey(userId))
    } catch { /* current session still works when storage is disabled */ }
  }, [activeDonation, userId])

  useEffect(() => {
    if (!supabase || !userId || !activeDonation?.orderId) return
    let cancelled = false
    void (async () => {
      const { data, error } = await supabase.rpc('janwatch_get_my_donation_claim_status', { p_order_id: activeDonation.orderId })
      if (cancelled || error) return
      const claim = data as { found?: boolean; status?: ManualClaimStatus; admin_review_note?: string | null } | null
      if (!claim?.found || !claim.status) return
      setActiveDonation(current => current?.orderId === activeDonation.orderId
        ? { ...current, claimStatus: claim.status, adminReviewNote: claim.admin_review_note ?? null, ...(claim.status === 'confirmed' ? { status: 'SUCCESS' } : {}) }
        : current)
      void loadMyDonations()
      if (claim.status === 'rejected') {
        setProofNotice({ tone: 'error', title: 'More information is needed', body: claim.admin_review_note || 'We could not verify this payment claim. Check the UTR and upload the correct receipt.' })
      }
    })()
    return () => { cancelled = true }
  }, [activeDonation?.orderId, userId, loadMyDonations])

  // Automatic gateway status polling is intentionally disabled. Donation status is authoritative only after admin bank-record review.


  useEffect(() => { if (userName && !donorName) setDonorName(userName) }, [userName, donorName])
  useEffect(() => {
    const target = upiQrRef.current
    if (!target || !activeDonation?.upiUri) return
    target.innerHTML = ''
    if (window.QRCode) {
      new window.QRCode(target, {
        text: activeDonation.upiUri,
        width: 232,
        height: 232,
        colorDark: '#06111f',
        colorLight: '#ffffff',
      })
    } else {
      target.textContent = 'QR display is unavailable in this browser. Use the Open UPI app link below.'
    }
    return () => { target.innerHTML = '' }
  }, [activeDonation?.upiUri])

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

  function openManualProofForm() {
    if (!activeDonation) return
    setProofUtr(activeDonation.claimedUtr || '')
    setProofAmountText((activeDonation.amountPaise / 100).toFixed(2))
    setProofNote('PhonePe did not automatically confirm my payment.')
    setProofTime('')
    setProofFile(null)
    setProofNotice(null)
    setProofOpen(true)
    window.setTimeout(() => document.getElementById('manual-payment-confirmation')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120)
  }

  function handlePaymentStatus(orderId: string, status: string) {
    const safeStatus = status === 'SUCCESS' ? 'PENDING_REVIEW' : status
    setActiveDonation(current => current?.orderId === orderId ? { ...current, status: safeStatus } : current)
    void loadMyDonations()
  }

  async function reopenActivePayment() {
    const session = activeDonation
    if (session?.upiUri) {
      document.getElementById('active-payment-checkout')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setProofNotice({ tone: 'info', title: 'Your UPI QR is ready', body: 'Scan this QR with your UPI app or tap Open UPI app. After your bank confirms the transfer, submit the UTR and receipt here.' })
      return
    }
    if (!session || !window.Youpi?.pay) {
      setProofNotice({ tone: 'error', title: 'Checkout is unavailable', body: 'The original reference is saved. You can still submit the UTR and receipt below for payment review.' })
      return
    }
    setLaunching(true)
    try {
      await window.Youpi.pay({
        key: merchantKey,
        order_id: session.orderId,
        paymentId: session.paymentId,
        checkoutUrl: `${gatewayPortalUrl}/checkout/${encodeURIComponent(session.paymentId)}`,
        amount: Number((session.amountPaise / 100).toFixed(2)),
        currency: 'INR',
        name: 'LokPravaah',
        description: 'Resume your existing LokPravaah donation payment session',
        portalUrl: gatewayPortalUrl,
        apiUrl: gatewayApiUrl,
        theme: { color: '#55d8a1' },
        metadata: { purpose: 'lokpravaah_donation', order_id: session.orderId, amount_paise: session.amountPaise },
        handler: () => { handlePaymentStatus(session.orderId, 'PENDING_REVIEW'); setLaunching(false); setNotice({ tone: 'warning', title: 'Awaiting bank-record review', body: 'Checkout reported a payment response. The donation is confirmed only after the receiving-bank record is verified.' }) },
        onSuccess: () => { handlePaymentStatus(session.orderId, 'PENDING_REVIEW'); setLaunching(false); setNotice({ tone: 'warning', title: 'Awaiting bank-record review', body: 'The donation is not marked successful until the bank record has been verified.' }); void loadPublicData(); void loadMyDonations() },
        onFailed: () => { handlePaymentStatus(session.orderId, 'FAILED'); setLaunching(false) },
        onSuspicious: () => { handlePaymentStatus(session.orderId, 'PENDING_REVIEW'); setLaunching(false) },
        onExpired: () => { handlePaymentStatus(session.orderId, 'EXPIRED'); setLaunching(false) },
        onCancelled: () => { handlePaymentStatus(session.orderId, 'CANCELLED'); setLaunching(false) },
        onManualPaymentRequest: result => submitManualPaymentFromModal(result, { orderId: session.orderId, amountPaise: session.amountPaise }),
        onClose: () => setLaunching(false),
      })
    } catch (error) {
      setLaunching(false)
      setProofNotice({ tone: 'error', title: 'Could not reopen the QR', body: error instanceof Error ? error.message : 'The original session could not be opened. Submit the UTR and receipt below if you have paid.' })
    }
  }

  async function submitManualPaymentProof(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const session = activeDonation
    if (!session || !supabase || !userId) {
      setProofNotice({ tone: 'error', title: 'Sign in required', body: 'Sign in to submit a private payment receipt for payment review.' })
      return
    }
    if (session.claimStatus === 'pending_review' || session.claimStatus === 'confirmed') {
      setProofNotice({ tone: 'info', title: 'Payment proof already submitted', body: session.claimStatus === 'confirmed' ? 'This donation has already been verified.' : 'Your proof is in the payment review. Please do not pay again.' })
      return
    }
    const utr = proofUtr.trim()
    if (!/^[A-Za-z0-9_-]{6,80}$/.test(utr)) {
      setProofNotice({ tone: 'error', title: 'Check the UTR', body: 'Enter the 6–80 character transaction ID / bank reference from your UPI receipt.' })
      return
    }
    if (!proofAmountText.trim() || !/^\d+(?:\.\d{1,2})?$/.test(proofAmountText.trim())) {
      setProofNotice({ tone: 'error', title: 'Check the amount paid', body: 'Enter the amount shown as paid in the UPI app or bank statement.' })
      return
    }
    const claimedAmountPaise = Math.round(Number(proofAmountText) * 100)
    if (!Number.isSafeInteger(claimedAmountPaise) || claimedAmountPaise < 100 || claimedAmountPaise > 10000000) {
      setProofNotice({ tone: 'error', title: 'Check the amount paid', body: 'The reported amount must be between ₹1 and ₹1,00,000.' })
      return
    }
    if (!proofFile) {
      setProofNotice({ tone: 'error', title: 'Payment screenshot required', body: 'Attach the UPI receipt or bank transaction screenshot so our team can compare it with the receiving account.' })
      return
    }
    if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(proofFile.type) || proofFile.size > 10 * 1024 * 1024) {
      setProofNotice({ tone: 'error', title: 'Unsupported receipt file', body: 'Use a JPG, PNG, WebP image or PDF up to 10 MB.' })
      return
    }
    if (proofNote.trim().length > 2000) {
      setProofNotice({ tone: 'error', title: 'Receipt note is too long', body: 'Keep your note under 2,000 characters.' })
      return
    }

    setProofBusy(true)
    setProofNotice({ tone: 'info', title: 'Submitting payment proof…', body: 'Your receipt is stored privately for review. This does not mark the donation paid automatically.' })
    let uploadedPath = ''
    try {
      uploadedPath = `${userId}/${session.orderId}-${Date.now()}-${evidenceFileName(proofFile.name)}`
      const { error: uploadError } = await supabase.storage.from('donation-payment-evidence').upload(uploadedPath, proofFile, {
        cacheControl: '3600', contentType: proofFile.type, upsert: false,
      })
      if (uploadError) throw uploadError
      const { data, error: submitError } = await supabase.rpc('janwatch_submit_manual_donation_claim', {
        p_order_id: session.orderId,
        p_screenshot_path: uploadedPath,
        p_claimed_utr: utr,
        p_claimed_amount_paise: claimedAmountPaise,
        p_payment_timestamp: proofTime ? new Date(proofTime).toISOString() : null,
        p_user_note: proofNote.trim() || null,
      })
      if (submitError) {
        await supabase.storage.from('donation-payment-evidence').remove([uploadedPath])
        throw submitError
      }
      const response = data as { status?: ManualClaimStatus; message?: string } | null
      setActiveDonation(current => current?.orderId === session.orderId
        ? { ...current, claimStatus: response?.status || 'pending_review', claimedUtr: utr, adminReviewNote: null }
        : current)
      setProofOpen(false)
      setProofFile(null)
      setProofNotice({ tone: 'success', title: 'Sent for payment review', body: 'Your screenshot and UTR were submitted privately. The donation total updates only after the UTR is verified against the receiving-bank statement. Do not pay again while this is being checked.' })
      setProofSubmission({ orderId: session.orderId, amountPaise: claimedAmountPaise, submittedAt: new Date().toISOString() })
      setNotice({ tone: 'info', title: 'Payment proof submitted', body: response?.message || `The receipt for ${session.orderId} is waiting for payment review.` })
      void loadMyDonations(); void loadPublicData()
    } catch (error) {
      setProofNotice({ tone: 'error', title: 'Could not submit payment proof', body: error instanceof Error ? error.message : 'Please check your connection and try again.' })
    } finally { setProofBusy(false) }
  }


  async function submitManualPaymentFromModal(
    result: CheckoutResult,
    fallback: { orderId: string; amountPaise: number },
  ): Promise<{ success: boolean; message: string }> {
    const orderId = String(result.order_id || fallback.orderId || '').trim()
    const utr = String(result.utr || '').trim()
    const amountReceived = Number(result.amount_received)
    const amountPaise = Math.round(amountReceived * 100)
    const evidenceFile = result.evidenceFile
    const note = String(result.user_note || '').trim()
    if (!supabase || !isSupabaseConfigured) return { success: false, message: 'Payment records are unavailable right now. Please try again shortly.' }
    if (!userId) return { success: false, message: 'Sign in to LokPravaah to submit proof and track your donation.' }
    if (orderId.length < 8) return { success: false, message: 'The donation reference is missing. Close this window and reopen the same checkout from My donations.' }
    if (!/^[A-Za-z0-9_-]{6,80}$/.test(utr)) return { success: false, message: 'Enter the actual UTR / bank reference shown by your UPI app.' }
    if (!Number.isSafeInteger(amountPaise) || amountPaise < 100 || amountPaise > 10_000_000) return { success: false, message: 'Enter a valid amount between ₹1 and ₹1,00,000.' }
    if (!(evidenceFile instanceof File) || !['image/jpeg','image/png','image/webp','application/pdf'].includes(evidenceFile.type) || evidenceFile.size > 10 * 1024 * 1024) {
      return { success: false, message: 'Attach one JPG, PNG, WebP image or PDF receipt up to 10 MB.' }
    }
    if (note.length > 2000) return { success: false, message: 'Keep the reviewer note under 2,000 characters.' }

    setProofBusy(true)
    setProofNotice({ tone: 'info', title: 'Submitting payment proof', body: 'Uploading the receipt privately. Your donation remains unverified until the bank record is checked.' })
    let uploadedPath = ''
    try {
      uploadedPath = userId + '/' + orderId + '-' + Date.now() + '-' + evidenceFileName(evidenceFile.name)
      const { error: uploadError } = await supabase.storage.from('donation-payment-evidence').upload(uploadedPath, evidenceFile, {
        cacheControl: '3600', contentType: evidenceFile.type, upsert: false,
      })
      if (uploadError) throw new Error('Receipt upload failed: ' + uploadError.message)
      const { data, error: claimError } = await supabase.rpc('janwatch_submit_manual_donation_claim', {
        p_order_id: orderId,
        p_screenshot_path: uploadedPath,
        p_claimed_utr: utr,
        p_claimed_amount_paise: amountPaise,
        p_payment_timestamp: result.payment_timestamp ? new Date(result.payment_timestamp).toISOString() : null,
        p_user_note: note || null,
      })
      if (claimError) throw new Error(claimError.message || 'Could not create the manual review request.')
      const claim = data as { status?: ManualClaimStatus; message?: string } | null
      manualProofSubmittedRef.current = true
      setActiveDonation(current => current?.orderId === orderId
        ? { ...current, status: 'PENDING_REVIEW', claimStatus: claim?.status || 'pending_review', claimedUtr: utr, adminReviewNote: null }
        : { orderId, paymentId: String(result.paymentId || ''), amountPaise, status: 'PENDING_REVIEW', claimStatus: claim?.status || 'pending_review', claimedUtr: utr, adminReviewNote: null })
      setProofOpen(false)
      setProofUtr(utr)
      setProofAmountText((amountPaise / 100).toFixed(2))
      setProofTime(result.payment_timestamp || '')
      setProofFile(null)
      setProofNotice({ tone: 'success', title: 'Under review', body: 'Your payment proof was submitted privately. Do not pay again while the bank record is being checked.' })
      setProofSubmission({ orderId, amountPaise, submittedAt: new Date().toISOString() })
      setNotice({ tone: 'info', title: 'Payment proof submitted', body: claim?.message || ('The receipt for ' + orderId + ' is in the payment review.') })
      // Do not wait for independent dashboard refresh RPCs inside the checkout SDK callback;
      // a slow public feed or donation-history query must not leave its I Paid modal blank.
      void loadMyDonations()
      void loadPublicData()
      return { success: true, message: 'Your UTR and receipt were submitted privately. The donation becomes successful only after admin bank-statement verification.' }
    } catch (caught) {
      if (uploadedPath) await supabase.storage.from('donation-payment-evidence').remove([uploadedPath]).catch(() => undefined)
      const message = caught instanceof Error ? caught.message : 'Payment proof could not be submitted. Please retry.'
      setProofNotice({ tone: 'error', title: 'Could not submit payment proof', body: message })
      return { success: false, message }
    } finally {
      setProofBusy(false)
    }
  }

  function donationStatusLabel(item: MyDonationRow): string {
    if (item.status === 'succeeded' || item.claim_status === 'confirmed') return 'Successful'
    if (item.claim_status === 'pending_review') return 'Under review'
    if (item.claim_status === 'rejected') return 'Action needed'
    if (item.status === 'expired') return 'Expired'
    if (item.status === 'cancelled') return 'Cancelled'
    if (item.status === 'failed') return 'Failed'
    if (item.status === 'suspicious') return 'Needs review'
    return 'Pending'
  }

  function donationStatusClass(item: MyDonationRow): string {
    const label = donationStatusLabel(item)
    return label === 'Successful' ? 'success' : label === 'Under review' ? 'review' : ['Action needed','Needs review','Failed'].includes(label) ? 'attention' : 'pending'
  }

  async function createDonationTicket(item: MyDonationRow) {
    if (!supabase || !userId) {
      setTicketNotice({ tone: 'error', text: 'Sign in to create a support ticket.' })
      return
    }
    if (ticketSubject.trim().length < 6 || ticketDescription.trim().length < 10) {
      setTicketNotice({ tone: 'error', text: 'Enter a subject of at least 6 characters and describe the issue in at least 10 characters.' })
      return
    }
    setTicketBusy(true)
    setTicketNotice(null)
    try {
      const { data, error } = await supabase.rpc('janwatch_create_donation_support_ticket', {
        p_donation_id: item.id,
        p_subject: ticketSubject.trim(),
        p_description: ticketDescription.trim(),
      })
      if (error) throw error
      const response = data as { status?: string; ticket_number?: number; message?: string } | null
      setTicketDraftId(null)
      setTicketDescription('')
      setTicketNotice({ tone: 'success', text: response?.message || ('Support ticket' + (response?.ticket_number ? ' #' + response.ticket_number : '') + ' created.') })
      await loadMyDonations()
      if (onOpenSupportTickets) onOpenSupportTickets()
    } catch (caught) {
      setTicketNotice({ tone: 'error', text: caught instanceof Error ? caught.message : 'Could not create the support ticket. Please retry.' })
    } finally {
      setTicketBusy(false)
    }
  }

  async function startDonation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setNotice(null)
    if (!amountValid || parsedAmount === null) {
      setNotice({ tone: 'error', title: 'Check the amount', body: `Enter an amount from ${money(settings.min_amount_paise)} to ${money(settings.max_amount_paise)}, with up to two decimal places.` }); return
    }
    if (!userId) { setNotice({ tone: 'warning', title: 'Sign in to donate', body: 'Sign in so your private donation history, manual payment review and support tickets stay linked to your account.' }); return }
    if (!settings.donations_enabled) { setNotice({ tone: 'warning', title: 'Donations are temporarily paused', body: 'The LokPravaah team has paused new contributions. Please check back later.' }); return }
    if (!settings.payment_gateway_enabled) { setNotice({ tone: 'warning', title: 'Online payments are temporarily paused', body: 'The payment service is temporarily unavailable. Please try again later.' }); return }
    const useHostedCheckout = gatewayConfigured && gatewayState === 'ready' && Boolean(window.Youpi?.pay)
    if (!useHostedCheckout && !upiVpa) {
      setNotice({ tone: 'error', title: 'UPI details are unavailable', body: 'The configured receiving UPI ID could not be loaded. No payment was started. Please try again later or contact support.' }); return
    }
    if (!supabase || !isSupabaseConfigured) { setNotice({ tone: 'error', title: 'Donation records are unavailable', body: 'The database is not configured, so checkout has been stopped before any payment session was created.' }); return }
    if (donorEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(donorEmail.trim())) { setNotice({ tone: 'error', title: 'Check the email address', body: 'Enter a valid email address or leave the field blank.' }); return }

    setLaunching(true)
    manualProofSubmittedRef.current = false
    const orderId = makeOrderId(); setLastOrderId(orderId)
    try {
      const { error } = await supabase.from('donation_intents').insert({
        order_id: orderId, donor_user_id: userId, amount_paise: parsedAmount, currency: 'INR',
        donor_name: anonymous ? null : (donorName.trim().slice(0, 80) || null), donor_email: anonymous ? null : (donorEmail.trim().slice(0, 254) || null),
        is_anonymous: anonymous, show_on_leaderboard: !anonymous && showOnLeaderboard, show_message_publicly: !anonymous && showOnLeaderboard && showMessagePublicly && Boolean(message.trim()), message: message.trim().slice(0, 300) || null, status: 'pending',
      })
      if (error) throw new Error(`Could not create a donation record: ${error.message}`)
      if (!useHostedCheckout) {
        const params = new URLSearchParams({
          pa: upiVpa,
          pn: upiPayeeName,
          am: (parsedAmount / 100).toFixed(2),
          cu: 'INR',
          tr: makeUpiTransactionRef(orderId),
          tn: `LokPravaah ${orderId}`.slice(0, 50),
        })
        // Some UPI handlers incorrectly treat '+' as a literal space in deep links.
        const upiUri = `upi://pay?${params.toString().replace(/\+/g, '%20')}`
        setActiveDonation({
          orderId,
          paymentId: '',
          amountPaise: parsedAmount,
          status: 'ACTIVE',
          upiUri,
          upiVpa,
          payeeName: upiPayeeName,
          checkoutMethod: 'upi_qr',
        })
        setNotice({ tone: 'info', title: 'UPI QR is ready', body: `Scan the QR using any UPI app, or tap Open UPI app. Reference: ${orderId}. Your donation is not confirmed until the payment proof is reviewed.` })
        setProofOpen(false)
        setProofUtr('')
        setProofAmountText((parsedAmount / 100).toFixed(2))
        setProofFile(null)
        setProofNotice(null)
        void loadMyDonations()
        setLaunching(false)
        window.setTimeout(() => document.getElementById('active-payment-checkout')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
        return
      }
      setNotice({ tone: 'info', title: 'Opening secure UPI checkout…', body: `Reference: ${orderId}. The contribution will appear in the live totals after the server verifies it.` })
      const checkout = await window.Youpi!.pay({
        key: merchantKey, order_id: orderId, amount: Number((parsedAmount / 100).toFixed(2)), currency: 'INR', name: 'LokPravaah',
        description: 'Voluntary contribution to support LokPravaah development and operating costs',
        customer: anonymous ? undefined : { name: donorName.trim().slice(0, 80), email: donorEmail.trim().slice(0, 254) },
        metadata: { purpose: 'lokpravaah_donation', order_id: orderId, amount_paise: parsedAmount }, portalUrl: gatewayPortalUrl, apiUrl: gatewayApiUrl, theme: { color: '#55d8a1' },
        handler: () => {
          handlePaymentStatus(orderId, 'PENDING_REVIEW')
          setNotice({ tone: 'warning', title: 'Awaiting bank-record review', body: `Checkout reported a payment response for ${orderId}. The donation is not successful until an administrator verifies the amount and UTR against the receiving-bank statement.` })
          setLaunching(false); void loadPublicData(); void loadMyDonations()
        },
        onSuccess: () => {
          handlePaymentStatus(orderId, 'PENDING_REVIEW')
          setNotice({ tone: 'warning', title: 'Awaiting bank-record review', body: `Checkout reported a payment response for ${orderId}. The donation is not successful until an administrator verifies the amount and UTR against the receiving-bank statement.` })
          setLaunching(false); void loadPublicData(); void loadMyDonations()
        },
        onFailed: result => { handlePaymentStatus(orderId, 'FAILED'); setNotice({ tone: 'error', title: 'Payment was not confirmed', body: `${result.reason || result.error || 'The checkout could not confirm this payment.'} If money was debited, check your bank statement and contact support with reference ${orderId} before trying again.` }); setLaunching(false) },
        onSuspicious: () => { handlePaymentStatus(orderId, 'SUSPICIOUS'); setNotice({ tone: 'warning', title: 'Payment needs review', body: `Reference ${orderId} has been flagged for review. Do not retry until it is checked.` }); setLaunching(false) },
        onExpired: () => { handlePaymentStatus(orderId, 'EXPIRED'); setNotice({ tone: 'warning', title: 'Checkout session expired', body: `Reference ${orderId} expired before confirmation. You can still submit the UTR and payment receipt for review.` }); setLaunching(false) },
        onCancelled: () => { handlePaymentStatus(orderId, 'CANCELLED'); setNotice({ tone: 'info', title: 'Checkout cancelled', body: `Reference ${orderId} was cancelled in checkout. If you approved a transfer in your UPI app, check your bank statement before retrying.` }); setLaunching(false) },
        onManualPaymentRequest: result => submitManualPaymentFromModal(result, { orderId, amountPaise: parsedAmount }),
        onClose: () => setLaunching(false),
      })
      // The I Paid callback may complete while this checkout promise is still pending.
      // Preserve its review state instead of overwriting it with a fresh ACTIVE session.
      if (manualProofSubmittedRef.current) { setLaunching(false); return }
      const paymentId = String(checkout?.options?.paymentId || '')
      if (!paymentId) throw new Error('Checkout opened, but its payment ID could not be saved. Keep the donation reference visible and do not start another payment if your bank shows a debit.')
      setActiveDonation({ orderId, paymentId, amountPaise: parsedAmount, status: 'ACTIVE' })
      void loadMyDonations()
      setProofOpen(false)
      setProofUtr('')
      setProofAmountText((parsedAmount / 100).toFixed(2))
      setProofFile(null)
      setProofNotice(null)
    } catch (error) {
      setNotice({ tone: 'error', title: 'Could not start UPI checkout', body: error instanceof Error ? error.message : 'Please check the gateway setup and try again.' })
      setLaunching(false)
    }
  }

  const topThree = publicData?.top_donors.slice(0, 3) ?? []
  const remainingLeaders = publicData?.top_donors.slice(3) ?? []
  const accountDonations = myDonationsOwner === userId ? myDonations : []
  const filteredMyDonations = accountDonations.filter(item => {
    const successful = item.status === 'succeeded' || item.claim_status === 'confirmed'
    if (donationHistoryFilter === 'successful') return successful
    if (donationHistoryFilter === 'pending') return !successful
    return true
  })
  const pendingDonationCount = accountDonations.filter(item => item.status !== 'succeeded' && item.claim_status !== 'confirmed').length
  const successfulDonationCount = accountDonations.filter(item => item.status === 'succeeded' || item.claim_status === 'confirmed').length

  if (proofSubmission) {
    return <div className="donation-page donation-thankyou-page">
      <section className="donation-review-success" aria-labelledby="donation-review-title" role="status">
        <div className="donation-review-success-icon"><CircleCheck size={34}/></div>
        <span className="donation-section-kicker">DONATION PROOF RECEIVED</span>
        <h1 id="donation-review-title">Thank you for supporting LokPravaah.</h1>
        <p className="donation-review-lead">Your payment details have been submitted successfully.</p>
        <div className="donation-review-status"><Clock3 size={19}/><div><strong>Payment is under review</strong><span>Our team will compare the UTR, amount and receipt with the receiving-bank record. Your donation will be marked verified only after that check.</span></div></div>
        <div className="donation-review-reference"><span>Donation reference</span><code>{proofSubmission.orderId}</code></div>
        <div className="donation-review-amount"><span>Amount you reported as paid</span><strong>{money(proofSubmission.amountPaise)}</strong></div>
        <p className="donation-review-reminder">Please do not pay again while this claim is being reviewed. Keep your UPI receipt for your records.</p>
        <button type="button" className="donation-submit donation-review-back" onClick={() => setProofSubmission(null)}>Back to donations <ArrowRight size={16}/></button>
      </section>
    </div>
  }
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
      <article className="donation-live-indicator"><span className="donation-live-icon"><RefreshCw size={17} className={feedLoading ? 'donation-spin' : ''}/></span><div><small>Live board</small><strong>{feedError ? 'Connecting' : 'Auto-refreshes'}</strong></div></article>
    </section>

    {settings.show_goal_progress && <section className="donation-progress-card"><div className="donation-progress-heading"><div><span className="donation-section-kicker">COMMUNITY MILESTONE</span><h2>{Math.min(100, goalPercent)}% of the target reached</h2></div><b>{money(publicData?.total_raised_paise ?? 0)} <span>of {money(settings.campaign_goal_paise)}</span></b></div><div className="donation-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={goalPercent} aria-label="Campaign goal progress"><span style={{ width: `${goalPercent}%` }}/></div><div className="donation-progress-footer"><span>{(publicData?.successful_donations ?? 0).toLocaleString('en-IN')} verified contributions</span><span>{money(Math.max(0, settings.campaign_goal_paise - (publicData?.total_raised_paise ?? 0)))} to go</span></div></section>}

    <div className="donation-layout">
      <section className="donation-form-card">
        <div className="donation-card-header"><div className="donation-icon"><Wallet size={20}/></div><div><span className="donation-section-kicker">MAKE A CONTRIBUTION</span><h2>Choose your amount</h2><p>UPI checkout · One-time contribution · INR</p></div></div>
        {!settings.donations_enabled && <div className="donation-inline-warning"><CircleAlert size={16}/><span>Contributions are temporarily paused. Please check back later.</span></div>}
        <form onSubmit={startDonation}>
          <div className="donation-presets" aria-label="Suggested amounts">{settings.suggested_amounts.map(value => <button type="button" key={value} className={`donation-preset ${selectedPreset === value ? 'selected' : ''}`} onClick={() => selectPreset(value)}>{amountLabel(value * 100)}{value === settings.suggested_amounts[0] && <small>Start here</small>}</button>)}</div>
          <label className="donation-field"><span>Custom amount (₹)</span><div className="donation-amount-input"><span>₹</span><input type="number" inputMode="decimal" min={settings.min_amount_paise / 100} max={settings.max_amount_paise / 100} step="0.01" value={amountText} onChange={e => { setAmountText(e.target.value); setSelectedPreset(settings.suggested_amounts.find(v => String(v) === e.target.value) ?? null); setNotice(null) }} aria-describedby="donation-amount-help" required/><span className="donation-inr-pill">INR</span></div><small id="donation-amount-help">Minimum {money(settings.min_amount_paise)} · Maximum {money(settings.max_amount_paise)} · up to 2 decimals</small></label>
          <div className="donation-field-grid"><label className="donation-field"><span>Name <small>(optional)</small></span><input type="text" maxLength={80} value={donorName} onChange={e => setDonorName(e.target.value)} disabled={anonymous} placeholder="Your name" autoComplete="name"/></label><label className="donation-field"><span>Email <small>(optional)</small></span><input type="email" maxLength={254} value={donorEmail} onChange={e => setDonorEmail(e.target.value)} disabled={anonymous} placeholder="you@example.com" autoComplete="email"/></label></div>
          <label className="donation-anonymous"><input type="checkbox" checked={anonymous} onChange={e => setAnonymous(e.target.checked)}/><span><b>Keep my contribution anonymous</b><small>Your name and email will not be attached to this donation record or shown publicly.</small></span></label>
          <label className="donation-anonymous"><input type="checkbox" checked={showOnLeaderboard && !anonymous} disabled={anonymous} onChange={e => setShowOnLeaderboard(e.target.checked)}/><span><b>Include me on the supporter leaderboard</b><small>Only your display name and verified contribution total are public. Your message is private unless you separately opt in. Email, UPI details and payment references are never shown.</small></span></label>
          <label className="donation-field"><span>Message <small>(optional)</small></span><textarea rows={2} maxLength={300} value={message} onChange={e => setMessage(e.target.value)} placeholder="Leave a note of support (max 300 characters)"/></label>
          <label className="donation-anonymous"><input type="checkbox" checked={showMessagePublicly && !anonymous && showOnLeaderboard} disabled={anonymous || !showOnLeaderboard || !message.trim()} onChange={e => setShowMessagePublicly(e.target.checked)}/><span><b>Show my message in public activity</b><small>Your message is private by default. This is separate from showing your name on the leaderboard.</small></span></label>
          <div className="donation-summary"><span>Your one-time contribution</span><strong>{amountValid && parsedAmount !== null ? money(parsedAmount) : '—'}</strong></div>
          <button className="donation-submit" type="submit" disabled={!paymentReady || !amountValid || launching}>{launching ? <><LoaderCircle size={17} className="donation-spin"/> Preparing checkout…</> : <><Heart size={17}/> Donate {amountValid && parsedAmount !== null ? money(parsedAmount) : 'now'} <ArrowRight size={16}/></>}</button>
          {!isSupabaseConfigured && <div className="donation-inline-warning"><CircleAlert size={16}/><span>Supabase is not configured. Donation history and verified totals are unavailable until the database is enabled.</span></div>}
          {gatewayState === 'not-configured' && upiVpa && <div className="donation-gateway-state"><CircleAlert size={15}/><span>The hosted checkout is unavailable. You can still generate a UPI QR using the verified receiving details below.</span></div>}
          {gatewayState === 'not-configured' && !upiVpa && <div className="donation-inline-warning"><CircleAlert size={16}/><span>UPI payment details are temporarily unavailable. No payment will start until the receiving account is configured.</span></div>}
          {gatewayState === 'loading' && <div className="donation-gateway-state"><LoaderCircle size={15} className="donation-spin"/> Connecting to UPI checkout…</div>}
          {gatewayState === 'error' && upiVpa && <div className="donation-gateway-state"><CircleAlert size={15}/><span>The hosted checkout is unavailable. You can still generate a UPI QR using the configured receiving details.</span></div>}
          {gatewayState === 'error' && !upiVpa && <div className="donation-inline-warning"><CircleAlert size={16}/><span>UPI checkout is temporarily unavailable and no receiving UPI ID is configured. No payment has been started.</span></div>}
          {!feedLoading && feedError && <div className="donation-inline-warning"><CircleAlert size={16}/><span>Live activity is unavailable. Apply the donation SQL migration, then refresh this page.</span></div>}
          {notice && <div className={`donation-notice notice-${notice.tone}`} role="status"><div className="donation-notice-icon">{notice.tone === 'success' ? <CircleCheck size={19}/> : notice.tone === 'error' || notice.tone === 'warning' ? <CircleAlert size={19}/> : <BadgeCheck size={19}/>}</div><div><b>{notice.title}</b><p>{notice.body}</p>{lastOrderId && <code>Reference: {lastOrderId}</code>}</div></div>}
        </form>
        {activeDonation && <section className="donation-active-payment" id="active-payment-checkout" aria-live="polite">
          <div className="donation-active-payment-head">
            <div className="donation-active-payment-icon"><Wallet size={20}/></div>
            <div><span className="donation-section-kicker">YOUR DONATION SESSION</span><h3>{activeDonation.status === 'SUCCESS' || activeDonation.claimStatus === 'confirmed' ? 'Payment confirmed' : activeDonation.claimStatus === 'pending_review' ? 'Payment proof sent for review' : 'Payment not confirmed yet'}</h3><p>{money(activeDonation.amountPaise)} · {activeDonation.status.replace(/_/g, ' ')}</p></div>
          </div>
          {activeDonation.upiUri && !TERMINAL_PAYMENT_STATUSES.has(activeDonation.status) && <div className="donation-upi-checkout">
            <div className="donation-section-kicker">PAY WITH ANY UPI APP</div>
            <div className="donation-upi-qr" ref={upiQrRef} aria-label="Donation UPI QR code" />
            <strong>{activeDonation.payeeName || 'LokPravaah'}</strong>
            <span>{activeDonation.upiVpa}</span>
            <strong className="donation-upi-amount">{money(activeDonation.amountPaise)}</strong>
            <p>Check the payee and exact amount in your UPI app before approving. QR scanning or returning to this screen does not verify payment.</p>
            <a className="donation-active-primary" href={activeDonation.upiUri}>Open UPI app <ArrowRight size={15}/></a>
          </div>}
          {activeDonation.upiUri && TERMINAL_PAYMENT_STATUSES.has(activeDonation.status) && activeDonation.status !== 'SUCCESS' && <div className="donation-proof-message proof-pending"><CircleAlert size={17}/><span>This QR session is marked {activeDonation.status.toLowerCase()}. Do not pay through this QR again. If your bank shows money was debited, submit the UTR and receipt below so the team can review it.</span></div>}
          <div className="donation-active-reference"><span>Donation reference</span><code>{activeDonation.orderId}</code></div>
          <p className="donation-active-help">Closing the QR window will not cancel this session. Reopen the same QR here while it is active. If PhonePe does not auto-confirm after you actually paid, submit the UTR and receipt below. A screenshot alone does not verify payment.</p>
          {activeDonation.status === 'SUCCESS' || activeDonation.claimStatus === 'confirmed'
            ? <div className="donation-proof-message proof-success"><CircleCheck size={17}/><span>This donation is verified. Thank you for supporting LokPravaah.</span></div>
            : activeDonation.claimStatus === 'pending_review'
              ? <div className="donation-proof-message proof-pending"><Clock3 size={17}/><span>Your claimed UTR and screenshot are in the payment review. Do not pay again while it is being checked.</span></div>
              : activeDonation.claimStatus === 'rejected'
                ? <div className="donation-proof-message proof-rejected"><CircleAlert size={17}/><span>We need more information to review this payment: {activeDonation.adminReviewNote || 'Please check the UTR and submit the correct receipt.'}</span></div>
                : null}
          <div className="donation-active-actions">
            {activeDonation.status !== 'SUCCESS' && (Boolean(activeDonation.paymentId) || Boolean(activeDonation.upiUri)) && !TERMINAL_PAYMENT_STATUSES.has(activeDonation.status) && !['confirmed', 'pending_review', 'rejected'].includes(String(activeDonation.claimStatus || '')) && <button className="donation-active-primary" type="button" disabled={launching} onClick={() => void reopenActivePayment()}><RefreshCw size={15} className={launching ? 'donation-spin' : ''}/>{activeDonation.upiUri ? 'Show my UPI QR' : ['ACTIVE', 'PROCESSING', 'QUEUED'].includes(activeDonation.status) ? 'Open the same QR again' : 'View original payment status'}</button>}
            {activeDonation.status !== 'SUCCESS' && activeDonation.claimStatus !== 'confirmed' && activeDonation.claimStatus !== 'pending_review' && <button className="donation-active-secondary" type="button" onClick={() => proofOpen ? setProofOpen(false) : openManualProofForm()}><Upload size={15}/>{proofOpen ? 'Hide confirmation form' : 'I have paid — confirm payment'}</button>}
            {(activeDonation.status === 'SUCCESS' || activeDonation.claimStatus === 'confirmed') && <button className="donation-active-secondary" type="button" onClick={() => { setActiveDonation(null); setProofOpen(false); setProofNotice(null) }}>Dismiss confirmed session</button>}
          </div>
          {proofOpen && activeDonation.status !== 'SUCCESS' && activeDonation.claimStatus !== 'confirmed' && activeDonation.claimStatus !== 'pending_review' && <form className="donation-manual-proof-form" id="manual-payment-confirmation" onSubmit={submitManualPaymentProof}>
            <div><span className="donation-section-kicker">MANUAL PAYMENT CONFIRMATION</span><h4>Send your UTR and receipt for payment review</h4><p>Only submit this after the UPI app or your bank confirms that money was sent. Our team will compare your claim with the receiving-bank record before confirming it.</p></div>
            <label className="donation-field"><span>UPI transaction ID / UTR</span><input value={proofUtr} onChange={e => setProofUtr(e.target.value.trimStart())} minLength={6} maxLength={80} pattern="[A-Za-z0-9_-]{6,80}" autoComplete="off" spellCheck={false} placeholder="Enter UTR / transaction reference" required/></label>
            <label className="donation-field"><span>Amount actually paid (₹)</span><input type="number" inputMode="decimal" min="1" max="100000" step="0.01" value={proofAmountText} onChange={e => setProofAmountText(e.target.value)} required/><small>Expected donation amount: {money(activeDonation.amountPaise)}. The admin checks the amount in your receipt and bank statement.</small></label>
            <label className="donation-field"><span>Payment date and time <small>(optional)</small></span><input type="datetime-local" value={proofTime} onChange={e => setProofTime(e.target.value)}/></label>
            <label className="donation-field"><span>Payment screenshot or PDF receipt</span><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={e => setProofFile(e.target.files?.[0] || null)} required/><small>Private upload · JPG, PNG, WebP or PDF · maximum 10 MB. Do not upload a screenshot with UPI PIN or OTP visible.</small>{proofFile && <small>Selected: {proofFile.name} ({(proofFile.size / 1024 / 1024).toFixed(2)} MB)</small>}</label>
            <label className="donation-field"><span>Additional details <small>(optional)</small></span><textarea rows={3} maxLength={2000} value={proofNote} onChange={e => setProofNote(e.target.value)} placeholder="Tell us what happened after payment"/></label>
            <button className="donation-submit" type="submit" disabled={proofBusy}>{proofBusy ? <><LoaderCircle size={16} className="donation-spin"/> Sending receipt privately…</> : <><Upload size={16}/> Submit UTR & payment screenshot <ArrowRight size={15}/></>}</button>
          </form>}
          {proofNotice && <div className={`donation-proof-notice proof-${proofNotice.tone}`} role="status"><b>{proofNotice.title}</b><p>{proofNotice.body}</p></div>}
        </section>}
        <section className="donation-history-panel" aria-labelledby="donation-history-title">
          <div className="donation-history-heading">
            <div><span className="donation-section-kicker">PRIVATE ACCOUNT AREA</span><h3 id="donation-history-title">My donations</h3><p>Track pending attempts, manual reviews and successful contributions. This history is private to your account.</p></div>
            <button type="button" className="donation-history-refresh" onClick={() => { void loadMyDonations(); void loadPublicData() }} disabled={myDonationsLoading}><RefreshCw size={14} className={myDonationsLoading ? 'donation-spin' : ''}/> Refresh</button>
          </div>
          {!userId && <div className="donation-history-empty"><LockKeyhole size={18}/><span>Sign in to view donation history or submit payment proof.</span></div>}
          {myDonationsLoading && !myDonations.length && <div className="donation-history-empty"><LoaderCircle size={17} className="donation-spin"/><span>Loading your donation history…</span></div>}
          {myDonationsError && <div className="donation-history-error" role="alert"><CircleAlert size={16}/><span>{myDonationsError}</span><button type="button" onClick={() => void loadMyDonations()}>Try again</button></div>}
          {!myDonationsLoading && !myDonationsError && userId && !myDonations.length && <div className="donation-history-empty"><HeartHandshake size={20}/><span>No donation records yet. Your new contribution will appear here after checkout creates its reference.</span></div>}
          <div className="donation-history-filters" role="tablist" aria-label="Filter donation history">
            <button type="button" role="tab" aria-selected={donationHistoryFilter === 'all'} className={'donation-history-filter' + (donationHistoryFilter === 'all' ? ' active' : '')} onClick={() => setDonationHistoryFilter('all')}>All <span>{myDonations.length}</span></button>
            <button type="button" role="tab" aria-selected={donationHistoryFilter === 'pending'} className={'donation-history-filter' + (donationHistoryFilter === 'pending' ? ' active' : '')} onClick={() => setDonationHistoryFilter('pending')}>Pending / review <span>{pendingDonationCount}</span></button>
            <button type="button" role="tab" aria-selected={donationHistoryFilter === 'successful'} className={'donation-history-filter' + (donationHistoryFilter === 'successful' ? ' active' : '')} onClick={() => setDonationHistoryFilter('successful')}>Successful <span>{successfulDonationCount}</span></button>
          </div>
          {accountDonations.length > 0 && filteredMyDonations.length === 0 && <div className="donation-history-empty"><HeartHandshake size={19}/><span>{donationHistoryFilter === 'successful' ? 'No successful donations yet. Verified payments will appear here after admin approval.' : 'No pending donations or reviews. You are all caught up.'}</span></div>}
          <div className="donation-history-list">
            {filteredMyDonations.map(item => {
              const label = donationStatusLabel(item)
              const ticketClosed = ['resolved','closed','rejected'].includes(String(item.ticket_status || ''))
              const canRaiseTicket = !item.ticket_number || ticketClosed
              return <article className="donation-history-item" key={item.id}>
                <div className="donation-history-item-top">
                  <div><strong>{money(item.amount_paise)}</strong><span className={'donation-history-status status-' + donationStatusClass(item)}>{label}</span></div>
                  <time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString('en-IN',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}</time>
                </div>
                <div className="donation-history-reference"><span>Reference</span><code>{item.order_id}</code></div>
                <div className="donation-history-meta">
                  <span>Source: {item.record_source === 'manual_cash' ? 'Offline cash' : item.record_source === 'manual_bank' ? 'Direct bank transfer' : item.record_source === 'manual_upi' ? 'Direct UPI' : item.record_source === 'manual_other' ? 'Other offline source' : 'UPI checkout'}</span>
                  {item.utr && <span>UTR: <code>{item.utr}</code></span>}
                  {item.claimed_utr && !item.utr && <span>Submitted UTR: <code>{item.claimed_utr}</code></span>}
                  {item.verified_at && <span>Verified: {new Date(item.verified_at).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}</span>}
                </div>
                {item.claim_status === 'pending_review' && <div className="donation-history-review-note"><Clock3 size={15}/><span><b>Under review</b> Your proof has been received. Admin will compare the amount and UTR with the receiving-bank statement. Please do not pay again.</span></div>}
                {item.claim_status === 'rejected' && <div className="donation-history-action-note"><CircleAlert size={15}/><span><b>More information needed</b> {item.admin_review_note || 'Your claim was not verified. Check your receipt before resubmitting.'}</span></div>}
                {item.status === 'succeeded' && <div className="donation-history-success-note"><CircleCheck size={15}/><span>Payment verified. Thank you for supporting LokPravaah.</span></div>}
                {item.ticket_number && <div className="donation-history-ticket"><Ticket size={14}/><span>Ticket #{item.ticket_number} · {String(item.ticket_status || 'open').replaceAll('_',' ')}</span><button type="button" onClick={() => onOpenSupportTickets?.()}>View ticket</button></div>}
                <div className="donation-history-actions">
                  {item.claim_status === 'rejected' && <button type="button" className="donation-history-primary" onClick={() => { setActiveDonation({ orderId:item.order_id, paymentId:'', amountPaise:item.amount_paise, status:item.status.toUpperCase(), claimStatus:'rejected', claimedUtr:item.claimed_utr || '', adminReviewNote:item.admin_review_note || null }); setProofNotice({tone:'error',title:'Review needs more information',body:item.admin_review_note || 'Please raise a ticket with the correct receipt and payment reference.'}); setTicketDraftId(item.id); setTicketSubject('Payment review follow-up: ' + item.order_id); setTicketDescription('Please review the manual payment claim for donation ' + item.order_id + '. Admin review note: ' + (item.admin_review_note || 'More information requested') + '.'); }}>Resolve issue</button>}
                  {canRaiseTicket && (ticketDraftId === item.id ? <form className="donation-history-ticket-form" onSubmit={e => { e.preventDefault(); void createDonationTicket(item) }}>
                    <label>Ticket subject<input maxLength={120} minLength={6} value={ticketSubject} onChange={e => setTicketSubject(e.target.value)} required/></label>
                    <label>Describe the issue<textarea rows={3} minLength={10} maxLength={5000} value={ticketDescription} onChange={e => setTicketDescription(e.target.value)} placeholder="Explain what happened and what help you need…" required/></label>
                    <div><button type="button" className="donation-history-refresh" onClick={() => setTicketDraftId(null)} disabled={ticketBusy}>Cancel</button><button type="submit" className="donation-history-primary" disabled={ticketBusy}>{ticketBusy ? <><LoaderCircle size={14} className="donation-spin"/> Creating ticket…</> : <><Ticket size={14}/> Create support ticket</>}</button></div>
                  </form> : <button type="button" className="donation-history-secondary" onClick={() => { setTicketDraftId(item.id); setTicketSubject('Donation issue: ' + item.order_id); setTicketDescription('Please help me with donation ' + item.order_id + '. Current status: ' + label + '.'); setTicketNotice(null) }}><Ticket size={14}/>{ticketClosed ? 'Raise another ticket' : 'Raise a ticket'}</button>)}
                </div>
              </article>
            })}
          </div>
          {ticketNotice && <div className={'donation-history-ticket-notice ' + ticketNotice.tone} role="status">{ticketNotice.text}</div>}
          <p className="donation-history-foot"><ShieldCheck size={13}/> Only the verified bank-record review changes a donation to successful. Ticket replies and status are available in Support tickets.</p>
        </section>

        <div className="donation-security-note"><LockKeyhole size={15}/><span>Payments appear in public totals only after the amount and UTR are verified against the receiving-bank statement. Screenshots alone do not confirm payment. Never share your UPI PIN or OTP.</span></div>
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
