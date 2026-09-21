// Foundation schema. Regenerate against the project when schema migrations change.
export type Database = {
  public: {
    Tables: {
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
        Row: { id: string; user_id: string; actor_id: string | null; action: string; entity_type: string; occurred_at: string }
        Insert: never
        Update: never
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
