# Cora on Claude

Kevin's assistant now lives in Claude, where it is called **CMD**. It works on the web, in Claude Desktop and in Claude Code, and replaces the private ChatGPT agent and its schedules. It uses Kevin's existing HCPA Claude subscription: no Anthropic API account, no API key and no new vendor account. Command stays the source of truth, and its boundaries are unchanged: owner-only data, row-level security, reviewed edits and read-only Microsoft 365.

## The pieces

| Piece | Where | What it does |
| --- | --- | --- |
| **Command connector** | Claude custom connector → `https://cmd.hillspafl.gov/api/mcp` | Command's existing MCP tools: read every record kind, save authorized new records, prepare reviewed edits, read Outlook and Teams through Command, save brief receipts. |
| **Connector sign-in** | Supabase Auth OAuth 2.1 server + `cmd.hillspafl.gov/oauth/consent` | Kevin signs in with his normal Command account and approves Claude. No token to paste or rotate. |
| **CMD skill** | `.claude/skills/cmd/` (`SKILL.md`, `brief.md`) | The assistant's name in Claude is **CMD**. Voice, evidence and trust rules, Kevin's standing write authorizations, workflows (attention, meeting prep, capture, weekly review) and the on-request brief procedure. |
| **Claude Project** | claude.ai Project with the Command and Microsoft 365 connectors and the CMD skill | Where Kevin works with CMD: ask for a Command Brief, capture reminders and tasks, prep meetings. Everything is on request and in real time; nothing is scheduled. |

The Microsoft 365 connector already in Kevin's Claude can also be used for Outlook, Calendar and Teams. Command's own read-only Microsoft tools remain available through the Command connector.

## How sign-in works

1. Claude calls `/api/mcp` without credentials. Command answers `401` with `WWW-Authenticate: … resource_metadata="https://cmd.hillspafl.gov/.well-known/oauth-protected-resource"`.
2. That document (RFC 9728) names the authorization server: the Command Supabase project's `/auth/v1`. Claude registers itself there by dynamic client registration and starts the standard OAuth flow with PKCE.
3. Supabase sends Kevin to `https://cmd.hillspafl.gov/oauth/consent`. Command requires its normal sign-in and active membership, shows what the app can do, and allows **Allow** only when the return address is Claude's (`https://claude.ai/api/mcp/auth_callback`, `https://claude.com/api/mcp/auth_callback`) or a loopback address (Claude Code).
4. Claude receives a Supabase access token (1-hour, refreshable). On every call, `/api/mcp` verifies it with Supabase Auth. It requires a `client_id` claim, so an ordinary Command browser session is refused. It also requires active membership, and it re-checks after each tool before returning data.
5. Tool calls share the existing quota: 30 per minute and 1,000 per day per owner. They are audited in `cora_mcp_activity`, with the OAuth client ID as `connection_id`, and are included in workspace exports.

Revoke any signed-in app in **Command → Settings → Cora in connected apps**. Revoking membership stops everything. The previous personal token still works for scripted Claude Code use and is optional.

A limitation to note: a Supabase OAuth access token is a Supabase user token. Claude could in principle present it to Command's database API directly, where row-level security limits it to Kevin's own data, the same as his browser session. Command's MCP endpoint is the only place Claude is told to use it.

## Setup (in order)

Steps marked **Kevin** change production settings or accounts. Nothing in this change applied them.

1. **Kevin, Supabase dashboard** (Command project):
   - Authentication → OAuth Server: **enable**, Authorization Path `/oauth/consent`, **allow dynamic client registration**.
   - Authentication → URL Configuration: confirm Site URL is `https://cmd.hillspafl.gov`.
   - Authentication → JWT signing keys: asymmetric keys are recommended for OAuth. Check whether the project already uses them.
   - Apply migration `20260925160000_cora_mcp_oauth.sql`, which adds the server-only reservation function.
2. **Deploy** this branch after CI passes. It adds the consent page, the discovery document and OAuth support on `/api/mcp`.
3. **Kevin, Claude (org owner):** add a custom connector named "Command" with URL `https://cmd.hillspafl.gov/api/mcp`. Keep it limited to Kevin, if that option is available. Connect it, sign in to Command, choose **Allow**. Confirm Settings in Command lists it under Signed-in apps.
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
- Direct saves are limited to new reminders, tasks, people, projects, initiatives, journal entries and AI Lab records. Everything else is a review card that Kevin confirms in Command.
- A unit test keeps the brief rules in `brief.md` identical to Command's (`briefStyle`).
- Data sent to Claude is the same data the ChatGPT agent received (Command records, calendar and, when asked, mail and Teams excerpts), handled under HCPA's Claude organization agreement. Command conversation history is not synchronized with Claude chats.

## Rollback

Revoke the Claude connector in Command Settings and remove it from Claude. Turning off Supabase's OAuth server stops all connector sign-ins; the personal token keeps working. The added database function can stay. Do not delete audit or review history.

## Verification in this change

- `npm run check`: type checking, lint, unit and database tests including the new migration, and the build.
- Browser workflows (`npm run test:e2e`) and PWA tests (`npm run test:pwa`).
- New unit tests:
  - The 401 discovery header and metadata document.
  - OAuth access accepted and audited under its client ID.
  - Browser sessions, revoked grants and inactive members refused.
  - Consent return-address allowlist.
  - Skill brief rules matching Command.
- Not tested here:
  - A real Claude-to-Supabase sign-in, which needs the production OAuth server enabled.
  - Whether Claude sends an RFC 8707 `resource` parameter that Supabase accepts.

  Check these in setup steps 3–5.
