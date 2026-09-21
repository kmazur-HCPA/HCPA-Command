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
  const recovery=await admin.auth.admin.generateLink({type:'recovery',email});if(recovery.error)throw recovery.error
  const recoverClient=createClient(url,values.ANON_KEY,opts)
  const verify=await recoverClient.auth.verifyOtp({token_hash:recovery.data.properties.hashed_token,type:'recovery'});if(verify.error)throw verify.error
  const newPassword=randomBytes(32).toString('base64url')
  const changed=await recoverClient.auth.updateUser({password:newPassword});if(changed.error)throw changed.error
  await recoverClient.auth.signOut({scope:'global'})
  assert((await owner.auth.signInWithPassword({email,password})).error,'Old password must fail after reset')
  assert.equal((await owner.auth.signInWithPassword({email,password:newPassword})).error,null)
  const revoked=await admin.from('app_memberships').update({active:false}).eq('user_id',users[0]);if(revoked.error)throw revoked.error
  assert.deepEqual((await owner.from('user_preferences').select('*')).data,[])
  await owner.auth.signOut();assert.equal((await owner.auth.getSession()).data.session,null)
  console.log('PASS: local GoTrue signup denial, login, RLS, persisted mutation/audit, recovery, revocation and logout.')
} finally {
  for(const id of users) { const result=await admin.auth.admin.deleteUser(id);if(result.error)console.error('Synthetic user cleanup failed; reset the disposable local database.') }
}
