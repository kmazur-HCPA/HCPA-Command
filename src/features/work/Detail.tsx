import {useEffect,useRef,useState} from 'react'
import type {AppClient} from '../../platform/supabase'
import {getWork,listWork,patchWork} from '../../services/work'
import type {WorkFilter} from '../../services/work'
import type {WorkItem,WorkSummary} from './model'
import {priorities,statuses} from './model'
import {Editor} from './Editor'
import {displayDate} from './dates'
import {ProjectView,PersonView} from './ContextView'
export function Detail({client,userId,id,onClose,modal=false,onChanged}:{client:AppClient;userId:string;id:string;onClose:()=>void;modal?:boolean;onChanged?:()=>void}) {
 const [quickSaving,setQuickSaving]=useState(false),[quickNotice,setQuickNotice]=useState('')
 const quickLock=useRef(false)
 const dialog=useRef<HTMLDialogElement>(null)
 useEffect(()=>{if(modal)dialog.current?.showModal()},[modal])
 const [item,setItem]=useState<WorkItem|null>(null),[error,setError]=useState(''),[editing,setEditing]=useState(false),[linked,setLinked]=useState<WorkItem[]>([]),[related,setRelated]=useState<WorkSummary[]>([]),[offset,setOffset]=useState(0),[more,setMore]=useState(false),[revision,setRevision]=useState(0)
 useEffect(()=>{let alive=true;getWork(client,id).then(async row=>{if(!alive)return;setItem(row);const ids=[row.project_id,row.person_id,row.task_id,row.converted_task_id].filter((v):v is string=>!!v);const links=await Promise.all([...new Set(ids)].map(value=>getWork(client,value)));if(alive)setLinked(links)}).catch(caught=>{if(alive)setError((caught as Error).message)});return()=>{alive=false}},[client,id,revision])
 const kind=item?.kind
 useEffect(()=>{
  if(!kind)return
  let alive=true;const filter:WorkFilter={offset}
  if(kind==='project')filter.projectId=id;else if(kind==='person')filter.personId=id;else if(kind==='task')filter.taskId=id;else return
  listWork(client,filter).then(rows=>{if(alive){setRelated(old=>offset?[...old,...rows]:rows);setMore(rows.length===50)}}).catch(caught=>{if(alive)setError((caught as Error).message)})
  return()=>{alive=false}
 },[client,id,kind,offset,revision])
 async function quickUpdate(patch:Partial<WorkItem>){
  if(!item||quickLock.current)return
  quickLock.current=true;setQuickSaving(true);setError('');setQuickNotice('Saving…')
  try{const updated=await patchWork(client,item,patch);setItem(updated);setQuickNotice('Saved');onChanged?.()}
  catch(caught){setError(caught instanceof Error?caught.message:'Unable to save changes.');setQuickNotice('')}
  finally{quickLock.current=false;setQuickSaving(false)}
 }
 function saved(){onChanged?.();setEditing(false);setOffset(0);setRevision(v=>v+1)}
 const content = modal&&editing&&item ? <Editor embedded client={client} userId={userId} kind={item.kind} item={item} onClose={()=>setEditing(false)} onSaved={saved}/> : <section>{!modal&&<button className="btn btn--ghost back-link" disabled={quickSaving} onClick={onClose}>Back to list</button>}{error&&<p role="alert" className="error-message">{error}</p>}{!item&&!error&&<p role="status">Loading record…</p>}{item&&<>
  <div className="section-heading"><div><p className="eyebrow">{item.kind}{item.archived?' · Archived':''}</p><h1 id="detail-title" tabIndex={-1}>{item.title}</h1></div><button className="btn" disabled={quickSaving} onClick={()=>{setQuickNotice('');setEditing(true)}}>Edit</button></div>
  {item.kind==='task'&&<div className="task-quick-edit">
   <div className="task-quick-fields">
    <label>Priority<select value={item.priority} disabled={quickSaving} onChange={event=>void quickUpdate({priority:event.target.value})}>{priorities.map(value=><option key={value}>{value}</option>)}</select></label>
    <label>Due date<input key={`${item.id}:${item.version}:${error}`} type="date" defaultValue={item.due_date??''} disabled={quickSaving} onBlur={event=>{if(event.target.validity.valid&&event.target.value!==(item.due_date??''))void quickUpdate({due_date:event.target.value||null})}} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur()}}/></label>
    <label>Status<select value={item.status} disabled={quickSaving} onChange={event=>void quickUpdate({status:event.target.value})}>{statuses('task').map(value=><option key={value}>{value}</option>)}</select></label>
   </div>
   <p className="small muted" role="status">{quickNotice||'Changes save automatically. Due date saves when you leave the field.'}</p>
   {error&&<button disabled={quickSaving} onClick={()=>{setError('');setRevision(value=>value+1)}}>Reload task</button>}
  </div>}
  {item.kind!=='person'&&item.kind!=='task'&&<p className="record-meta">{item.status} · {item.priority} · {displayDate(item.due_date,item.remind_at)}</p>}
  {(item.body||!['project','person'].includes(item.kind))&&<p className="full-text">{item.body||'No notes yet.'}</p>}
  {item.tags.length>0&&<p className="muted">Tags · {item.tags.join(', ')}</p>}
  {item.kind==='project'&&<ProjectView item={item} related={related} more={more} onMore={()=>setOffset(v=>v+50)}/>}
  {item.kind==='person'&&<><p className="directory-role meta">{[item.person_role,item.organization].filter(Boolean).join(' · ')}</p><PersonView item={item} related={related} more={more} onMore={()=>setOffset(v=>v+50)}/></>}
  <p><a href={`/?record=${item.id}`}>Permanent link to this record</a></p>
  {linked.length>0&&<section><h2 className="label">Linked context</h2><ul className="link-rows">{linked.map(link=><li key={link.id}><a href={`/?record=${link.id}`}>{link.title}</a> · {link.kind}{link.archived?' (archived)':''}</li>)}</ul></section>}
  {item.kind==='task'&&<section><h2 className="label">Related work</h2>{!related.length?<p className="muted">No current linked work.</p>:<ul className="link-rows">{related.map(row=><li key={row.id}><a href={`/?record=${row.id}`}>{row.title}</a> · {row.kind} · {row.status}</li>)}</ul>}{more&&<button onClick={()=>setOffset(related.length)}>More related work</button>}</section>}
  {editing&&!modal&&<Editor client={client} userId={userId} kind={item.kind} item={item} onClose={()=>setEditing(false)} onSaved={saved}/>}
 </>}</section>
 return modal ? <dialog ref={dialog} className="record-dialog task-detail-dialog" aria-label={editing?"Edit task":"Task details"} onCancel={event=>{event.preventDefault();if(!editing&&!quickLock.current)onClose()}}>{!editing&&<div className="task-dialog-close"><button disabled={quickSaving} onClick={()=>{if(!quickLock.current)onClose()}} aria-label="Close task details">×</button></div>}{content}</dialog> : content
}
