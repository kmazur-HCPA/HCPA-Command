# Phase 1 operating runbook

Kevin coordinates operations, DNS and recovery. HCPA owns billing. Use the HCPA Netlify team and the dedicated Command production Supabase project. No hosted staging database is required or authorized.

## Access

Command uses the existing approved application account selected by Kevin. Organization-account access does not grant application access. Provision additional users only when explicitly approved: create the Auth user through the administrator interface, then add its UUID to `public.app_memberships`. The database creates default preferences and audit events automatically.

To revoke access, an authorized database administrator sets that membership's `active` field to false. RLS denies subsequent data requests even if a previously issued JWT remains unexpired. Also revoke the user's Auth sessions when appropriate. Do not delete audit history as part of revocation.

Public registration and anonymous sign-in are disabled. MFA is deferred by Kevin. The hosted Auth session time box is 12 hours; access tokens expire independently. The UI rechecks access on visibility/connection changes and reload. A stale screen is not an authorization boundary: RLS protects every database request.

## Password recovery — administrator assisted

Kevin declined an email service on September 21, 2026. The application therefore does not offer email-reset requests. Do not claim delivery through Supabase's default test mailer is production-ready.

An authorized HCPA Supabase administrator must verify the user's identity using HCPA's established process, then use the supported Auth administrator API to update that specific user's password (`auth.admin.updateUserById`). Run this only in a trusted administrative environment, with the administrator secret stored securely and input hidden; never put a password, recovery token or secret in SQL, source control, command arguments, logs or chat. Communicate the replacement password through HCPA's approved secure channel. Revoke existing sessions using the Auth administrator session controls/API. Temporarily disable membership during a suspected compromise; restore it only after recovery is verified. This operational procedure has not yet been drilled against Kevin's live account.

The authenticated password-change handler and exact `/auth/reset` route remain available for a future approved recovery flow. Adding SMTP later requires a delivery test, expiry/reuse tests, and an update to this decision record before exposing email reset in the UI.

## Deploy and rollback

Run `npm run check`, browser tests, and the dependency audit before release. Use reviewed migrations; never reset the hosted production database. Local migration filenames must match the hosted migration history.

For the current manual CLI workflow, **build before launching deploy**, so Netlify parses the freshly generated `dist/_headers`. Reusing a previous preview's headers can otherwise block production authentication.

Production, from an authorized checkout with its ignored production public configuration:

```sh
CONTEXT=production npm run build
npx netlify deploy --prod --no-build --skip-functions-cache
```

Disconnected preview:

```sh
CONTEXT=deploy-preview npm run build
node scripts/check-preview.mjs
npx netlify deploy --no-build --skip-functions-cache
```

The CLI does not accept `--context` with `--no-build`. The production flag selects production deployment; never use it for a preview. Verify preview bundles contain no production URL/key and preview `/api/access` returns `not_configured`. Verify production HTML's CSP includes the exact Supabase origin, unauthenticated `/api/access` returns 401 with `no-store`, and sign-in works. Do not declare success solely from a successful upload.

For code rollback, select the prior known-good production deployment in Netlify and publish it. Recheck headers and authentication. Code rollback does not reverse SQL migrations or Auth settings. Prefer backward-compatible database changes and a reviewed forward repair.

## Recovery and backups

Targets remain RPO at most 24 hours and RTO at most one business day. These are objectives, not measured service guarantees. Before real organizational data, Kevin must designate the backup operator and approved independent backup destination, verify a post-migration hosted backup and retention, and run a timed recovery drill.

For an isolated drill, use disposable local PostgreSQL/Supabase, apply the committed migrations, restore a synthetic record from an export, and verify its owner, contents and RLS boundary. `npm test` includes an isolated synthetic preference export/delete/restore assertion. That is evidence of record restoration, not a production disaster-recovery exercise. Never restore over production merely to test recovery. No second hosted project is needed.

For a real incident, preserve evidence, suspend writes, select an approved known-good backup, restore into an isolated environment, verify row counts/ownership/migrations and the recovery point, then coordinate a controlled cutover. Include Auth identities and application data in the backup design. Storage objects will require a separate backup plan when file storage is introduced.

## Logs and maintenance

Netlify function logs include request ID, status and duration; client operations record operation/result/timing without note contents or tokens. Supabase Auth logs cover identity events; `activity_log` records important database changes atomically. Browser telemetry currently stays in the browser console; centralized client error collection and alert routing are not yet configured.

Review failed authentication, server errors, backup health, dependency advisories and Supabase advisors regularly. Investigate using request IDs, never by copying credentials or protected content into logs. Measure user-perceived latency on Kevin's devices before accepting the later pilot performance targets.

## Domain

The current HTTPS origin is the Netlify application address. `cmd.hillspafl.gov` has not been cut over. Kevin coordinates authoritative DNS. Confirm the requested hostname's existing use, configure it on this Netlify project, add the provider-verified DNS record, and wait for certificate issuance. Then update the production app origin, Supabase Site URL and exact recovery redirect together, redeploy, and test. Do not add wildcard Auth redirect URLs.
