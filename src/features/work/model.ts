export const taskStatuses = ['Inbox','Next','In Progress','Waiting','Scheduled','Someday','Complete','Cancelled'] as const
export const reminderStatuses = ['Active','Snoozed','Complete','Dismissed'] as const
export const priorities = ['Critical','High','Normal','Low'] as const
export type Kind = 'task' | 'reminder' | 'project' | 'initiative' | 'person' | 'journal' | 'waiting'
export const entryTypes = ['Capture','Thought','Idea','Research','Decision','Meeting','Learning','Experiment','Observation','Progress','Problem','Opportunity'] as const
export type WorkItem = {
  focus_slot:number|null;project_id:string|null;initiative_id:string|null;person_id:string|null;task_id:string|null;source_entry_id:string|null;
  entry_type:string;tags:string[];goals:string;current_state:string;next_milestone:string;organization:string;person_role:string;search_vector?:string;
  id:string; user_id:string; kind:Kind; title:string; body:string; original_body:string;
  status:string; priority:string; due_date:string|null; remind_at:string|null; snoozed_until:string|null;
  completed_at:string|null; converted_task_id:string|null; archived:boolean; version:number; created_at:string; updated_at:string;
}
export type WorkSummary = Omit<WorkItem,'body'|'original_body'|'goals'|'current_state'|'next_milestone'|'search_vector'>
export type WorkInput = Omit<WorkItem,'original_body'|'version'|'created_at'|'updated_at'|'completed_at'|'search_vector'>
export const labels:Record<Kind,string> = { task:'Tasks', reminder:'Reminders',project:'Projects',initiative:'Initiatives',person:'People',journal:'Journal',waiting:'Waiting On' }
export function statuses(kind:Kind): readonly string[] { return kind==='task'?taskStatuses:kind==='reminder'?reminderStatuses:kind==='journal'?['Recorded']:kind==='person'?['Active']:kind==='waiting'?['Active','Complete']:['Active','On Hold','Complete'] }
export function newItem(kind:Kind,userId:string): WorkInput {
  return {focus_slot:null,project_id:null,initiative_id:null,person_id:null,task_id:null,source_entry_id:null,entry_type:'Thought',tags:[],goals:'',current_state:'',next_milestone:'',organization:'',person_role:'',id:crypto.randomUUID(),user_id:userId,kind,title:'',body:'',status:statuses(kind)[0]!,priority:'Normal',due_date:null,remind_at:null,snoozed_until:null,converted_task_id:null,archived:false}
}
export function effectiveStatus(item: Pick<WorkItem,'status'|'snoozed_until'>, now=Date.now()) {
  return item.status==='Snoozed' && item.snoozed_until && Date.parse(item.snoozed_until)<=now ? 'Active':item.status
}

export function toInput(item:WorkItem): WorkInput {
 const {original_body,version,created_at,updated_at,completed_at,search_vector,...input}=item
 void original_body;void version;void created_at;void updated_at;void completed_at;void search_vector;return input
}
