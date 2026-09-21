# Phase 8 — Search, portability and operational verification

## Scope and accepted exceptions

Kevin authorized Phase 8 on September 21, 2026. He explicitly declined external operational alert routing and an independent backup destination. Neither is configured or claimed as a release requirement. Kevin remains the coordinating recovery owner. Exports and an isolated recovery drill remain in scope; an export is not a scheduled independent backup.

## Comprehensive search

Open Search Command or press Cmd/Ctrl+K. Search spans every implemented record type: Tasks, Reminders, Projects, Initiatives, People, Journal, Waiting On, Learning, AI Program, Use Cases, Experiments and Library.

The indexed projection covers titles, current text, original text, tags, goals, current state, next milestones, organizations, people roles, entry types, and allowed structured detail values. Ready Library filenames have a separate GIN expression index and lead directly to the parent document. File contents await extraction; intermediate revision snapshots are exported but are not independently indexed.

Titles/tags receive stronger weight, exact titles rank first, and plain terms also match token prefixes. Quotes, OR and minus exclusions use PostgreSQL web-search syntax. Relevance is followed by updated time and stable ID. Filters select module, status, exact tag and current/archived/all records. Current records are the default. Source links support opening in another tab.

Search starts after two characters with a 180 ms debounce. Superseded requests are cancelled. Queries are limited to 200 characters; pages return 25 records plus one look-ahead row rather than calculating a full count. Refine after 10,000 results. No record text or query is written to telemetry. Results are escaped as text, never rendered as HTML. Invoker-rights RPCs retain ownership and active-membership RLS.

## Export and recovery

Settings → Export workspace creates one ZIP containing:

- `workspace.json`: a consistent database snapshot with complete source fields, stable IDs, relationships, archived records, original text, all revision history, preferences, membership and activity.
- `records.csv`: a spreadsheet view. Formula-like values are prefixed safely; JSON retains the original values.
- `originals/`: every ready original version, with immutable version IDs in the path.
- `originals-manifest.json`: document/version mapping, byte counts and SHA-256 digests.
- `README.txt`: format, scope, pending-upload explanation and handling guidance.

Counts reconcile within the database snapshot. Client validation checks ownership and relationship integrity. Each original is downloaded through the existing authenticated Library function and checked against its stored byte count and SHA-256. Any failure or cancellation prevents saving a partial archive. Pending uploads are included as metadata and explicitly reported, never presented as backed-up originals. Unsaved drafts remain separately exportable in Settings.

Browser exports are bounded at 50 MB of database JSON and 250 MB estimated total content. Exceeding the bound fails explicitly and requires an administrator procedure; it never truncates the dataset. Auth credentials/sessions and infrastructure configuration are outside the user export. There is no public import endpoint or automatic production overwrite.

`test-phase8-local.mjs` is called only from the localhost integration harness. It snapshots the synthetic workspace, independently saves every original, simulates loss, restores application records/history/preferences/membership/activity with original IDs and versions, restores document bytes, and verifies exact equality plus cross-user isolation. Existing Auth identities remain intact; this is an application-data drill, not a hosted disaster-recovery or Auth restore claim.

## Verification and remaining device acceptance

The release pipeline runs TypeScript, lint, unit/database tests, real local Supabase Auth/API/Storage tests, browser workflows, PWA offline/update tests and dependency audit. Growth tests generate 15,000 records (10,000 belonging to the caller) in a rolled-back local transaction, capture the authenticated query plan and measure selective and common ranked searches. PostgreSQL may choose an owner-filtered scan because full-text operators cannot run ahead of RLS checks; the gate measures authenticated latency rather than requiring a particular index. Ownership checks remain intact. The SQL gate is 1.5 seconds on the CI host; this is not a production end-user latency guarantee.

Automated accessibility checks cover both themes, the search/filter dialog, the mobile workspace sheet and Settings against available WCAG A/AA rules. Responsive, keyboard, focus, doubled-text and reduced-motion checks supplement this. Automated checks are not a complete accessibility certification. Kevin’s physical iPad/iPhone Safari, installed-PWA, VoiceOver and five-workday pilot acceptance remain user-run checks.

## Support and maintenance

Kevin coordinates incidents and review. External alert routing and an independent backup destination were declined. Use the provider dashboards and existing content-free operation logs when investigating; do not log search text, notes, passwords, tokens or originals.

| Symptom | First action | Escalation / recovery |
| --- | --- | --- |
| Sign-in fails | Check Supabase Auth status and active membership; use the generic error | Follow administrator recovery in the Phase 1 runbook |
| Search fails | Retry; check network, migration and RPC grants | Check Supabase API/Postgres logs and advisors; preserve owner RLS |
| Search is slow | Compare `work.search` timing and query plans with the growth benchmark | Inspect index statistics and representative queries before adding indexes |
| Export fails | Read the displayed reason; retry connection failures | Check original hash/size and missing objects; never silently omit a file |
| Save conflicts | Compare saved version with local draft | Export drafts before clearing browser storage |
| New release problem | Confirm deployed commit and reproduce | Revert the frontend commit; additive RPCs may remain during UI rollback |

Weekly: inspect provider errors, CI failures and dependency advisories (`npm audit --audit-level=high`); review Supabase advisors. Update dependencies on a branch with pinned versions and lockfile, then run the full pipeline. Monthly: review access/membership and export/recovery procedure. Quarterly and after significant schema/storage changes: rerun the isolated recovery drill. These are documented owner procedures, not scheduled automations.

Deployment order: validate the migration in disposable local CI, apply it to the single production Supabase project, verify RPC grants/RLS and advisors, then publish the app. Roll back the frontend first if needed. The expanded search projection is derived data; source fields and originals remain unchanged. Do not roll back by deleting records or file versions.

## Release evidence — September 21, 2026

Code revision `66a55f5` passed [Foundation checks run 35616683465](https://github.com/kmazur-HCPA/HCPA-Command/actions/runs/35616683465): 76 unit/database tests, 23 pgTAP assertions, real Auth/API/Storage integration, 26 browser workflows, two PWA tests, type checking, lint, build and dependency audit. JS/CSS startup transfer is 154 KiB gzip against the 190 KiB budget; the export module loads on demand.

Native PostgreSQL growth results: 15,000 synthetic records across two owners, 10,000 owned by the caller; selective filtering 9.802 ms, ranked selective search 18.757 ms, ranked common-term search 326.866 ms. These are individual database measurements on GitHub-hosted CI, not p95 end-to-end device measurements. RLS selected a scan rather than GIN; no privilege bypass or leakproof overrides were introduced.

The isolated recovery drill restored 10 records, four revisions and six original files in 479 ms. Exact database snapshots and original SHA-256 digests matched after restoration; the other approved user remained isolated. This does not establish a hosted recovery time or independent backup schedule.

The production migration was applied successfully. Both RPCs use invoker rights, deny anonymous execution and retain authenticated RLS. Supabase security advisors returned no findings. Performance advisors reported informational unused indexes and the existing fixed Auth connection allocation; no warning/error findings. Physical-device, VoiceOver and five-workday pilot acceptance remain open.
