# Command development roadmap

**Owner:** Kevin Mazur · HCPA Enterprise Technology  
**Version:** 1.0 · September 21, 2026  
**Status:** Phase 0 accepted by Kevin on September 21, 2026. Phases 3, 5 and 4 implemented in Kevin’s requested order; integration/release and pilot acceptance tracked in the [delivery record](PHASES-3-5-4-DELIVERY.md). Phases 6–7 delivery is tracked [here](PHASES-6-7-DELIVERY.md). See the [accepted build contract](PHASE-0-BUILD-CONTRACT.md).
**Source:** [Command master brief](COMMAND-MASTER-BRIEF.md)

## Recommended development path

Build a small, secure daily-use application first, then expand its work memory, introduce Cora, and connect external systems. Performance and security are release requirements throughout the project.

The master brief's original Foundation phase is too large for one manageable release. This roadmap divides its seven broad phases into smaller increments, each with a demonstrable outcome and an acceptance gate. The repository was empty when this plan was prepared; no existing implementation is assumed.

Two early milestones deliberately separate **daily usefulness** from **feature completeness**:

- **Daily-use pilot — after Phase 4:** secure installed PWA, Work Day, Tasks, persistent Reminders, Quick Capture, and protected drafts.
- **Foundation complete — after Phase 8:** Projects, Initiatives, People, Journal, Learning, AI Lab, Library, traditional search, exports, and operational verification.
- **Cora release — after Phase 10:** conversational actions and grounded contextual assistance.
- **Knowledge release — after Phase 12:** document processing and source-backed retrieval.
- **Connected intelligence — Phases 13–17:** independently gated integrations and proactive assistance.

These are scope milestones, not calendar promises. Estimate the next phase after its dependencies and acceptance criteria are understood. Do not commit to an end date for the entire vision before the pilot provides evidence.

## Working rules and ownership

**Kevin is the product owner and acceptance owner.** He decides priorities, tests the Mini experience, and approves material scope changes. The assigned developer or Codex implementation session owns delivery, tests, technical documentation, and demonstrations. Kevin assigns an operational maintainer and backup before the pilot. HCPA's appropriate security, records, identity, and platform owners participate when the relevant decisions arise; this plan does not assume they have approved anything.

Keep one phase active at a time. Within a phase, deliver the numbered slices separately. Each slice should fit one focused implementation/review cycle; split it further when it spans multiple independent behaviors. Inspect the repository and existing implementation before every coding task.

For each completed phase, record the actual delivery date, acceptance evidence, measured performance, remaining limitations, and next decision in this document or a linked release note. A feature is complete only when its failure behavior is tested and Kevin can use it on the target device.

Preserve these boundaries:

- Supabase owns Command information. External systems remain authoritative for their own records.
- Shared application services support the UI, Cora, and eventual MCP. Authorization must remain enforceable at the database and server boundaries.
- Routine data operations do not depend on an AI response.
- Original Journal entries and uploaded documents remain authoritative; derived content is separately identified.
- Command initially serves Kevin only. Model ownership from the start without building multi-user administration.
- No graph database, elaborate agent framework, or organization-wide inventory is needed to reach the pilot.

## Release requirements that apply to every phase

### Fast

Retain the brief's budgets below. As a proposed acceptance method, measure p95 for routine interactions on a documented representative dataset and normal connection. Record cold startup and hotspot/degraded-network results separately. Show sample counts and conditions; small test runs are preliminary evidence, not a production guarantee.

| Interaction | Target | Measurement boundary |
|---|---|---|
| Navigation | Under 200 ms perceived | Tap to usable visual response; measure data freshness separately |
| Normal CRUD | Under 500 ms | Submit to persisted confirmation; optimistic feedback does not count as persistence |
| Work Day useful render | Under 1 second | Launch/navigation to actionable core data; label cached data |
| Reminder creation after intent resolution | Under 500 ms | Validated intent to persisted record; also track total conversational time |
| Initial search results | Under 1 second | Submitted query to useful results |
| Cora acknowledgement | Under 1 second | Submit to visible working state |
| Normal Cora first streamed content | Under 2 seconds | Submit to meaningful streamed content, not a spinner |
| Typical contextual answer | Under 5 seconds | Submit to complete normal answer |
| Deep synthesis | Variable | Immediate working state, meaningful progress, cancellation and timeout |

Start with small and growing test datasets; include a representative multi-year workload before declaring the foundation complete. Identify slow queries and payloads before adding caches. Fetch independent context concurrently, paginate long lists, load secondary content separately, and prevent Microsoft or Helix outages from blocking local work. Record latency regressions as defects before expanding scope.

### Secure

Recommended controls for this application:

- Provision Kevin explicitly; disable public registration and anonymous sign-in. Use Supabase Authentication with a tested recovery procedure. MFA is deferred per Kevin’s Phase 0 decision.
- Restrict every exposed table and document operation by ownership and permitted action. Test denial for signed-out callers, an unrelated test user, and attempts to change ownership.
- Keep privileged database keys, OpenAI credentials, and Microsoft tokens server-side. Authenticate and authorize each server operation; never trust a client-supplied owner ID.
- Use private document storage and bounded authenticated access. Treat temporary document links as credentials and keep them out of logs.
- Use one hosted production Supabase project per Kevin’s Phase 1 decision. Keep local/CI tests synthetic and previews disconnected from production; scan commits and builds for secrets.
- Validate inputs and files; limit request sizes and expensive operations. Render notes, retrieved documents, and AI output safely. Apply appropriate browser security headers.
- Record important writes and action outcomes without copying sensitive source content or credentials into telemetry.
- Define the permitted information classes before real use. Restricted, exempt, personnel-sensitive, and internal security material remain excluded until HCPA explicitly permits the relevant storage and processing.
- Treat instructions embedded in documents, email, and retrieved content as untrusted data. They cannot grant Cora authority.

Supabase documents that grants and row-level security together control table access, and that Storage uses its own RLS policies. Both require tests; a protected UI is insufficient. Sources: [database RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) and [Storage access control](https://supabase.com/docs/guides/storage/security/access-control).

### Reliable and usable

Every phase must pass applicable type checks, linting, production build, meaningful behavior tests, and regression tests for affected flows. Include authorization tests whenever access paths change. Verify migrations and rollback/recovery before production changes.

Test Mini portrait and landscape in dark mode, light mode, iPhone, and desktop. Use device testing for installation, keyboard/dictation, rotation, reconnect, and writing recovery. Target WCAG 2.2 AA as the engineering baseline, including keyboard access, focus, contrast, screen-reader behavior, reduced motion, and touch usability. This is a proposed product target, not a legal compliance determination. [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/)

## Phase 0 — Agree on the build contract

**Outcome:** The first release has clear boundaries and no unresolved foundational dependency.

1. Confirm pilot scope, allowed information, Supabase Auth sign-in approach, and ownership of Netlify, Supabase, DNS, and recovery.
2. Document the proposed React/Vite/TypeScript frontend, dedicated Supabase project, and server-side service boundary for privileged work and future AI.
3. Decide environment separation, billing ownership, backup objectives, draft-storage policy, and production acceptance process.
4. Produce a Mini-first Work Day wireframe and small architecture/data-flow diagram. Keep future integrations visible without implementing them.

**Gate:** Kevin accepts the pilot boundaries; platform access and responsible owners are identified. Records ownership and retention questions are assigned to the appropriate HCPA owner before organizational information is entered. No legal retention duration is assumed.

**Dependency:** None. **Defer:** Detailed schemas for future operational systems, model selection, MCP, and integration permissions.

## Phase 1 — Establish the secure application foundation

**Outcome:** Kevin can sign in to a deployed application whose data boundary is already tested.

1. Scaffold the application, reproducible dependency setup, checks, and environment configuration.
2. Establish Supabase migrations, owner-scoped data conventions, authentication, account recovery, and server request validation.
3. Add structured error reporting, request IDs, basic timing, and important-write audit conventions.
4. Deploy through a preview workflow; configure the production domain and HTTPS when ready. Document rollback and initial backup/restore procedure.

**Gate:** Sign-in, sign-out, expiry, recovery, and unauthorized direct API access behave correctly. Production secrets are absent from client assets and previews. Restore a test record in an isolated environment.

**Dependency:** Phase 0. **Defer:** Feature-complete screens and AI.

## Phase 2 — Deliver the Mini-first PWA shell

**Outcome:** Command installs and feels intentional on the 8.3-inch Mini.

1. Implement design tokens, typography, dark/light themes, consistent icons, accessible controls, and restrained motion.
2. Build portrait navigation, deliberate landscape layout, desktop navigation, and iPhone capture access.
3. Add manifest, icon, standalone behavior, safe areas, static-asset caching, and a predictable app-update flow.
4. Add reusable loading, empty, error, and connection states. Establish local draft handling before writing-heavy features.

**Gate:** Install and relaunch on the actual Mini; test rotation, software keyboard, text scaling, focus, and reduced motion. Cached assets must not expose authenticated data after logout. Do not display an active Ask Cora control before it works.

**Dependency:** Phase 1. **Defer:** Full offline database sync, notifications, and badging.

## Phase 3 — Build Tasks and persistent Reminders

**Outcome:** Kevin can reliably manage obligations without AI.

1. Implement Tasks with the brief's statuses, priorities, due dates, filters, and completion flow.
2. Implement separate Reminders with undated/date-only/timed behavior and Active, Snoozed, Complete, and Dismissed states.
3. Add complete, snooze, edit, dismiss, and explicit conversion to Task. Make conversion atomic and resistant to duplicate retries.
4. Define America/New_York date handling, UTC timestamps where appropriate, and daylight-saving behavior; preserve date-only meaning.

**Gate:** Passing a due time never removes an active Reminder. Snoozed items return when due and remain inspectable while snoozed. Test retry/double-tap behavior, failed writes, dates around midnight/DST, ownership, and CRUD latency.

**Dependency:** Phase 2. **Defer:** Natural-language interpretation until Phase 9; operating-system dictation may already fill ordinary fields.

## Phase 4 — Make Work Day useful and start the pilot

**Outcome:** Kevin can use Command throughout a real workday.

1. Assemble a compact Work Day with a limited priority list, due work, persistent Reminders, and Waiting On/delegated-work views.
2. Keep Waiting On conceptually distinct: capture the dependency, responsible party, follow-up date, and linked task when one exists. Delegation remains Kevin's tracking record, not an assignment sent to someone else.
3. Add global Quick Capture that preserves original text without mandatory classification, plus basic list/title lookup.
4. Preserve in-progress writing through temporary connection loss; show saved/pending/failed states and recover drafts without silently overwriting newer edits.

**Gate:** Kevin completes at least five workdays of pilot use. Simulated disconnect/reconnect does not lose writing or duplicate saves. Work Day meets its measured budget and remains useful with all external services absent.

**Dependency:** Phase 3. **Defer:** Calendar timeline and AI brief until actual integrations/AI exist; no fabricated placeholders.

**Milestone:** Daily-use pilot. Fix usability and reliability findings before widening the application.

## Phase 5 — Add Projects, People, and durable work memory

**Outcome:** Work has context and thinking has a retrievable history.

1. Add lightweight Projects, Initiative grouping, and People; connect existing work and waiting items.
2. Expand capture into chronological Journal entries, with optional types, tags, project links, and revision history that preserves original text.
3. Add Ideas and Decisions as explicit records or well-defined entry types with stable links; document the chosen simple model.
4. Add project current state, goals, next milestone, and manually maintained context views. Introduce relationships only where a real flow needs them.

**Gate:** Kevin can trace a decision or idea to a project and resulting task, review an entry's original text, and retrieve waiting items by person. Deleting/archiving linked items follows a documented preservation rule.

**Dependency amendment:** Kevin authorized Phase 5 before Phase 4. Implement the shared Journal/Waiting On structures here, then assemble Quick Capture and Work Day in Phase 4. **Defer:** Automatic classification and inferred relationships.

## Phase 6 — Add Learning and the AI Lab

**Outcome:** Command supports professional learning and HCPA AI Program development.

1. Build Learning records with sources, progress, takeaways, usefulness, and HCPA applicability.
2. Add AI Program overview and governance references, linked to existing projects and decisions.
3. Add the Use Case Registry with the brief's lifecycle, owner, data involved, risk, expected/actual benefit, and decision.
4. Add Experiments with hypothesis, setup, tool/model metadata, results, conclusion, and next action.

**Gate:** Kevin records one complete learning-to-experiment-to-decision example. Program status and next work are understandable without AI. A use-case status records a decision; it does not automatically authorize data processing.

**Dependency:** Phase 5. **Defer:** Automated governance assessments and organizational approval workflows.

## Phase 7 — Add the private Library

**Outcome:** Documents are safely stored, organized, linked, and retrievable.

1. Add private Storage, document metadata, categories, classifications, and links to projects, learning, and AI Lab.
2. Establish an initial supported-file allowlist, size limits, safe download behavior, and upload validation/quarantine rules appropriate to those formats.
3. Add upload progress, retry, failure recovery, and reconciliation for files whose metadata write fails.
4. Preserve originals, document replacement/version rules, and test file backup and restoration separately from database metadata.

**Gate:** An unauthorized caller cannot list or retrieve documents. Invalid uploads fail safely. Kevin can recover an original document and its links after an isolated restore test. Classification labels do not override the approved-data policy.

**Dependency:** Phase 5; delivered after Phase 6 in the default sequence. **Defer:** Extraction, OCR, embeddings, and AI document answers.

## Phase 8 — Finish and verify the foundation

**Outcome:** The complete non-AI foundation is searchable, portable, and maintainable.

1. Add traditional cross-module search over titles, text, tags, and approved metadata with filters and direct source links. Library full-text search waits for extraction.
2. Export implemented entities and relationships with stable IDs in appropriate JSON, CSV, or Markdown formats, plus original documents.
3. Verify query plans and indexes against representative growth; improve only measured bottlenecks.
4. Complete the support runbook, recovery drill, error alert routing, dependency maintenance process, and full device/accessibility review.

**Gate:** Search respects ownership; exports reconcile to source record counts and retain usable relationships. Backup restoration recovers both database and documents. Critical security, data-loss, and routine-performance failures block release.

**Dependency:** Phases 5–7. **Milestone:** Foundation complete. Advanced AI is still unnecessary for daily use.

## Phase 9 — Introduce Cora's conversational actions

**Outcome:** Kevin can ask Cora to perform narrow, reliable Command operations.

1. Add server-side AI access, persistent Ask Cora, streaming, cancellation, timeouts, usage limits, and the brief's restrained personality and Pulse.
2. Introduce configurable model routing without choosing permanent model names in this roadmap. Verify provider capabilities and data handling at implementation time.
3. Convert validated natural-language intent into existing service calls for task/reminder creation, completion, snoozing, and capture. Use deterministic retrieval for simple list requests.
4. Enforce action authority outside the model; add idempotency, audit records, and clear success/failure feedback tied to actual committed writes.

**Gate:** An evaluation set distinguishes Tasks from Reminders, handles ambiguous timing, tests adversarial instructions, and proves retries do not duplicate actions. Cora cannot claim a failed write succeeded. All core manual flows work during AI outage.

**Dependency:** Phase 8. **Defer:** External writes and broad autonomous agents.

**Brief clarification:** Conversational reminders appear in the brief's initial target but AI is scheduled later. This plan delivers manual/dictated reminders in the pilot and natural-language execution here. If conversation is required for pilot acceptance, move only this narrow reminder slice forward after Phase 4; do not pull all AI work into the foundation.

## Phase 10 — Give Cora prepared context

**Outcome:** Cora explains work and proposes useful next steps with identifiable evidence.

1. Build compact context services for Work Day, Projects, Initiatives, People, and the AI Program; retrieve independent inputs concurrently.
2. Add Cora Brief and project/learning/AI Lab summaries with source links and freshness information.
3. Add proposed Journal classification, metadata, tasks, reminders, and related-content suggestions while preserving originals.
4. Add constructive challenge and next-step suggestions; distinguish recorded facts, inference, and incomplete context.

**Gate:** Test representative questions against known records. Missing or conflicting context is disclosed. Instrument request receipt, intent, context retrieval, provider start, first token, completion, and total duration. Normal answers meet the budget under documented conditions.

**Dependency:** Phase 9. **Milestone:** Cora release. **Defer:** Semantic retrieval and proactive scheduling.

## Phase 11 — Process documents reliably

**Outcome:** Approved uploaded documents produce traceable searchable text.

1. Add an asynchronous extraction pipeline for a small declared set of document formats.
2. Add processing states, bounded retries, job deduplication, cancellation, and visible failure reasons.
3. Store derived text/chunks with document version and source location; handle replacement and deletion consistently.
4. Add extracted-text search. Evaluate OCR only if real documents justify it.

**Gate:** Extraction failures never block ordinary Command use. Reprocessing creates no duplicates, oversized/malformed files fail safely, and source text remains traceable to the original. Processing runs in a constrained environment.

**Dependency:** Phases 7–10. **Defer:** Vector search until extraction quality is proven.

## Phase 12 — Add grounded knowledge retrieval

**Outcome:** Cora can answer research questions with verifiable source support.

1. Add embeddings and pgvector only where traditional retrieval demonstrably misses useful content.
2. Combine structured, full-text, and semantic retrieval across Library and relevant Journal, Learning, Projects, and AI Lab content.
3. Apply ownership and classification rules before any retrieved text reaches the model. Propagate source updates/deletions to derived indexes and caches.
4. Return citations with document version/location or record links, and evaluate support, relevance, latency, and refusal to invent missing evidence.

**Gate:** A curated question set demonstrates improvement over traditional search. Unauthorized content never appears in retrieval or model context. Malicious document instructions cannot invoke actions. Each substantive sourced claim can be checked against its source.

**Dependency:** Phase 11. **Milestone:** Knowledge release.

## Phase 13 — Connect Microsoft Calendar and Meeting Mode

**Outcome:** Work Day understands the schedule and helps Kevin prepare for meetings.

1. Confirm tenant approval, least-privilege delegated access, server-side token storage, and revocation behavior.
2. Add read-only calendar context, time zones, cancellations, open blocks, bounded refresh, and visibly dated cached results.
3. Build meeting preparation using attendees and existing Command context; add Mini-focused meeting notes.
4. Propose post-meeting decisions, tasks, reminders, waiting items, and project updates for review before persistence where appropriate.

**Gate:** Calendar remains authoritative. Revoked access, throttling, and outages leave Command usable. Meeting notes survive disconnects; extracted commitments are reviewed and not duplicated.

**Dependency:** Phase 10; default sequence follows Phase 12. **Defer:** Calendar writes, email, Teams, and recording/transcription.

## Phase 14 — Add Outlook, then Teams signals

**Outcome:** Selected communications inform work without recreating messaging clients.

1. Deliver Outlook read/search and linked thread context as its own reviewable release.
2. Add proposed commitments/follow-ups and draft replies without automatic sending.
3. Validate Teams permissions and available access paths, then deliver relevant mentions/search as a separate release only if justified.
4. Bound caches, retention, refresh frequency, and context payloads; retain source links and distinguish external content from Command records.

**Gate:** Kevin confirms signal quality during a pilot. Permission denial and service failure degrade gracefully. External content cannot authorize actions. Sending or changing external records remains outside this phase.

**Dependency:** Phase 13 and HCPA tenant approvals. **Decision:** Stop after Outlook if Teams does not add enough value or requires excessive permissions.

## Phase 15 — Connect Helix context

**Outcome:** Cora can explain relevant operational context without duplicating Helix.

1. Identify the smallest useful read-only context contract and its owner.
2. Implement authenticated, permission-scoped project/system/incident context only for approved use cases.
3. Add bounded parallel retrieval, source links, freshness, timeouts, and integration error monitoring.

**Gate:** Validate a concrete cross-system question against Helix's source records. Helix remains authoritative, and a Helix outage does not slow routine local work.

**Dependency:** Phase 10 and Helix API/security approval; independent of Microsoft delivery. **Defer:** Operational writes and full system/asset replication.

## Phase 16 — Expose Command through secure MCP

**Outcome:** ChatGPT can access the same authorized Command services.

1. Verify current MCP/client authentication requirements and approved data handling, then expose a small read-only contextual tool set.
2. Test identity binding, scopes, session expiry/revocation, limits, and auditability.
3. Add selected low-impact writes only after read-only acceptance; preserve confirmation policy and retry safety across interfaces.

**Gate:** The same identity has the same permitted data/actions through the app and MCP. Unknown clients, expired credentials, and attempts to exceed scope are rejected. No second Cora data store or independent business logic is introduced.

**Dependency:** Stable services from Phases 9–10; does not require every integration. **Defer:** Broad external actions.

## Phase 17 — Add proactive intelligence incrementally

**Outcome:** Cora helps maintain situational awareness without creating noise.

1. Release morning, end-of-day, and weekly reviews individually, using explicit schedule and timezone settings.
2. Add forgotten-item and delegation follow-up detection with explainable reasons and dismiss/snooze controls.
3. Evaluate focus suggestions, thinking-over-time analysis, learning gaps, recurring issues, risks, and AI Program progress one use case at a time.
4. Introduce notification channels only after actual device support, permissions, delivery behavior, quiet hours, and usefulness are verified.

**Gate:** Kevin finds the suggestions useful over a real-use evaluation period. Track dismissals, corrections, unsupported claims, latency, and cost. Jobs are deduplicated, observable, cancellable, and safe to retry. Consequential actions still require explicit authority.

**Dependency:** Phase 10 plus only the data/integrations needed for the selected use case. **Decision:** Continue based on measured value, not feature count.

## Decisions and risks to resolve deliberately

| Decision or risk | Recommended handling | Owner / timing |
|---|---|---|
| Broad scope delays everyday value | Protect the Phase 4 pilot; admit later features only after its review | Kevin / each phase |
| Sensitive information spreads into drafts, logs, or AI | Define allowed data and provider processing before use; minimize retained content | Kevin + appropriate HCPA owners / Phase 0, revisit before Phase 9 |
| Local draft recovery versus device exposure | Limit local storage to approved draft types, scope by user, purge on logout, disclose unsynced drafts, and decide expiry/device protections | Kevin + developer / Phases 0–2 |
| “Private” mistaken for “not an organizational record” | Assign classification, retention, export, deletion, and hold decisions; no blanket automatic purge | Appropriate HCPA records owner / before real organizational data |
| Full offline expectations | Support asset caching and interrupted-writing recovery first; no general offline sync promise | Kevin / Phase 0 |
| Recovery gaps | Set proposed initial objectives of no more than 24 hours of data loss and restoration within one business day, then verify feasibility and cost before accepting them | Operational maintainer + Kevin / Phase 1 |
| AI latency, errors, and cost | Bound context and usage, preserve manual operation, measure quality and latency before expansion | Developer + Kevin / Phases 9–12 |
| Integration permissions or APIs block progress | Verify access before each integration; keep core releases independent | HCPA identity/system owner / Phases 13–16 |
| Orphaned operational ownership | Assign maintainer, backup, alert recipient, and maintenance cadence | Kevin / before Phase 4 pilot |

## Definition of done and immediate next action

A phase closes when its deliverables are usable, its gate and applicable shared requirements pass, documentation/export coverage is updated, and Kevin accepts the demonstration. Record any limitation explicitly; do not describe planned controls as implemented security or measured performance.

**Latest delivery:** Phase 8 implementation and automated verification completed September 21, 2026, following Kevin’s request for comprehensive and fast site search. He explicitly declined external alert routing and an independent backup destination. See [Phase 8 delivery](PHASE-8-DELIVERY.md). Carry forward physical-device/accessibility and five-workday pilot acceptance before declaring the foundation accepted.

## Traceability to the master brief

| Master brief release | Roadmap coverage |
|---|---|
| Phase 1 — Foundation | Phases 0–8 |
| Phase 2 — Cora Foundation | Phases 9–10 |
| Phase 3 — Knowledge | Phases 11–12 |
| Phase 4 — Microsoft 365 | Phases 13–14 |
| Phase 5 — Command + Helix | Phase 15 |
| Phase 6 — ChatGPT / MCP | Phase 16 |
| Phase 7 — Intelligence | Phase 17 |

The product vision and feature requirements remain in the master brief. This document governs sequencing, bounded delivery, and acceptance. Platform-specific APIs, pricing, service limits, model selections, and legal requirements must be reverified when their implementation phase begins.

## Cora v0.1 scope decision — September 21, 2026

Kevin’s Cora implementation brief authorizes the narrow first milestone across conversational access, live read tools, page context and controlled task creation. [Cora delivery notes](CORA-DELIVERY.md) define this slice. Task-card review is the initial write boundary. Broader Phase 9 reminder/completion/snooze actions and Phase 10 automatic AI briefs remain later work; this slice does not mark those entire roadmap phases accepted.


## Microsoft 365 sequencing decision — September 21, 2026

Kevin authorized bringing read-only Microsoft connection management, Calendar and Outlook context forward after Cora v0.1. Use a new HCPA single-tenant **Command — Microsoft 365** Entra registration. [Setup and operational notes](MICROSOFT-365-SETUP.md) define the bounded delivery and tenant activation checks. Teams remains a separate follow-on scope; the ChatGPT/MCP interface follows the shared backend integration. This does not close all of Phases 13–14: full Meeting Mode, selected Teams access and pilot acceptance remain outstanding.
