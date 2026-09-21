import {useEffect,useRef,useState} from 'react'
import type {AppClient} from '../../platform/supabase'
import {draftStore} from '../../platform/drafts'
import {newItem} from './model'
import {saveWork} from '../../services/work'
import {useDraftGuard} from './useDraftGuard'
export function Capture({client,userId,onClose,onSaved}:{client:AppClient;userId:string;onClose:()=>void;onSaved:()=>void}) {
 const [initial]=useState(()=>{
  try{const draft=draftStore(localStorage,userId).read('quick-capture');if(draft){const data=JSON.parse(draft.text) as {id:string;text:string};if(typeof data.id!=='string'||typeof data.text!=='string')throw new Error();return {...data,error:''}}}
  catch{return {id:crypto.randomUUID(),text:'',error:'Draft storage is unavailable. Copy your writing before closing.'}}
  return {id:crypto.randomUUID(),text:'',error:''}
 })
 const [text,setText]=useState(initial.text),[error,setError]=useState(initial.error),[status,setStatus]=useState(initial.text?'Recovered your unsaved capture.':''),[busy,setBusy]=useState(false)
 const [localSafe,setLocalSafe]=useState(!initial.error)
 const saving=useRef(false),dialog=useRef<HTMLDialogElement>(null)
 useDraftGuard(Boolean(text))
 useEffect(()=>{dialog.current?.showModal()},[])
 function change(value:string){setText(value);try{if(initial.error)throw new Error('Preserve unreadable draft');draftStore(localStorage,userId).save('quick-capture',JSON.stringify({id:initial.id,text:value}));setStatus('Draft saved on this device.');setLocalSafe(true);setError('')}catch{setLocalSafe(false);setStatus('Draft not saved.');setError('Keep this window open or copy your writing. Device storage is unavailable.')}}
 async function save(event:React.FormEvent){event.preventDefault();if(saving.current||!text.trim())return;saving.current=true;setBusy(true);setError('');setStatus('Saving…');try{
  await saveWork(client,{...newItem('journal',userId),id:initial.id,title:text.trim().split('\n')[0]!.slice(0,120),body:text,entry_type:'Capture'})
  draftStore(localStorage,userId).acknowledge('quick-capture',JSON.stringify({id:initial.id,text}));onSaved()
 }catch(caught){setError((caught as Error).message);setStatus('Not saved to server. Retry when connected.')}finally{saving.current=false;setBusy(false)}}
 function close(){if(localSafe||confirm('This capture is not saved locally. Copy it before closing. Close anyway?'))onClose()}
 function discard(){if(confirm('Discard this unsaved capture?')){try{draftStore(localStorage,userId).discard('quick-capture');onClose()}catch{setError('Could not remove the draft.')}}}
 return <dialog ref={dialog} className="record-dialog" aria-labelledby="capture-title" onCancel={event=>{event.preventDefault();if(!busy)close()}}><form onSubmit={event=>void save(event)}><div className="dialog-heading"><h2 id="capture-title">Quick Capture</h2><button aria-label="Close capture" type="button" onClick={close} disabled={busy}>×</button></div><label>What’s on your mind?<textarea autoFocus required rows={10} maxLength={50000} value={text} disabled={busy} onChange={e=>change(e.target.value)}/></label><p className="muted small">Saved to your Journal. No classification needed; your original words are preserved.</p><p role="status">{status}</p>{error&&<p role="alert" className="error-message">{error}</p>}<div className="actions"><button className="save-button" disabled={busy||!text.trim()}>{busy?'Saving…':'Save capture'}</button><button type="button" disabled={busy} onClick={close}>Close · keep draft</button><button type="button" disabled={busy} onClick={discard}>Discard capture</button></div></form></dialog>
}
