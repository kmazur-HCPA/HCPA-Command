import { describe, it, expect } from "vitest";
import {
  directRecordInput,
  directKinds,
} from "../../netlify/functions/_shared/cora/create";
const owner = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
const args = {
  kind: "task",
  request_id: owner,
  fields_json: JSON.stringify({
    title: "Follow up",
    body: "My words",
    due_date: "2026-09-23",
  }),
};
describe("Authorized Cora creation", () => {
  it("uses a stable owner-scoped retry ID and preserves supplied content", () => {
    const first = directRecordInput(owner, args);
    expect(directRecordInput(owner, args)).toEqual(first);
    expect(directRecordInput(other, args).id).not.toBe(first.id);
    expect(first).toMatchObject({
      user_id: owner,
      body: "My words",
      due_date: "2026-09-23",
    });
    for (const kind of directKinds)
      expect(directRecordInput(owner, { ...args, kind }).kind).toBe(kind);
  });
  it("rejects edits, unauthorized types, ownership overrides and invalid fields", () => {
    for (const patch of [
      { kind: "reminder" },
      { kind: "waiting" },
      { kind: "library" },
      { record_id: owner },
      { request_id: "invalid" },
      { fields_json: JSON.stringify({ title: "A", user_id: other }) },
      { fields_json: JSON.stringify({ title: "A", archived: true }) },
      { fields_json: JSON.stringify({ title: "A", focus_slot: 1 }) },
      { fields_json: JSON.stringify({ title: "A", due_date: "2026-02-30" }) },
    ])
      expect(() => directRecordInput(owner, { ...args, ...patch })).toThrow();
  });
});

// Exercise the real site orchestration with a deterministic provider and HTTP boundary.
import {afterEach,vi} from 'vitest';
import {createClient} from '@supabase/supabase-js';
import type Anthropic from '@anthropic-ai/sdk';
import type {Database} from '../../src/data/database.types';
import type {CoraEvent,CoraTurn} from '../../src/features/cora/model';
import {runCora} from '../../netlify/functions/_shared/cora/engine';
import {slotAt,slotRunId,verifiedLinks,writeBrief} from '../../netlify/functions/_shared/cora/brief';
type Reply={text?:string;tool?:{name:string;input:unknown}};
type Params={tools?:{name:string}[];messages:unknown[];system:unknown};
// Mirrors the SDK surface the engine uses: beta.messages.stream/create + finalMessage.
function fakeProvider(reply:(params:Params,round:number)=>Reply){
 let round=0;
 const message=(params:Params)=>{const r=reply(params,round++);return{content:r.tool?[{type:'tool_use',id:'call-'+round,name:r.tool.name,input:r.tool.input}]:[{type:'text',text:r.text??''}],stop_reason:r.tool?'tool_use':'end_turn'};};
 return {beta:{messages:{
  create:async(params:Params)=>message(params),
  stream:(params:Params)=>{const texts:((t:string)=>void)[]=[];return{on(event:string,cb:(t:string)=>void){if(event==='text')texts.push(cb);return this;},abort(){},async finalMessage(){const m=message(params);for(const b of m.content)if('text' in b)texts.forEach(cb=>cb(b.text));return m;}};},
 }}} as unknown as Anthropic;
}
afterEach(()=>vi.unstubAllGlobals());
it.each(directKinds)('site Cora saves %s directly and returns a refreshable receipt without a proposal',async(kind)=>{
 const turn:CoraTurn={id:owner,user_id:owner,conversation_id:owner,message:'Save this record',context:{page:'workspace',recordId:null},response:'',sources:[],proposal:null,task_id:other,status:'running',action_status:'none',created_at:new Date().toISOString(),finished_at:null};
 const input={...args,kind};const expected=directRecordInput(owner,input);
 const audits:Record<string,unknown>[]=[];
 vi.stubGlobal('fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
  const request=new Request(input,init),url=new URL(request.url);
  if(url.pathname.endsWith('/app_memberships'))return Response.json({active:true});
  if(url.pathname.endsWith('/work_items'))return Response.json([],{headers:{'content-range':'0-0/0'}});
  if(url.pathname.endsWith('/cora_activity')){audits.push(await request.json());return new Response(null,{status:201});}
  if(url.pathname.endsWith('/cora_turns'))return request.method==='PATCH'?Response.json({...turn,...await request.json()}):Response.json([]);
  if(url.pathname.endsWith('/cora_create_record')){expect(await request.json()).toMatchObject({p_user:owner,p_record:{id:expected.id,kind}});return Response.json({saved:true,created:true,id:expected.id});}
  throw new Error('Unexpected request '+url.pathname);
 });
 const provider=fakeProvider((_,round)=>round===0?{tool:{name:'create_record',input}}:{text:'Saved.'});
 const client=createClient<Database>('https://fixture.supabase.co','fixture',{auth:{persistSession:false,autoRefreshToken:false}});
 const events:CoraEvent[]=[];
 await runCora({client,store:client,turn,provider,signal:new AbortController().signal,emit:event=>events.push(event)});
 expect(events.find(event=>event.type==='complete')).toMatchObject({turn:{action_status:'created',proposal:null,task_id:expected.id,sources:[{id:expected.id,kind,title:'Follow up'}]}});
 expect(audits.find(a=>a.tool==='create_record')).toMatchObject({success:true,result:{state:'saved'}});
});

it('site Cora rejects tools outside its request scope and returns the failure to the model',async()=>{
 const turn:CoraTurn={id:owner,user_id:owner,conversation_id:owner,message:'Save the brief',context:{page:'workspace',recordId:null},response:'',sources:[],proposal:null,task_id:other,status:'running',action_status:'none',created_at:new Date().toISOString(),finished_at:null};
 const audits:Record<string,unknown>[]=[];
 vi.stubGlobal('fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
  const request=new Request(input,init),url=new URL(request.url);
  if(url.pathname.endsWith('/app_memberships'))return Response.json({active:true});
  if(url.pathname.endsWith('/work_items'))return Response.json([],{headers:{'content-range':'0-0/0'}});
  if(url.pathname.endsWith('/cora_activity')){audits.push(await request.json());return new Response(null,{status:201});}
  if(url.pathname.endsWith('/cora_turns'))return request.method==='PATCH'?Response.json({...turn,...await request.json()}):Response.json([]);
  throw new Error('Unexpected request '+url.pathname);
 });
 let toolResult='';
 const provider=fakeProvider((params,round)=>{
  const names=(params.tools??[]).map(t=>t.name);
  expect(names).toContain('create_reminder');expect(names).not.toContain('record_workday_review');expect(names).not.toContain('search_outlook_mail');
  if(round===0)return{tool:{name:'record_workday_review',input:{run_id:owner,status:'complete',summary:'x'}}};
  toolResult=JSON.stringify(params.messages.at(-1));return{text:'I could not do that.'};
 });
 const client=createClient<Database>('https://fixture.supabase.co','fixture',{auth:{persistSession:false,autoRefreshToken:false}});
 const events:CoraEvent[]=[];
 await runCora({client,store:client,turn,provider,signal:new AbortController().signal,emit:event=>events.push(event)});
 expect(toolResult).toContain('"is_error":true');
 expect(audits.find(a=>a.tool==='record_workday_review')).toMatchObject({success:false});
 expect(events.find(event=>event.type==='complete')).toMatchObject({turn:{action_status:'none',proposal:null}});
});

describe('Command-owned brief',()=>{
 it('maps quarter-hour runs to Eastern weekday slots across daylight saving',()=>{
  expect(slotAt(new Date('2026-09-25T10:45:00Z'))).toBe('06:45');
  expect(slotAt(new Date('2026-12-01T11:58:00Z'))).toBe('06:45');
  expect(slotAt(new Date('2026-12-01T20:00:00Z'))).toBe('15:00');
  expect(slotAt(new Date('2026-09-25T13:20:00Z'))).toBeNull();
  expect(slotAt(new Date('2026-09-26T13:00:00Z'))).toBeNull();
  expect(slotRunId(owner,'2026-09-25','09:00')).toBe(slotRunId(owner,'2026-09-25','09:00'));
  expect(slotRunId(owner,'2026-09-25','09:00')).not.toBe(slotRunId(other,'2026-09-25','09:00'));
 });
 it('keeps only record links Command supplied',()=>{
  expect(verifiedLinks(`Next: [Parcel](/?record=${owner}) then [Fake](/?record=${other}).`,new Set([owner]))).toBe(`Next: [Parcel](/?record=${owner}) then Fake.`);
 });
 it('drafts without tools, rewrites an oversized draft and saves one partial receipt',async()=>{
  const writes:{method:string;body:Record<string,unknown>}[]=[];
  vi.stubGlobal('fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
   const request=new Request(input,init),url=new URL(request.url);
   if(url.pathname.endsWith('/app_memberships'))return Response.json({active:true});
   if(url.pathname.endsWith('/cora_review_preferences'))return Response.json({automatic_reminders:true});
   if(url.pathname.endsWith('/work_items')){expect(request.method).toBe('GET');return Response.json([],{headers:{'content-range':'0-0/0'}});}
   if(url.pathname.endsWith('/cora_workday_reviews')){
    if(request.method==='GET')return Response.json(null);
    writes.push({method:request.method,body:await request.json()});
    return request.method==='POST'?Response.json([{id:owner}]):new Response(null,{status:204});
   }
   throw new Error('Unexpected request '+url.pathname);
  });
  const provider=fakeProvider((params,round)=>{expect(params.tools).toBeUndefined();return{text:round===0?'word '.repeat(150):'Now: Quiet morning.\n\nNext: Finish the parcel review before lunch.'};});
  const store=createClient<Database>('https://fixture.supabase.co','fixture',{auth:{persistSession:false,autoRefreshToken:false}});
  const result=await writeBrief({store,userId:owner,provider,settings:{apiKey:'fixture'},signal:new AbortController().signal,runId:owner});
  expect(result).toMatchObject({state:'saved',status:'partial',summary:expect.stringContaining('parcel review')});
  expect(writes.map(w=>w.method)).toEqual(['POST','PATCH']);
  expect(writes[1]!.body).toMatchObject({status:'partial'});
 });
 it('is a no-op when the slot already ran or reviews are paused',async()=>{
  let paused=false;
  vi.stubGlobal('fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
   const request=new Request(input,init),url=new URL(request.url);
   if(url.pathname.endsWith('/app_memberships'))return Response.json({active:true});
   if(url.pathname.endsWith('/cora_review_preferences'))return Response.json({automatic_reminders:!paused});
   if(url.pathname.endsWith('/cora_workday_reviews')&&request.method==='POST')return Response.json([]);
   throw new Error('Unexpected request '+url.pathname);
  });
  const provider=fakeProvider(()=>{throw new Error('Provider must not run');});
  const store=createClient<Database>('https://fixture.supabase.co','fixture',{auth:{persistSession:false,autoRefreshToken:false}});
  const options={store,userId:owner,provider,settings:{apiKey:'fixture'},signal:new AbortController().signal,runId:owner};
  expect(await writeBrief(options)).toMatchObject({state:'skipped',reason:'This brief already ran.'});
  paused=true;
  expect(await writeBrief(options)).toMatchObject({state:'skipped',reason:expect.stringContaining('paused')});
 });
});
