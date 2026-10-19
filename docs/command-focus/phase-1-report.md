# Command Focus: Phase 1 report

Branch `feature/command-focus`. Nothing is on `main` and **no production migration has been applied**. Decisions used: the AI is **CMD**; the Variance Map initiative and program are **merged** into one project; the close-the-day time is **3:00 PM ET** on weekdays; the library Edge Function and tables stay in place.

## What changed

**Migrations** (both additive, each with its rollback in the file header; apply in this order)
- `20261019120000_focus_proposed_projects.sql`: adds the `Proposed` project status; lets projects carry `details.migrated_from`/`migrated_to`; converts every non-archived initiative and program into a Proposed project and archives the original (`details.migrated_to` points at the new project, `details.migrated_from` records `kind:id`); merges the Variance Map pair into one project that records both origins. Links are re-pointed only where the linked record had no project. Nothing is deleted. From production data it will convert 4 records into 3 projects (the Variance Map pair becomes one; "HCPA Disaster Plan" and "HCPA Radar Agent" one each). The functions `focus_new_project` and `focus_fold_to_projects` stay installed (server-only, safe to re-run).
- `20261019130000_focus_day_close.sql`: `day_closes` and `usage_events` (RLS, owner-only); `apply_day_close` (one transaction: versions checked first, then done, move, drop, flagged-mail conversion, tomorrow's first item, receipt); flagged mail can become a Waiting On item; `cora_workday_reviews` is now read-only.

**App**
- Retired from the UI, navigation, search facets, create menus, validation and MCP enums: journal, learning, use case, experiment, library, initiative, program. Quick capture now saves an Inbox task.
- Proposed projects sit in their own collapsed group below Active and On Hold.
- People: name, role, organization, email, notes and linked records stay; phone and mobile are hidden (values kept). A person page shows **They owe me** (Waiting On) and **I owe them** (linked tasks and reminders).
- **Close the Day** at `/close`, a Work Day card from 3:00 PM on weekdays, and the MCP tools below. Sections in order: Done today, Still open, Stale, Flagged mail, Tomorrow's first item. Proposals are fixed rules (Inbox or Someday items more than 7 days overdue: drop; other tasks: move to the next working day; reminders past due and untouched: drop; Waiting On: review). Nothing changes without a tap or a chat confirmation. Drop archives.
- Work Day shows the SITREP's status in plain words (for example "SITREP is partial: Teams unavailable this morning"), a quiet "This week: 4/5 days closed · 11 captures" line, and counts `app_open`, `capture`, `day_close` and `sitrep_opened` events.
- The single attribution constant is `Created by CMD.` (`netlify/functions/_shared/cora/attribution.ts`).

**MCP tools**
- Added: `get_day_close` (read only; includes flagged mail), `apply_day_close` (atomic; rejects the whole batch on a stale version). `get_day_snapshot` now returns `last_day_close` with tomorrow's first item.
- Removed: `prepare_task`, `get_workday_reviews`, `record_workday_review`, and the `command_brief` prompt (replaced by `close_day`).
- Enums: `create_record` is task, person, project, waiting; `prepare_record` and `get_records` list the five current kinds.
- Descriptions now give each write one path: `create_record`/`create_reminder` for new records, `quick_update` for complete, snooze, dismiss and dates, `prepare_record` for everything else, `apply_day_close` for the close.
- Kept on purpose, with the reason in `deferred-cleanup.md`: `get_my_tasks`, `get_tasks_due_today`, `get_priority_tasks`, `get_reminders_due`, `get_active_projects`, `get_waiting_on`. The scheduled SITREP calls them.

## Verification against the acceptance criteria

| Criterion | Result |
| --- | --- |
| Retired kinds gone from UI and MCP schemas | Done and tested (tool list and enum assertions; 44 browser tests across every page, both themes, axe clean). Rows stay in the database. |
| Initiative and Program become Proposed projects with `migrated_from`; nothing lost | Verified by database tests on the same record shapes, including the merge, link re-pointing and re-running safely. **Not yet run on production** (waiting for your approval). |
| No Command Brief tools or UI remain; SITREP shows its status | Tools, prompt, panel code and `brief.md` removed. **Correction:** the Settings "Automatic reminders" switch lived in the old panel's file. It is the kill switch for automatic writes, so it was kept (renamed `AutomaticReminders`). |
| No weekend SITREP runs, or the external change documented | Documented below. The trigger is outside the repository. |
| Close the Day works end to end on an iPad Mini and through MCP, and a receipt appears | Tested at iPad Mini portrait size (744 px) in the browser and through the MCP handler; the database function is tested under row-level security. **Not yet tried on a real iPad or with real Claude**, which needs the migrations applied. |
| Datto and Barracuda appear under Stale | Yes by rule: Datto is an Inbox task 24 days overdue; Barracuda is a reminder 19 days overdue and untouched since Sep 22. Covered by a unit test and a browser test using the same shape. |
| Deploy preview passes Kevin's review | See **Preview** below. |

Full check: type check, lint, 280 unit and database tests, build (190 KiB gzip), and 44 browser tests all pass.

## SITREP (decision 5: it runs from Claude)

Root cause I can establish from the data: Teams is `partial` in 25 of 26 partial runs although the Teams tools almost always succeed. The SITREP prompt appears to mark Teams `partial` whenever it relied on search, which the tool descriptions say is limited. **In the repo** I changed `save_sitrep`'s description so a source is `partial` only when a call errored, timed out or came back incomplete; limited search coverage alone is `ok`. That should take effect on the next run without any edit on your side, but I cannot confirm it until a run happens.

**You need to do, in the Claude scheduled task (outside this repo):**
1. Change the schedule to **weekdays only**: the `am` and `midday` runs Monday to Friday, America/New_York. Remove Saturday and Sunday. (11 of the last 38 runs were weekend runs.)
2. In its prompt, start with `get_day_snapshot`, and when `last_day_close` is from the previous workday, open now/next with `last_day_close.first_item`.
3. In its prompt, remove any use of `get_workday_reviews`, `record_workday_review` or `prepare_task`; they no longer exist.
4. Optional: tell it that Teams is `ok` when its calls returned results, to match the tool text.
5. Tell me if you would like it to stop calling the six overlapping read tools; then I can remove them.

## Other steps for you outside the repo

1. **Apply the two migrations to production** when you approve. I re-count the retired kinds (including archived) immediately before applying, and stop if any is above zero.
2. **Re-upload the CMD skill** to claude.ai from `.claude/skills/cmd/` (`SKILL.md` changed; `brief.md` is gone).
3. **Entra:** the stored Microsoft grant includes send and read-write Teams scopes that Command never requests (see `discovery.md`). Consider trimming them in the app registration.

## Preview and CI

- **There is no deploy preview yet.** Netlify does not build this branch on its own (`https://feature-command-focus--hcpa-command.netlify.app` returns 404 after more than five minutes), and previews appear once a pull request is open. I have not opened one; say the word and I will open a draft.
- **A preview cannot show real data.** `netlify.toml` and `vite.config.ts` deliberately give previews no Supabase connection, so a preview would show the app without your records and `/close` would have nothing to load. To review the screens with real data, run it locally against production with `npm run dev:netlify` (it reads `.env.production.local`), or point previews at a staging Supabase project. Both need your decision.
- **CI on the branch:** the real local Supabase run (Auth, REST, Storage, Edge Function and pgTAP, applying both new migrations) **passes**, and so does `npm run check` (280 tests, build). The `application` job still fails on its `npm audit --audit-level=high` step, which has failed on `main` for several commits already (the dev dependencies `braces` and `node-forge`; `npm audit fix --force` is the suggested fix). That failure also skips CI's browser tests, which I ran locally instead: 44 of 44 pass, and the 2 offline-install tests pass.

## Deferred

See `deferred-cleanup.md`. Phase 2 (push, shortcut capture, meeting prep) has not been started.
