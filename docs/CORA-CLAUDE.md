# Cora on Claude

Kevin's assistant now lives in Claude, where it is called **CMD**. It works on the web, in Claude Desktop and in Claude Code, and replaces the private ChatGPT agent and its schedules. It uses Kevin's existing HCPA Claude subscription: no Anthropic API account, no API key and no new vendor account. Command stays the source of truth, and its boundaries are unchanged: owner-only data, row-level security, reviewed edits and read-only Microsoft 365.

## The pieces

| Piece | Where | What it does |
| --- | --- | --- |
| **Command connector** | Claude custom connector → `https://cmd.hillspafl.gov/api/mcp` | Command's existing MCP tools: read every record kind, save authorized new records, prepare reviewed edits, read Outlook and Teams through Command, save brief receipts. |
| **Connector sign-in** | Command's own OAuth 2.1 server (`/api/oauth/*`) + `cmd.hillspafl.gov/oauth/authorize` | Kevin signs in with his normal Command account and approves Claude. No token to paste or rotate, and no dependence on Supabase Auth token refresh or the browser session time box. |
| **CMD skill** | `.claude/skills/cmd/` (`SKILL.md`, `brief.md`) | The assistant's name in Claude is **CMD**. Voice, evidence and trust rules, Kevin's standing write authorizations, workflows (attention, meeting prep, capture, weekly review) and the on-request brief procedure. |
| **Claude Project** | claude.ai Project with the Command and Microsoft 365 connectors and the CMD skill | Where Kevin works with CMD: ask for a Command Brief, capture reminders and tasks, prep meetings. Everything is on request and in real time; nothing is scheduled. |

The Microsoft 365 connector already in Kevin's Claude can also be used for Outlook, Calendar and Teams. Command's own read-only Microsoft tools remain available through the Command connector.

## How sign-in works

1. Claude calls `/api/mcp` without credentials. Command answers `401` with `WWW-Authenticate: … resource_metadata="https://cmd.hillspafl.gov/.well-known/oauth-protected-resource"`.
2. That document (RFC 9728) names Command itself as the authorization server. `/.well-known/oauth-authorization-server` (RFC 8414) lists the endpoints. Claude registers by dynamic client registration (`/api/oauth/register`; public clients, and only Claude callback addresses are accepted) and starts the standard authorization-code flow with PKCE (S256).
3. Claude sends Kevin to `https://cmd.hillspafl.gov/oauth/authorize`. Command requires its normal sign-in and active membership, shows what the app can do and allows **Allow** only when the return address is one registered by the client and is Claude's (`https://claude.ai/api/mcp/auth_callback`, `https://claude.com/api/mcp/auth_callback`) or a loopback address (Claude Code). Approval creates a single-use code that lives five minutes.
4. Claude exchanges the code at `/api/oauth/token` and receives Command's own tokens: a one-hour access token (`cmd_at_…`) and a rotating refresh token (`cmd_rt_…`). Only SHA-256 digests are stored. The refresh window slides 90 days from each use, capped at one year from approval, so a connection that is used stays connected without reauthorizing. The three newest refresh tokens stay valid, so a lost response or parallel refresh never strands the client.
5. On every call, `/api/mcp` verifies the access token in one database call: live token, live grant, active membership. It re-checks after each tool before returning data. A Command browser session or a Supabase token is refused. The token cannot reach Command's database API, only the MCP endpoint.
6. The token endpoint returns `invalid_grant` only when a grant is definitely invalid (revoked, expired, wrong code). Database trouble returns `503 temporarily_unavailable`, which clients retry instead of asking Kevin to reconnect.
7. Tool calls share the existing quota: 30 per minute and 1,000 per day per owner. They are audited in `cora_mcp_activity`, with the grant ID as `connection_id`, and are included in workspace exports.

Revoke any connected app in **Command → Settings → Cora in connected apps**, which also shows when each was last used. Revoking membership stops everything. The personal token still works for scripted Claude Code use and is optional.

## Setup (in order)

Steps marked **Kevin** change production settings or accounts. Nothing in this change applied them.

1. **Apply migration** `20260929120000_command_oauth_server.sql` to the Command Supabase project. It adds the OAuth tables and server-only functions. Supabase's own OAuth Server setting is no longer used and can stay off.
2. **Deploy** after CI passes. It adds the OAuth endpoints, the authorize page and the discovery documents.
3. **Kevin, Claude (org owner):** add a custom connector named "Command" with URL `https://cmd.hillspafl.gov/api/mcp`. Keep it limited to Kevin, if that option is available. Connect it, sign in to Command, choose **Allow**. Confirm Settings in Command lists it under Signed-in apps. If Claude still shows the old connection, remove the connector and add it again.
4. **Kevin, Claude:** upload the skill. Remove any older "cora" skill first. Zip the folder (`cd .claude/skills && zip -r ~/Desktop/cmd.zip cmd`) and add it under Claude's Skills settings. Claude Code already picks it up inside this repository.
5. **Test in Claude:** "CMD, what needs my attention today?", "Remind me tomorrow to follow up on the website" (check Reminders in Command), and "Give me my Command Brief."
6. **Create a Claude Project** (for example "Command") with the Command and Microsoft 365 connectors enabled and the CMD skill on. Optionally add a one-line project instruction: "You are CMD; use the cmd skill."
7. **Retire ChatGPT:** delete the five ChatGPT automations and the private Command Cora app/agent, then revoke the old ChatGPT token in Command Settings (Personal token → Revoke).

## Inside Command

Command is the data side: records, Work Day, the Outlook calendar panel and Settings.
- **Work Day:** four count cards in one row, then Tasks, with Calendar, Reminders and Waiting On alongside. The Command Brief card was removed; briefs are requested from CMD in Claude and answered in the chat.
- **Calendar panel:** shows today through Friday. On weekends it shows the coming work week. It previously started on Monday, so earlier days could use up the 75-entry limit before today's events loaded.
- **Automatic reminders** in Settings is the standing consent for CMD to save the reminders you ask for without a confirmation card. Pausing it blocks those saves from every connected app.
- **Cora panel inside Command:** it needs model access for Command's own server, which is not configured, and now says to use CMD in Claude. The Claude API engine remains in the code, dormant without `ANTHROPIC_API_KEY`. Scheduled briefs were removed.

## Boundaries that did not change

- Microsoft 365 is read-only: no sending, replying, accepting or changing meetings.
- Direct saves are limited to new reminders, tasks, people, projects, initiatives, journal entries and AI Lab records, plus `quick_update`: complete or reopen a task, complete/dismiss/snooze a reminder, or change a due date. `quick_update` accepts only `status`, `due_date` and `snoozed_until`, refuses a stale record version so it can never overwrite an edit Kevin made, and returns an `undo` payload. Everything else is a review card that Kevin confirms in Command.
- `get_day_snapshot` returns the attention picture (due and overdue tasks, due reminders, priorities, Waiting On, active projects) in one audited call. The connector also offers prompts: Command Brief, Meeting prep, Weekly review and Capture notes.
- A unit test keeps the brief rules in `brief.md` identical to Command's (`briefStyle`).
- Data sent to Claude is the same data the ChatGPT agent received (Command records, calendar and, when asked, mail and Teams excerpts), handled under HCPA's Claude organization agreement. Command conversation history is not synchronized with Claude chats.

## Rollback

Revoke the Claude connector in Command Settings and remove it from Claude. The personal token keeps working. The added database objects can stay. Do not delete audit or review history.

## Verification in this change

- `npm run check`: type checking, lint, unit and database tests including the new migration, and the build.
- New tests: registration and redirect allowlist, consent origin/session/PKCE checks, code single-use and burn-on-failure, refresh rotation with lost-response tolerance, sliding and absolute lifetimes, membership revocation, registration cap, and retryable outage handling.
- Not tested here: a real Claude-to-Command sign-in on claude.ai, Claude Desktop and Claude Code. Check it in setup steps 3–5. Claude sends an RFC 8707 `resource` parameter; Command accepts it only when it names Command.
