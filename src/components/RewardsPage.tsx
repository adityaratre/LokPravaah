import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { BadgeIndianRupee, Clock3, Coins, Info, LoaderCircle, RefreshCw, Send, ShieldCheck, Wallet } from 'lucide-react'
import { supabase } from '../lib/supabase'

type LedgerRow = { id: string; delta_points: number; reason: string; created_at: string; source_report_id: string | null }
type Withdrawal = { id: string; points_requested: number; amount_inr: number; payout_method: string; payout_destination: string; status: 'pending' | 'approved' | 'paid' | 'rejected'; admin_note: string | null; payout_reference: string | null; created_at: string; processed_at: string | null }
type RewardConfig = { enabled: boolean; cash_redemption_enabled: boolean; points_per_rupee: number; min_withdrawal_points: number; enabled_payout_methods: string[]; auto_reward_on_verified: boolean; points_for_verified_report: number; auto_reward_on_resolved: boolean; points_for_resolved_report: number }
type Balance = { earned_points: number; reserved_points: number; available_points: number }
const EMPTY_BALANCE: Balance = { earned_points: 0, reserved_points: 0, available_points: 0 }
function money(value: number) { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value) }
function shortDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) }
function messageOf(error: unknown) { return error && typeof error === 'object' && 'message' in error ? String((error as { message: unknown }).message) : String(error) }

export default function RewardsPage({ userId, enabled, notify }: { userId: string; enabled: boolean; notify: (message: string) => void }) {
  const [ledger, setLedger] = useState<LedgerRow[]>([])
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([])
  const [config, setConfig] = useState<RewardConfig | null>(null)
  const [balance, setBalance] = useState<Balance>(EMPTY_BALANCE)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [points, setPoints] = useState('')
  const [payoutMethod, setPayoutMethod] = useState('UPI')
  const [upi, setUpi] = useState('')
  const [bankName, setBankName] = useState('')
  const [bankAccount, setBankAccount] = useState('')
  const [bankIfsc, setBankIfsc] = useState('')
  const [giftDelivery, setGiftDelivery] = useState('')
  const [requesting, setRequesting] = useState(false)

  const load = useCallback(async () => {
    if (!supabase) { setError('Rewards are temporarily unavailable. Please try again later.'); setLoading(false); return }
    setLoading(true); setError('')
    const [ledgerResult, withdrawalResult, configResult, balanceResult] = await Promise.all([
      supabase.from('reward_ledger').select('id,delta_points,reason,created_at,source_report_id').eq('user_id', userId).order('created_at', { ascending: false }).limit(100),
      supabase.from('reward_withdrawals').select('id,points_requested,amount_inr,payout_method,payout_destination,status,admin_note,payout_reference,created_at,processed_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(50),
      supabase.from('reward_settings').select('enabled,cash_redemption_enabled,points_per_rupee,min_withdrawal_points,enabled_payout_methods,auto_reward_on_verified,points_for_verified_report,auto_reward_on_resolved,points_for_resolved_report').eq('id', true).maybeSingle(),
      supabase.rpc('janwatch_reward_balance'),
    ])
    const failures = [ledgerResult.error, withdrawalResult.error, configResult.error, balanceResult.error].filter(Boolean)
    if (failures.length) setError('Rewards could not be refreshed. Please try again shortly.')
    if (!ledgerResult.error) setLedger((ledgerResult.data ?? []) as LedgerRow[])
    if (!withdrawalResult.error) setWithdrawals((withdrawalResult.data ?? []) as Withdrawal[])
    if (!configResult.error && configResult.data) setConfig({ ...configResult.data, points_per_rupee: Number(configResult.data.points_per_rupee) } as RewardConfig)
    if (!balanceResult.error) {
      const result = Array.isArray(balanceResult.data) ? balanceResult.data[0] : balanceResult.data
      if (result) setBalance({ earned_points: Number(result.earned_points ?? 0), reserved_points: Number(result.reserved_points ?? 0), available_points: Number(result.available_points ?? 0) })
    }
    setLoading(false)
  }, [userId])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    const methods = config?.enabled_payout_methods?.length ? config.enabled_payout_methods : ['UPI']
    if (!methods.includes(payoutMethod)) setPayoutMethod(methods[0])
  }, [config?.enabled_payout_methods, payoutMethod])

  useEffect(() => {
    if (!supabase || !enabled) return
    const channel = supabase.channel(`janwatch-rewards-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reward_ledger', filter: `user_id=eq.${userId}` }, () => { void load() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reward_withdrawals', filter: `user_id=eq.${userId}` }, () => { void load() })
      .subscribe()
    return () => { void supabase?.removeChannel(channel) }
  }, [userId, enabled, load])

  const requestedPoints = Number(points)
  const available = Math.max(0, balance.available_points)
  const payoutMethods = config?.enabled_payout_methods?.length ? config.enabled_payout_methods : ['UPI']
  const redemptionReady = Boolean(enabled && config?.enabled && config.cash_redemption_enabled && !loading && !error)
  const destination = payoutMethod === 'UPI' ? upi.trim() : payoutMethod === 'Bank transfer' ? `Name: ${bankName.trim()}; Account: ${bankAccount.trim()}; IFSC: ${bankIfsc.trim().toUpperCase()}` : giftDelivery.trim()
  const bankValid = bankName.trim().length >= 2 && /^\d{8,18}$/.test(bankAccount.trim()) && /^[A-Z]{4}0[A-Z0-9]{6}$/.test(bankIfsc.trim().toUpperCase())
  const giftValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(giftDelivery.trim()) || /^\+?[0-9 ()-]{10,18}$/.test(giftDelivery.trim())
  const destinationValid = payoutMethod === 'UPI' ? /^[A-Za-z0-9._-]{2,}@[A-Za-z0-9._-]{2,}$/.test(upi.trim()) : payoutMethod === 'Bank transfer' ? bankValid : payoutMethod === 'Gift card' ? giftValid : false
  const validRequest = Boolean(config && payoutMethods.includes(payoutMethod) && Number.isInteger(requestedPoints) && requestedPoints >= config.min_withdrawal_points && requestedPoints <= available && destinationValid && !requesting && redemptionReady)
  const recentLedger = useMemo(() => ledger.slice(0, 100), [ledger])

  async function requestWithdrawal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !config || !validRequest) return
    if (!window.confirm(`Request ${requestedPoints.toLocaleString()} points (${money(requestedPoints / config.points_per_rupee)}) for administrator review? Submission does not guarantee payment.`)) return
    setRequesting(true); setError('')
    const { error: rpcError } = await supabase.rpc('janwatch_request_reward_withdrawal', { p_points: requestedPoints, p_method: payoutMethod, p_destination: destination })
    setRequesting(false)
    if (rpcError) { setError('Your withdrawal request could not be submitted. Please try again.'); notify('Your withdrawal request could not be submitted. Please try again.'); return }
    setUpi(''); setBankName(''); setBankAccount(''); setBankIfsc(''); setGiftDelivery(''); setPoints('')
    notify('Withdrawal request submitted for administrator review. No payment has been sent yet.')
    await load()
  }

  if (!enabled) return <section className="panel reward-disabled"><Wallet size={28}/><h2>Rewards are currently paused</h2><p>An administrator has disabled the rewards feature in platform controls. No new requests can be submitted while it is paused.</p></section>
  if (!loading && !config) return <section className="panel reward-disabled"><Info size={28}/><h2>Rewards settings are unavailable</h2><p>{error || 'Reward settings are currently unavailable.'}</p><button className="btn btn-secondary" onClick={() => void load()}><RefreshCw size={15}/> Retry</button></section>
  const currentConfig = config

  return <div className="rewards-page">
    <section className="rewards-heading"><div><div className="section-kicker">CONTRIBUTION RECOGNITION</div><h1>Rewards & withdrawals<span>.</span></h1><p>Eligible contributions may earn points under the programme rules. A report must be reviewed before it can qualify; submission alone does not guarantee points.</p></div><button className="btn btn-secondary" onClick={() => void load()} disabled={loading}><RefreshCw size={15}/> Refresh</button></section>
    {currentConfig && !currentConfig.enabled && <div className="data-warning"><Info size={17}/><div><b>Rewards are paused by an administrator</b><span>Your historical balance remains visible, but automatic and manual awards are paused.</span></div></div>}
    {error && <div className="data-warning"><Info size={17}/><div><b>Some rewards data could not be refreshed</b><span>{error}</span></div><button className="btn btn-secondary" onClick={() => void load()}><RefreshCw size={15}/> Retry</button></div>}
    <div className="reward-principle"><ShieldCheck size={18}/><div><b>Quality over quantity</b><span>Verified/resolved means an authorised LokPravaah reviewer changed the status. It is not an independent government verification. Rewards depend on an organisation's published rules and available funding.</span></div></div>
    <section className="rewards-balance-grid"><article className="panel reward-balance-card"><div className="reward-icon"><Coins size={20}/></div><span>Net points before reservations</span><b>{loading ? '…' : balance.earned_points.toLocaleString()}</b><small>Total points recorded</small></article><article className="panel reward-balance-card"><div className="reward-icon"><Wallet size={20}/></div><span>Available points</span><b>{loading ? '…' : available.toLocaleString()}</b><small>{balance.reserved_points.toLocaleString()} points reserved/spent on pending, approved or paid requests</small></article><article className="panel reward-balance-card"><div className="reward-icon"><BadgeIndianRupee size={20}/></div><span>Indicative value</span><b>{loading || !currentConfig ? '…' : money(available / currentConfig.points_per_rupee)}</b><small>{currentConfig ? `${currentConfig.points_per_rupee} points per ₹1` : 'Current redemption rate'} · not guaranteed cash</small></article></section>
    <div className="rewards-main-grid">
      {currentConfig?.cash_redemption_enabled ? <section className="panel rewards-withdraw-card"><div className="panel-heading"><div><div className="section-kicker">REDEEM POINTS</div><h3>Request a withdrawal</h3></div><Wallet size={19}/></div><div className="withdrawal-notice"><Info size={16}/><p>Select one of the payout methods enabled by the administrator. Your destination details are private to you and authorised administrators. Requests are reviewed and paid manually; this form does not send money or gift cards automatically.</p></div><form className="withdrawal-form" onSubmit={requestWithdrawal}><label>Points to redeem<input type="number" value={points} min={currentConfig.min_withdrawal_points} max={available} step={1} onChange={e => setPoints(e.target.value)} required/><small>Minimum: {currentConfig.min_withdrawal_points.toLocaleString()} · Available: {available.toLocaleString()}</small></label><label>Payout method<select value={payoutMethod} onChange={e => setPayoutMethod(e.target.value)} required>{payoutMethods.map(method => <option key={method} value={method}>{method}</option>)}</select></label>{payoutMethod === 'UPI' && <label>UPI ID<input value={upi} onChange={e => setUpi(e.target.value)} maxLength={120} placeholder="name@upi" autoComplete="off" required/><small>Never enter a UPI PIN or OTP.</small></label>}{payoutMethod === 'Bank transfer' && <><label>Account holder name<input value={bankName} onChange={e => setBankName(e.target.value)} maxLength={50} autoComplete="name" required/></label><label>Bank account number<input value={bankAccount} onChange={e => setBankAccount(e.target.value.replace(/\D/g, '').slice(0,18))} inputMode="numeric" minLength={8} maxLength={18} autoComplete="off" required/></label><label>IFSC code<input value={bankIfsc} onChange={e => setBankIfsc(e.target.value.toUpperCase().slice(0,11))} minLength={11} maxLength={11} autoComplete="off" required/><small>Only provide details needed to receive a transfer. Never provide a PIN, password or OTP.</small></label></>}{payoutMethod === 'Gift card' && <label>Delivery email or mobile number<input value={giftDelivery} onChange={e => setGiftDelivery(e.target.value)} maxLength={120} autoComplete="email" placeholder="you@example.com or mobile number" required/><small>Gift card delivery is handled manually by an administrator; availability and brand are not guaranteed.</small></label>}<div className="withdrawal-estimate"><span>Estimated redemption value</span><b>{Number.isInteger(requestedPoints) && requestedPoints > 0 ? money(requestedPoints / currentConfig.points_per_rupee) : '—'}</b></div><button className="btn btn-primary" type="submit" disabled={!validRequest}>{requesting ? <LoaderCircle size={15} className="spin"/> : <Send size={15}/>} Submit withdrawal request</button><p className="withdrawal-footnote">Submitting reserves points while the request is pending or approved. Rejected requests release them. A successful request is not a payment confirmation.</p></form></section> : <section className="panel rewards-withdraw-card redemption-paused"><div className="panel-heading"><div><div className="section-kicker">CASH REDEMPTION</div><h3>Withdrawals are not open yet</h3></div><Wallet size={19}/></div><p>Points can accumulate under the contribution rules. An administrator will enable withdrawals when the rewards programme is ready.</p><div className="reward-rule-summary"><div><span>Points for a verified public report</span><b>{currentConfig?.auto_reward_on_verified ? currentConfig.points_for_verified_report : 0}</b></div><div><span>Points for a resolved public report</span><b>{currentConfig?.auto_reward_on_resolved ? currentConfig.points_for_resolved_report : 0}</b></div><div><span>Withdrawal threshold</span><b>{currentConfig?.min_withdrawal_points.toLocaleString() ?? '—'} points</b></div></div></section>}
      <section className="panel reward-history-card"><div className="panel-heading"><div><div className="section-kicker">TRANSPARENT LEDGER</div><h3>Points history</h3></div><Coins size={19}/></div>{loading ? <div className="chat-empty"><LoaderCircle size={22} className="spin"/></div> : recentLedger.length ? <div className="reward-ledger-list">{recentLedger.map(item => <article key={item.id}><span className={`ledger-delta ${item.delta_points < 0 ? 'negative' : ''}`}>{item.delta_points > 0 ? '+' : ''}{item.delta_points.toLocaleString()}</span><div><b>{item.reason}</b><small>{shortDate(item.created_at)}{item.source_report_id ? ` · Report ${item.source_report_id.slice(0, 8)}` : ''}</small></div></article>)}</div> : <div className="chat-empty"><Coins size={25}/><b>No reward points recorded yet</b><span>Points appear after a verified/resolved public report milestone or an authorised manual award.</span></div>}</section>
    </div>
    <section className="panel withdrawal-history"><div className="panel-heading"><div><div className="section-kicker">REQUEST TRACKER</div><h3>Withdrawal requests</h3></div><Clock3 size={18}/></div>{loading ? <p className="reward-muted">Loading requests…</p> : withdrawals.length ? <div className="withdrawal-list">{withdrawals.map(item => <article key={item.id}><div className="withdraw-status-icon"><Clock3 size={17}/></div><div className="withdraw-summary"><b>{money(Number(item.amount_inr))} · {item.points_requested.toLocaleString()} points</b><small>{item.payout_method} · {item.payout_destination} · {shortDate(item.created_at)}</small>{item.admin_note && <p>{item.admin_note}</p>}{item.payout_reference && <small>Transaction reference: {item.payout_reference}</small>}</div><span className={`withdraw-status withdraw-${item.status}`}>{item.status.replace('_', ' ')}</span></article>)}</div> : <div className="chat-empty"><Wallet size={24}/><b>No withdrawal requests yet</b><span>Eligible users can request a payout once cash redemptions are enabled by an administrator.</span></div>}</section>
    <p className="reward-legal-note">A points balance is not cash and does not guarantee payment. Approved withdrawals are paid separately by the programme’s authorised administrator. Withdrawal availability depends on the programme rules and funding.</p>
  </div>
}
