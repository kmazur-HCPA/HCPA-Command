import type {AppClient} from '../platform/supabase'
import {readConfig} from '../platform/config'
export type LibraryVersion={id:string;user_id:string;document_id:string;filename:string;media_type:string;size_bytes:number;sha256:string;state:'pending'|'ready';created_at:string}
export async function listVersions(client:AppClient,documentId:string,offset=0){
 const {data,error}=await client.from('library_versions').select('*').eq('document_id',documentId).order('created_at',{ascending:false}).order('id').range(offset,offset+19)
 if(error)throw new Error('Could not load original versions.');return data
}
export async function uploadOriginal(client:AppClient,documentId:string,id:string,file:File,onProgress:(value:number)=>void,signal:AbortSignal){
 const config=readConfig(import.meta.env);if(!config)throw new Error('Library is not configured.')
 const {data:{session}}=await client.auth.getSession();if(!session)throw new Error('Sign in again before uploading.')
 const form=new FormData();form.set('documentId',documentId);form.set('id',id);form.set('file',file)
 return new Promise<LibraryVersion>((resolve,reject)=>{
  const xhr=new XMLHttpRequest();xhr.open('POST',`${config.supabaseUrl}/functions/v1/library`);xhr.timeout=120000
  xhr.setRequestHeader('Authorization',`Bearer ${session.access_token}`);xhr.setRequestHeader('apikey',config.publishableKey)
  const abort=()=>xhr.abort();signal.addEventListener('abort',abort,{once:true});xhr.onloadend=()=>signal.removeEventListener('abort',abort)
  xhr.upload.onprogress=event=>{if(event.lengthComputable)onProgress(Math.round(event.loaded/event.total*100))}
  xhr.onload=()=>{try{const result=JSON.parse(xhr.responseText);if(xhr.status<200||xhr.status>=300)throw new Error(result.error??'Upload failed. Retry with the same file.');resolve(result)}catch(error){reject(error)}}
  xhr.onerror=()=>reject(new Error('Connection lost. Retry with the same original; it will not be duplicated.'))
  xhr.ontimeout=()=>reject(new Error('Upload timed out. Retry the same version to reconcile it.'))
  xhr.onabort=()=>reject(new Error('Upload interrupted. Select the same file to retry.'))
  if(signal.aborted){reject(new Error('Upload cancelled.'));return}xhr.send(form)
 })
}
export async function downloadOriginal(client:AppClient,version:LibraryVersion){
 const {data,error}=await client.functions.invoke('library',{body:{action:'download',id:version.id}})
 if(error||!(data instanceof Blob))throw new Error('Download failed. Reconnect and retry; contact the recovery owner if it persists.')
 const url=URL.createObjectURL(new Blob([data],{type:'application/octet-stream'})),link=document.createElement('a');link.href=url;link.download=version.filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),60000)
}
