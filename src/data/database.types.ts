import type {CoraTurn,CoraConversation,CoraActivity,CoraContext} from '../features/cora/model'
import type {SearchResult} from '../services/search'
import type {LibraryVersion} from '../services/library'
import type { WorkItem, WorkInput } from '../features/work/model'
// Foundation schema. Regenerate against the project when schema migrations change.
export type Database = {
  public: {
    Tables: {
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
    Functions: { cora_begin:{Args:{p_user:string;p_conversation:string;p_request:string;p_message:string;p_context:CoraContext};Returns:{turn:CoraTurn;started:boolean}}; search_work:{Args:{query_text:string;module_filter?:string;status_filter?:string;archive_filter?:string;tag_filter?:string;page_offset?:number};Returns:SearchResult[]}; export_workspace:{Args:Record<string,never>;Returns:unknown}; convert_reminder: { Args: { reminder_id:string; expected_version:number }; Returns:string } }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
