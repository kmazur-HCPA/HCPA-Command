import {useState} from 'react'
import type {AppClient} from '../../platform/supabase'
import type {WorkItem,Kind} from '../work/model'
import {WorkList} from '../work/WorkList'
export function Lab({client,userId,onOpen}:{client:AppClient;userId:string;onOpen:(row:Pick<WorkItem,'id'>)=>void}) {
 const [kind,setKind]=useState<Kind>('program')
 return <><p className="eyebrow">HCPA AI Lab</p><div className="record-actions" aria-label="AI Lab sections">{([['program','Program & governance'],['use_case','Use cases'],['experiment','Experiments']] as const).map(([value,label])=><button key={value} aria-pressed={kind===value} onClick={()=>setKind(value)}>{label}</button>)}</div><WorkList key={kind} client={client} userId={userId} kind={kind} onOpen={onOpen}/></>
}
