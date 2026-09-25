# Cora on Claude

Cora now lives in Claude, on the web, in Claude Desktop and in Claude Code, and replaces the private ChatGPT agent. It uses Kevin's existing HCPA Claude subscription: no Anthropic API account, no API key and no new vendor account. Command stays the source of truth, and its boundaries are unchanged: owner-only data, row-level security, reviewed edits and read-only Microsoft 365.

## The pieces

| Piece | Where | What it does |
| --- | --- | --- |
| **Command connector** | Claude custom connector → `https://cmd.hillspafl.gov/api/mcp` | Command's existing MCP tools: read every record kind, save authorized new records, prepare reviewed edits, read Outlook and Teams through Command, save brief receipts. |
| **Connector sign-in** | Supabase Auth OAuth 2.1 server + `cmd.hillspafl.gov/oauth/consent` | Kevin signs in with his normal Command account and approves Claude. No token to paste or rotate. |
| **Cora skill** | `.claude/skills/cora/` (`SKILL.md`, `brief.md`) | Cora's voice, evidence and trust rules, Kevin's standing write authorizations, routines (attention, meeting prep, capture, weekly review) and the brief procedure. |
| **Brief routines** | Claude Code routines (Anthropic cloud) | Run the Command Brief on weekdays at 6:45 AM, 9 AM, 11 AM, 1 PM and 3 PM Eastern and save it to Work Day. They run while Kevin's computer is off. |

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
4. **Kevin, Claude:** upload the skill. Zip the folder (`cd .claude/skills && zip -r ~/Desktop/cora.zip cora`) and add it under Claude's Skills settings. Claude Code already picks it up inside this repository.
5. **Test in Claude:** "What needs my attention today?", "Remind me tomorrow to follow up on the website" (check Reminders in Command), and "Update my Command Brief" (check Work Day).
6. **Create the brief routines** in Claude Code (`/schedule`), weekdays. Suggested routine prompt: *"Use the cora skill. Run the scheduled Command Brief procedure in .claude/skills/cora/brief.md now, using the Command connector."* Check each of these when creating them:
   - The routine can use the Command connector.
   - Times are Eastern and stay correct across daylight-saving changes. Routines may convert times to UTC, so recheck in November and March.
   - The routine run allowance covers 25 runs a week.
   Two routines can cover the slots: 6:45 AM, and 9, 11, 1 and 3 on the hour.
7. **Retire ChatGPT:** delete the five ChatGPT automations and the private Command Cora app/agent, then revoke the old ChatGPT token in Command Settings (Personal token → Revoke).
8. **Verify** the first scheduled receipt in Settings → Cora workday reviews.

## Inside Command

- The Command Brief card, review history and the pause switch are unchanged. Pausing reviews in Settings makes Command reject brief receipts and automatic reminders from every connected app.
- The Cora panel and Update brief button inside Command need model access for Command's own server, which is not configured. They now say to use Cora in Claude. The Claude API engine and scheduled brief writer from the first part of this change stay dormant in the code (`netlify/functions/_shared/cora/`, `netlify/functions/cora-brief.ts`). They do nothing without `ANTHROPIC_API_KEY`. If model access is approved later, turn off the Claude routines first so briefs aren't written twice.

## Boundaries that did not change

- Microsoft 365 is read-only: no sending, replying, accepting or changing meetings.
- Direct saves are limited to new reminders, tasks, people, projects, initiatives, journal entries and AI Lab records. Everything else is a review card that Kevin confirms in Command.
- Brief receipts must pass Command's compact-brief rules (`isCompactBrief`). A unit test keeps `brief.md` identical to Command's rules.
- Data sent to Claude is the same data the ChatGPT agent received (Command records, calendar and, when asked, mail and Teams excerpts), handled under HCPA's Claude organization agreement. Command conversation history is not synchronized with Claude chats.

## Rollback

Revoke the Claude connector in Command Settings and remove it from Claude, and delete or pause the routines. Turning off Supabase's OAuth server stops all connector sign-ins; the personal token keeps working. The added database function can stay. Do not delete audit or review history.

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
  - Routine connector access and daylight-saving handling.

  Check these in setup steps 3–6.
