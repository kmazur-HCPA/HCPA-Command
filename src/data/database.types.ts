import type {CoraTurn,CoraConversation,CoraActivity,CoraContext} from '../features/cora/model'
import type {SearchResult} from '../services/search'
import type {LibraryVersion} from '../services/library'
import type { WorkItem, WorkInput } from '../features/work/model'
import type { MicrosoftConnection } from '../features/microsoft/model'
// Foundation schema. Regenerate against the project when schema migrations change.
export type Database = {
  public: {
    Tables: {
      cora_review_preferences: {Row:{user_id:string;automatic_reminders:boolean};Insert:{user_id:string;automatic_reminders:boolean};Update:{automatic_reminders:boolean};Relationships:[]}
      cora_reminder_sources: {Row:{user_id:string;source_hash:string;reminder_id:string;created_at:string};Insert:never;Update:never;Relationships:[]}
      cora_workday_reviews: {Row:{id:string;user_id:string;status:'running'|'complete'|'partial'|'failed';summary:string;started_at:string;finished_at:string|null};Insert:{id:string;user_id:string;status:string;summary:string;finished_at?:string|null};Update:{status:string;summary:string;finished_at:string|null};Relationships:[]}

      email_captures: {Row:{user_id:string;message_id:string;conversation_id:string|null;action:'task'|'reminder'|'dismissed';record_id:string|null;captured_at:string};Insert:never;Update:never;Relationships:[]}
      mail_automated_senders: {Row:{pattern:string;created_at:string};Insert:{pattern:string};Update:never;Relationships:[]}
      sitrep_runs: {Row:{id:string;user_id:string;run_id:string;for_date:string;run_slot:'am'|'midday'|'manual';status:'running'|'complete'|'partial'|'failed';started_at:string;generated_at:string|null;schema_version:number;sources:Record<string,string>;payload:unknown;error_note:string|null;created_by:string};Insert:{user_id:string;run_id:string;for_date:string;run_slot:string;status:string;sources?:Record<string,string>;payload?:unknown;generated_at?:string;error_note?:string|null};Update:{status?:string;sources?:Record<string,string>;payload?:unknown;generated_at?:string;error_note?:string|null};Relationships:[]}
      cora_mcp_connections: {Row:{user_id:string;id:string;token_hash:string;created_at:string;expires_at:string;last_used_at:string|null};Insert:{user_id:string;id:string;token_hash:string;created_at:string;expires_at:string;last_used_at?:string|null};Update:{last_used_at?:string};Relationships:[]}
      cora_oauth_clients: {Row:{id:string;name:string;redirect_uris:string[];created_at:string};Insert:never;Update:never;Relationships:[]}
      cora_oauth_codes: {Row:{code_hash:string;client_id:string;user_id:string;redirect_uri:string;code_challenge:string;expires_at:string};Insert:{code_hash:string;client_id:string;user_id:string;redirect_uri:string;code_challenge:string;expires_at:string};Update:never;Relationships:[]}
      cora_oauth_grants: {Row:{id:string;user_id:string;client_id:string;refresh_hashes:string[];refresh_expires_at:string;created_at:string;refreshed_at:string|null;last_used_at:string|null};Insert:never;Update:never;Relationships:[{foreignKeyName:"cora_oauth_grants_client_id_fkey";columns:["client_id"];isOneToOne:false;referencedRelation:"cora_oauth_clients";referencedColumns:["id"]}]}
      cora_mcp_activity: {Row:{id:string;user_id:string;connection_id:string;tool:string;success:boolean;created_at:string};Insert:never;Update:{success:boolean};Relationships:[]}

      microsoft_connections:{Row:MicrosoftConnection;Insert:MicrosoftConnection;Update:Partial<MicrosoftConnection>;Relationships:[]}
      cora_conversations:{Row:CoraConversation;Insert:CoraConversation;Update:Partial<CoraConversation>;Relationships:[]}
      cora_turns:{Row:CoraTurn;Insert:CoraTurn;Update:Partial<CoraTurn>;Relationships:[]}
      cora_activity:{Row:CoraActivity;Insert:Omit<CoraActivity,"id"|"created_at">;Update:never;Relationships:[]}
      library_versions: {Row:LibraryVersion;Insert:never;Update:never;Relationships:[]}
      journal_revisions: { Row: {id:string;item_id:string;user_id:string;version:number;snapshot:WorkItem;created_at:string};Insert:never;Update:never;Relationships:[] }
      work_items: { Row: WorkItem; Insert: WorkInput; Update: Partial<WorkInput>; Relationships: [] }
      app_memberships: {
        Row: { user_id: string; active: boolean; created_at: string }
        Insert: { user_id: string; active?: boolean; created_at?: string }
        Update: { active?: boolean }
        Relationships: []
      }
      user_preferences: {
        Row: { user_id: string; theme: 'system' | 'dark' | 'light'; timezone: string; version: number; updated_at: string }
        Insert: { user_id: string; theme?: 'system' | 'dark' | 'light'; timezone?: string }
        Update: { theme?: 'system' | 'dark' | 'light'; timezone?: string }
        Relationships: []
      }
      activity_log: {
        Row: { id: string; user_id: string; actor_id: string | null; action: string; entity_type: string; entity_id:string|null; occurred_at: string }
        Insert: never
        Update: never
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: { directory_people:{Args:{query_text:string;show_archived:boolean;page_offset:number};Returns:import("../features/people/model").DirectoryPerson[]}; import_people:{Args:{contacts:import("../features/people/model").ContactInput[]};Returns:{created:number;skipped:number;results:{id:string;status:string}[]}}; cora_create_record:{Args:{p_user:string;p_record:WorkInput};Returns:{id:string;created:boolean;saved:boolean}}; swap_work_order:{Args:{first_id:string;second_id:string;first_version:number;second_version:number};Returns:undefined}; cora_create_reminder:{Args:{p_user:string;p_source_hash:string;p_title:string;p_body:string;p_due:string|null;p_at:string|null};Returns:{id:string;created:boolean;saved:boolean}}; cora_mcp_reserve:{Args:{p_hash:string;p_tool:string};Returns:string}; cora_oauth_register:{Args:{p_name:string;p_uris:string[]};Returns:string}; cora_oauth_redeem:{Args:{p_code_hash:string;p_client:string;p_redirect:string;p_challenge:string;p_access_hash:string;p_refresh_hash:string;p_access_seconds:number};Returns:{ok:boolean}}; cora_oauth_refresh:{Args:{p_refresh_hash:string;p_client:string;p_new_refresh:string;p_access_hash:string;p_access_seconds:number};Returns:{ok:boolean}}; cora_oauth_verify:{Args:{p_hash:string};Returns:{user_id:string;grant_id:string;client_id:string}|null}; cora_mcp_reserve_oauth:{Args:{p_user:string;p_client:string;p_tool:string};Returns:string}; cora_begin:{Args:{p_user:string;p_conversation:string;p_request:string;p_message:string;p_context:CoraContext};Returns:{turn:CoraTurn;started:boolean}}; search_work:{Args:{query_text:string;module_filter?:string;status_filter?:string;archive_filter?:string;tag_filter?:string;page_offset?:number};Returns:SearchResult[]}; export_workspace:{Args:Record<string,never>;Returns:unknown}; capture_flagged_email:{Args:{p_message_id:string;p_conversation_id:string|null;p_action:'task'|'reminder'|'dismissed';p_title:string|null;p_due:string|null;p_priority:string;p_source_url:string|null};Returns:{captured:boolean;created:boolean;action:string;record_id:string|null}}; convert_reminder: { Args: { reminder_id:string; expected_version:number }; Returns:string } }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
