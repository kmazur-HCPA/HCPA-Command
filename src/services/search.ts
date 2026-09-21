import type {AppClient} from '../platform/supabase'
import type {Kind} from '../features/work/model'
import {measured} from '../platform/telemetry'
export type SearchResult={id:string;kind:Kind;title:string;status:string;priority:string;archived:boolean;tags:string[];updated_at:string;excerpt:string;rank:number}
export type SearchFilters={module:Kind|'';status:string;archive:'current'|'archived'|'all';tag:string}
export const defaultSearchFilters:SearchFilters={module:'',status:'',archive:'current',tag:''}
export async function searchWorkspace(client:AppClient,query:string,filters:SearchFilters,offset:number,signal:AbortSignal){
 return measured('work.search',async()=>{
  const {data,error}=await client.rpc('search_work',{query_text:query.trim(),module_filter:filters.module||undefined,status_filter:filters.status||undefined,archive_filter:filters.archive,tag_filter:filters.tag.trim()||undefined,page_offset:offset}).abortSignal(signal)
  if(error)throw new Error('Search could not finish. Reconnect and try again.')
  return {rows:(data??[]).slice(0,25),more:(data?.length??0)>25}
 })
}
