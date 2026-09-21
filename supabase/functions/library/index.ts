import {createClient} from '@supabase/supabase-js'
import {handleLibrary} from './handler.ts'
Deno.serve((request:Request)=>{
 const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!,secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
 const auth={persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}
 const client=createClient(url,anon,{auth,global:{headers:{Authorization:request.headers.get('Authorization')??''}}})
 const admin=createClient(url,secret,{auth})
 return handleLibrary(request,client,admin)
})
