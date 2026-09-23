import { useEffect, useRef, useState } from 'react'
import type { AppClient } from '../../platform/supabase'
import { draftStore } from '../../platform/drafts'
import { getWork,saveWork } from '../../services/work'
import { newItem, priorities, statuses, toInput, entryTypes } from './model'
import type { Kind, WorkInput, WorkItem } from './model'
import { useDraftGuard } from './useDraftGuard'
import { LabFields } from '../lab/LabFields'
import { LinkPicker } from './LinkPicker'
import { fromLocalDateTime, localDateTime } from './dates'
export function Editor({client,userId,kind,item,seed,onClose,onSaved,embedded=false}:{client:AppClient;userId:string;kind:Kind;item?:WorkItem;seed?:Partial<WorkInput>;embedded?:boolean;onClose:()=>void;onSaved:(item:WorkItem)=>void}) {
 const key=item?`edit:${item.id}`:`new:${kind}${seed?.source_entry_id?`:${seed.source_entry_id}`:''}`
 const [initial]=useState(()=>{
  const base=item?{...newItem(kind,userId),...toInput(item)}:{...newItem(kind,userId),...seed}
  try {
   const stored=draftStore(localStorage,userId).read(key)
   if(stored){const parsed=JSON.parse(stored.text) as {input:WorkInput;version?:number};if(parsed.input.user_id!==userId||parsed.input.kind!==kind)throw new Error();return {...parsed,recovered:true,error:''}}
   return {input:base,version:item?.version,recovered:false,error:''}
  }catch{return {input:base,version:item?.version,recovered:false,error:'Local draft storage is unavailable or unreadable. Copy your writing before closing.'}}
 })
 const [expectedVersion,setExpectedVersion]=useState(initial.version)
 const [latest,setLatest]=useState<WorkItem|null>(null)
 const [input,setInput]=useState(initial.input)
 const [tagText,setTagText]=useState(initial.input.tags.join(', '))
 const [error,setError]=useState(initial.error)
 const [localSafe,setLocalSafe]=useState(!initial.error)
 const [draftStatus,setDraftStatus]=useState(initial.recovered?'Recovered a local draft. Review it before saving.':'')
 const [busy,setBusy]=useState(false)
 useDraftGuard(initial.recovered||JSON.stringify(input)!==JSON.stringify(initial.input))
 const dialog=useRef<HTMLDialogElement>(null)
 const form=useRef<HTMLFormElement>(null)
 const saving=useRef(false)
 useEffect(()=>{dialog.current?.showModal()},[])
 useEffect(()=>{
  if(!embedded)return
  const parent=form.current?.closest("dialog")
  function cancel(event:Event){event.preventDefault();event.stopPropagation();if(!busy&&(localSafe||confirm("This draft is not saved locally. Copy your writing before closing. Close anyway?")))onClose()}
  parent?.addEventListener("cancel",cancel)
  return()=>parent?.removeEventListener("cancel",cancel)
 },[embedded,busy,localSafe,onClose])
 function change(patch:Partial<WorkInput>) {
  const next={...input,...patch};setInput(next)
  try{if(initial.error)throw new Error('Preserve unreadable draft');draftStore(localStorage,userId).save(key,JSON.stringify({input:next,version:expectedVersion}));setDraftStatus('Draft saved on this device.');setLocalSafe(true);setError('')}
  catch{setLocalSafe(false);setError('Local draft could not be saved. Keep this window open or copy your writing.');setDraftStatus('Draft not saved.')}
 }
 async function submit(event:React.FormEvent) {
  event.preventDefault();if(saving.current)return;saving.current=true;setBusy(true);setError('')
  try{
   const saved=await saveWork(client,input,expectedVersion)
   try{draftStore(localStorage,userId).acknowledge(key,JSON.stringify({input,version:expectedVersion}))}catch{setError('Saved to server, but the local copy could not be cleared.');return}
   onSaved(saved)
  }catch(caught){setError(caught instanceof Error?caught.message:'Unable to save.')}
  finally{saving.current=false;setBusy(false)}
 }
 function close(){if(localSafe||confirm('This draft is not saved locally. Copy your writing before closing. Close anyway?'))onClose()}
 function discard(){if(window.confirm('Discard this local draft? Saved records will not be deleted.')){try{draftStore(localStorage,userId).discard(key);onClose()}catch{setError('The draft could not be removed.')}}}
 const content = <form ref={form} onSubmit={event=>void submit(event)}><div className="dialog-heading"><h2 id="editor-title">{item?'Edit':'New'} {kind}</h2><button type="button" disabled={busy} onClick={close} aria-label="Close editor">×</button></div>
   <label>{kind==='person'?'Full name':'Title'}<input autoFocus required maxLength={240} value={input.title} onChange={e=>change({title:e.target.value})} disabled={busy}/></label>
   {kind==='task'&&<LinkPicker client={client} kind="project" label="Project" value={input.project_id} disabled={busy} onChange={id=>change({project_id:id})}/>}
   <label>Notes<textarea rows={7} maxLength={50000} value={input.body} onChange={e=>change({body:e.target.value})} disabled={busy}/></label>
   {kind==='journal'&&<label>Entry type<select value={input.entry_type} disabled={busy} onChange={e=>change({entry_type:e.target.value})}>{entryTypes.map(t=><option key={t}>{t}</option>)}</select></label>}
   {['project','initiative'].includes(kind)&&<>{(['goals','current_state','next_milestone'] as const).map((field,i)=><label key={field}>{['Goals','Current state','Next milestone'][i]}<textarea rows={3} maxLength={10000} value={input[field]} disabled={busy} onChange={e=>change({[field]:e.target.value})}/></label>)}</>}
   {kind==='person'&&<div className="form-grid"><label>Job title<input maxLength={240} value={input.person_role} disabled={busy} onChange={e=>change({person_role:e.target.value})}/></label><label>Organization<input maxLength={240} value={input.organization} disabled={busy} onChange={e=>change({organization:e.target.value})}/></label></div>}
   {kind==='task'&&<label>Work Day priority slot<select value={input.focus_slot??''} disabled={busy} onChange={e=>change({focus_slot:e.target.value?Number(e.target.value):null})}><option value="">Not a chosen priority</option>{[1,2,3].map(slot=><option key={slot} value={slot}>Priority {slot}</option>)}</select></label>}
   {kind==='waiting'&&<label>Responsible person or organization<input maxLength={240} value={input.organization} disabled={busy} onChange={e=>change({organization:e.target.value})}/></label>}
   <LabFields input={input} disabled={busy} onChange={change}/>
   <label>Tags (comma separated, up to 20)<input maxLength={2000} value={tagText} disabled={busy} onChange={e=>{setTagText(e.target.value);change({tags:e.target.value.split(',').map(t=>t.trim()).filter(Boolean).slice(0,20)})}}/></label>
   {kind!=='person'&&<div className="form-grid"><label>Status<select value={input.status} disabled={busy} onChange={e=>change({status:e.target.value,snoozed_until:e.target.value==='Snoozed'?new Date(Date.now()+3600000).toISOString():null})}>{statuses(kind).map(s=><option key={s}>{s}</option>)}</select></label>
   <label>Priority<select value={input.priority} disabled={busy} onChange={e=>change({priority:e.target.value})}>{priorities.map(p=><option key={p}>{p}</option>)}</select></label>
   <label>{kind==='reminder'?'Reminder date (no time)':kind==='waiting'?'Follow-up date':'Due date'}<input type="date" value={input.due_date??''} disabled={busy} onChange={e=>change({due_date:e.target.value||null,remind_at:null})}/></label>
   {kind==='reminder'&&<label>Reminder date and time · New York<input type="datetime-local" value={input.remind_at?localDateTime(input.remind_at):''} disabled={busy} onChange={e=>{try{change({remind_at:e.target.value?fromLocalDateTime(e.target.value):null,due_date:null})}catch(caught){setError((caught as Error).message)}}}/></label>}
   {input.status==='Snoozed'&&<label>Snooze until · New York<input type="datetime-local" required value={input.snoozed_until?localDateTime(input.snoozed_until):''} disabled={busy} onChange={e=>{try{change({snoozed_until:fromLocalDateTime(e.target.value)})}catch(caught){setError((caught as Error).message)}}}/></label>}
   </div>}
   <details className="context-fields"><summary>Links and context</summary><div className="form-grid">
    {kind!=='project'&&kind!=='task'&&<LinkPicker client={client} kind="project" label="Project" value={input.project_id} disabled={busy} onChange={id=>change({project_id:id})}/>}
    {kind!=='initiative'&&<LinkPicker client={client} kind="initiative" label="Initiative" value={input.initiative_id} disabled={busy} onChange={id=>change({initiative_id:id})}/>}
    {kind!=='person'&&<LinkPicker client={client} kind="person" label="Person" value={input.person_id} disabled={busy} onChange={id=>change({person_id:id})}/>}
    {kind!=='task'&&<LinkPicker client={client} kind="task" label="Task" value={input.task_id} disabled={busy} onChange={id=>change({task_id:id})}/>}
    {kind==='task'&&<LinkPicker client={client} kind="journal" label="Source entry" value={input.source_entry_id} disabled={busy} onChange={id=>change({source_entry_id:id})}/>}
    {([['learning_id','learning','Learning source'],['program_id','program','AI Program'],['use_case_id','use_case','Use case'],['experiment_id','experiment','Experiment'],['decision_id','journal','Decision']] as const).filter(([,target])=>target!==kind||target==='journal').map(([field,target,label])=><LinkPicker key={field} client={client} kind={target} label={label} value={input[field]??null} disabled={busy} decisionOnly={field==='decision_id'} onChange={id=>change({[field]:id})}/>)}
   </div></details>
   {kind==='reminder'&&<p className="muted small">Times use America/New_York. During the fall clock change, repeated times use the first occurrence (daylight time). Spring-forward times that do not exist are rejected.</p>}
   {error&&<button type="button" disabled={busy} onClick={()=>{void getWork(client,input.id).then(setLatest).catch(()=>setError('Could not load the latest server copy.'))}}>Compare latest saved version</button>}
   {latest&&<section className="conflict-panel"><h3>Server version {latest.version}</h3><p>{latest.title}</p><p className="full-text">{latest.body}</p><details><summary>All saved fields</summary><pre>{JSON.stringify(toInput(latest),null,2)}</pre></details><button type="button" onClick={()=>{if(confirm('Use your draft to replace the displayed server version?')){setExpectedVersion(latest.version);try{draftStore(localStorage,userId).save(key,JSON.stringify({input,version:latest.version}));setError('');setLatest(null)}catch{setError('Could not save the updated draft.')}}}}>Keep my draft against this version</button></section>}
   <p role="status" className="muted small">{draftStatus}</p>{error&&<p role="alert" className="error-message">{error}</p>}
   <div className="actions"><button className="save-button" disabled={busy} type="submit">{busy?'Saving…':'Save'}</button><button type="button" disabled={busy} onClick={close}>Close · keep draft</button><button type="button" disabled={busy} onClick={discard}>Discard draft</button></div>
  </form>
 return embedded ? content : <dialog ref={dialog} className="record-dialog" aria-labelledby="editor-title" onCancel={event=>{event.preventDefault();if(!busy)close()}}>{content}</dialog>
}
