import { useState } from 'react'
import { AlertCircle, CheckCircle2, LoaderCircle, Send, Sparkles, ShieldCheck, RefreshCw } from 'lucide-react'
import { supabase } from '../lib/supabase'

type AIResult = { answer?: string; ai_available?: boolean; message?: string }

const STARTER_PROMPTS = [
  'Help me write a clear civic complaint about a blocked drain.',
  'What evidence should I collect for a broken streetlight report?',
  'Turn my observations into a neutral, factual summary.'
]

const UNAVAILABLE_MESSAGE = 'LokPravaah AI could not prepare a response right now. Please try again shortly, or continue with the complaint and RTI drafting tools.'

async function friendlyInvokeFailure(error: unknown): Promise<string> {
  const value = error as { context?: unknown; message?: unknown } | null
  const response = value?.context instanceof Response ? value.context : null
  if (response) {
    if (response.status === 401) return 'Your session may have expired. Sign in again and retry.'
    if (response.status === 404) return 'The AI assistant is not connected to this site yet. Please try again later.'
    if (response.status === 429) return 'You have sent several requests in a short time. Please wait a moment and try again.'
    if (response.status >= 500) return UNAVAILABLE_MESSAGE
  }
  const message = String(value?.message ?? '').toLowerCase()
  if (message.includes('failed to fetch') || message.includes('network') || message.includes('fetch')) return 'We could not reach the AI assistant. Check your connection and try again.'
  return UNAVAILABLE_MESSAGE
}

export default function JanwatchAI() {
  const [prompt, setPrompt] = useState('')
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)

  async function askAI(value = prompt) {
    if (busy) return
    const question = value.trim()
    if (!question) { setError('Please enter your question.'); return }
    if (question.length > 4000) { setError('Please keep your question under 4,000 characters.'); return }
    setBusy(true); setError(''); setUnavailable(false); setAnswer('')
    try {
      if (!supabase) throw new Error('service-unavailable')
      const { data, error: invokeError } = await supabase.functions.invoke('janwatch-ai', { body: { prompt: question, task: 'civic_assistant' } })
      if (invokeError) {
        const message = await friendlyInvokeFailure(invokeError)
        setUnavailable(true)
        setAnswer(message)
        console.warn('LokPravaah AI request could not be completed.', { status: (invokeError as { context?: Response }).context instanceof Response ? ((invokeError as { context: Response }).context.status) : 'network-or-deployment' })
        return
      }
      const result = (data ?? {}) as AIResult
      if (result.ai_available === false) {
        setUnavailable(true)
        setAnswer(result.message?.trim() || UNAVAILABLE_MESSAGE)
        return
      }
      if (!result.answer?.trim()) {
        setUnavailable(true)
        setAnswer(UNAVAILABLE_MESSAGE)
        return
      }
      setAnswer(result.answer.trim())
    } catch (e) {
      // Never expose secret names, model IDs or provider details in the public interface.
      console.warn('LokPravaah AI request could not be completed.', e instanceof Error ? e.name : 'unknown-error')
      setUnavailable(true)
      setAnswer(UNAVAILABLE_MESSAGE)
    } finally { setBusy(false) }
  }

  return <section className="panel toolkit-panel lokpravaah-ai-panel">
    <div className="toolkit-panel-heading"><div className="toolkit-icon"><Sparkles size={21}/></div><div><div className="section-kicker">AI CIVIC ASSISTANT</div><h2>LokPravaah AI</h2><p>Get help organising observations, preparing civic drafts, and forming clear questions for an authority.</p></div></div>
    <div className="ai-safety-note"><ShieldCheck size={18}/><span>AI can make mistakes. Check important facts and official procedures before acting. This assistant does not submit complaints or replace professional advice.</span></div>
    <div className="ai-starters">{STARTER_PROMPTS.map(item => <button key={item} type="button" className="ai-starter" disabled={busy} onClick={() => { setPrompt(item); void askAI(item) }}>{item}</button>)}</div>
    <form className="ai-prompt-form" onSubmit={e => { e.preventDefault(); void askAI() }}><label htmlFor="lokpravaah-ai-prompt">Your question</label><textarea id="lokpravaah-ai-prompt" value={prompt} onChange={e => setPrompt(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void askAI() } }} maxLength={4000} rows={5} placeholder="Describe the issue. Press Enter to send or Shift+Enter for a new line. Avoid sharing sensitive personal information." aria-describedby="lokpravaah-ai-enter-hint"/><div className="ai-prompt-footer"><span id="lokpravaah-ai-enter-hint">{prompt.length}/4000 characters · Enter to send</span><button className="btn btn-primary" type="submit" disabled={busy || !prompt.trim()}>{busy ? <><LoaderCircle size={16} className="spin"/> Preparing response…</> : <><Send size={15}/> Ask LokPravaah AI</>}</button></div></form>
    {error && <div className="ai-error" role="alert"><AlertCircle size={16}/><span>{error}</span></div>}
    {answer && <div className={`ai-answer ${unavailable ? 'ai-answer-fallback' : ''}`} aria-live="polite"><div className="ai-answer-head">{unavailable ? <AlertCircle size={17}/> : <CheckCircle2 size={17}/>}<b>{unavailable ? 'Temporarily unavailable' : 'LokPravaah AI'}</b></div><div className="ai-answer-text">{answer}</div>{unavailable && <button type="button" className="btn btn-secondary ai-retry" onClick={() => void askAI()} disabled={busy || !prompt.trim()}><RefreshCw size={14}/> Try again</button>}</div>}
  </section>
}
