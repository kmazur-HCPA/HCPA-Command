# Command visual redesign

Canonical production URL: https://cmd.hillspafl.gov.

## Design

Light is a bright editorial workspace: white elevated cards, a graphite rail, strong orange navigation, and a clean focus card. Dark is a warm graphite workspace: restrained outlined navigation, softly lit focus treatment, inset surfaces, and an open brief with an accent rule. Both preserve navigation positions and task behavior.

The slash/orbit mark is native SVG, with dark browser and install icons. Geist is self-hosted as one 29 KB Latin variable font. Short entrance transitions, hover feedback, and focus progress respect reduced-motion preferences. No animation framework or remote font service is used.

Work Day shows real due-task, reminder, focus, and learning counts; saved priorities; quick task completion; current projects; reminders; waiting dependencies; and a deterministic brief. The ring measures selected priority slots, not task completion. Calendar, weather, and AI-generated advice are not represented as working integrations. Search uses the existing owner-scoped search endpoint and supports workspace navigation. Cmd/Ctrl+K opens it; Shift+Cmd/Ctrl+K opens capture.

Mini and phone layouts use a single-column feed, focus first, five-item bottom navigation, and a modal workspace sheet. Shared record lists, forms, details, and settings use the same design tokens.

## Verification

- TypeScript, lint, 68 unit/database tests and production build pass.
- 23 browser tests pass, including saved themes, quick completion, command search, draft recovery, and 390/744/1133/1440 pixel layouts.
- Both production PWA tests pass: private data excluded from caches and explicit update activation preserved.
- Populated and empty layouts were inspected visually. Screenshots below use synthetic test records, not production data.
- Compressed JavaScript/CSS totals approximately 148 KiB; font adds 29 KB. Existing 190 KiB JS/CSS budget remains enforced.

[Light preview](design/work-day-light.png) · [Dark preview](design/work-day-dark.png)

## Operations and rollback

Netlify production app origin and Supabase Site URL now use the canonical hostname. The exact canonical `/auth/reset` URL is allowlisted; email recovery remains disabled as requested. The existing Netlify alias and its exact recovery redirect remain available during transition. Save or export any local drafts there before switching. Browser sessions and installed PWAs are origin-specific; sign in and install from the canonical address.

No production schema or data migration is part of this release. Revert the design commit and redeploy to roll back the UI. Keep the canonical origin settings. Existing static PWA resources update through the normal explicit reload flow, with unsaved-draft protection.
