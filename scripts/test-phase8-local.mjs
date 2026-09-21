import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {mkdir,writeFile} from 'node:fs/promises'
// Called only by the local-only Auth integration harness. No hosted credentials.
export async function testPhase8({admin,owner,outsider,users,url,anonKey}){
 assert(['127.0.0.1','localhost','[::1]'].includes(new URL(url).hostname))
 const db='supabase_db_HCPA-Command'
 const sql=text=>execFileSync('docker',['exec','-i',db,'psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-qAt'],{input:text,encoding:'utf8',maxBuffer:10*1024*1024})
 const ownerId=users[0];assert.match(ownerId,/^[a-f0-9-]{36}$/)
 const snapshot=await owner.rpc('export_workspace');assert.equal(snapshot.error,null)
 const backup=snapshot.data
 for(const table of ['work_items','journal_revisions','library_versions','user_preferences','activity_log','app_memberships']){
  assert.equal(backup.counts[table],backup[table].length)
  const source=await owner.from(table).select('user_id',{count:'exact',head:true});assert.equal(source.error,null);assert.equal(source.count,backup.counts[table])
  assert(backup[table].every(row=>row.user_id===ownerId))
 }
 const foreign=await outsider.rpc('export_workspace');assert.equal(foreign.error,null);assert.equal(foreign.data.work_items.length,0)
 const search=await owner.rpc('search_work',{query_text:'original'});assert.equal(search.error,null);assert(search.data.length>0)
 assert.equal((await outsider.rpc('search_work',{query_text:'original'})).data.length,0)
 const token=(await owner.auth.getSession()).data.session.access_token
 const download=id=>fetch(`${url}/functions/v1/library`,{method:'POST',headers:{Authorization:`Bearer ${token}`,apikey:anonKey,'Content-Type':'application/json'},body:JSON.stringify({action:'download',id})})
 const originals=[]
 for(const version of backup.library_versions.filter(v=>v.state==='ready')){
  const response=await download(version.id);assert.equal(response.status,200)
  const bytes=Buffer.from(await response.arrayBuffer());assert.equal(createHash('sha256').update(bytes).digest('hex'),version.sha256)
  originals.push({version,bytes,path:`${ownerId}/${version.document_id}/${version.id}`})
 }
 // Simulate loss and recover the entire synthetic user's application data and all originals.
 const started=performance.now()
 if(originals.length){const removed=await admin.storage.from('command-library').remove(originals.map(v=>v.path));assert.equal(removed.error,null)}
 const encoded=Buffer.from(JSON.stringify(backup)).toString('base64')
 sql(`begin;
 set local session_replication_role=replica;
 create temporary table recovery_payload as select convert_from(decode('${encoded}','base64'),'UTF8')::jsonb value;
 do $$ declare table_name text; cols text; begin
 foreach table_name in array array['library_versions','journal_revisions','work_items','activity_log','user_preferences','app_memberships'] loop
 execute format('delete from public.%I where user_id=$1',table_name) using '${ownerId}'::uuid;
 end loop;
 foreach table_name in array array['app_memberships','user_preferences','work_items','journal_revisions','library_versions','activity_log'] loop
 select string_agg(quote_ident(attname),',' order by attnum) into cols from pg_attribute where attrelid=format('public.%I',table_name)::regclass and attnum>0 and not attisdropped and attgenerated='';
 execute format('insert into public.%I (%s) select %s from jsonb_populate_recordset(null::public.%I,(select value->$1 from recovery_payload))',table_name,cols,cols,table_name) using table_name;
 end loop;
 end $$; commit;`)
 for(const original of originals){const restored=await admin.storage.from('command-library').upload(original.path,original.bytes,{contentType:'application/octet-stream'});assert.equal(restored.error,null)}
 const recovered=await owner.rpc('export_workspace');assert.equal(recovered.error,null)
 for(const table of Object.keys(backup.counts))assert.deepEqual(recovered.data[table],backup[table],`restored ${table}`)
 for(const original of originals){const response=await download(original.version.id);assert.equal(response.status,200);assert.equal(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'),original.version.sha256)}
 assert.equal((await outsider.rpc('search_work',{query_text:'original'})).data.length,0)
 console.log(JSON.stringify({event:'recovery_drill',scope:'disposable local application database and originals; existing Auth identities retained',records:backup.work_items.length,history:backup.journal_revisions.length,originals:originals.length,duration_ms:Math.round(performance.now()-started),result:'pass'}))
 // Representative growth, rolled back completely. Two owners, 15,000 records, indexed RLS path.
 const timings=sql(`begin;
 insert into public.work_items(user_id,kind,title,body,status,tags)
 select case when n<=10000 then '${ownerId}'::uuid else '${users[1]}'::uuid end,'task',case when n%100=0 then 'Geospatial recovery '||n else 'Synthetic work item '||n end,repeat('Planning implementation operational notes. ',30),'Inbox',array[case when n%100=0 then 'gis' else 'operations' end]
 from generate_series(1,15000) n;
 analyze public.work_items;
 set local role authenticated;
 select set_config('request.jwt.claims','{"sub":"${ownerId}","role":"authenticated"}',true);
 explain (analyze,buffers,format json) select id from public.work_items where user_id=(select auth.uid()) and search_vector@@websearch_to_tsquery('english','geospatial');
 explain (analyze,buffers,format json) select * from public.search_work('geospatial');
 explain (analyze,buffers,format json) select * from public.search_work('planning');
 rollback;`)
 await mkdir('test-results',{recursive:true});await writeFile('test-results/search-query-plans.txt',timings)
 assert(timings.includes('work_search'),'Representative selective query must use the search index')
 const elapsed=[...timings.matchAll(/"Execution Time": ([\d.]+)/g)].map(match=>Number(match[1]));assert.equal(elapsed.length,3);assert(elapsed.every(ms=>ms<1500),'Search exceeds the 1.5 second local growth-test gate')
 console.log(JSON.stringify({event:'search_growth_plan',records:15000,owned:10000,selective_index_ms:elapsed[0],ranked_selective_ms:elapsed[1],ranked_common_ms:elapsed[2],index:'work_search',scope:'local PostgreSQL with RLS; not production network latency'}))
}
