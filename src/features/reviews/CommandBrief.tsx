import { useEffect, useRef, useState } from 'react';
import type { AppClient } from '../../platform/supabase';
import { Icon } from '../../ui/Icon';
import { chat } from '../cora/service';
import { briefInstructions, briefIsOld, isCompactBrief, latestBrief, type Review } from './brief';
const stamp = (value:string) => new Date(value).toLocaleString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
// Only verified-format Command record links are interactive; never render model HTML.
function BriefLine({text,onOpen}:{text:string;onOpen:(item:{id:string})=>void}) {
 const label=/^(Now|Next|Watch):\s*/i.exec(text);
 if(label)return <><strong>{label[1]}:</strong> <BriefLine text={text.slice(label[0].length)} onOpen={onOpen}/></>;
 const parts=text.split(/(\[[^\]\n]+\]\(\/\?record=[a-f0-9-]{36}\))/gi);
 return <>{parts.map((part,i)=>{
  const link=/^\[([^\]]+)\]\(\/\?record=([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\)$/i.exec(part);
  return link?<button key={i} className="brief-record-link" onClick={()=>onOpen({id:link[2]!})}>{link[1]}</button>:part;
 })}</>;
}
export function CommandBrief({client,onOpen}:{client:AppClient;onOpen:(item:{id:string})=>void}) {
 const [reviews,setReviews]=useState<Review[]>([]),[enabled,setEnabled]=useState<boolean|null>(null),[error,setError]=useState(''),[generationError,setGenerationError]=useState(''),[generating,setGenerating]=useState(false),[loading,setLoading]=useState(true),[retry,setRetry]=useState(0),[now,setNow]=useState(()=>Date.now());
 const controller=useRef<AbortController|null>(null);
 const mounted=useRef(false);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;controller.current?.abort()}},[]);
 useEffect(()=>{
  let active=true;
  let inFlight=false;
  async function load(){
   if(inFlight)return;
   inFlight=true;
   try {
    const [recent,successful,preference]=await Promise.all([
     client.from('cora_workday_reviews').select('*').order('started_at',{ascending:false}).limit(5),
     client.from('cora_workday_reviews').select('*').in('status',['complete','partial']).neq('summary','').order('started_at',{ascending:false}).limit(1),
     client.from('cora_review_preferences').select('automatic_reminders').maybeSingle(),
    ]);
    if(!active)return;
    if(recent.error||successful.error||preference.error)throw new Error('Could not refresh the Command Brief. The last loaded brief is still shown.');
    setReviews([...new Map([...(recent.data??[]),...(successful.data??[])].map(r=>[r.id,r])).values()].sort((a,b)=>Date.parse(b.started_at)-Date.parse(a.started_at)));
    setEnabled(preference.data?.automatic_reminders??false);setError('');setNow(Date.now());
   }catch(caught){if(active)setError(caught instanceof Error?caught.message:'Command Brief unavailable.')}
   finally{inFlight=false;if(active)setLoading(false)}
  }
  void load();
  const visible=()=>{if(document.visibilityState==='visible')void load()};
  const timer=window.setInterval(visible,60000);document.addEventListener('visibilitychange',visible);
  return()=>{active=false;clearInterval(timer);document.removeEventListener('visibilitychange',visible)};
 },[client,retry]);
 async function generate(){
  if(controller.current||!enabled)return;
  const abort=new AbortController();controller.current=abort;setGenerating(true);setGenerationError('');
  const started=Date.now();
  try {
   await chat(client,{message:'Update and save my Command Brief now. '+briefInstructions,requestId:crypto.randomUUID(),conversationId:crypto.randomUUID(),context:{page:'command-brief',recordId:null}},abort.signal,event=>{if(event.type==='error')throw new Error(event.message)});
   const result=await client.from('cora_workday_reviews').select('*').in('status',['complete','partial']).gte('started_at',new Date(started-1000).toISOString()).order('started_at',{ascending:false}).limit(1);
   if(result.error||!latestBrief(result.data??[]))throw new Error('Cora did not confirm a saved brief. The previous brief is still shown; check review history before retrying.');
  }catch(caught){if(mounted.current&&!abort.signal.aborted)setGenerationError(caught instanceof Error?caught.message:'Cora could not update the brief.')}
  finally{controller.current=null;if(mounted.current){setGenerating(false);setRetry(v=>v+1)}}
 }
 const brief=latestBrief(reviews), latest=reviews[0];
 const compact=brief ? isCompactBrief(brief.summary) : false;
 return <section className="day-panel command-brief" aria-labelledby="command-brief-title">
  <div className="command-brief-heading">
   <div><h2 id="command-brief-title"><Icon name="flag"/> Command brief</h2></div>
   <button disabled={generating||enabled!==true||loading} onClick={()=>void generate()}>{generating?'Cora is preparing your brief…':'Update brief'}</button>
  </div>
  <p className="brief-byline">{brief?`Prepared by Cora · ${stamp(brief.finished_at??brief.started_at)}`:'What matters right now.'}</p>
  {brief&&briefIsOld(brief,now)&&<p className="brief-state">Previous day’s brief. Update for current context.</p>}
  {brief?.status==='partial'&&<p className="brief-state">Limited context.</p>}
  {enabled===false&&<p className="brief-state">Brief updates are paused. Enable automatic reviews in Settings to resume.</p>}
  {latest?.status==='running'&&<p role="status">{now-Date.parse(latest.started_at)>1800000?'The latest review may have been interrupted.':'Cora is reviewing your day.'} {brief?'Showing the last saved brief.':''}</p>}
  {latest?.status==='failed'&&<p className="brief-state">The latest review failed. {brief?'Showing the last saved brief.':'No brief is available yet.'}</p>}
  {loading&&<p role="status">Loading Command Brief…</p>}
  {(error||generationError)&&<p role="alert" className="error-message">{error||generationError} <button onClick={()=>setRetry(v=>v+1)}>Reload brief</button></p>}
  {!loading&&!brief&&!error&&<p className="brief-empty">No saved Cora brief yet. {enabled?'Choose Update brief to prepare one from your current work.':'Your brief will appear here after a completed review.'}</p>}
  {brief&&compact&&<div className="command-brief-copy">{brief.summary.split(/\n/).filter(line=>line.trim()).map((line,index)=><p key={index}><BriefLine text={line} onOpen={onOpen}/></p>)}</div>}
  {brief&&!compact&&<p className="brief-empty">A detailed review is saved in history. Choose Update brief for a short, current check-in.</p>}
  {reviews.length>0&&<details className="brief-history"><summary>Review history</summary>{reviews.slice(0,5).map(review=><details key={review.id}><summary>{stamp(review.started_at)} · {review.status}</summary><p className="full-text brief-history-copy" tabIndex={0}>{review.summary||'No finished summary recorded.'}</p></details>)}</details>}
 </section>;
}
