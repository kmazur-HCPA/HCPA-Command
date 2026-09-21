import {createClient} from '@supabase/supabase-js'
const secret=process.env.SUPABASE_SECRET_KEY
let role='';try{role=JSON.parse(Buffer.from(secret?.split('.')[1]??'', 'base64url').toString()).role??''}catch{}
if(!secret?.startsWith('sb_secret_')&&role!=='service_role')throw new Error('SUPABASE_SECRET_KEY is not an accessible server credential (publishable, absent or masked).')
const client=createClient(process.env.SUPABASE_URL,secret,{auth:{persistSession:false,autoRefreshToken:false}})
const result=await client.from('app_memberships').select('user_id',{head:true,count:'exact'})
if(result.error)throw new Error('Server database credential verification failed.')
console.log(JSON.stringify({event:'cora_configuration',server_database_access:true,provider_configured:!!process.env.OPENAI_API_KEY,model:process.env.CORA_MODEL??'gpt-5.4-mini'}))
