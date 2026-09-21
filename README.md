# Command

Production: **https://cmd.hillspafl.gov**.

Private work planning for HCPA. The authenticated, installable shell now includes Tasks, Reminders, Projects, Initiatives, People, Journal, Waiting On, Quick Capture and Work Day. AI remains a later phase.

- [Phase 8 search, exports and operations](docs/PHASE-8-DELIVERY.md)
- [Visual redesign and theme guide](docs/DESIGN-DELIVERY.md)
- [Phases 3 → 5 → 4 delivery and pilot checks](docs/PHASES-3-5-4-DELIVERY.md)
- [Development roadmap](docs/COMMAND-DEVELOPMENT-ROADMAP.md)
- [Phase 2 delivery and device checks](docs/PHASE-2-STATUS.md)
- [Phase 1 delivery and remaining checks](docs/PHASE-1-STATUS.md)
- [Operating runbook](docs/PHASE-1-RUNBOOK.md)
- [Accepted build contract](docs/PHASE-0-BUILD-CONTRACT.md)

## Develop and verify

Use Node 22. Run `npm ci`, then `npm run check`. Run `npx playwright install chromium` and `npm run test:e2e` for browser workflows. Run `npm run test:pwa` to verify the built service worker, offline privacy and update lifecycle. `npm run dev` without environment configuration shows a disconnected preview.

There is exactly one hosted Supabase project, production. For connected development use Docker and `npm run db:start`; copy local public values into an ignored `.env.local` using `.env.example` as the field reference. Never point development at production. `npm run db:test` runs database assertions against disposable local Supabase. The normal test suite also exercises the actual SQL migration in isolated PGlite databases without Docker.

The GitHub workflow includes application checks and disposable Supabase integration tests. A workflow file alone is not evidence of a successful CI run; see the delivery record.

## Production boundary

React/Vite/TypeScript on Netlify; Supabase Auth and PostgreSQL. Public signup and anonymous sign-in are disabled. An authenticated user also needs active app membership; row-level security enforces ownership. No service-role key belongs in the browser or Netlify functions. The access function verifies the user's token and membership with a public key.

Email/password sign-in, no MFA, and no SMTP service are Kevin's current decisions. Self-service email recovery is deferred; administrator-assisted recovery is documented in the runbook.

Preview builds have no production database connection. Production public environment settings are scoped to production in Netlify. Dependency versions are locked; the `sharp` override patches the Netlify CLI's transitive dependency.

Learning, AI Lab and private Library: [Phases 6–7 delivery and file recovery](docs/PHASES-6-7-DELIVERY.md).

Cora v0.1: [implementation, operating boundaries and acceptance](docs/CORA-DELIVERY.md).
