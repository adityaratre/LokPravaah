import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowRight, Download, FileArchive, FileDown, LoaderCircle, Plus, RefreshCw, Trash2, UploadCloud, Eye, EyeOff, CheckCircle2, AlertCircle, Smartphone, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import './Downloads.css'

export type PublicDownloadInfo = { title: string; fileName: string; href: string }

type DownloadRow = {
  id: string; title: string; description: string | null; file_name: string
  storage_path: string; file_size: number; version: string | null
  is_published: boolean; created_at: string
}
const readableSize = (n: number) => n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`
const getPublicUrl = (path: string) => supabase?.storage.from('app-downloads').getPublicUrl(path).data.publicUrl ?? '#'

export function PublicDownloads({ onDownloadStarted, dedicatedPage = false, promotionOnly = false }: { onDownloadStarted?: (download: PublicDownloadInfo) => void; dedicatedPage?: boolean; promotionOnly?: boolean } = {}) {
  const [rows, setRows] = useState<DownloadRow[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [popupOpen, setPopupOpen] = useState(false)
  const [popupDismissed, setPopupDismissed] = useState(true)
  useEffect(() => {
    const mobileQuery = window.matchMedia('(max-width: 767px)')
    const mobileUserAgent = /Android|iPhone|iPod|Mobile/i.test(navigator.userAgent)
    const updateDevice = () => setIsMobile(mobileQuery.matches || mobileUserAgent)
    updateDevice()
    mobileQuery.addEventListener?.('change', updateDevice)
    try { setPopupDismissed(localStorage.getItem('lokpravaah.appPromptDismissed') === '1') } catch { /* optional storage */ }
    return () => mobileQuery.removeEventListener?.('change', updateDevice)
  }, [])
  useEffect(() => {
    if (dedicatedPage || !isMobile || popupDismissed) return
    const timer = window.setTimeout(() => setPopupOpen(true), 2500)
    return () => window.clearTimeout(timer)
  }, [dedicatedPage, isMobile, popupDismissed])
  const dismissPopup = (remember = false) => {
    setPopupOpen(false)
    if (remember) {
      try { localStorage.setItem('lokpravaah.appPromptDismissed', '1') } catch { /* optional storage */ }
      setPopupDismissed(true)
    }
  }
  const load = useCallback(async () => {
    if (!supabase) { setLoading(false); setFailed(true); return }
    setLoading(true); setFailed(false)
    const { data, error } = await supabase.from('download_files')
      .select('id,title,description,file_name,storage_path,file_size,version,is_published,created_at')
      .eq('is_published', true).order('created_at', { ascending: false }).limit(24)
    if (error) setFailed(true)
    setRows((data ?? []) as DownloadRow[])
    setLoading(false)
  }, [])
  useEffect(() => { void load() }, [load])
  if (!isMobile && !dedicatedPage) return null
  return <>{!promotionOnly && <section className={`public-downloads ${dedicatedPage ? 'public-downloads-dedicated' : ''}`} id="lokpravaah-downloads" aria-labelledby="downloads-title">
    <div className="public-downloads-heading"><div><span className="downloads-kicker">LOKPRAVAAH DOWNLOAD CENTRE</span><h2 id="downloads-title">Useful tools, <em>one click away.</em></h2><p>Official downloads published by the LokPravaah team.</p></div><span className="downloads-badge"><FileDown size={16}/> Official files</span></div>
    {loading ? <div className="downloads-empty"><LoaderCircle className="downloads-spin" size={23}/> Loading available downloads…</div> :
      failed ? <div className="downloads-empty"><AlertCircle size={22}/><span>Downloads could not be loaded. Please try again.</span><button className="downloads-secondary" onClick={() => void load()}>Retry</button></div> :
      rows.length === 0 ? <div className="downloads-empty"><FileArchive size={25}/><div><b>Downloads are coming soon</b><span>Published apps and files will appear here.</span></div></div> :
      <div className="public-download-grid">{rows.map(row => <article className="public-download-card" key={row.id}><div className="download-file-icon"><FileArchive size={22}/></div><div className="download-file-info"><div className="download-file-title">{row.title}</div>{row.description && <p>{row.description}</p>}<div className="download-file-meta">{row.version ? <span>v{row.version}</span> : null}<span>{readableSize(Number(row.file_size))}</span><span>{row.file_name.split('.').pop()?.toUpperCase() || 'FILE'}</span></div><a className="downloads-primary" href={getPublicUrl(row.storage_path)} download={row.file_name} target="_blank" rel="noreferrer" onClick={() => { const download = { title: row.title, fileName: row.file_name, href: getPublicUrl(row.storage_path) }; window.setTimeout(() => onDownloadStarted?.(download), 120) }}><Download size={15}/> Download file</a></div></article>)}</div>}
  </section>}
    {!dedicatedPage && isMobile && <button type="button" className="mobile-app-fab" onClick={() => window.location.assign('/downloads/')}><Smartphone size={17}/> Get the app</button>}
    {popupOpen && <div className="mobile-app-backdrop" role="presentation" onClick={() => dismissPopup()}><section className="mobile-app-popup" role="dialog" aria-modal="true" aria-labelledby="mobile-app-title" onClick={event => event.stopPropagation()}><button type="button" className="mobile-app-popup-close" aria-label="Close app prompt" onClick={() => dismissPopup()}><X size={18}/></button><div className="mobile-app-popup-icon"><Smartphone size={25}/></div><span className="downloads-kicker">LOKPRAVAAH FOR ANDROID</span><h2 id="mobile-app-title">Your community, closer.</h2><p>Get the LokPravaah Android app from the official download centre.</p><button type="button" className="downloads-primary" onClick={() => { dismissPopup(); window.location.assign('/downloads/') }}><Download size={16}/> Open download centre</button><button type="button" className="mobile-app-never" onClick={() => dismissPopup(true)}>Don’t show again</button></section></div>}
  </>
}

export function DownloadsAdmin({ userId }: { userId: string }) {
  const [rows, setRows] = useState<DownloadRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [version, setVersion] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [publish, setPublish] = useState(true)
  const [message, setMessage] = useState<{kind:'ok'|'error';text:string}|null>(null)
  const load = useCallback(async () => {
    if (!supabase) { setLoading(false); return }
    setLoading(true)
    const { data, error } = await supabase.from('download_files')
      .select('id,title,description,file_name,storage_path,file_size,version,is_published,created_at')
      .order('created_at', { ascending: false })
    if (error) setMessage({kind:'error',text:error.message})
    setRows((data ?? []) as DownloadRow[]); setLoading(false)
  }, [])
  useEffect(() => { void load() }, [load])
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage(null)
    if (!supabase) { setMessage({kind:'error',text:'Supabase is not configured.'}); return }
    if (!file) { setMessage({kind:'error',text:'Choose a file to upload first.'}); return }
    if (file.size <= 0 || file.size > 500 * 1024 * 1024) { setMessage({kind:'error',text:'File size must be between 1 byte and 500 MB.'}); return }
    if (title.trim().length < 2 || title.trim().length > 140) { setMessage({kind:'error',text:'Title must be 2–140 characters.'}); return }
    setBusy(true)
    const safeName = file.name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(-120) || 'download.bin'
    const path = `${userId}/${Date.now()}-${safeName}`
    const upload = await supabase.storage.from('app-downloads').upload(path, file, { upsert: false, contentType: file.type || 'application/octet-stream' })
    if (upload.error) { setMessage({kind:'error',text:`Upload failed: ${upload.error.message}`}); setBusy(false); return }
    const insert = await supabase.from('download_files').insert({
      title: title.trim(), description: description.trim() || null, file_name: file.name,
      storage_path: path, file_size: file.size, version: version.trim() || null,
      is_published: publish, created_by: userId
    })
    if (insert.error) {
      await supabase.storage.from('app-downloads').remove([path])
      setMessage({kind:'error',text:`File uploaded but its listing could not be saved: ${insert.error.message}`})
    } else {
      setTitle(''); setDescription(''); setVersion(''); setFile(null)
      const input = document.getElementById('download-file-input') as HTMLInputElement | null
      if (input) input.value = ''
      setMessage({kind:'ok',text:publish ? 'File uploaded and published on the welcome page.' : 'File uploaded as a draft.'})
      await load()
    }
    setBusy(false)
  }
  async function togglePublished(row: DownloadRow) {
    if (!supabase || busy) return
    setBusy(true); setMessage(null)
    const { error } = await supabase.from('download_files').update({is_published:!row.is_published}).eq('id',row.id)
    if (error) setMessage({kind:'error',text:error.message})
    else { setMessage({kind:'ok',text:row.is_published ? 'Download hidden from the welcome page.' : 'Download published on the welcome page.'}); await load() }
    setBusy(false)
  }
  async function removeRow(row: DownloadRow) {
    if (!supabase || busy) return
    if (!window.confirm(`Delete “${row.title}” and its stored file permanently?`)) return
    setBusy(true); setMessage(null)
    const { error: storageError } = await supabase.storage.from('app-downloads').remove([row.storage_path])
    if (storageError) { setMessage({kind:'error',text:`Could not delete stored file: ${storageError.message}`}); setBusy(false); return }
    const { error } = await supabase.from('download_files').delete().eq('id',row.id)
    if (error) setMessage({kind:'error',text:`Stored file was removed, but listing deletion failed: ${error.message}`})
    else setMessage({kind:'ok',text:'Download deleted.'})
    await load(); setBusy(false)
  }
  return <section className="downloads-admin">
    <div className="downloads-admin-heading"><div><span className="downloads-kicker">SUPER ADMIN · CONTENT MANAGEMENT</span><h2>Download <em>centre</em></h2><p>Upload an app or file, then publish it to the public welcome page. Nothing is added to the signed-in dashboard.</p></div><button className="downloads-secondary" type="button" onClick={() => void load()} disabled={loading || busy}><RefreshCw size={15} className={loading ? 'downloads-spin' : ''}/> Refresh</button></div>
    {message && <div className={`downloads-message ${message.kind}`}>{message.kind === 'ok' ? <CheckCircle2 size={17}/> : <AlertCircle size={17}/>}<span>{message.text}</span></div>}
    <form className="downloads-upload-form" onSubmit={submit}><div className="downloads-form-title"><UploadCloud size={20}/><div><b>Upload a new file</b><span>Maximum file size: 500 MB</span></div></div>
      <label>Display title<input value={title} onChange={e=>setTitle(e.target.value)} required minLength={2} maxLength={140} placeholder="e.g. LokPravaah Android App"/></label>
      <label>Description<textarea value={description} onChange={e=>setDescription(e.target.value)} rows={3} maxLength={1000} placeholder="What is this file and who should use it?"/></label>
      <div className="downloads-form-row"><label>Version (optional)<input value={version} onChange={e=>setVersion(e.target.value)} maxLength={40} placeholder="e.g. 1.0.0"/></label><label>File<input id="download-file-input" type="file" required onChange={e=>setFile(e.target.files?.[0] ?? null)}/>{file && <small>{file.name} · {readableSize(file.size)}</small>}</label></div>
      <label className="downloads-publish-toggle"><input type="checkbox" checked={publish} onChange={e=>setPublish(e.target.checked)}/><span><b>Publish immediately</b><small>If unchecked, only super admins can see the draft in this console.</small></span></label>
      <button className="downloads-primary" type="submit" disabled={busy}>{busy ? <LoaderCircle size={16} className="downloads-spin"/> : <UploadCloud size={16}/>} {busy ? 'Uploading…' : publish ? 'Upload & publish' : 'Upload as draft'}</button>
    </form>
    <div className="downloads-list-heading"><h3>Uploaded files <span>{rows.length}</span></h3></div>
    {loading ? <div className="downloads-empty"><LoaderCircle size={22} className="downloads-spin"/> Loading files…</div> : rows.length === 0 ? <div className="downloads-empty">No files uploaded yet.</div> : <div className="downloads-admin-list">{rows.map(row=><article className="downloads-admin-row" key={row.id}><div className="download-file-icon"><FileArchive size={21}/></div><div className="download-file-info"><b>{row.title}</b><span>{row.file_name} · {readableSize(Number(row.file_size))}{row.version ? ` · v${row.version}` : ''}</span><span className={row.is_published ? 'downloads-status published' : 'downloads-status draft'}>{row.is_published ? 'Published on welcome page' : 'Draft / hidden'}</span></div><div className="downloads-admin-actions"><a className="downloads-icon-button" href={getPublicUrl(row.storage_path)} target="_blank" rel="noreferrer" aria-label={`Preview ${row.title}`}><Download size={16}/></a><button className="downloads-icon-button" type="button" disabled={busy} onClick={()=>void togglePublished(row)} aria-label={row.is_published?'Hide download':'Publish download'}>{row.is_published ? <EyeOff size={16}/> : <Eye size={16}/>}</button><button className="downloads-icon-button danger" type="button" disabled={busy} onClick={()=>void removeRow(row)} aria-label={`Delete ${row.title}`}><Trash2 size={16}/></button></div></article>)}</div>}
  </section>
}


export function DownloadThankYou({ download, onSignIn, onBack }: { download: PublicDownloadInfo; onSignIn: () => void; onBack: () => void }) {
  const [countdown, setCountdown] = useState(7)
  const onSignInRef = useRef(onSignIn)
  useEffect(() => { onSignInRef.current = onSignIn }, [onSignIn])
  useEffect(() => {
    setCountdown(7)
    const interval = window.setInterval(() => setCountdown(value => Math.max(0, value - 1)), 1000)
    const redirect = window.setTimeout(() => onSignInRef.current(), 7000)
    return () => { window.clearInterval(interval); window.clearTimeout(redirect) }
  }, [])
  return <main className="downloads-thankyou-page" aria-labelledby="download-thankyou-title">
    <section className="downloads-thankyou-card">
      <div className="downloads-thankyou-icon"><CheckCircle2 size={32}/></div>
      <span className="downloads-kicker">LOKPRAVAAH DOWNLOAD CENTRE</span>
      <h1 id="download-thankyou-title">Thanks for choosing LokPravaah.</h1>
      <p className="downloads-thankyou-lead">Your download request for <strong>{download.title}</strong> has started in a new tab. You can sign in to continue using the civic-action platform.</p>
      <div className="downloads-countdown"><LoaderCircle size={17} className="downloads-spin"/><span>Taking you to sign in in <strong>{countdown} {countdown === 1 ? 'second' : 'seconds'}</strong>.</span></div>
      <a className="downloads-primary downloads-thankyou-retry" href={download.href} download={download.fileName} target="_blank" rel="noreferrer"><Download size={16}/> Download again</a>
      <button type="button" className="downloads-secondary downloads-thankyou-signin" onClick={onSignIn}>Sign in now <ArrowRight size={16}/></button>
      <button type="button" className="downloads-thankyou-back" onClick={onBack}>Back to website</button>
      <p className="downloads-thankyou-footnote">If the file did not start downloading, use “Download again” above. The Android app may request installation permission from your phone.</p>
    </section>
  </main>
}
