-- Existing Outlook connections stay valid; Teams requires a new consent grant.
-- This metadata is server-owned alongside the encrypted token cache.
alter table public.microsoft_connections
  add column granted_scopes text[] not null default '{}'
  check (cardinality(granted_scopes) <= 32);
