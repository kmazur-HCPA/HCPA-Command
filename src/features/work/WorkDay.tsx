import {useEffect,useState} from 'react'
import type {AppClient} from '../../platform/supabase'
import {workDay} from '../../services/work'
import {effectiveStatus} from './model'
import type {Kind,WorkItem,WorkSummary} from './model'
import {displayDate,today} from './dates'
export function WorkDay({client,revision,onOpen,onNavigate}:{client:AppClient;revision:number;onOpen:(item:Pick<WorkItem,'id'>)=>void;onNavigate:(kind:Kind)=>void}) {
 const [data,setData]=useState<Awaited<ReturnType<typeof workDay>>|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0),[now,setNow]=useState(()=>Date.now())
 const date=today(new Date(now))
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),30000);return()=>clearInterval(timer)},[])
 useEffect(()=>{let alive=true;workDay(client,date).then(rows=>{if(alive){setData(rows);setError('')}}).catch(caught=>{if(alive)setError((caught as Error).message)});return()=>{alive=false}},[client,date,revision,retry])
 const ready=data?.reminders.filter(r=>effectiveStatus(r,now)==='Active')??[], snoozed=data?.reminders.filter(r=>effectiveStatus(r,now)==='Snoozed')??[]
 const rows=(items:WorkSummary[])=>items.length?<ul className="day-list">{items.map(item=><li key={item.id}><button onClick={()=>onOpen(item)}>{item.title}</button><p className="record-meta">{item.organization&&`${item.organization} · `}{displayDate(item.due_date,item.remind_at)}{item.status==='Snoozed'&&` · Snoozed until ${displayDate(null,item.snoozed_until)}`}</p></li>)}</ul>:<p className="muted">Nothing here right now.</p>
 return <section><p className="eyebrow">{displayDate(date)} · New York</p><h1 tabIndex={-1}>Work Day</h1><p className="intro">Choose what matters. Keep the rest in view.</p>{error&&<p role="alert" className="error-message">{error} <button onClick={()=>setRetry(v=>v+1)}>Retry Work Day</button></p>}{!data&&!error&&<p role="status">Loading your day…</p>}{data&&<div className="day-grid">
  <section className="day-panel focus-panel"><div className="section-heading"><h2>Chosen priorities</h2><button onClick={()=>onNavigate('task')}>Choose tasks</button></div>{rows(data.focus)}<p className="small muted">Up to three. Assign a slot when editing a task.</p></section>
  <section className="day-panel"><div className="section-heading"><h2>Reminders</h2><button onClick={()=>onNavigate('reminder')}>All reminders</button></div>{rows(ready)}{snoozed.length>0&&<details><summary>Snoozed ({snoozed.length})</summary>{rows(snoozed)}</details>}{data.reminders.length===100&&<p className="muted">Showing the oldest 100 open reminders. Open All reminders for the rest.</p>}</section>
  <section className="day-panel"><div className="section-heading"><h2>Due work</h2><button onClick={()=>onNavigate('task')}>All tasks</button></div>{rows(data.due)}{data.due.length===30&&<p className="muted">Showing 30 due tasks. Open All tasks for more.</p>}</section>
  <section className="day-panel"><div className="section-heading"><h2>Waiting On</h2><button onClick={()=>onNavigate('waiting')}>Manage waiting</button></div><p className="small muted">Dependencies on others—your private tracking, not assignments sent to them.</p>{rows(data.waiting)}{data.waiting.length===30&&<p className="muted">Showing 30 dependencies. Open Manage waiting for more.</p>}</section>
 </div>}</section>
}
