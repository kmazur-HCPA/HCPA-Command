import type { AppClient } from '../platform/supabase'
import { measured } from '../platform/telemetry'
import type { Kind, WorkInput, WorkItem } from '../features/work/model'
const summaryColumns='id,user_id,kind,title,status,priority,due_date,remind_at,snoozed_until,converted_task_id,completed_at,archived,version,created_at,updated_at,project_id,initiative_id,person_id,task_id,source_entry_id,entry_type,tags,organization,person_role,focus_slot,learning_id,program_id,use_case_id,experiment_id,decision_id' as const
export type WorkFilter = {kind?:Kind; search?:string; status?:string; priority?:string; archived?:boolean; offset?:number; projectId?:string;personId?:string;initiativeId?:string;sourceId?:string;taskId?:string;entryType?:string;tag?:string;learningId?:string;programId?:string;useCaseId?:string;experimentId?:string;decisionId?:string}
export async function listWork(client:AppClient, filter:WorkFilter) {
 return measured('work.read',async()=>{
  let q=client.from('work_items').select(summaryColumns).eq('archived',filter.archived??false).order('created_at',{ascending:false}).order('id').range(filter.offset??0,(filter.offset??0)+49)
  for(const [key,column] of [['learningId','learning_id'],['programId','program_id'],['useCaseId','use_case_id'],['experimentId','experiment_id'],['decisionId','decision_id']] as const)if(filter[key])q=q.eq(column,filter[key]!)
  if(filter.kind)q=q.eq('kind',filter.kind)
  if(filter.search)q=q.textSearch('search_vector',filter.search,{type:'websearch',config:'english'})
  if(filter.projectId)q=q.eq('project_id',filter.projectId)
  if(filter.personId)q=q.eq('person_id',filter.personId)
  if(filter.initiativeId)q=q.eq('initiative_id',filter.initiativeId)
  if(filter.sourceId)q=q.eq('source_entry_id',filter.sourceId)
  if(filter.taskId)q=q.eq('task_id',filter.taskId)
  if(filter.entryType)q=q.eq('entry_type',filter.entryType)
  if(filter.tag)q=q.contains('tags',[filter.tag])
  if(filter.kind==='reminder'&&filter.status==='Active')q=q.or(`status.eq.Active,and(status.eq.Snoozed,snoozed_until.lte.${new Date().toISOString()})`)
  else if(filter.status)q=q.eq('status',filter.status)
  if(filter.priority)q=q.eq('priority',filter.priority)
  const {data,error}=await q; if(error)throw new Error('Could not load your records. Reconnect and retry.');return data
 })
}
export async function getWork(client:AppClient,id:string) {
 const {data,error}=await client.from('work_items').select('*').eq('id',id).single()
 if(error)throw new Error('This record is unavailable.');return data
}
export function matchesWorkFields(row:Partial<WorkItem>,input:Partial<WorkInput>) {
 return Object.entries(input).every(([key,value])=>{
  const saved=row[key as keyof WorkItem]
  if((key==='remind_at'||key==='snoozed_until')&&typeof saved==='string'&&typeof value==='string')return Date.parse(saved)===Date.parse(value)
  return JSON.stringify(saved)===JSON.stringify(value)
 })
}
export async function saveWork(client:AppClient,input:WorkInput,version?:number) {
 return measured('work.write',async()=>{
  if(!input.title.trim())throw new Error('Add a title before saving.')
  const result=version
   ? await client.from('work_items').update(input).eq('id',input.id).eq('version',version).select('*').maybeSingle()
   : await client.from('work_items').upsert(input,{onConflict:'id',ignoreDuplicates:true}).select('*').maybeSingle()
  if(result.data)return result.data
  if(result.error?.code==='23505')throw new Error('That Work Day priority slot is already in use. Clear it on the other task first.')
  // Reconcile a lost acknowledgement without overwriting a concurrent edit.
  const current=await getWork(client,input.id).catch(()=>null)
  if(current && matchesWorkFields(current,input))return current
  if(current)throw new Error('This record changed elsewhere. Your draft is preserved. Compare the latest record before saving again.')
  throw new Error('Not saved. Your draft is preserved; reconnect and retry.')
 })
}
export async function convertReminder(client:AppClient,item:Pick<WorkItem,'id'|'version'>) {
 return measured('work.convert',async()=>{
  const {data,error}=await client.rpc('convert_reminder',{reminder_id:item.id,expected_version:item.version})
  if(error)throw new Error('Conversion did not finish. Reload and retry; retries cannot create a second task.')
  return data
 })
}

export async function revisions(client:AppClient,id:string,offset=0) {
 const {data,error}=await client.from('journal_revisions').select('*').eq('item_id',id).order('version',{ascending:false}).range(offset,offset+19)
 if(error)throw new Error('Revision history is unavailable.');return data
}

export async function listChoices(client:AppClient,kind:Kind,search:string,decisionOnly=false) {
 let query=client.from('work_items').select('id,title,archived').eq('kind',kind).eq('archived',false).order('title').limit(50)
 if(decisionOnly)query=query.eq('entry_type','Decision')
 if(search)query=query.ilike('title',`%${search.replace(/[\\%_]/g,'\\$&')}%`)
 const {data,error}=await query;if(error)throw new Error('Choices unavailable');return data
}

export async function workDay(client:AppClient,date:string) {
 return measured('work.read',async()=>{
  const base=()=>client.from('work_items').select(summaryColumns).eq('archived',false)
  const results=await Promise.all([
   base().eq('kind','task').not('focus_slot','is',null).not('status','in','(Complete,Cancelled)').order('focus_slot').limit(3),
   base().eq('kind','task').lte('due_date',date).not('status','in','(Complete,Cancelled)').order('due_date').limit(30),
   base().eq('kind','reminder').in('status',['Active','Snoozed']).order('created_at',{ascending:true}).limit(100),
   base().eq('kind','waiting').eq('status','Active').order('due_date',{nullsFirst:false}).limit(30),
  ])
  if(results.some(r=>r.error))throw new Error('Work Day could not be loaded. Reconnect and retry.')
  return {focus:results[0]!.data!,due:results[1]!.data!,reminders:results[2]!.data!,waiting:results[3]!.data!}
 })
}

export async function patchWork(client:AppClient,item:Pick<WorkItem,'id'|'version'>,patch:Partial<WorkInput>) {
 return measured('work.write',async()=>{
  const {data,error}=await client.from('work_items').update(patch).eq('id',item.id).eq('version',item.version).select('*').maybeSingle()
  if(data)return data
  if(error?.code==='23505')throw new Error('That priority slot is already in use.')
  const current=await getWork(client,item.id).catch(()=>null)
  if(current&&matchesWorkFields(current,patch))return current
  throw new Error('The change was not saved or this record changed elsewhere. Reload before retrying.')
 })
}
