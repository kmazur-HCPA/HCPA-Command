import type {SupabaseClient} from '@supabase/supabase-js'
import {MAX_FILE_BYTES,validateFile} from '../_shared/validate-file.ts'
const bucket='command-library'
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const origins=new Set(['https://cmd.hillspafl.gov','https://hcpa-command.netlify.app','http://localhost:5173','http://127.0.0.1:5173'])
export async function handleLibrary(req:Request,client:SupabaseClient,admin:SupabaseClient) {
 const origin=req.headers.get('origin')
 const headers:Record<string,string>={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Expose-Headers':'Content-Disposition'}
 if(origin&&origins.has(origin))headers['Access-Control-Allow-Origin']=origin
 const reply=(message:string,status:number)=>Response.json({error:message},{status,headers})
 if(origin&&!origins.has(origin))return reply('Origin is not allowed.',403)
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers})
 if(req.method!=='POST')return reply('Method not allowed.',405)
 const token=req.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1]
 if(!token)return reply('Sign in before accessing documents.',401)
 try{
  const {data:{user},error:authError}=await client.auth.getUser(token)
  if(authError||!user||user.is_anonymous)return reply('Sign in again.',401)
  const member=await client.from('app_memberships').select('active').eq('user_id',user.id).eq('active',true).maybeSingle()
  if(member.error||!member.data)return reply('Access is unavailable.',403)
  // Bound the stream itself: Content-Length is not trusted and may be absent.
  const reader=req.body?.getReader();if(!reader)return reply('Missing request.',400)
  const chunks:Uint8Array[]= [];let length=0
  while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>MAX_FILE_BYTES+65536){await reader.cancel();return reply('Upload exceeds 5 MiB.',413)}chunks.push(value)}
  const body=new Uint8Array(length);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length}
  const copy=new Request(req.url,{method:'POST',headers:req.headers,body})
  if(req.headers.get('content-type')?.includes('application/json')){
   const input=await copy.json()
   if(input.action!=='download'||typeof input.id!=='string'||!uuid.test(input.id))return reply('Invalid download request.',400)
   const row=await client.from('library_versions').select('*').eq('id',input.id).eq('user_id',user.id).eq('state','ready').maybeSingle()
   if(row.error||!row.data)return reply('Document version unavailable.',404)
   const path=`${user.id}/${row.data.document_id}/${row.data.id}`
   const file=await admin.storage.from(bucket).download(path)
   if(file.error||!file.data)return reply('Original unavailable. Contact the recovery owner.',503)
   const bytes=new Uint8Array(await file.data.arrayBuffer())
   const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('')
   if(hash!==row.data.sha256||bytes.length!==row.data.size_bytes)return reply('Integrity verification failed. Contact the recovery owner.',503)
   return new Response(bytes,{headers:{...headers,'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="document.${row.data.filename.split('.').pop().replace(/[^a-z0-9]/gi,'')}"; filename*=UTF-8''${encodeURIComponent(row.data.filename)}`,'Content-Security-Policy':"default-src 'none'; sandbox"}})
  }
  const form=await copy.formData(),file=form.get('file'),documentId=form.get('documentId'),id=form.get('id')
  if(!(file instanceof File)||typeof documentId!=='string'||!uuid.test(documentId)||typeof id!=='string'||!uuid.test(id))return reply('Choose a file and saved Library record.',400)
  const document=await client.from('work_items').select('id,details').eq('id',documentId).eq('user_id',user.id).eq('kind','library').eq('archived',false).maybeSingle()
  if(document.error||!document.data)return reply('Document unavailable.',404)
  if(!['Public','Internal'].includes(document.data.details?.classification))return reply('Choose an approved classification before uploading.',400)
  const bytes=new Uint8Array(await file.arrayBuffer())
  let validated:Awaited<ReturnType<typeof validateFile>>
  try{validated=await validateFile(file.name,bytes)}catch(error){return reply(error instanceof Error?error.message:'File validation failed.',422)}
  const record={id,user_id:user.id,document_id:documentId,filename:file.name,media_type:validated.mediaType,size_bytes:validated.size,sha256:validated.hash,state:'pending'}
  const reserve=await admin.from('library_versions').upsert(record,{onConflict:'id',ignoreDuplicates:true})
  if(reserve.error)return reply('Could not reserve this upload. Retry with the same file.',503)
  const existing=await client.from('library_versions').select('*').eq('id',id).eq('user_id',user.id).single()
  if(existing.error||existing.data.document_id!==documentId||existing.data.sha256!==validated.hash||existing.data.filename!==file.name)return reply('This upload ID belongs to a different file. Start a new version.',409)
  if(existing.data.state==='ready')return Response.json(existing.data,{headers})
  const path=`${user.id}/${documentId}/${id}`
  const stored=await admin.storage.from(bucket).upload(path,bytes,{contentType:'application/octet-stream',upsert:false,cacheControl:'0'})
  if(stored.error){
   // A completed object write with a lost acknowledgement is safe to reconcile.
   const previous=await admin.storage.from(bucket).download(path)
   if(previous.error||!previous.data)return reply('Upload not finished. Retry this pending version with the same file.',503)
   const priorBytes=new Uint8Array(await previous.data.arrayBuffer())
   const priorHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',priorBytes))).map(v=>v.toString(16).padStart(2,'0')).join('')
   if(priorHash!==validated.hash)return reply('Stored original differs. Contact the recovery owner.',409)
  }
  // Membership remains authoritative even if revoked during a long upload.
  const stillAllowed=await client.from('app_memberships').select('active').eq('user_id',user.id).eq('active',true).maybeSingle()
  if(!stillAllowed.data)return reply('Access revoked. The pending upload is retained for administrative recovery.',403)
  const finalized=await admin.from('library_versions').update({state:'ready'}).eq('id',id).eq('user_id',user.id).eq('state','pending').select('*').maybeSingle()
  if(finalized.error)return reply('Original uploaded; finalization is pending. Retry the same version and file.',503)
  const result=finalized.data??(await client.from('library_versions').select('*').eq('id',id).eq('state','ready').single()).data
  if(!result)return reply('Finalization is pending. Retry the same version.',503)
  return Response.json(result,{headers})
 }catch{return reply('The request could not finish. Retry; pending originals are preserved.',503)}
}
