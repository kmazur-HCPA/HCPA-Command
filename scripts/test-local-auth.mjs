import {testPhase8} from './test-phase8-local.mjs'
import {testLibrary} from './test-library-local.mjs'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'
import { randomUUID, randomBytes } from 'node:crypto'

// Deliberately local-only: this script must never provision test identities in production.
const values = Object.fromEntries((await readFile('.env.supabase.test', 'utf8')).split('\n').filter(line=>line.includes('=')).map(line=>{const index=line.indexOf('=');return [line.slice(0,index),line.slice(index+1).replace(/^"|"$/g,'')]}))
const url = values.API_URL
assert(url && ['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname), 'Integration tests require a local Supabase URL')
assert(values.SERVICE_ROLE_KEY && values.ANON_KEY, 'Local CLI status must include test keys')
const opts = { auth:{ persistSession:false, autoRefreshToken:false, detectSessionInUrl:false } }
const admin = createClient(url, values.SERVICE_ROLE_KEY, opts)
const anon = createClient(url, values.ANON_KEY, opts)
const owner = createClient(url, values.ANON_KEY, opts)
const outsider = createClient(url, values.ANON_KEY, opts)
const suffix=randomUUID()
const email=`command-${suffix}@example.test`
const password=randomBytes(32).toString('base64url')
const users=[]
try {
  const signup=await anon.auth.signUp({email:`signup-${suffix}@example.test`,password})
  assert(signup.error, 'Public signup must be disabled')
  for(const address of [email,`outsider-${suffix}@example.test`]) {
    const result=await admin.auth.admin.createUser({email:address,password,email_confirm:true});if(result.error)throw result.error;users.push(result.data.user.id)
  }
  const grant=await admin.from('app_memberships').insert({user_id:users[0]});if(grant.error)throw grant.error
  const login=await owner.auth.signInWithPassword({email,password});if(login.error)throw login.error
  const denied=await outsider.auth.signInWithPassword({email:`outsider-${suffix}@example.test`,password});if(denied.error)throw denied.error
  assert((await anon.from('user_preferences').select('*')).error,'Anonymous API call must be denied')
  assert.deepEqual((await outsider.from('user_preferences').select('*')).data,[])
  assert.equal((await owner.from('user_preferences').select('*')).data?.length,1)
  const update=await owner.from('user_preferences').update({theme:'light'}).eq('user_id',users[0]).select('version').single();if(update.error)throw update.error;assert.equal(update.data.version,2)
  const events=await owner.from('activity_log').select('id').eq('action','UPDATE');assert.equal(events.data?.length,1)

  // Real PostgREST/GoTrue integration for the three requested phases.
  async function create(kind,title,extra={}) {
    const status=kind==='task'?'Inbox':kind==='journal'?'Recorded':'Active'
    const result=await owner.from('work_items').insert({id:randomUUID(),user_id:users[0],kind,title,status,...extra}).select('*').single()
    if(result.error)throw result.error;return result.data
  }
  const project=await create('project','Synthetic project',{goals:'Verify ownership',current_state:'Testing',next_milestone:'Pilot'})
  const person=await create('person','Synthetic person')
  const entry=await create('journal','Synthetic decision',{body:'Original words',entry_type:'Decision',project_id:project.id})
  const edit=await owner.from('work_items').update({body:'Revised words'}).eq('id',entry.id).eq('version',1).select('*').single();if(edit.error)throw edit.error
  assert.equal(edit.data.original_body,'Original words')
  assert.equal((await owner.from('journal_revisions').select('id').eq('item_id',entry.id)).data.length,2)
  const task=await create('task','Synthetic task',{project_id:project.id,person_id:person.id,source_entry_id:entry.id,focus_slot:1})
  await create('waiting','Synthetic dependency',{person_id:person.id,task_id:task.id,due_date:'2026-09-21'})
  const reminder=await create('reminder','Synthetic reminder',{remind_at:'2020-01-01T00:00:00Z',project_id:project.id})
  const converted=await owner.rpc('convert_reminder',{reminder_id:reminder.id,expected_version:1});if(converted.error)throw converted.error
  const repeated=await owner.rpc('convert_reminder',{reminder_id:reminder.id,expected_version:1});if(repeated.error)throw repeated.error;assert.equal(converted.data,repeated.data)
  assert.deepEqual((await outsider.from('work_items').select('id')).data,[])
  assert.deepEqual((await outsider.from('journal_revisions').select('id')).data,[])
  const replay=await owner.from('work_items').upsert({id:task.id,user_id:users[0],kind:'task',title:'Must not overwrite',status:'Inbox'},{onConflict:'id',ignoreDuplicates:true});if(replay.error)throw replay.error
  assert.equal((await owner.from('work_items').select('title').eq('id',task.id).single()).data.title,'Synthetic task')
  const timings=[]
  for(let i=0;i<30;i++){
    const started=performance.now();const saved=await owner.from('work_items').update({body:`Synthetic edit ${i}`}).eq('id',task.id).eq('version',i+1).select('version').single();if(saved.error)throw saved.error;timings.push(performance.now()-started)
  }
  timings.sort((a,b)=>a-b)
  console.log(JSON.stringify({event:'local_api_latency',samples:30,p50_ms:Math.round(timings[14]),p95_ms:Math.round(timings[28]),scope:'loopback synthetic writes; not production-device latency'}))
  console.log('PASS: tasks, waiting/person/project links, immutable journal revisions, retry-safe conversion and insert, priority slot, and RLS through real local APIs.')
  await testLibrary({admin,owner,outsider,users,url,anonKey:values.ANON_KEY})
  await testPhase8({admin,owner,outsider,users,url,anonKey:values.ANON_KEY})
  // Test the administrator-assisted recovery path selected for this pilot.
  const newPassword=randomBytes(32).toString('base64url')
  const changed=await admin.auth.admin.updateUserById(users[0],{password:newPassword});if(changed.error)throw changed.error
  const signedOut=await owner.auth.signOut({scope:'global'});if(signedOut.error)throw signedOut.error
  assert((await owner.auth.signInWithPassword({email,password})).error,'Old password must fail after reset')
  assert.equal((await owner.auth.signInWithPassword({email,password:newPassword})).error,null)
  const revoked=await admin.from('app_memberships').update({active:false}).eq('user_id',users[0]);if(revoked.error)throw revoked.error
  assert.deepEqual((await owner.from('user_preferences').select('*')).data,[])
  await owner.auth.signOut();assert.equal((await owner.auth.getSession()).data.session,null)
  console.log('PASS: local GoTrue signup denial, login, RLS, persisted mutation/audit, recovery, revocation and logout.')
} finally {
  for(const id of users) {
    const versions=await admin.from('library_versions').select('id,document_id').eq('user_id',id)
    if(versions.data?.length)await admin.storage.from('command-library').remove(versions.data.map(v=>`${id}/${v.document_id}/${v.id}`))
    await admin.from('library_versions').delete().eq('user_id',id)
    await admin.from('journal_revisions').delete().eq('user_id',id)
    await admin.from('work_items').delete().eq('user_id',id)
    const result=await admin.auth.admin.deleteUser(id);if(result.error)console.error('Synthetic user cleanup failed; reset the disposable local database.') }
}
