# Returning to Command

Visibility changes, network reconnection, and Supabase auth events still revalidate the signed-in user and active membership. A previously verified workspace stays mounted during same-user checks, preserving the selected page, scroll position, open editor, and in-memory draft. A missing session, changed identity, recovery flow, verification failure, or revoked membership still removes the private workspace. Auth-event generation guards prevent stale checks from restoring an older state; workspace instances are keyed by user ID.

The current page is also retained in an allowlisted URL parameter, so a deliberate reload returns to Tasks (or the selected section). Existing local draft recovery remains available after a full browser/PWA reload. This does not promise that the operating system will keep a suspended browser process alive.

Regression coverage holds an access check pending while an unsaved task editor is open, verifies the editor remains present, completes the check, reloads and recovers the draft on Tasks, and then revokes membership to verify private UI is removed. Existing sign-in/out and unauthorized-account checks also remain in place.

Rollback: revert this application change; no schema or authentication-provider configuration changes are required. Auth event reference: https://supabase.com/docs/reference/javascript/auth-onauthstatechange
