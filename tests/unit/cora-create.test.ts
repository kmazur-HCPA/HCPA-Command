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
import type OpenAI from 'openai';
import type {Database} from '../../src/data/database.types';
import type {CoraEvent,CoraTurn} from '../../src/features/cora/model';
import {runCora} from '../../netlify/functions/_shared/cora/engine';
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
 let round=0;
 const provider={chat:{completions:{create:async()=>{const first=round++===0;return(async function*(){yield {choices:[{delta:first?{tool_calls:[{index:0,id:'call-1',type:'function',function:{name:'create_record',arguments:JSON.stringify(input)}}]}:{content:'Saved.'}}]};})();}}}} as unknown as OpenAI;
 const client=createClient<Database>('https://fixture.supabase.co','fixture',{auth:{persistSession:false,autoRefreshToken:false}});
 const events:CoraEvent[]=[];
 await runCora({client,store:client,turn,provider,model:'fixture',signal:new AbortController().signal,emit:event=>events.push(event)});
 expect(events.find(event=>event.type==='complete')).toMatchObject({turn:{action_status:'created',proposal:null,task_id:expected.id,sources:[{id:expected.id,kind,title:'Follow up'}]}});
 expect(audits.find(a=>a.tool==='create_record')).toMatchObject({success:true,result:{state:'saved'}});
});

it('brief mode publishes a saved review but rejects work mutations even if the model requests one',async()=>{
 const turn:CoraTurn={id:owner,user_id:owner,conversation_id:owner,message:'Update my brief',context:{page:'command-brief',recordId:null},response:'',sources:[],proposal:null,task_id:other,status:'running',action_status:'none',created_at:new Date().toISOString(),finished_at:null};
 const writes:Record<string,unknown>[]=[];
 const audits:Record<string,unknown>[]=[];
 vi.stubGlobal('fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
  const request=new Request(input,init),url=new URL(request.url);
  if(url.pathname.endsWith('/app_memberships'))return Response.json({active:true});
  if(url.pathname.endsWith('/work_items')){expect(request.method).toBe('GET');return Response.json([],{headers:{'content-range':'0-0/0'}});}
  if(url.pathname.endsWith('/cora_review_preferences'))return Response.json({automatic_reminders:true});
  if(url.pathname.endsWith('/cora_workday_reviews')){
   if(request.method==='GET')return Response.json([]);
   writes.push(await request.json());return Response.json(request.method==='POST'?[{id:owner}]:{id:owner});
  }
  if(url.pathname.endsWith('/cora_activity')){audits.push(await request.json());return new Response(null,{status:201});}
  if(url.pathname.endsWith('/cora_turns'))return request.method==='PATCH'?Response.json({...turn,...await request.json()}):Response.json([]);
  throw new Error('Unexpected request '+url.pathname);
 });
 const calls=[['get_workday_reviews',{}],['record_workday_review',{run_id:owner,status:'running',summary:''}],['create_record',args],['record_workday_review',{run_id:owner,status:'partial',summary:'At a glance\nNo active work found.\n\nCoverage\nCalendar unavailable.'}]] as const;
 let round=0;
 const provider={chat:{completions:{create:async(input:{tools:{type:string;function:{name:string}}[]})=>{
  const names=input.tools.map(t=>t.function.name);
  expect(names).toContain('record_workday_review');expect(names).not.toContain('create_record');expect(names).not.toContain('prepare_record');expect(names).not.toContain('search_outlook_mail');
  const call=calls[round++];return(async function*(){yield {choices:[{delta:call?{tool_calls:[{index:0,id:'call-'+round,type:'function',function:{name:call[0],arguments:JSON.stringify(call[1])}}]}:{content:'Brief saved.'}}]};})();
 }}}} as unknown as OpenAI;
 const client=createClient<Database>('https://fixture.supabase.co','fixture',{auth:{persistSession:false,autoRefreshToken:false}});
 const events:CoraEvent[]=[];
 await runCora({client,store:client,turn,provider,model:'fixture',signal:new AbortController().signal,emit:event=>events.push(event)});
 expect(writes).toHaveLength(2);expect(writes[1]).toMatchObject({status:'partial',summary:expect.stringContaining('At a glance')});
 expect(audits.find(a=>a.tool==='create_record')).toMatchObject({success:false});
 expect(events.find(event=>event.type==='complete')).toMatchObject({turn:{action_status:'none',proposal:null}});
});
