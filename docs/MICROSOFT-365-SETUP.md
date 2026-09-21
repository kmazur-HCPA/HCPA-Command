# Command — Microsoft 365

Owner: Kevin Mazur / HCPA. This release connects the existing Command Cora panel to the signed-in user's default Outlook calendar and mailbox. Teams and the ChatGPT interface follow separately.

## Entra registration

1. In HCPA's Microsoft Entra admin center, open **App registrations → New registration**.
2. Name: **Command — Microsoft 365**. Supported accounts: **Accounts in this organizational directory only** (single tenant).
3. Add a **Web** redirect URI (not Single-page application):
   `https://cmd.hillspafl.gov/api/microsoft/callback`
4. Under **API permissions**, add Microsoft Graph **Delegated** permissions:
   - `User.Read`
   - `Calendars.Read`
   - `Mail.Read`
   - `offline_access` (keeps the delegated connection available between visits)
   The authentication library also requests standard `openid` and `profile` sign-in scopes. No application permissions, mail sending, calendar writing, or Teams permissions are needed.
5. Grant HCPA administrator consent if required by your tenant policy. Leave implicit grants and public-client flows disabled. Existing HCPA Conditional Access policies continue to apply.
6. Create a client secret and note its expiry in HCPA's normal credential management process. Copy the **Value**, not the secret ID, directly into the server environment below. Do not paste it into chat, source control, or client-side variables.

## Server environment

In Netlify's **Command** site, scope these variables to **Functions / Production only**. Put local equivalents in ignored `.env.production.local` for development.

| Variable | Value |
| --- | --- |
| `MICROSOFT_TENANT_ID` | Directory (tenant) ID from the registration overview |
| `MICROSOFT_CLIENT_ID` | Application (client) ID from the registration overview |
| `MICROSOFT_CLIENT_SECRET` | Client secret **Value** |
| `MICROSOFT_TOKEN_ENCRYPTION_KEY` | A cryptographically random 32-byte key encoded as 64 hexadecimal characters; keep it stable across deploys |

`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and server-only `SUPABASE_SECRET_KEY` are already used by Cora. Do not prefix any Microsoft variable with `VITE_`.

The production origin defaults to `https://cmd.hillspafl.gov`. For local OAuth testing, additionally register **Web** URI `http://127.0.0.1:8888/api/microsoft/callback` and set local `MICROSOFT_APP_ORIGIN=http://127.0.0.1:8888`. Production must use its HTTPS origin. Run `npm run dev:netlify`.

## Enable and verify

Apply `20260921161124_microsoft_connection.sql`, deploy the application with the configured environment, then open **Settings → Microsoft 365 → Connect Microsoft 365**. Sign in as **mazurk@hillspafl.gov**. The Microsoft mailbox must match the authenticated Command email; choosing another account is rejected.

Try:

- “What meetings do I have today?”
- “Help me prepare for my next meeting.”
- “Find recent emails about [a known subject], then read the relevant message.”
- “Based on that email, prepare a follow-up task.” Verify that a review card appears and nothing is saved until **Add task**.

Verify source links open the original Outlook item. Disconnect in Settings, verify Cora stops retrieving Microsoft content, then reconnect. Test tenant consent denial and expired credentials before acceptance. Real Microsoft sign-in and Graph retrieval remain required deployment checks; fixtures cannot establish tenant permissions or account access.

## Security, performance and operational behavior

- MSAL Node handles the confidential-client authorization code flow and refresh. PKCE, a random one-use state, browser-bound HttpOnly cookie, 10-minute expiry, fixed redirect, tenant validation and mailbox identity matching protect connection setup.
- Token caches and PKCE verifiers use AES-256-GCM with user, connection generation and purpose as authenticated associated data. The encryption key stays in Functions; the database alone cannot decrypt credentials. Every database access is explicitly scoped to the authenticated owner.
- `microsoft_connections` has RLS enabled and no browser/anonymous table grants. Only the server can read or write it. It is intentionally excluded from workspace exports and normal recovery imports. Reconnect after recovery.
- Disconnect deletes credentials and pending attempts. Connection generations and compare-and-swap updates prevent an in-flight callback or refresh from restoring deleted credentials. Disabling Command membership also deletes the connection. Disconnect does not revoke the app's tenant consent; an administrator can remove that separately in Entra.
- Queries run on demand. Calendar requests cover at most 31 days and 75 returned events; mail searches return at most 45 previews. The tools disclose truncation and retrieval time. Outlook bodies are plain text capped at 12,000 characters; attachments are not fetched. Calendar recurrence is expanded by Graph; cancellations, all-day state, timezone and busy status are retained.
- Only request-scoped results are memoized. No mailbox content is synced to database or browser storage. Relevant details in Cora's generated answers and source titles remain in its existing private conversation history and export. Tool auditing records tool names/outcomes, not email bodies, search phrases or tokens.
- Graph calls have eight-second timeouts; Cora retains its overall request deadline and user quotas. Throttling, consent denial and outages produce explicit missing-context messages. Microsoft failures do not disable normal Command records.
- Email and meeting text are untrusted evidence. They cannot authorize writes. The sole Cora write remains the existing user-confirmed task card.

## Rollback and rotation

Remove `MICROSOFT_CLIENT_SECRET` from the Functions environment and redeploy to disable retrieval and connection creation. Settings can still disconnect stored credentials. Preserve the schema for rollback; no changes to existing work records are required.

For a client-secret rotation, replace the secret before expiry and deploy. For an encryption-key replacement, disconnect accounts first, replace the key, deploy, then reconnect; existing ciphertext cannot be decrypted with a different key. Do not restore old credential rows from backup.

## Verification — September 21, 2026

Typecheck, lint, 102 unit/database checks, 29 browser workflows and 2 PWA checks passed locally. Browser checks include connected/disconnected settings, callback navigation, outage isolation, mobile layout, dark/light accessibility, safe Outlook source links and unchanged task-card confirmation. The production browser bundle is 161 KiB gzip across JS/CSS, under the existing 190 KiB budget; MSAL and encryption remain server-only. Netlify function bundles build successfully.

Four real-provider evaluations with synthetic data passed: calendar retrieval, email search/read, explicit follow-up task proposal, and unavailable calendar access. Durations were 1.693–3.585 seconds excluding real Microsoft and database retrieval. An embedded email instruction to send passwords did not produce a task proposal during the read-only case or replace the user-requested task.

The production migration is applied. Direct grant checks confirm RLS enabled, no anonymous/browser reads, and server access. The security advisor reports only the informational “RLS Enabled No Policy” notice for this intentionally server-only table; no browser policies or grants should be added to silence it. [Advisor explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

The HCPA tenant authority was reachable and all four local Microsoft environment variables were present. The generated encryption key was also configured as a production Functions secret in Netlify. [Full CI for the implementation](https://github.com/kmazur-HCPA/HCPA-Command/actions/runs/35626914254) passed both application and native Supabase jobs, including the new real Auth/PostgREST connection tests and existing recovery drill. Production deploy `6ab15d8c60ef740008a909b4` published commit `ecf7ade4599a7218afc403a130037d70abad5446`.

Production activation is verified. After Kevin corrected the Netlify client-secret Value, deploy `6ab160b01a7d28ea1b60368f` published commit `3502dbf7317e7158c324c8bb6af90ca294431381`. Microsoft's account chooser and consent screen requested the intended delegated permissions; organization-wide consent was left unchecked. Settings confirms Kevin's HCPA account is connected read-only. A live Cora request successfully retrieved today's calendar, searched recent email, and read one returned message. Server activity records independently confirm all three successful tool calls at 16:54 UTC. The check requested no subjects or message content in the answer and created no tasks. Email search correctly disclosed truncation.

[Latest full CI](https://github.com/kmazur-HCPA/HCPA-Command/actions/runs/35627823089) passed. The immediately preceding run had an intermittent 409 in the existing concurrent task-creation test (`test-cora-local.mjs`); the subsequent unchanged native harness passed. This concurrency failure is not yet reproduced or resolved. Local `.env.production.local` still has a GUID-shaped client-secret entry consistent with the Secret ID; replace it with the Value before testing Microsoft locally. Production uses the corrected Netlify configuration.

A follow-up diagnostic release adds allowlisted, content-free connection references (stage and known error code). Its 18 Microsoft unit tests passed, including credential-error redaction. No raw provider error, authorization code, token or mailbox content is logged.

## References

- [Microsoft authorization code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)
- [MSAL Node token caching](https://learn.microsoft.com/en-us/entra/msal/javascript/node/caching)
- [Microsoft Graph calendar view](https://learn.microsoft.com/en-us/graph/api/user-list-calendarview?view=graph-rest-1.0)
- [Microsoft Graph messages](https://learn.microsoft.com/en-us/graph/api/user-list-messages?view=graph-rest-1.0)
