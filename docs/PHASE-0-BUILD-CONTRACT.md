# Phase 0 — Command build contract

**Date:** September 21, 2026  
**Status:** Accepted by Kevin on September 21, 2026  
**Product owner:** Kevin Mazur  
**Scope:** Planning and design. No infrastructure has been provisioned or application code deployed.

## Recommendation

Deliver Command's first daily-use pilot at the end of roadmap Phase 4. Use React, Vite, TypeScript, Supabase Auth/PostgreSQL, and Netlify. Keep the pilot deterministic: Kevin manages his day directly, with Cora introduced after the core is reliable.

This contract turns the [roadmap](COMMAND-DEVELOPMENT-ROADMAP.md) into an implementation boundary. The [architecture note](PHASE-0-ARCHITECTURE.md) describes how to build it, and the [Work Day wireframe](wireframes/work-day.html) demonstrates the proposed interface. All example records in the wireframe are synthetic. Nothing entered there is sent to a service or saved after reload.

## 1. What the pilot includes

| Capability | Minimum useful behavior | Acceptance evidence |
|---|---|---|
| Private access | Kevin's explicitly provisioned account, recovery, sign-out, enforced authorization | Signed-out and wrong-user requests denied at the data/API boundary |
| Installed PWA | Standalone launch, dark/light mode, Mini portrait/landscape, iPhone and desktop layouts | Actual-device installation, rotation, keyboard and launch checks |
| Work Day | Compact orientation, up to three chosen priorities, persistent Reminders, Waiting On and delegated-work tracking | Kevin can identify the next action within five seconds |
| Tasks | Create/edit, statuses/priorities from the brief, dates, complete/cancel, filters | Correct persistence, retry handling, date behavior and ownership tests |
| Reminders | Undated, date-only or timed; complete, snooze, dismiss, edit, explicit conversion to Task | Passing the due time cannot hide an active Reminder; conversion cannot create duplicates |
| Waiting On | Dependency, person/organization label, next follow-up date, optional linked Task | Remains distinguishable from an obligation Kevin can act on directly |
| Quick Capture | Save original free text without mandatory classification; list/reopen captures | Input survives temporary connection loss; retry produces one record |
| Basic lookup | Search/filter titles and captured text within implemented lists | Useful results without AI or vector search |
| Recovery and operations | Draft recovery, write/error telemetry, auditable important actions, tested backup path | Isolated restore, latency report and support runbook |

Initial navigation is **Work Day, Tasks, Captures, Settings**, with Reminders inside Work Day and a dedicated expanded view reachable there. Captures is a temporary pilot destination that becomes part of Journal in Phase 5, retaining original IDs and text. Hide unfinished destinations rather than offering empty Projects, Library, or Cora screens.

“Waiting” on a Task describes its status. A Waiting On record describes the external dependency and can exist without a Task. A delegated task remains Kevin's private tracking record; the pilot sends no assignments to staff.

**Explicitly later:** Projects/Initiatives/People, full Journal, Learning, AI Lab, Library, global cross-module search, AI conversation, semantic search, Calendar/Outlook/Teams, Helix, MCP, push notifications, and general offline synchronization. Typing and operating-system dictation work in pilot fields; neither implies natural-language reminder parsing.

## 2. Decisions and proposed defaults

Kevin accepted this contract and the Phase 0 package on September 21, 2026. Proposed baselines below are now the implementation baseline; future operational verification remains scheduled at the indicated gates.

| ID | Decision | Proposed baseline | Status / needed by |
|---|---|---|---|
| D01 | Pilot boundary | Phase 4 scope above; five real workdays before expansion | Proposed / Phase 0 acceptance |
| D02 | Sign-in | Supabase Authentication, proposed email/password for one provisioned user; no public signup or anonymous users; no MFA at this time | Supabase Authentication and MFA deferral confirmed by Kevin |
| D03 | Allowed information | Synthetic/public material while building; ordinary non-sensitive work notes only after HCPA classification/retention ownership is assigned | Proposed / before real data |
| D04 | Cloud ownership | HCPA-controlled Netlify team and dedicated project in HCPA Supabase organization | Account visibility verified; Kevin confirmed as coordinating owner / verify provisioning access in Phase 1 |
| D05 | Environments | One hosted Supabase production project; isolated synthetic local/CI tests; previews have no production data connection | Updated by Kevin during Phase 1: no staging database |
| D06 | Billing | HCPA owns billing; a project-specific monthly ceiling is not a planning dependency | Confirmed by Kevin; select appropriately sized resources |
| D07 | Recovery target | RPO ≤24 hours; RTO ≤1 business day, validated through a drill | Proposed / before pilot |
| D08 | Draft policy | Device-local, user-scoped temporary drafts of permitted content; no cached document corpus; preserve unacknowledged drafts | Proposed / before capture implementation |
| D09 | Operations | Kevin coordinates DNS, recovery and data/records decisions, involving HCPA staff as needed; HCPA owns billing | Confirmed by Kevin; designate backup operator before pilot |
| D10 | Record lifecycle | No automated business-record deletion; assign records owner to settle retention/export/hold rules | Kevin coordinates / settle applicable rules before real data |
| D11 | Production acceptance | Developer evidence + Kevin's device demonstration; no unresolved access-control/data-loss defects | Proposed / Phase 0 acceptance |

Kevin selected Supabase Authentication and explicitly deferred MFA. Use email/password as the proposed sign-in method; Microsoft sign-in is not a pilot dependency. Public registration remains disabled, and authentication alone does not grant access without approved app membership and record ownership.

## 3. Access and resource readiness

Read-only checks on September 21, 2026 established:

- Repository remote is `kmazur-HCPA/HCPA-Command`; only planning documents are present locally. Remote push permission and CI integration have not been exercised.
- The connected Netlify account can list the **HCPA-Netlify** team. A project-name search for `command` returned no results. This does not rule out a differently named site or confirm domain availability.
- The connected Supabase account can list **HCPAFL** and its existing projects. No dedicated Command project appeared in that listing.
- HCPA owns billing, as confirmed by Kevin. DNS control of `cmd.hillspafl.gov`, sender-email configuration, backup destination and recovery operator access remain unverified.

Existing unrelated applications will not supply Command's database. Connector visibility establishes read access, not proof that DNS changes or production deployment will succeed. Exact project IDs, credentials, and internal account security findings do not belong in this source-controlled planning package.

## 4. Information and device policy

Kevin is the confirmed coordinating owner for data/records decisions. Before the real-data pilot, he resolves record classification, retention, holds, and export requirements with the appropriate HCPA staff as needed. The private nature of the application does not determine whether its contents are organizational records.

Start with public references, synthetic examples, and—once approved—non-sensitive work planning. Exclude credentials, protected taxpayer data, private personnel information, exempt records, and internal security details. Do not enter restricted information merely because the application has a login.

Use a passcode-protected device under the applicable HCPA device policy. Application code cannot guarantee protection against someone controlling an unlocked device. Local draft storage is a recovery mechanism, not a secure archive or backup.

Proposed draft behavior:

1. Persist editing state locally as it changes; show whether the latest version is local or confirmed on the server. Handle storage failure explicitly.
2. Scope drafts by authenticated user and stable record ID. Never display one user's drafts to another session.
3. Retry saves only after authorization is reestablished, with duplicate protection and a version check. If both copies changed, preserve both and ask which to retain.
4. Purge a successfully synchronized draft after server acknowledgement. Do not silently expire unsynchronized writing.
5. On explicit logout, surface unsynchronized drafts and offer sync, copy/export, or explicit discard. Signing out clears tokens and local application content; expired sessions hide drafts until the same user signs in again.
6. Cache versioned application assets only. Do not put authenticated API responses or future documents into a general service-worker cache.

Browser eviction, manual site-data clearing, or device loss can destroy local storage. The implementation must detect persistence failures where possible and cannot promise survival of those events. The pilot's guarantee is tested resilience to temporary network interruption, not impossible protection from every device failure.

## 5. Environment, cost and recovery plan

**Local:** migrations and synthetic seed data; test owner and unrelated user. No production credentials in repository files.

**Previews:** no hosted staging database. Kevin directed that Command use one production Supabase project only. Local and CI tests use synthetic data in disposable databases; preview builds have no production Supabase configuration. Production integration checks must be bounded, use designated synthetic records and leave no test access behind. The single project initially named “Command Staging” was renamed Command and repurposed as production; no second project was created.

**Production:** a dedicated Command project, exact production auth redirects, stable Netlify deployment, and HCPA-controlled domain. Select an available US region near the user and align server compute where supported; verify actual end-to-end latency before treating proximity as proof of speed.

**Billing:** HCPA owns billing. Kevin explicitly stated that budget is not a concern for this project, so a monthly ceiling or cost approval meeting is not a Phase 0 dependency. Choose appropriately sized resources, document selected plans and material ongoing services, and avoid unnecessary per-branch infrastructure. No paid resources are created during this planning phase.

**Recovery:** target daily recoverable database copies and a documented independent export route; designate the approved backup location and operator before real data. Store code/configuration in version control, secrets in an approved secret store, and test restore into a separate environment. Do not blindly roll back database migrations; prefer compatible migrations and a tested forward-fix/restore plan. Netlify code rollback does not undo database changes.

Database backups do not include files stored through Supabase Storage. Separate original-file backup/restore is mandatory when Library arrives in Phase 7. [Supabase backup documentation](https://supabase.com/docs/guides/platform/backups)

## 6. Release evidence

The developer provides a short release record with:

- Type check, lint, build and relevant behavior-test results.
- Access-control evidence for signed-out, permitted and unrelated users, including direct API attempts.
- Mini portrait/landscape, iPhone and desktop checks; keyboard, contrast, text scaling and reduced-motion checks.
- Latency samples for navigation (<200 ms perceived), persisted CRUD (<500 ms), Work Day useful render (<1 second), and lookup (<1 second), with dataset/network/sample count.
- Interrupted-write/retry/conflict results, backup/restore evidence and rollback instructions.

For pilot performance testing, use a documented synthetic dataset of approximately 1,000 Tasks, 250 Reminders, 2,000 Captures, and 100 Waiting On records, including mixed states and dates. This is a test workload, not an estimate of Kevin's actual records. Measure at least 30 repetitions per critical interaction for an initial report; call out the limited confidence of small p95 samples. Record cold/warm launch and hotspot results separately.

Kevin then runs the five-workday pilot and accepts or returns the release with specific issues. No real-data pilot proceeds with an unresolved authorization bypass, data-loss defect, missing recovery path, or repeated routine latency failure.

## 7. Phase 0 exit checklist

- [x] Pilot boundary and acceptance criteria drafted.
- [x] Architecture, trust boundaries and data flow documented.
- [x] Mini-first wireframe prepared for review.
- [x] Read-only Netlify/Supabase account discovery completed.
- [x] Environment, draft and recovery proposals documented; HCPA billing ownership confirmed.
- [x] Kevin accepted Phase 0, including the pilot scope and technical defaults, and authorized Phase 1.
- [x] Supabase Authentication selected, MFA deferred, and no project-specific budget ceiling required per Kevin.
- [x] Kevin confirmed as coordinating owner for DNS and recovery; verify operational access during Phase 1. Billing belongs to HCPA.
- [x] Kevin confirmed as coordinating owner for data/records decisions; settle applicable rules before real organizational data.

**Phase 0 is accepted. Phase 1 is authorized.** Phase 1's first bounded assignment will be repository scaffold, reproducible checks and local Supabase setup. Cloud provisioning follows confirmation of the target organization and operational access; budget is not a planning blocker.

## Phase 1 decision amendment

Kevin declined SMTP/email service on September 21, 2026. Self-service email password recovery is deferred; use the administrator-assisted procedure in the [Phase 1 runbook](PHASE-1-RUNBOOK.md). No MFA is required. This updates the earlier email-recovery assumption.
