# Deferred cleanup

Everything here is intentionally left in place by Phase 1. Nothing was dropped, and no record data was deleted. Each item needs Kevin's approval and its own reversible migration before it is removed.

## Database (kept; hidden from the app)

- **Foreign-key columns on `work_items`**, all nullable and unused: `initiative_id`, `program_id`, `learning_id`, `use_case_id`, `experiment_id`, `decision_id`, `source_entry_id`. Production has no row that uses any of them. Their composite foreign keys, indexes and the `guard_lab` link checks remain.
- **Retired kinds in the `work_kind` and `work_status` checks** (`initiative`, `program`, `journal`, `learning`, `use_case`, `experiment`, `library`). The migration only added `Proposed` for projects. The application no longer creates or lists these kinds.
- **Archived originals** of the converted initiatives and programs. Each carries `details.migrated_to` (the new project ID); each new project carries `details.migrated_from` (`kind:id`).
- **Columns used only by retired kinds:** `entry_type`, plus the program detail keys now allowed on projects by `guard_lab`.
- **Tables:** `journal_revisions` (still holds one revision, for the Variance Map program record), `library_versions` (empty), and `cora_workday_reviews` (19 rows of Command Brief history, now read-only: insert, update and delete are revoked).
- **Supabase Edge Function `library`** and the storage it uses (no objects). `src/services/library.ts` and its tests stay with it.
- **Export** still includes every table above, so a retention export is complete.

## Code kept on purpose

- **Overlapping read tools** `get_my_tasks`, `get_tasks_due_today`, `get_priority_tasks`, `get_reminders_due`, `get_active_projects`, `get_waiting_on`. `get_day_snapshot` covers their first page, but the scheduled SITREP prompt (outside this repository) calls them and the audit shows regular use. Remove them only after the SITREP prompt is confirmed to use `get_day_snapshot`, and keep `get_my_tasks` for paging past 25.
- **In-app CMD engine** (`netlify/functions/_shared/cora/engine.ts`, the CMD panel), dormant without `ANTHROPIC_API_KEY`, and `validateProposal` / `TaskProposal`, which the in-app confirm path still uses for stored turns.
- **`src/features/lab/fields.ts`** now holds only person contact fields and the program detail keys a project may carry. It keeps its old path to avoid churn; rename it with the next change that touches it.
- **`command_skill.zip`** in the repository root predates this release. Re-export it from `.claude/skills/cmd/` when the skill is next uploaded.

## Data

- **9 records say "Created by Cora" and 2 say "Created by CMD"** in their notes. New records use the single `attribution` constant ("Created by CMD."). The older text was left as history.
