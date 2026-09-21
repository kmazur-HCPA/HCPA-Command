import {useEffect,useState} from 'react'
import type {AppClient} from '../../platform/supabase'
import {getWork,listChoices} from '../../services/work'
import type {Kind,WorkItem} from './model'
export function LinkPicker({client,kind,label,value,onChange,disabled,decisionOnly=false}:{client:AppClient;kind:Kind;label:string;value:string|null;onChange:(id:string|null)=>void;disabled:boolean;decisionOnly?:boolean}) {
 const [query,setQuery]=useState(''),[rows,setRows]=useState<Pick<WorkItem,'id'|'title'|'archived'>[]>([]),[selected,setSelected]=useState<WorkItem|null>(null),[error,setError]=useState('')
 useEffect(()=>{let alive=true;if(value)void getWork(client,value).then(r=>{if(alive)setSelected(r)}).catch(()=>{if(alive)setError('Linked record unavailable')});return()=>{alive=false}},[client,value])
 useEffect(()=>{let alive=true;const timer=setTimeout(()=>{void listChoices(client,kind,query,decisionOnly).then(r=>{if(alive){setRows(r);setError('')}}).catch(()=>{if(alive)setError('Could not load link choices')})},200);return()=>{alive=false;clearTimeout(timer)}},[client,kind,query,decisionOnly])
 return <div className="link-picker"><label>Find {label.toLowerCase()}<input type="search" value={query} disabled={disabled} onChange={e=>setQuery(e.target.value)} placeholder="Search to narrow choices"/></label><label>{label}<select value={value??''} disabled={disabled} onChange={e=>onChange(e.target.value||null)}><option value="">None</option>{value&&!rows.some(r=>r.id===value)&&<option value={value}>{selected?.title??'Current link'}{selected?.archived?' (archived)':''}</option>}{rows.map(r=><option key={r.id} value={r.id}>{r.title}</option>)}</select></label>{rows.length===50&&<p className="small muted">Showing 50 choices. Search to narrow the list.</p>}{error&&<p className="error-message">{error}</p>}</div>
}
