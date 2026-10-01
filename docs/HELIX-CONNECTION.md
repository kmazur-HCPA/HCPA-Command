# Helix connection

Command shows "Helix work that needs you" on Today. It reads one read-only endpoint in Helix (`GET https://helix.hillspafl.gov/api/bridge/v1/command-summary`) as the signed-in user, under that user's own Helix permissions. It never writes to Helix. The Helix side is documented in the Helix repo (`docs/command-bridge.md`).

## How it works

- Settings → Helix → **Connect Helix** starts an OAuth authorization-code flow with PKCE against the Helix OAuth server (Supabase Auth with Microsoft sign-in). Command is a registered client of that server.
- The tokens are encrypted (AES-256-GCM, bound to the user and connection) in `helix_connections` and are readable only by the server function. They are never sent to the browser, logged or exported. Disconnecting, or removing Command membership, deletes them.
- `/api/helix/summary` refreshes the access token when needed (the rotated refresh token is saved with a compare-and-swap), calls Helix with a 4-second limit, and rebuilds the response from an allowlist of fields. If Helix is slow, down or refuses, it returns the last saved copy marked `stale`. The Today card shows "Saved copy" in that case.
- The Today card refreshes at most every 5 minutes and when the tab regains focus. Items link to Helix; tickets and contracts link to the module list because Helix has no detail pages for them.
- Command never reads Helix's own Waiting On or Manager Today.

## Endpoints (`netlify/functions/helix.ts`)

`GET /api/helix/status`, `GET /api/helix/summary`, `POST /api/helix/connect`, `GET /api/helix/callback`, `POST /api/helix/disconnect`. Errors are `{ "message": ... }` with no sensitive detail. Logs carry endpoint, status and duration only.

## Activation

1. Apply `supabase/migrations/20261001200000_helix_connection.sql` to Command's Supabase project.
2. In the Helix project, apply `20261001190000_helix_bridge_command_summary.sql` and register the client (steps in the Helix doc). The redirect URI is `https://cmd.hillspafl.gov/api/helix/callback`.
3. In Netlify's **production** context set `HELIX_SUPABASE_URL` (the Helix project URL), `HELIX_OAUTH_CLIENT_ID`, `HELIX_OAUTH_CLIENT_SECRET` and `HELIX_TOKEN_ENCRYPTION_KEY` (`openssl rand -hex 32`, not the Microsoft key). Deploy.
4. Open Command → Settings → Helix → Connect Helix.

Rollback: Disconnect in Settings, or disable the client row in Helix (Command then shows its last saved copy and asks to reconnect).

## Tests

`npx vitest run tests/unit/helix.test.ts` covers config validation, the authorization URL and single-use callback, token encryption and rotation, the cached fallback, revoked grants, disconnect, and that unexpected fields from Helix are dropped.
