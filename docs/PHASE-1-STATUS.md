# Phase 1 delivery record

**Date:** September 21, 2026  
**Status:** Foundation deployed; operational acceptance checks remain.

## Delivered

- React/Vite/TypeScript foundation, locked dependencies, lint/type/build checks and browser tests.
- One hosted Supabase project, renamed Command and used only for production. No staging database.
- Existing approved application account; Supabase email/password authentication without MFA. Organization sign-in remains separate.
- Explicit membership, owner-scoped preferences, optimistic version checks, database-enforced audit events and RLS.
- Server token/membership verification, safe error messages, request IDs and timing.
- Disabled signup and anonymous access, 12-character password minimum, secure password-change and leaked-password protection settings, 12-hour session time box.
- Disconnected preview and HTTPS production deployment on Netlify; production-scoped public configuration and no administrator secrets in the application.
- Recovery/rollback procedures and disposable local/CI test setup.

## Verification

Type checking, lint and production build pass. The updated suite has 37 unit/database tests. Eight browser workflows cover sign-in, persistence, logout, denial, revocation, administrator password-help text and responsive layouts. The combined JavaScript/CSS payload is approximately 124 KiB gzip, below the 190 KiB build budget; this is not a device latency measurement.

The hosted schema passed the Supabase security advisor with no findings. A live owner mutation produced an audit event within a transaction that was rolled back. Anonymous privileges and unapproved/cross-user access are covered by database tests. Preview configuration isolation was checked against the actual production public values; its access function returns `not_configured`. Production's unauthenticated access endpoint returns 401 and `Cache-Control: no-store`.

A synthetic preference was exported and restored in isolated PostgreSQL testing. Full disposable Supabase/GoTrue tests are prepared in CI but have not been executed here: Docker is unavailable. CI has not yet run remotely. Dependency audit reported zero vulnerabilities after patching the CLI's transitive sharp dependency.

## Explicit decisions and remaining acceptance

Kevin selected his existing organizational application account on September 21. The support mailbox is for the Supabase organization, not an additional Command user. He also declined an email service: self-service email recovery is deferred and removed from the UI. Administrator-assisted recovery replaces that planned capability for now.

Before closing the phase: Kevin verifies live sign-in/sign-out with his own password; exercise the administrator recovery procedure; run the prepared full Auth/expiry integration checks; verify a post-migration hosted backup and the operational recovery destination. Custom-domain cutover remains pending DNS coordination. Physical iPad/iPhone installation and interaction checks belong to Phase 2 and the pilot gates.

Do not enter real organizational working content yet. This release contains the foundation and appearance preference, not Work Day or Tasks.

## Final deployment checks

The production header policy was corrected and verified over HTTPS: it permits the exact production Supabase origin. The deployed page shows administrator password help and no email-reset button. The production access endpoint still returns 401/no-store without authentication.

Supabase’s Backups screen shows daily scheduled backups and one physical backup from September 21, 2026 at 11:27:06 UTC. That backup predates the foundation migration; verify the next backup includes the schema before relying on it for application recovery. No restore was attempted against production.

Source publication and remote CI are awaiting Kevin’s approval to push the application and organizational project documents to the configured GitHub repository. Automatic approval review blocked that export; no push occurred.
