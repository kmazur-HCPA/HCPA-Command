import {fields} from './fields'
import {telephoneLink} from '../people/model'
import type {WorkInput,WorkItem} from '../work/model'
export function LabFields({input,disabled,onChange}:{input:WorkInput;disabled:boolean;onChange:(patch:Partial<WorkInput>)=>void}) {
 return <>{(fields[input.kind]??[]).map(field=>{
 const props={value:input.details?.[field.key]??'',disabled,onChange:(e:React.ChangeEvent<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>)=>onChange({details:{...input.details,[field.key]:e.target.value}})}
 return <label key={field.key}>{field.label}{field.type==='textarea'?<textarea rows={3} maxLength={10000} {...props}/>:field.options?<select {...props}><option value="">Not set</option>{field.options.map(o=><option key={o}>{o}</option>)}</select>:<input type={field.type} maxLength={input.kind==='person'?(field.type==='email'?254:field.type==='tel'?80:240):field.type==='url'?2000:500} min={field.type==='number'?0:undefined} max={field.type==='number'?100:undefined} step={field.type==='number'?1:undefined} {...props}/>}</label>
 })}{input.kind==='use_case'&&<p className="muted">Approved, Pilot, Production, Rejected and Retired require a recorded decision. A status does not authorize data processing.</p>}{input.kind==='library'&&<p className="muted">Only approved Public or Internal material. Restricted information is excluded. Save metadata, then upload an original.</p>}</>
}
export function LabSummary({item}:{item:WorkItem}) {
 return <dl className="context-summary">{(fields[item.kind]??[]).map(field=>{const value=item.details?.[field.key];return value?<div key={field.key}><dt>{field.label}</dt><dd className="full-text">{field.type==='email'?<a href={`mailto:${encodeURIComponent(value)}`}>{value}</a>:field.type==='tel'&&telephoneLink(value)?<a href={telephoneLink(value)}>{value}</a>:field.type==='url'&&/^https?:\/\//.test(value)?<a href={value} target="_blank" rel="noopener noreferrer">{value}</a>:value}</dd></div>:null})}</dl>
}
