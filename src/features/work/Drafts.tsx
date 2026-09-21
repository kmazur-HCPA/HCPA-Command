import {useState} from 'react'
import {listDrafts} from '../../platform/drafts'
export function Drafts({userId}:{userId:string}) {
 const [version,setVersion]=useState(0),[error,setError]=useState('')
 let drafts:ReturnType<typeof listDrafts>=[]
 try{drafts=listDrafts(localStorage,userId)}catch{/* Report unavailable below through action errors. */}
 function download(key:string,text:string){const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`command-draft-${key.split(':').at(-1)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
 return <section className="settings-panel" key={version}><h2>Local drafts</h2><p className="muted">Reopen Quick Capture or the record editor to resume. Export before discarding if you need a copy.</p>{drafts.length?<ul>{drafts.map(draft=><li key={draft.key}><span>{decodeURIComponent(draft.key.split(':').at(-1)??'Draft')}</span><div className="actions"><button onClick={()=>download(draft.key,draft.text)}>Export draft</button><button onClick={()=>{if(confirm('Permanently discard this local draft?'))try{localStorage.removeItem(draft.key);setVersion(v=>v+1)}catch{setError('Could not remove draft.')}}}>Discard draft</button></div></li>)}</ul>:<p>No stored drafts.</p>}{error&&<p role="alert">{error}</p>}</section>
}
