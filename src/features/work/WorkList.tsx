import { useEffect, useState } from 'react'
import type { AppClient } from '../../platform/supabase'
import { convertReminder, listWork, patchWork } from '../../services/work'
import type { Kind,WorkItem,WorkSummary } from './model'
import { effectiveStatus,labels,priorities,statuses,entryTypes } from './model'
import { displayDate } from './dates'
import { Editor } from './Editor'
export function WorkList({client,userId,kind,onOpen}:{client:AppClient;userId:string;kind:Kind;onOpen:(item:Pick<WorkItem,'id'>)=>void}) {
 const [rows,setRows]=useState<WorkSummary[]>([]),[search,setSearch]=useState(''),[status,setStatus]=useState(''),[priority,setPriority]=useState(''),[archived,setArchived]=useState(false)
 const [entryType,setEntryType]=useState(''),[tag,setTag]=useState('')
 const [offset,setOffset]=useState(0),[more,setMore]=useState(false),[revision,setRevision]=useState(0),[loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const [editor,setEditor]=useState<WorkItem|'new'|null>(null)
 const [now,setNow]=useState(()=>Date.now())
 useEffect(()=>{const id=window.setInterval(()=>setNow(Date.now()),30000);return()=>clearInterval(id)},[])
 useEffect(()=>{
  let alive=true
  const timer=window.setTimeout(()=>{setLoading(true);listWork(client,{kind,search,status,priority,archived,offset,entryType,tag}).then(data=>{if(alive){setRows(old=>offset?[...old,...data]:data);setMore(data.length===50);setError('')}}).catch(caught=>{if(alive)setError((caught as Error).message)}).finally(()=>{if(alive)setLoading(false)})},180)
  return()=>{alive=false;clearTimeout(timer)}
 },[client,kind,search,status,priority,archived,offset,revision,entryType,tag])
 function refresh(){setOffset(0);setRevision(v=>v+1)}
 async function act(item:WorkSummary,patch:Partial<WorkItem>|'convert') {
  if(busy)return;setBusy(true);setError('')
  try{if(patch==='convert')await convertReminder(client,item);else await patchWork(client,item,patch);refresh()}
  catch(caught){setError((caught as Error).message)}finally{setBusy(false)}
 }
 return <section aria-label={labels[kind]}>
  <div className="section-heading"><h1 tabIndex={-1}>{labels[kind]}</h1><button onClick={()=>setEditor('new')}>New {kind}</button></div>
  <div className="filters"><label>Search titles and notes<input type="search" value={search} onChange={e=>{setSearch(e.target.value);setOffset(0)}}/></label><label>Filter status<select value={status} onChange={e=>{setStatus(e.target.value);setOffset(0)}}><option value="">All statuses</option>{statuses(kind).map(s=><option key={s}>{s}</option>)}</select></label><label>Filter priority<select value={priority} onChange={e=>{setPriority(e.target.value);setOffset(0)}}><option value="">All priorities</option>{priorities.map(p=><option key={p}>{p}</option>)}</select></label><label>View<select value={String(archived)} onChange={e=>{setArchived(e.target.value==='true');setOffset(0)}}><option value="false">Current</option><option value="true">Archived</option></select></label></div>
  {kind==='journal'&&<div className="form-grid"><label>Filter entry type<select value={entryType} onChange={e=>{setEntryType(e.target.value);setOffset(0)}}><option value="">All entry types</option>{entryTypes.map(t=><option key={t}>{t}</option>)}</select></label><label>Filter tag<input value={tag} onChange={e=>{setTag(e.target.value);setOffset(0)}} placeholder="Exact tag"/></label></div>}
  {error&&<p role="alert" className="error-message">{error} <button onClick={refresh}>Retry</button></p>}
  {loading&&<p role="status">Loading…</p>}
  {!loading&&!rows.length&&!error&&<div className="state-panel"><h2>No matching {labels[kind].toLowerCase()}.</h2><p className="muted">Create one or adjust your filters.</p></div>}
  <ul className="record-list">{rows.map(item=><li key={item.id}>
   <button className="record-title" onClick={()=>onOpen(item)}>{item.title}</button>
   <p className="record-meta">{effectiveStatus(item,now)} · {item.priority} · {displayDate(item.due_date,item.remind_at)}{item.status==='Snoozed'&&` · Snoozed until ${displayDate(null,item.snoozed_until)}`}</p>
   <div className="record-actions">
    {statuses(kind).includes('Complete')&&!['Complete','Cancelled','Dismissed'].includes(item.status)&&<button disabled={busy} onClick={()=>void act(item,{status:'Complete',snoozed_until:null})}>Complete</button>}
    {kind==='reminder'&&!['Complete','Dismissed'].includes(item.status)&&<><button disabled={busy} onClick={()=>void act(item,{status:'Snoozed',snoozed_until:new Date(Date.now()+3600000).toISOString()})}>Snooze 1 hour</button><button disabled={busy} onClick={()=>void act(item,{status:'Dismissed',snoozed_until:null})}>Dismiss</button><button disabled={busy} onClick={()=>void act(item,'convert')}>Convert to task</button></>}
    <button disabled={busy} onClick={()=>void act(item,{archived:!item.archived})}>{item.archived?'Restore':'Archive'}</button>
   </div>
  </li>)}</ul>
  {more&&<button disabled={loading} onClick={()=>setOffset(rows.length)}>Load more</button>}
  {editor&&<Editor client={client} userId={userId} kind={kind} item={editor==='new'?undefined:editor} onClose={()=>setEditor(null)} onSaved={()=>{setEditor(null);refresh()}}/>}
 </section>
}
