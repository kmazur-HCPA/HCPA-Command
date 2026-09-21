import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFile,readdir } from 'node:fs/promises'

const owner = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
const unapproved = '33333333-3333-4333-8333-333333333333'
let db: PGlite
async function authenticate(id: string, anonymous = false) {
  await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: id, role: 'authenticated', is_anonymous: anonymous })])
  await db.exec('set local role authenticated')
}

describe('Work record integrity and authorization', () => {
  beforeAll(async () => {
    db = new PGlite()
    await db.exec(`
      create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create schema auth; create table auth.users (id uuid primary key);
      create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
      create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
      grant usage on schema auth to anon, authenticated, service_role;
      grant execute on function auth.uid(), auth.jwt() to anon, authenticated, service_role;
    `)
    await db.exec(await readFile('supabase/migrations/20260921115103_foundation.sql', 'utf8'))
    for(const file of (await readdir('supabase/migrations')).filter(name=>name!=='20260921115103_foundation.sql').sort()) await db.exec(await readFile(`supabase/migrations/${file}`,'utf8'))
    await db.query('insert into auth.users(id) values ($1),($2),($3)', [owner, other, unapproved])
    await db.query('insert into public.app_memberships(user_id) values ($1),($2)', [owner, other])
  })
  beforeEach(async () => { await db.exec('begin') })
  afterEach(async () => { await db.exec('rollback') })
  afterAll(async () => { await db.close() })

  it('denies cross-owner inserts and unapproved reads',async()=>{
    await authenticate(owner)
    await expect(db.query("insert into public.work_items(user_id,kind,title,status) values ($1,'task','Private','Inbox')",[other])).rejects.toThrow(/row-level security/)
  })
  it('keeps active overdue reminders and converts them exactly once',async()=>{
    await authenticate(owner)
    const r=await db.query<{id:string}>("insert into public.work_items(user_id,kind,title,body,status,remind_at) values ($1,'reminder','Follow up','Original context','Active','2020-01-01Z') returning id",[owner])
    const id=r.rows[0]!.id
    expect((await db.query("select status from public.work_items where id=$1",[id])).rows[0]).toEqual({status:'Active'})
    const first=await db.query("select public.convert_reminder($1,1) as id",[id]); const retry=await db.query("select public.convert_reminder($1,1) as id",[id])
    expect(retry.rows).toEqual(first.rows)
    expect((await db.query("select * from public.work_items where kind='task'")).rows).toHaveLength(1)
  })
  it('rejects stale conversion and direct deletion',async()=>{
    await authenticate(owner)
    const row=(await db.query<{id:string}>("insert into public.work_items(user_id,kind,title,status) values ($1,'reminder','Reminder','Active') returning id",[owner])).rows[0]!
    await expect(db.query('select public.convert_reminder($1,9)',[row.id])).rejects.toThrow(/Reload/)
  })
  it('uses optimistic versions and preserves original text',async()=>{
    await authenticate(owner)
    const row=(await db.query<{id:string}>("insert into public.work_items(user_id,kind,title,body,status) values ($1,'task','Task','original','Inbox') returning id",[owner])).rows[0]!
    await db.query("update public.work_items set body='edited',original_body='forged' where id=$1 and version=1",[row.id])
    expect((await db.query('select body,original_body,version from public.work_items where id=$1',[row.id])).rows[0]).toEqual({body:'edited',original_body:'original',version:2})
    expect((await db.query("update public.work_items set body='stale' where id=$1 and version=1 returning id",[row.id])).rows).toHaveLength(0)
  })
  it('blocks forged task links to another owner',async()=>{
    const row=(await db.query<{id:string}>("insert into public.work_items(user_id,kind,title,status) values ($1,'task','Other','Inbox') returning id",[other])).rows[0]!
    await authenticate(owner)
    await expect(db.query("insert into public.work_items(user_id,kind,title,status,converted_task_id) values ($1,'reminder','Mine','Active',$2)",[owner,row.id])).rejects.toThrow(/Invalid task link/)
  })
  it('revocation hides records and clients cannot delete',async()=>{
    await db.query("insert into public.work_items(user_id,kind,title,status) values ($1,'task','Task','Inbox')",[owner])
    await db.query('update public.app_memberships set active=false where user_id=$1',[owner]);await authenticate(owner)
    expect((await db.query('select * from public.work_items')).rows).toHaveLength(0)
    await expect(db.exec('delete from public.work_items')).rejects.toThrow(/permission denied/)
  })
  it('preserves journal originals, revisions, and archived project links',async()=>{
    await authenticate(owner)
    const project=(await db.query<{id:string}>("insert into public.work_items(user_id,kind,title,status) values ($1,'project','Program','Active') returning id",[owner])).rows[0]!
    const entry=(await db.query<{id:string}>("insert into public.work_items(user_id,kind,title,body,status,entry_type,project_id) values ($1,'journal','Decision','First reasoning','Recorded','Decision',$2) returning id",[owner,project.id])).rows[0]!
    await db.query("update public.work_items set body='Revised reasoning' where id=$1",[entry.id])
    await db.query('update public.work_items set archived=true where id=$1',[project.id])
    expect((await db.query('select original_body,project_id from public.work_items where id=$1',[entry.id])).rows[0]).toEqual({original_body:'First reasoning',project_id:project.id})
    expect((await db.query('select * from public.journal_revisions where item_id=$1',[entry.id])).rows).toHaveLength(2)
    await expect(db.exec('delete from public.journal_revisions')).rejects.toThrow(/permission denied/)
  })
  it('rejects references with the wrong owner or kind',async()=>{
    await authenticate(owner)
    const person=(await db.query<{id:string}>("insert into public.work_items(user_id,kind,title,status) values ($1,'person','Person','Active') returning id",[owner])).rows[0]!
    await expect(db.query("insert into public.work_items(user_id,kind,title,status,project_id) values ($1,'task','Task','Inbox',$2)",[owner,person.id])).rejects.toThrow(/Invalid context link/)
  })

  it('enforces exactly three available priority slots and releases completed slots',async()=>{
    await authenticate(owner)
    await db.query("insert into public.work_items(user_id,kind,title,status,focus_slot) select $1::uuid,'task','Priority '||n,'Next',n from generate_series(1,3) n",[owner])
    await db.exec("update public.work_items set status='Complete' where focus_slot=1")
    await db.query("insert into public.work_items(user_id,kind,title,status,focus_slot) values ($1,'task','Replacement','Next',1)",[owner])
    expect((await db.query("select * from public.work_items where focus_slot is not null and status<>'Complete'")).rows).toHaveLength(3)
    await expect(db.query("insert into public.work_items(user_id,kind,title,status,focus_slot) values ($1,'task','Fourth','Next',2)",[owner])).rejects.toThrow(/duplicate key/)
  })

  it('traces learning through an experiment and decision with preserved revisions',async()=>{
    await authenticate(owner)
    const make=async(kind:string,status:string,details={})=>(await db.query<{id:string}>("insert into public.work_items(user_id,kind,title,status,details) values ($1,$2,$2,$3,$4) returning id",[owner,kind,status,JSON.stringify(details)])).rows[0]!.id
    const learning=await make('learning','Complete',{progress:'100',takeaways:'Evaluate with synthetic data'})
    const experiment=await make('experiment','Complete',{hypothesis:'Structured evaluation improves consistency',results:'Repeatable results'})
    await db.query('update public.work_items set learning_id=$1 where id=$2',[learning,experiment])
    const decision=await make('journal','Recorded')
    await db.query("update public.work_items set entry_type='Decision',experiment_id=$1,learning_id=$2 where id=$3",[experiment,learning,decision])
    await db.query('update public.work_items set decision_id=$1 where id=$2',[decision,experiment])
    expect((await db.query('select count(*)::integer as n from public.journal_revisions where item_id=$1',[experiment])).rows[0]).toEqual({n:3})
    await db.exec('reset role');await authenticate(other)
    expect((await db.query("select id from public.work_items where kind in ('learning','experiment')")).rows).toHaveLength(0)
  })
  it('preserves the Decision type when a lab record references it',async()=>{
    await authenticate(owner)
    const decision=(await db.query<{id:string}>("insert into public.work_items(user_id,kind,title,status,entry_type) values ($1,'journal','Decision','Recorded','Decision') returning id",[owner])).rows[0]!.id
    await db.query("insert into public.work_items(user_id,kind,title,status,decision_id) values ($1,'experiment','Experiment','Planned',$2)",[owner,decision])
    await expect(db.query("update public.work_items set entry_type='Thought' where id=$1",[decision])).rejects.toThrow(/referenced as a decision/)
  })
  it('requires recorded decisions for approval and rejects invalid learning progress',async()=>{
    await authenticate(owner)
    await expect(db.query("insert into public.work_items(user_id,kind,title,status) values ($1,'use_case','Unsafe shortcut','Approved')",[owner])).rejects.toThrow(/decision/)
  })
  it('rejects invalid learning progress at the database boundary',async()=>{
    await authenticate(owner)
    await expect(db.query("insert into public.work_items(user_id,kind,title,status,details) values ($1,'learning','Course','Saved','{\"progress\":\"101\"}')",[owner])).rejects.toThrow(/Progress/)
  })

  it('reports database latency on the agreed synthetic pilot dataset',async()=>{
    await authenticate(owner)
    for(const [kind,count,status] of [['task',1000,'Next'],['reminder',250,'Active'],['journal',2000,'Recorded'],['waiting',100,'Active']] as const){
      await db.query("insert into public.work_items(user_id,kind,title,body,status,due_date) select $1::uuid,$2,'Synthetic '||$2||' '||n,repeat('Synthetic planning content. ',20),$3,'2026-09-21'::date from generate_series(1,$4::integer) n",[owner,kind,status,count])
    }
    const times:number[]=[]
    for(let i=0;i<30;i++){
      const started=performance.now()
      await db.query("select id,title,status,due_date from public.work_items where user_id=$1 and kind='task' and not archived and due_date<='2026-09-21' and status not in ('Complete','Cancelled') order by due_date limit 30",[owner])
      await db.query("select id,title from public.work_items where user_id=$1 and search_vector @@ websearch_to_tsquery('english','planning') order by created_at desc limit 50",[owner])
      times.push(performance.now()-started)
    }
    times.sort((a,b)=>a-b)
    console.info(JSON.stringify({event:'synthetic_database_benchmark',records:3350,samples:30,p50_ms:Math.round(times[14]!),p95_ms:Math.round(times[28]!),scope:'PGlite due-work plus search; excludes device/network'}))
    expect((await db.query('select count(*)::integer as n from public.work_items')).rows[0]).toEqual({n:3350})
  },15000)

  it('searches tags, structured metadata, original text, prefixes, filters and filenames with ownership',async()=>{
    await db.query("insert into public.work_items(user_id,kind,title,body,status,tags) values ($1,'task','Architecture review','Original zephyr context','Inbox',array['geospatial'])",[owner])
    await db.query("insert into public.work_items(user_id,kind,title,status,details) values ($1,'learning','Course','In Progress',jsonb_build_object('provider','Cartography Institute','takeaways','spatial resilience'))",[owner])
    const doc=(await db.query<{id:string}>("insert into public.work_items(user_id,kind,title,status,details) values ($1,'library','Reference','Recorded',jsonb_build_object('classification','Internal')) returning id",[owner])).rows[0]!.id
    await db.query("insert into public.library_versions(id,user_id,document_id,filename,media_type,size_bytes,sha256,state) values(gen_random_uuid(),$1,$2,'procurement-handbook.pdf','application/pdf',12,repeat('a',64),'ready')",[owner,doc])
    await db.query("insert into public.work_items(user_id,kind,title,status) values ($1,'task','Hidden geospatial','Inbox')",[other])
    await authenticate(owner)
    for(const term of ['geospatial','archit','cartography','spatial','zephyr','procure']) expect((await db.query('select * from public.search_work($1)',[term])).rows.length,term).toBeGreaterThan(0)
    expect((await db.query("select * from public.search_work('geospatial')")).rows).toHaveLength(1)
    expect((await db.query("select * from public.search_work('geospatial','learning')")).rows).toHaveLength(0)
    await db.exec("update public.work_items set archived=true where kind='task'")
    expect((await db.query("select * from public.search_work('geospatial')")).rows).toHaveLength(0)
    expect((await db.query("select * from public.search_work('geospatial',null,null,'all','geospatial')")).rows).toHaveLength(1)
    expect((await db.query("select * from public.search_work('-geospatial')")).rows).toHaveLength(0)
  })
  it('ranks titles first and exports complete owned records with reconciled counts',async()=>{
    await db.query("insert into public.work_items(user_id,kind,title,body,status) values ($1,'task','Geospatial','notes','Inbox'),($1,'task','Other record','Geospatial','Inbox'),($2,'task','Secret','Geospatial','Inbox')",[owner,other])
    await authenticate(owner)
    const results=await db.query<{title:string}>("select * from public.search_work('Geospatial')")
    expect(results.rows).toHaveLength(2);expect(results.rows[0]!.title).toBe('Geospatial')
    const result=(await db.query<{value:{work_items:{id:string;user_id:string}[];counts:{work_items:number}}}>('select public.export_workspace() value')).rows[0]!.value
    expect(result.counts.work_items).toBe(2);expect(result.work_items).toHaveLength(2)
    expect(result.work_items.every(row=>row.user_id===owner)).toBe(true)
  })
  it('denies unapproved export and hides search results after revocation',async()=>{
    await db.query("insert into public.work_items(user_id,kind,title,status) values ($1,'task','Private record','Inbox')",[owner])
    await db.query('update public.app_memberships set active=false where user_id=$1',[owner])
    await authenticate(owner)
    expect((await db.query("select * from public.search_work('Private')")).rows).toHaveLength(0)
    await expect(db.query('select public.export_workspace()')).rejects.toThrow(/unavailable/)
  })

  it('reserves Cora requests once and restricts writes to the server role',async()=>{
    const request='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',conversation='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    await db.exec('set local role service_role')
    const args=[owner,conversation,request,'What needs attention?',JSON.stringify({page:'workspace',recordId:null})]
    const first=await db.query<{value:{started:boolean}}>('select public.cora_begin($1,$2,$3,$4,$5::jsonb) value',args)
    const second=await db.query<{value:{started:boolean}}>('select public.cora_begin($1,$2,$3,$4,$5::jsonb) value',args)
    expect(first.rows[0]!.value.started).toBe(true);expect(second.rows[0]!.value.started).toBe(false)
    await db.exec('reset role');await authenticate(owner)
    expect((await db.query('select * from public.cora_turns')).rows).toHaveLength(1)
    const exported=(await db.query<{value:{counts:{cora_turns:number}}}>('select public.export_workspace() value')).rows[0]!.value
    expect(exported.counts.cora_turns).toBe(1)
    await expect(db.query('select public.cora_begin($1,$2,$3,$4,$5::jsonb)',args)).rejects.toThrow(/permission denied/)
  })
  it('isolates Cora history and prevents browser-forged assistant receipts',async()=>{
    await db.exec('set local role service_role')
    await db.query("select public.cora_begin($1,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Private conversation','{}')",[owner])
    await db.exec('reset role');await authenticate(other)
    expect((await db.query('select * from public.cora_conversations')).rows).toHaveLength(0)
    expect((await db.query('select * from public.cora_turns')).rows).toHaveLength(0)
    await expect(db.query("update public.cora_turns set response='Task created'" )).rejects.toThrow(/permission denied/)
  })
  it('serializes separate Cora requests and hides history on revocation',async()=>{
    await db.exec('set local role service_role')
    await db.query("select public.cora_begin($1,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Private conversation','{}')",[owner])
    await db.exec('savepoint next_request')
    await expect(db.query("select public.cora_begin($1,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cccccccc-cccc-4ccc-8ccc-cccccccccccc','Another question','{}')",[owner])).rejects.toThrow(/already working/)
    await db.exec('rollback to savepoint next_request; reset role')
    await db.query('update public.app_memberships set active=false where user_id=$1',[owner]);await authenticate(owner)
    expect((await db.query('select * from public.cora_turns')).rows).toHaveLength(0)
  })

})
