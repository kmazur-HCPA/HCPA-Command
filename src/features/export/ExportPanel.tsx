import {useEffect,useRef,useState} from 'react'
import type {AppClient} from '../../platform/supabase'
import {useDraftGuard} from '../work/useDraftGuard'
export function ExportPanel({client}:{client:AppClient}){
 const controller=useRef<AbortController|null>(null),[busy,setBusy]=useState(false),[progress,setProgress]=useState(''),[error,setError]=useState(''),[complete,setComplete]=useState('')
 useEffect(()=>()=>controller.current?.abort(),[])
 useDraftGuard(busy)
 async function run(){
  controller.current=new AbortController();const signal=controller.current.signal;setBusy(true);setError('');setComplete('')
  try{const {createWorkspaceExport}=await import('../../services/export');const result=await createWorkspaceExport(client,signal,setProgress);signal.throwIfAborted();const url=URL.createObjectURL(result.blob),link=document.createElement('a');link.href=url;link.download=result.filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);setComplete(`Export ready: ${result.records} records and ${result.originals} verified originals.${result.pending?` ${result.pending} unfinished uploads are listed as pending.`:''}`)}catch(caught){setError(signal.aborted?'Export cancelled. No partial archive was saved.':caught instanceof Error?caught.message:'Export failed. No archive was saved.')}finally{setBusy(false);setProgress('')}
 }
 return <section className="settings-panel"><h2>Export your workspace</h2><p className="muted">Download a ZIP with all saved records, archived items, relationships, history, settings, and every verified original document. JSON preserves the full data; CSV provides a spreadsheet view.</p><p className="small muted">Unsaved local drafts are separate—save them first or export them below. Store exports in an HCPA-approved protected location.</p><div className="actions"><button disabled={busy} onClick={()=>void run()}>Export workspace</button>{busy&&<button onClick={()=>controller.current?.abort()}>Cancel export</button>}</div>{busy&&<p role="status">{progress}</p>}{error&&<p className="error-message" role="alert">{error}</p>}{complete&&<p className="notice" role="status">{complete}</p>}</section>
}
