# Tasks, work memory and Work Day — delivery record

Kevin authorized the order **Phase 3 → Phase 5 → Phase 4** on September 21, 2026. The migrations follow that order. Phase 5 supplied the shared Journal/Waiting On records that Phase 4 then used for Quick Capture and Work Day.

## Phase 3 — Tasks and Reminders

Tasks support Inbox, Next, In Progress, Waiting, Scheduled, Someday, Complete and Cancelled; priorities are Critical, High, Normal and Low. Records have editable titles/notes, dates, statuses, search, filters and archive/restore. Reminders have independent Active, Snoozed, Complete and Dismissed states, with undated, date-only and timed scheduling.

Past-due active reminders remain visible. A snooze whose deadline has passed is presented as Active without requiring a cron job or deleting history; Work Day reevaluates this every 30 seconds. Snoozed records remain inspectable. Conversion locks the reminder and creates its task in a single invoker-rights transaction. Repeating the conversion returns the existing task ID. Conversion preserves project/person/initiative links, tags and the New York calendar date of a timed reminder.

Date-only fields stay PostgreSQL dates. Timed reminders and snoozes use UTC timestamps with America/New_York input/display. Nonexistent spring-forward times are rejected; repeated fall times use the first occurrence, as stated in the editor. No natural-language parsing or push notifications are implied.

## Phase 5 — Projects, People and work memory

Projects and Initiatives have goals, current state, next milestone, status and explicit relationships. People records contain a role, organization and notes. Related work can be retrieved from a project, initiative or person. Waiting On may link a person and task without becoming a task assignment.

Journal entries form chronological work memory. Capture, Idea and Decision are entry types, not separate copies of the same text. Entries have optional tags, project/person/initiative links, indexed word search and type/tag filters. Each entry has a stable URL. Original body text is immutable; every saved Journal version has a server-generated revision snapshot. A Journal entry can create a resulting task with a source link back to the entry.

**Preservation rule:** archive instead of hard delete. Client roles cannot delete work records or insert/update/delete revision history. Existing links continue to resolve when their targets are archived. Current related-work lists exclude archived records; the main lists’ Archived view retrieves them. Membership/account removal requires an administrative retention decision because work records are not cascade-deleted.

## Phase 4 — Work Day and capture

Work Day assembles three explicitly selected task priority slots, due tasks, persistent reminders and Waiting On. A partial unique index enforces one active task per slot, including simultaneous requests. Completing or archiving a task frees its active slot. Waiting On tracks the dependency, responsible-party label/person, follow-up date and optional task; nothing is sent to that person.

Quick Capture is available from the global header, including on a phone. It saves the original text as a Journal Capture with a stable client-generated ID. A title is derived for listing; the body retains the entered whitespace and wording. Classification is optional.

Editors save user-scoped local drafts while typing. Failures are visible; corrupt drafts are not silently overwritten. Failed/uncertain server writes are reconciled by stable IDs and optimistic versions. A conflicting edit remains local until the saved version is reviewed and the user explicitly elects to replace it. Settings exposes draft export/discard. Logout is blocked while stored drafts need attention. Updates never force a reload; active editors retain normal refresh warnings. Session expiry hides the editor; the same authorized user can recover the draft after signing in again. Device storage clearing/eviction is not recoverable by this application.

## Security and performance

One production Supabase project remains in use. All work and revision tables have owner-and-active-membership RLS. Composite foreign keys and link-kind checks prevent cross-user and wrong-type associations. Private trigger functions preserve audit/revision data; the conversion RPC uses invoker rights. No privileged key enters the app.

Work Day and lists fetch summary fields instead of entire note/revision bodies. Lists are paginated (50 records), Journal revisions are paginated (20), and link selectors search bounded results. Work Day shows at most 30 due tasks, 100 open reminders and 30 waiting items, with explicit links/notices for the remainder. Search uses an indexed PostgreSQL text-search vector including original Journal text. All mutations record content-free operation timing and database audit metadata.

The application remains within the 190 KiB gzip JavaScript/CSS budget (approximately 137 KiB in local builds). Tests include a 3,350-record synthetic dataset: 1,000 tasks, 250 reminders, 2,000 Journal entries and 100 waiting items. Database timing and local loopback API timings are diagnostic baselines, not production-device latency claims.

## Validation and acceptance

Local validation covers type checking, lint, production build, owner boundaries, wrong links, optimistic writes, immutable originals/revisions, three priority slots, date/DST rules, conversion retries, and the synthetic workload. Browser tests cover task completion, original capture text, lost acknowledgements, failed writes/reload recovery, revision history, conflict resolution, project/decision/task traceability, draft-aware logout and responsive layouts. PWA privacy/update tests remain in the release suite. Disposable Supabase CI tests exercise the real Auth and REST APIs in addition to pgTAP assertions.

**Implementation is not pilot acceptance.** Kevin still needs to verify the actual Mini/iPhone experience and complete five real workdays of pilot use. Record per-device cold/warm Work Day load, writes and lookup timing on HCPA Wi-Fi and a hotspot. Targets remain useful render under one second, normal writes under 500 ms and lookup under one second. The hosting/network and physical-device results must be measured, not inferred from local tests.

Carry forward the Phase 1 operational gates: confirm the approved data/records scope, independent backup destination/operator, post-migration recoverability and custom-domain cutover. No new mail service, MFA, AI or external integration was added.

## Rollout and rollback

Apply the three additive migrations in 3 → 5 → 4 order before publishing the app. The Phase 2 app remains compatible with the expanded schema. Verify advisors and CI before promotion. If the UI needs rollback, republish the previous Netlify deployment; retain the new tables and records and forward-fix the application. Do not drop populated tables as a rollback. Database restoration follows the Phase 1 recovery runbook.

## Release evidence — September 21, 2026

The three production migrations were applied in order and recorded as `20260921131114`, `20260921131131`, and `20260921131141`. Anonymous record reads, authenticated hard deletes and revision rewrites are denied. The security advisor returned no findings. Performance notices are informational: newly created indexes have no usage history yet, and Auth retains its existing fixed connection allocation ([Supabase guidance](https://supabase.com/docs/guides/deployment/going-into-prod)). Retain the indexes for the workload and reassess after pilot use ([index guidance](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index)).

[Release CI](https://github.com/kmazur-HCPA/HCPA-Command/actions/runs/35603421863) passed the application suite, 20 browser tests, two built-PWA tests, 18 pgTAP assertions, and real disposable Auth/REST checks. Subsequent timestamp reconciliation coverage brings the local unit/database total to 57 passing tests. Thirty synthetic loopback API writes measured p50 4 ms and p95 6 ms; these are CI diagnostics, not HCPA network or device results.
