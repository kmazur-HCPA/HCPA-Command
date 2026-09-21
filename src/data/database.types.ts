import type {LibraryVersion} from '../services/library'
import type { WorkItem, WorkInput } from '../features/work/model'
// Foundation schema. Regenerate against the project when schema migrations change.
export type Database = {
  public: {
    Tables: {
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
    Functions: { convert_reminder: { Args: { reminder_id:string; expected_version:number }; Returns:string } }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
