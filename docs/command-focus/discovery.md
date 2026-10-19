# Command Focus: Phase 0 discovery

Read-only. Taken 2026-10-19 from the production Supabase project (queries only) and `origin/main` at `8126640`. No code or schema was changed. Branch: `feature/command-focus`.

## Verdict on the baseline

The database matches the brief. Two things differ or need a decision before Phase 1 (see **Surprises**).

| Kind | Non-archived | Archived | Total | Last updated |
| --- | ---: | ---: | ---: | --- |
| task | 43 | 1 | 44 | 2026-10-15 |
| person | 24 | 0 | 24 | 2026-09-22 |
| reminder | 12 | 0 | 12 | 2026-10-13 |
| project | 5 | 0 | 5 | 2026-09-23 |
| initiative | 3 | 0 | 3 | 2026-09-22 |
| program | 1 | 0 | 1 | 2026-09-23 |
| waiting | 1 | 0 | 1 | 2026-10-08 |
| journal, learning, use_case, experiment, library | 0 | 0 | 0 | none |

Non-archived total is 89, as stated. The five retiring kinds have zero rows including archived.

## 1. Schema

- **One table holds every record kind: `public.work_items`** (38 columns). Kind and status are `CHECK` constraints, not enums: `work_kind` lists all 12 kinds, and `work_status` is one combined check keyed by kind. Adding a `Proposed` project status means replacing `work_status`. `initiative` and `program` share project-style statuses today.
- **Other constraints that matter:** `reminder_schedule` (a reminder has a due date OR a time, never both; Snoozed needs `snoozed_until`), `work_items_check` (focus slot 1 to 3, tasks only), `entry_type` check (12 values, includes Learning and Experiment), text length caps.
- **Foreign keys.** All are composite `(user_id, x_id) → work_items(user_id, id)`: `project_id`, `initiative_id`, `person_id`, `task_id`, `source_entry_id`, `learning_id`, `program_id`, `use_case_id`, `experiment_id`, `decision_id`. Also `converted_task_id → work_items(id)`.
- **Rows that use each link today:** `project_id` 45, `person_id` 1, every other link column 0.
- **Triggers** (from migrations): `guard_work_item` sets `version`, `updated_at`, `completed_at` and blocks identity changes; `audit_work` writes `activity_log`; journal/learning/program/use case/experiment/library kinds also write `journal_revisions`. `guard_lab` allow-lists `details` keys per kind (a project had none until the fold-in migration).
- **Other tables in `public`:** `activity_log`, `app_memberships`, `cora_*` (activity, conversations, turns, mcp_*, oauth_*, reminder_sources, review_preferences, `cora_workday_reviews`), `email_captures`, `helix_connections`, `journal_revisions`, `library_versions`, `mail_automated_senders`, `microsoft_connections`, `sitrep_runs`, `standup_items`, `user_preferences`, `work_items`.
- **Not present yet:** `day_closes`, `usage_events`, `push_subscriptions`.

## 2. References to each retiring kind

File counts across `src`, `netlify`, `supabase/functions`, `tests` and `.claude`:

- **journal** (23 files): nav, command palette, icons, `Journal.tsx` (reading feed with capture field), `Workspace.tsx`, `Capture.tsx`, `Editor.tsx`, `Detail.tsx`, `ContextView.tsx`, `WorkList.tsx`, `services/work.ts`, `services/export.ts`, Cora identity/handler/create, MCP prompts (`capture`), the CMD skill, DB and e2e tests.
- **learning** (15 files): nav, `lab/fields.ts`, editor, detail, `services/work.ts`, export, Cora `actions`/`tools`/`create`/`handler`, DB, unit (`standup-tools.test.ts`) and e2e tests.
- **use_case** (14) and **experiment** (13): `features/lab/*` (Lab, LabFields, fields), editor, detail, work service, export, Cora tools/actions/create/handler, DB tests. Experiment is also in e2e.
- **library** (18): `features/library/Originals.tsx`, `services/library.ts`, `supabase/functions/library/handler.ts` (an Edge Function with JWT verification), `people/Directory.tsx`, `lab/LabFields.tsx`, export, Cora handler, DB, unit and e2e tests. Navigation is already hidden by commit `e6ea10b`.
- **initiative** (13) and **program** (12): nav ("Initiatives"), editor, detail, `ContextView.tsx`, work service, export, Cora tools/actions/create/handler, e2e. Program is also in `Lab.tsx`.
- **MCP enums that need editing:** `get_records.kind` (12 values plus null), `prepare_record.kind` (12), `create_record.kind` (10: task, person, project, initiative, journal, program, use_case, experiment, waiting, learning).
- **Seed data:** none found for these kinds outside tests.

## 3. Command Brief / workday review stack

- **Table:** `cora_workday_reviews` (19 rows: 10 complete, 9 partial; newest 2026-09-25). Nothing has run since.
- **MCP:** `get_workday_reviews` (22 calls in the last 30 days) and `record_workday_review` (38 calls). All calls fall in September.
- **UI:** `src/features/reviews/WorkdayReviews.tsx` is mounted only in **Settings** (`Workspace.tsx:421`, `settings` mode). The Work Day card was already removed, so §1.4 reduces to removing the Settings panel, the two tools, `brief.ts` (the brief style shared with the skill) and the `command_brief` MCP prompt and skill `brief.md`.
- **Scheduler:** none in this repo. There are no Netlify scheduled functions and no cron in `netlify.toml`. The Claude Code scheduled-task list on this machine is empty. A claude.ai-side task (not visible here) may still exist.

## 4. SITREP stack

- **Code:** `netlify/functions/_shared/sitrep.ts` (`save_sitrep`, `get_sitrep_runs`), `src/features/sitrep/*` (panel, schema, reconcile), table `sitrep_runs` (columns include `run_slot`, `for_date`, `sources` jsonb, `error_note`, `created_by`).
- **Trigger:** `created_by` is `cmd-scheduled-task` on every run, so SITREP is run by a **Claude scheduled task outside this repo** (claude.ai project or Claude desktop). It cannot be changed from here; the weekday-only change in §1.5 is a change Kevin makes there. Slots in use: `am`, `midday`, `manual`.
- **Last 30 days (2026-10-01 to 10-19): 38 runs.** 11 complete, 26 partial, 1 failed.

| Source | ok | partial | failed |
| --- | ---: | ---: | ---: |
| command | 37 | 0 | 0 |
| flagged | 37 | 0 | 0 |
| calendar | 36 | 0 | 1 |
| mail | 35 | 1 | 1 |
| **teams** | 9 | **27** | 1 |
| **helix** | 2 | 0 | **12** |

- **Cause of `partial`:** Teams is `partial` in 25 of the 26 partial runs, and is the only non-ok source in 14 of them. Teams was ok on 9 runs, last on 2026-10-16.
- **Helix** is `failed` in 12 of the 14 runs that report it, but those runs still end `partial`, so Helix failures are probably not driving the status. Helix does not appear in earlier runs.
- **The single `failed` run** (2026-10-04 am): `save_sitrep` rejected twice as `schema_invalid`, and a Microsoft refresh error hit the Teams chat list.
- **Weekend runs:** 11 of 38 runs were for Saturday or Sunday (6 Sat, 5 Sun).
- **Evidence that Teams `partial` is not an outage:** the tool audit (`cora_mcp_activity`, 30 days) shows `search_teams_messages` 52 of 65 ok, `list_teams_chats` 54 of 58, `read_teams_chat` 128 of 131, and Teams calls on 2026-10-19 (the latest `partial`) were 6 with 0 failures. The Teams search tool is documented as "indexing can lag" and "not a full archive". I think the scheduled task's prompt marks Teams `partial` whenever it relies on search. **I cannot confirm that from the repo**, because the task's prompt lives outside it. The Microsoft token itself is healthy (cache present, refreshed this morning).

## 5. MCP tool inventory (31 tools)

- **Read, records:** `get_day_snapshot`, `get_records`, `get_record`, `get_my_tasks`, `get_tasks_due_today`, `get_priority_tasks`, `get_reminders_due`, `get_active_projects`, `get_project_details`, `get_waiting_on`.
- **Write, records:** `create_record`, `quick_update`, `create_reminder`, `prepare_record`, `prepare_task`.
- **SITREP and stand-up:** `save_sitrep`, `get_sitrep_runs`, `get_standup_items`, `add_standup_item`, `update_standup_item`, `remove_standup_item`.
- **Brief (to retire):** `get_workday_reviews`, `record_workday_review`.
- **Microsoft:** `get_outlook_calendar`, `search_outlook_mail`, `get_flagged_mail`, `get_direct_mail`, `read_outlook_message`, `search_teams_messages`, `list_teams_chats`, `read_teams_chat`, `read_teams_message`.
- **Legacy / overlapping:**
  - `prepare_task` duplicates `create_record` and is called only by the in-app Cora engine (`engine.ts:306`) and tests.
  - `get_my_tasks`, `get_tasks_due_today`, `get_priority_tasks`, `get_reminders_due`, `get_active_projects` and `get_waiting_on` are all subsets of `get_day_snapshot`. They also back in-app Cora's baseline reads, and `get_my_tasks` pages beyond 25.
  - `record_workday_review` and `save_sitrep` do the same job for two briefings.
- **Tool failure rates worth knowing (30 days):** `get_direct_mail` 8 of 45 failed, `search_teams_messages` 13 of 65, `quick_update` 1 of 2 (expected: a stale-version refusal).

## 6. PWA status

- **Manifest** (`public/manifest.webmanifest`): standalone display, `start_url /`, 192 and 512 icons. No `shortcuts`.
- **Service worker:** generated by `scripts/build-pwa.mjs` (static assets only; it skips `/api/` and any request with an `Authorization` header). It has **no `push` or `notificationclick` handler**.
- **Push / notification scaffold:** none. No VAPID code, no subscription table, no notification settings.
- **Stone theme:** already merged (commits `302d86e`, `b2efbec`, `3fecc5c`; `public/stone-theme.js`; `docs/STONE-DESIGN.md`). No rebase needed. New UI should use its tokens.

## Surprises (please read before Phase 1)

1. **Correction (2026-10-19): there is no orphan journal revision.** An earlier version of this report said `journal_revisions` held an orphaned journal entry. That was wrong: its one row is version 1 of the Variance Map **program** record (revisions are written for journal, learning, program, use case, experiment and library kinds). Nothing is missing, and the journal kind still has no rows.
2. **"Library" is more than a record kind.** It has an Edge Function (`supabase/functions/library`), a storage bucket path, a `library_versions` table and an "Originals" feature. Both tables are empty (0 library versions, 0 storage objects), and it is already hidden from navigation. Retiring the kind means also deciding what happens to that function and its tests. Proposal: remove the kind from UI and MCP, leave the Edge Function and tables in place, and list them in `deferred-cleanup.md`.
3. **Learning was made directly creatable on 2026-10-05** (commit `8126640`), the same release that added Waiting On creation, yet it has zero records. Fine to retire, but that commit's tests (`standup-tools.test.ts`, `cora-create`) reference it and will need updating.
4. **Variance Map overlap, concrete detail.** The initiative "Create a GIS AI Agent to do Variance Maps" is empty (no body, no definition). The program "Automated Variance Map Intake, Generation and Distribution" has a `details.definition`, tag GIS, **due 2026-10-16 (now past)**, and neither has any inbound link. Merging them looks low-risk: no records point at either.
5. **Attribution strings are mixed in the data, not the code.** Code already writes "Created by CMD." (`automatic.ts:83`). The database has 9 records whose body contains "Created by Cora" and 2 with "Created by CMD".
6. **Only Settings, not Work Day, shows Command Brief.** §1.4's "remove the panel from Work Day" is already true.
7. **Microsoft permissions are broader than the app requests.** Code requests only `User.Read`, `Calendars.Read`, `Mail.Read`, `Chat.Read`, `ChannelMessage.Read.All`. The stored grant also lists `chat.readwrite`, `channelmessage.readwrite`, `channelmessage.send` and `teamsactivity.read`. Command never uses them, but the token carries them. Worth checking the Entra app registration and trimming it. This is outside the repo, so it is only noted here.
8. **Sent Items is already readable.** `direct.ts` reads `me/mailFolders/sentitems` with `Mail.Read`, so the §2.4 stretch (Waiting On suggestions) does not need new scopes.
9. **Both stale items are still open and overdue:** the Datto task (Inbox, due 2026-09-25) and the Barracuda reminder (due 2026-09-30).

## Decisions still needed from Kevin

1. **Name for the AI.** Code says CMD. Pick CMD or Cora for the single constant, and say whether the 9 existing "Created by Cora" records should be rewritten (a data edit) or left as history.
2. **Variance Map.** Merge the initiative and program into one Proposed project (my recommendation, given the details above), or keep both as two Proposed projects?
3. **Close-the-day reminder time.** Default 4:30 PM ET on weekdays?
4. **Library:** is leaving the Edge Function and empty tables in place (listed for later removal) acceptable?
5. **SITREP Teams `partial`:** I need the scheduled task's prompt (or the task itself) to fix the cause in §1.5. Can you open the task and share what it says about Teams, or tell me where it runs?
