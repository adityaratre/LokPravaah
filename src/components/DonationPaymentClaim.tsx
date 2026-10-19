import { useEffect, useState, type FormEvent } from 'react'
import { AlertCircle, CheckCircle2, Clock3, LoaderCircle, Paperclip, Send, UploadCloud } from 'lucide-react'
import { supabase } from '../lib/supabase'
import './DonationPaymentClaim.css'

type Props = {
  orderId: string
  amountPaise: number
  initialStatus: string
  defaultOpen?: boolean
  onSubmitted?: () => void
}
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
const money = (paise: number) => (paise / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 })

export default function DonationPaymentClaim({ orderId, amountPaise, initialStatus, defaultOpen = false, onSubmitted }: Props) {
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [signedIn, setSignedIn] = useState<boolean | null>(null)

  useEffect(() => {
    let active = true
    void (async () => {
      const { data, error: authError } = await supabase?.auth.getUser() ?? { data: { user: null }, error: null }
      if (active) setSignedIn(!authError && Boolean(data.user))
    })()
    return () => { active = false }
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) { setError('Payment evidence upload is unavailable because Supabase is not configured.'); return }
    if (!orderId || orderId.length < 8) { setError('This checkout does not have a saved donation order. Contact support with the reference displayed by checkout.'); return }
    if (!files.length || files.length > 4) { setError('Attach 1–4 payment screenshots or PDF receipts.'); return }
    if (files.some(file => !ALLOWED_TYPES.has(file.type) || file.size > 10 * 1024 * 1024)) { setError('Each file must be a JPG, PNG, WEBP or PDF no larger than 10 MB.'); return }
    const referenceValue = reference.trim()
    if (referenceValue && !/^[A-Za-z0-9_-]{6,80}$/.test(referenceValue)) { setError('Enter a valid UPI/bank reference (6–80 letters, numbers, underscore or hyphen), or leave it blank.'); return }
    if (note.trim().length < 10 || note.trim().length > 1000) { setError('Explain what happened in 10–1000 characters.'); return }

    setBusy(true); setError(''); setSuccess('')
    const uploadedPaths: string[] = []
    try {
      const { data: userResult, error: authError } = await supabase.auth.getUser()
      const user = userResult.user
      if (authError || !user) {
        setSignedIn(false)
        throw new Error('Please sign in to upload private payment evidence. You do not need to pay again while this is reviewed.')
      }
      setSignedIn(true)
      for (const file of files) {
        const safeName = file.name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-90) || 'payment-proof'
        const path = `${user.id}/${orderId}/${crypto.randomUUID()}-${safeName}`
        const { error: uploadError } = await supabase.storage.from('donation-payment-evidence').upload(path, file, {
          cacheControl: '3600', upsert: false, contentType: file.type,
        })
        if (uploadError) throw new Error(`Screenshot upload failed: ${uploadError.message}`)
        uploadedPaths.push(path)
      }
      const { data, error: rpcError } = await supabase.rpc('janwatch_submit_donation_payment_claim', {
        p_order_id: orderId,
        p_amount_paise: amountPaise,
        p_reference: referenceValue || null,
        p_note: note.trim(),
        p_evidence_paths: uploadedPaths,
      })
      if (rpcError) throw new Error(rpcError.message || 'Could not submit your payment claim.')
      const response = data as { message?: string } | null
      setSuccess(response?.message || 'Payment proof submitted. An administrator will review it.')
      setFiles([]); setReference(''); setNote('')
      onSubmitted?.()
    } catch (caught) {
      if (uploadedPaths.length) await supabase.storage.from('donation-payment-evidence').remove(uploadedPaths).catch(() => undefined)
      setError(caught instanceof Error ? caught.message : 'Payment proof could not be submitted. Please retry.')
    } finally { setBusy(false) }
  }

  return <details className="donation-claim" open={defaultOpen || undefined}>
    <summary><span className="donation-claim-summary-icon"><UploadCloud size={17}/></span><span><b>Paid, but website says failed or pending?</b><small>Submit private payment proof for administrator review. Do not pay again until you have checked your bank status.</small></span></summary>
    <div className="donation-claim-body">
      <div className="donation-claim-order"><span>Donation reference</span><code>{orderId}</code><span>Amount</span><b>{money(amountPaise)}</b><span>Checkout status</span><b>{initialStatus.replaceAll('_', ' ')}</b></div>
      {signedIn === false && <div className="donation-claim-alert"><AlertCircle size={16}/><span>Sign in to LokPravaah before submitting evidence. Screenshots stay private and are only available to you and authorised administrators.</span></div>}
      <form onSubmit={submit} className="donation-claim-form">
        <label>UPI / bank reference (optional)<input value={reference} onChange={e => setReference(e.target.value)} maxLength={80} autoComplete="off" placeholder="UTR / transaction reference"/></label>
        <label>What happened?<textarea value={note} onChange={e => setNote(e.target.value)} minLength={10} maxLength={1000} rows={3} required placeholder="For example: money was debited at 7:25 PM, but the donation remained pending."/></label>
        <label className="donation-claim-upload"><span>Payment screenshot / receipt</span><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple onChange={e => setFiles(Array.from(e.target.files || []))} required/><small><Paperclip size={13}/> 1–4 files · JPG, PNG, WEBP or PDF · 10 MB max each · no UPI PIN/OTP screenshots</small></label>
        {files.length > 0 && <div className="donation-claim-files">{files.map(file => <span key={`${file.name}-${file.size}`}><Paperclip size={12}/>{file.name}</span>)}</div>}
        {error && <p className="donation-claim-alert" role="alert"><AlertCircle size={16}/>{error}</p>}
        {success && <p className="donation-claim-success" role="status"><CheckCircle2 size={16}/>{success}</p>}
        <button className="donation-claim-submit" type="submit" disabled={busy || signedIn === false}>{busy ? <LoaderCircle size={15} className="donation-spin"/> : <Send size={15}/>} {busy ? 'Uploading securely…' : 'Submit payment proof'}</button>
      </form>
      <p className="donation-claim-foot"><Clock3 size={13}/> Your upload does not itself confirm payment. An administrator must verify the bank credit and UTR before approving it.</p>
    </div>
  </details>
}
