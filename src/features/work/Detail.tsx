import {useEffect,useState} from 'react'
import type {AppClient} from '../../platform/supabase'
import {getWork,listWork,revisions} from '../../services/work'
import type {WorkFilter} from '../../services/work'
import type {WorkItem,WorkSummary} from './model'
import {Originals} from '../library/Originals'
import {LabSummary} from '../lab/LabFields'
import {Editor} from './Editor'
import {displayDate} from './dates'
export function Detail({client,userId,id,onClose}:{client:AppClient;userId:string;id:string;onClose:()=>void}) {
 const [item,setItem]=useState<WorkItem|null>(null),[error,setError]=useState(''),[editing,setEditing]=useState(false),[createTask,setCreateTask]=useState(false),[linked,setLinked]=useState<WorkItem[]>([]),[related,setRelated]=useState<WorkSummary[]>([]),[offset,setOffset]=useState(0),[more,setMore]=useState(false),[revision,setRevision]=useState(0)
 const [history,setHistory]=useState<Awaited<ReturnType<typeof revisions>>>([]),[historyOffset,setHistoryOffset]=useState(0),[historyMore,setHistoryMore]=useState(false)
 useEffect(()=>{let alive=true;getWork(client,id).then(async row=>{if(!alive)return;setItem(row);const ids=[row.project_id,row.initiative_id,row.person_id,row.task_id,row.source_entry_id,row.converted_task_id,row.learning_id,row.program_id,row.use_case_id,row.experiment_id,row.decision_id].filter((v):v is string=>!!v);const links=await Promise.all([...new Set(ids)].map(value=>getWork(client,value)));if(alive)setLinked(links)}).catch(caught=>{if(alive)setError((caught as Error).message)});return()=>{alive=false}},[client,id,revision])
 const kind=item?.kind
 useEffect(()=>{
  if(!kind)return
  let alive=true;const filter:WorkFilter={offset}
  if(kind==='project')filter.projectId=id;else if(kind==='initiative')filter.initiativeId=id;else if(kind==='person')filter.personId=id;else if(kind==='journal')filter.sourceId=id;else if(kind==='task')filter.taskId=id;else if(kind==='learning')filter.learningId=id;else if(kind==='program')filter.programId=id;else if(kind==='use_case')filter.useCaseId=id;else if(kind==='experiment')filter.experimentId=id;else return
  listWork(client,filter).then(rows=>{if(alive){setRelated(old=>offset?[...old,...rows]:rows);setMore(rows.length===50)}}).catch(caught=>{if(alive)setError((caught as Error).message)})
  return()=>{alive=false}
 },[client,id,kind,offset,revision])
 useEffect(()=>{if(!kind||!['journal','learning','program','use_case','experiment','library'].includes(kind))return;let alive=true;revisions(client,id,historyOffset).then(rows=>{if(alive){setHistory(old=>historyOffset?[...old,...rows]:rows);setHistoryMore(rows.length===20)}}).catch(caught=>{if(alive)setError((caught as Error).message)});return()=>{alive=false}},[client,id,kind,historyOffset,revision])
 function saved(){setEditing(false);setCreateTask(false);setOffset(0);setHistoryOffset(0);setRevision(v=>v+1)}
 return <section><button onClick={onClose}>Back to list</button>{error&&<p role="alert" className="error-message">{error}</p>}{!item&&!error&&<p role="status">Loading record…</p>}{item&&<>
  <div className="section-heading"><div><p className="eyebrow">{item.kind}{item.archived?' · Archived':''}</p><h1 tabIndex={-1}>{item.title}</h1></div><button onClick={()=>setEditing(true)}>Edit</button></div>
  <p className="record-meta">{item.status} · {item.priority} · {displayDate(item.due_date,item.remind_at)}</p>
  {item.kind==='journal'&&<p>{item.entry_type} · {displayDate(null,item.created_at)}</p>}
  <p className="full-text">{item.body||'No notes yet.'}</p>
  {item.tags.length>0&&<p className="muted">Tags · {item.tags.join(', ')}</p>}
  {(item.kind==='project'||item.kind==='initiative')&&<dl className="context-summary"><dt>Goals</dt><dd>{item.goals||'Not set'}</dd><dt>Current state</dt><dd>{item.current_state||'Not set'}</dd><dt>Next milestone</dt><dd>{item.next_milestone||'Not set'}</dd></dl>}
  {item.kind==='person'&&<p>{item.person_role} · {item.organization}</p>}
  <LabSummary item={item}/>
  {item.kind==='library'&&<Originals client={client} item={item}/>}
  <p><a href={`/?record=${item.id}`}>Permanent link to this record</a></p>
  {linked.length>0&&<section><h2>Linked context</h2><ul>{linked.map(link=><li key={link.id}><a href={`/?record=${link.id}`}>{link.title}</a> · {link.kind}{link.archived?' (archived)':''}</li>)}</ul></section>}
  {['project','initiative','person','journal','task','learning','program','use_case','experiment'].includes(item.kind)&&<section><h2>{item.kind==='journal'?'Resulting tasks':'Related work'}</h2>{!related.length?<p className="muted">No current linked work.</p>:<ul>{related.map(row=><li key={row.id}><a href={`/?record=${row.id}`}>{row.title}</a> · {row.kind} · {row.status}</li>)}</ul>}{more&&<button onClick={()=>setOffset(related.length)}>More related work</button>}</section>}
  {item.kind==='journal'&&<><button onClick={()=>setCreateTask(true)}>Create resulting task</button><details><summary>Original entry</summary><p className="full-text">{item.original_body}</p></details></>}{['journal','learning','program','use_case','experiment','library'].includes(item.kind)&&<><details><summary>Revision history</summary>{history.map(row=><article key={row.id} className="revision"><h3>Version {row.version} · {displayDate(null,row.created_at)}</h3><p>{row.snapshot.title}</p><p className="full-text">{row.snapshot.body}</p><LabSummary item={row.snapshot}/><p>{row.snapshot.status}</p></article>)}{historyMore&&<button onClick={()=>setHistoryOffset(history.length)}>Earlier revisions</button>}</details></>}
  {editing&&<Editor client={client} userId={userId} kind={item.kind} item={item} onClose={()=>setEditing(false)} onSaved={saved}/>}
  {createTask&&<Editor client={client} userId={userId} kind="task" seed={{title:item.title,body:item.body,source_entry_id:item.id,project_id:item.project_id,person_id:item.person_id,initiative_id:item.initiative_id}} onClose={()=>setCreateTask(false)} onSaved={saved}/>}
 </>}</section>
}
