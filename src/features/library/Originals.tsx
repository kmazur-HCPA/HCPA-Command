import {useEffect,useRef,useState} from 'react'
import type {AppClient} from '../../platform/supabase'
import type {WorkItem} from '../work/model'
import {listVersions,uploadOriginal,downloadOriginal} from '../../services/library'
import type {LibraryVersion} from '../../services/library'
import {draftStore} from '../../platform/drafts'
import {useDraftGuard} from '../work/useDraftGuard'
export function Originals({client,item}:{client:AppClient;item:WorkItem}){
 const key=`upload:${item.id}`
 const [initial]=useState(()=>{try{const stored=draftStore(localStorage,item.user_id).read(key);return {attempt:stored?JSON.parse(stored.text) as {id:string;filename:string}:null,error:''}}catch{return {attempt:null,error:'Upload retry information is unreadable. Export or discard it in Settings, then reopen this record.'}}})
 const [attempt,setAttempt]=useState(initial.attempt),[file,setFile]=useState<File|null>(null),[rows,setRows]=useState<LibraryVersion[]>([]),[error,setError]=useState(initial.error),[message,setMessage]=useState(''),[progress,setProgress]=useState(0),[busy,setBusy]=useState(false),[downloading,setDownloading]=useState(false),[revision,setRevision]=useState(0),[offset,setOffset]=useState(0),[more,setMore]=useState(false)
 const controller=useRef<AbortController|null>(null)
 useDraftGuard(busy)
 useEffect(()=>()=>controller.current?.abort(),[])
 useEffect(()=>{let alive=true;listVersions(client,item.id,offset).then(data=>{if(alive){setRows(old=>offset?[...old,...data]:data);setMore(data.length===20)}}).catch(caught=>{if(alive)setError((caught as Error).message)});return()=>{alive=false}},[client,item.id,offset,revision])
 async function upload(){
  if(!file||busy)return
  if(initial.error){setError(initial.error);return}
  if(file.size>5*1024*1024||!file.size){setError('Choose a nonempty file of at most 5 MiB.');return}
  if(attempt&&file.name!==attempt.filename){setError(`Select ${attempt.filename} to retry, or start another version.`);return}
  const next=attempt??{id:crypto.randomUUID(),filename:file.name}
  try{draftStore(localStorage,item.user_id).save(key,JSON.stringify(next))}catch{setError('Could not save retry information. Resolve device storage before uploading.');return}
  setAttempt(next);setBusy(true);setError('');setMessage('');setProgress(0);controller.current=new AbortController()
  try{await uploadOriginal(client,item.id,next.id,file,setProgress,controller.current.signal);draftStore(localStorage,item.user_id).discard(key);setAttempt(null);setFile(null);setMessage('Original verified and saved. Previous versions are preserved.');setOffset(0);setRevision(v=>v+1)}catch(caught){setError((caught as Error).message);setRevision(v=>v+1)}finally{setBusy(false)}
 }
 function retry(row:LibraryVersion){const next={id:row.id,filename:row.filename};try{draftStore(localStorage,item.user_id).save(key,JSON.stringify(next));setAttempt(next);setMessage(`Select ${row.filename}, then retry upload.`)}catch{setError('Retry information could not be saved.')}}
 return <section className="originals"><h2>Original documents</h2><p className="muted">PDF, TXT, MD, CSV, JSON, DOCX, XLSX or PPTX · up to 5 MiB. No macros, embedded objects, encrypted PDFs or external Office relationships. Downloads are original files; use an HCPA-managed application to open them.</p>
 {!item.archived&&<><label>Choose original file<input type="file" accept=".pdf,.txt,.md,.csv,.json,.docx,.xlsx,.pptx" disabled={busy} onChange={e=>setFile(e.target.files?.[0]??null)}/></label>
 {attempt&&<p className="notice">Pending attempt: {attempt.filename}. Reselect the same original after a reload.</p>}
 <div className="actions"><button disabled={busy||!file} onClick={()=>void upload()}>{attempt?'Retry upload':'Upload new version'}</button>{attempt&&!busy&&<button onClick={()=>{if(confirm('Start another version? Any server-side pending original is retained.')){try{draftStore(localStorage,item.user_id).discard(key);setAttempt(null);setError('')}catch{setError('Could not clear retry information.')}}}}>Start another version</button>}</div></>}
 {downloading&&<p role="status">Downloading and verifying original…</p>}
 {busy&&!downloading&&<><progress max={100} value={progress} aria-label="Upload progress"/><p role="status">{progress<100?`Uploading · ${progress}%`:'Transferred · validating and saving…'}</p></>}
 {message&&<p role="status">{message}</p>}{error&&<p role="alert" className="error-message">{error}</p>}
 {!rows.length&&<p className="muted">No original versions recorded yet.</p>}
 <ul className="record-list">{rows.map(row=><li key={row.id}><strong>{row.filename}</strong><p className="muted small">{new Date(row.created_at).toLocaleString()} · {Math.ceil(row.size_bytes/1024)} KiB · {row.state==='ready'?'Verified original':'Pending — retry required'}</p>{row.state==='ready'?<button disabled={busy} onClick={()=>{setBusy(true);setDownloading(true);setError('');void downloadOriginal(client,row).catch(caught=>setError((caught as Error).message)).finally(()=>{setBusy(false);setDownloading(false)})}}>Download original</button>:<button disabled={busy||item.archived} onClick={()=>retry(row)}>Recover pending upload</button>}<details><summary>Integrity</summary><code className="file-hash">SHA-256 {row.sha256}</code></details></li>)}</ul>{more&&<button onClick={()=>setOffset(rows.length)}>Earlier originals</button>}
 </section>
}
