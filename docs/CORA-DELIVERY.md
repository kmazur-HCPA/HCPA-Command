# Cora v0.1 — implementation and operating notes

Kevin authorized the first Cora release through the September 21 implementation brief. This delivers the initial conversational, live-context and controlled task-creation milestone. It does not activate autonomous work, external systems, vector memory, voice or broad record editing.

## Experience

Ask Cora opens a persistent desktop side panel; the center mobile control opens Cora while retaining the previous workspace. Quick Capture remains in the desktop header, Work Day and mobile More menu. The approved orange slash stays in use, with restrained activity motion and reduced-motion support.

Cora streams responses, retains conversations, understands the currently open record and links to retrieved sources. “Ask Cora for perspective” on Work Day uses the same intelligence layer for an on-demand brief. The deterministic Work Day summary remains available during AI outages. Automatic/cached AI briefs remain a later expansion.

Read tools cover open tasks, overdue/due work, critical/high-priority tasks, active/on-hold projects, project details and private Waiting On dependencies. Related people/project/task titles are resolved through owner RLS. Lists return exact totals and 25 records per page, with explicit truncation and bounded paging. Text context is capped; Cora must disclose missing data and distinguish inference. Calendar data is not connected.

Cora prepares one task card per request. The user reviews its title, due date, priority and optional project, then chooses **Add task**. This deliberate first-release boundary prevents a model or instructions hidden in records from independently writing. The server revalidates the saved proposal and uses the existing work service under the user's JWT. A stable task ID reconciles concurrent retries without duplicating or overwriting records. A saved receipt supplies the success state; model prose does not. Timed reminder creation, completion, snoozing and other writes remain manual in this release.

## Architecture and authority

- `netlify/functions/_shared/cora`: identity, instructions, named tools, context/history assembly, provider loop and request handling.
- `/api/cora/chat`: verified Auth identity and active membership, request reservation, live context, bounded tool loop and NDJSON streaming.
- `/api/cora/history`: owner-only conversation and turn history with pagination.
- `/api/cora/action`: explicit task-card action; never accepts arbitrary task fields or a frontend user ID.
- `cora_conversations`, `cora_turns`, `cora_activity`: private conversation history, request receipts and tool audit. A turn stores its user message and assistant response together. Browser access is read-only; server persistence uses a separate secret. Existing Command record reads/writes use the caller's RLS, not that secret.

The reservation RPC is invoker-rights and executable only by `service_role`. It checks membership, serializes requests per owner and enforces 12 requests/minute, 100/day and one active request. Replayed request IDs return the saved turn, and different payloads cannot reuse an ID. No public SECURITY DEFINER API is introduced.

Model access defaults to `gpt-5.4-mini`, configurable through server-only `CORA_MODEL`. It uses OpenAI through Netlify AI Gateway when Netlify injects credentials, or an explicitly configured OpenAI key/base URL. `store:false` is sent to the provider. No model credentials, prompts, responses or record text enter application console logs. The private audit table retains tool arguments and summarized outcomes, and the conversation retains the user's request.

History is limited to eight completed turns, with bounded message text. Four model rounds and bounded tool arguments/outputs prevent runaway loops. The request has a 45-second deadline, provider retries are disabled, and Stop cancels client/remote work where the connection supports cancellation. Interrupted work may finish saving its conversation; reload history before resending. Chat itself cannot create a task.

## Configuration and operations

Production Functions require `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`. The secret must never use a `VITE_` prefix, build scope or preview context. Netlify injects `OPENAI_API_KEY` and `OPENAI_BASE_URL` for AI Gateway; explicit keys override this behavior. Missing configuration produces a visible unavailable state while normal Command tools remain usable. Preview contexts remain disconnected.

User exports now include Cora conversations, turns and activity alongside existing records. Restore in parent-before-child order: conversations, turns, activity. The local recovery harness includes these tables. Auth identities remain outside user exports. No new backup destination or external alert routing was added.

For failures, inspect request IDs and content-free `cora_request` timing in Netlify, private Cora receipts and Supabase status. A failed action may have committed before acknowledgement; retry the same task card to reconcile. Do not manually generate a new task ID to “retry.” Revoke membership to stop new access. Rotate the server secret in Netlify if necessary. Roll back the frontend/function release first; retain conversation tables and existing work records. Never delete user history to roll back code.

## Acceptance and remaining expansion

Verify live task accuracy, a follow-up about today's priorities, Waiting On context, a reviewed task due tomorrow and an open-project question. Automated fixtures additionally exercise unauthenticated access, owner isolation, forged receipt denial, revocation, quota reservations, cancellation/failure handling and retry-safe writes. Provider-backed synthetic evaluation and production smoke evidence are recorded below when complete.

Physical-device Safari/VoiceOver acceptance remains user-run. Automatic AI brief caching, broader actions, reminder interpretation and deeper cross-module context require their own acceptance checks.

## Sources checked

- [Netlify AI Gateway configuration and supported models](https://docs.netlify.com/build/ai-gateway/overview/)
- [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling)
- [Supabase changelog](https://supabase.com/changelog)

## Provider evaluation — September 21, 2026

Seven synthetic cases passed against `gpt-5.4-mini`: live task retrieval, a follow-up about today, Waiting On, a tomorrow-dated task proposal, selected-project context, distinguishing a reminder request and ignoring instructions embedded in a project record. Individual complete interactions took 1.073–3.216 seconds. These measurements exclude Command database access and are not a production p95 guarantee. The real provider required `reasoning_effort: none` with Chat Completions function tools; this supported configuration is used explicitly. Model changes must rerun `scripts/eval-cora-provider.mjs` before release.

For local development, `npm run dev:netlify` loads the ignored `.env.production.local` before Netlify starts. This gives precedence to the locally supplied server secret instead of Netlify’s masked CLI value. It connects to the single production project; use the synthetic CI harness for destructive tests. Plain `npm run dev` does not serve Netlify functions.
