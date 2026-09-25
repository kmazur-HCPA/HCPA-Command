# Cora in ChatGPT

> **Superseded September 2026.** Cora now runs on Claude inside Command, and the ChatGPT agent is retired. See [Cora on Claude](CORA-CLAUDE.md). This page is kept as a delivery record.

Cora’s private ChatGPT agent uses the same Command tools and Microsoft connection as the website. Command remains the source of truth. ChatGPT conversations do not automatically appear in Command; task proposals do, with an explicit Add task review card.

## Connection

- MCP endpoint: `https://cmd.hillspafl.gov/api/mcp` (stateless Streamable HTTP, official TypeScript SDK).
- ChatGPT agent builder: custom app, **Access token / API key**, **Bearer**. This option was verified in the HCPA_IT agent builder on September 21, 2026.
- Create the personal token in Command → Settings → Cora in ChatGPT. Enter it directly in the private app’s authentication dialog. Never put it in agent instructions, URLs, source control, chats or environment screenshots.
- One token per Command owner; 90-day expiry. Replacing or revoking it immediately invalidates the previous token. Membership revocation removes it as well. A token cannot sign in to Command, access Supabase directly, manage credentials, send messages or save work.
- Only a SHA-256 digest of a random 256-bit token is stored. Microsoft credentials stay encrypted server-side. No new Entra registration, Supabase project, OAuth server, or AI API key is needed.

The agent instructions are maintained in the former ChatGPT agent instructions (removed; see git history). Keep the agent and app private. The verified connection uses the agent-owned account option; do not share this agent with other people while it carries Kevin’s connection. Switch to end-user accounts and verify each user’s authorization before any future sharing. No schedules or autonomous triggers are configured.

## Tools and boundaries

Six Command readers cover open tasks, due/overdue tasks, priorities, active projects, project details and Waiting On. Outlook tools read the default calendar, search mail and read selected messages. Teams tools search messages, list recent chats and read selected chats/messages. These reuse the existing readers and their limits. This release does not add Library attachment reading, general record editing or message sending.

Microsoft references are encrypted, expire after 20 minutes and are bound to the owner, MCP credential and Microsoft connection generation. Discovery and subsequent reads work across separate HTTP requests. No mailbox/chat content is persisted by the MCP bridge. Tool results returned to ChatGPT are handled as part of that ChatGPT conversation.

`prepare_task` creates a reviewable Cora turn, not a work item. A stable request UUID reconciles retries. Its link opens the owner’s existing Command session and Add task control. The MCP credential cannot call the task-save endpoint. Chat approval alone cannot bypass this boundary.

Every read uses the token’s owner; caller-supplied owner IDs are rejected. Membership and credential validity are checked before and after tool execution. Microsoft connection generation is also checked after each read. The database serializes tool reservations and enforces 30 calls/minute and 1,000/day per owner; token replacement does not reset quotas. Proposal creation also observes existing Cora quotas.

## Operations and recovery

Kevin Mazur coordinates this connection. Settings shows expiry and last use, and offers replacement/revocation. After replacement, update the private ChatGPT app’s credential. Revoking Command access or disconnecting Microsoft takes effect on subsequent tool calls. Existing conversations and audit records remain.

`cora_mcp_activity` records owner, credential ID, tool name, success and time; logs record duration and request ID. Arguments, tokens and Microsoft message bodies are not logged by the bridge. Activity is included in owner workspace exports. Credential hashes are excluded. Recover credentials by reconnecting, not restoring or exporting them.

If a call fails, distinguish expired/revoked Command tokens, Microsoft disconnection, Teams consent, expired discovery references and quota limits. Re-search after a reference expires. Never repair by giving ChatGPT a Supabase secret or Microsoft client secret.

Rollback: revoke the ChatGPT token and remove the private app from the agent. The Command website and Microsoft integration remain usable. A code rollback can leave the additive tables in place; do not delete audit/proposal history to roll back the integration.

## Verification

Local validation covers MCP negotiation/tool discovery, token and membership rejection, owner filters, schema rejection, task-proposal retry identity, absence of work writes, reference isolation/expiry, database permissions/quotas, exported audit ownership, credential controls and explicit task confirmation. PWA checks ensure authenticated API responses remain uncached. Production deployment and live-agent verification are recorded below.

## Release evidence — September 21, 2026

- Application commit: `5ac99c8efb5fd0ca7a5d3268e2205fd4d32bb625`.
- Production Netlify deploy: `6ab16ce0b186a0000862147f`, published 17:44 UTC.
- Supabase migration `cora_chatgpt_mcp` applied successfully (hosted migration version `20260921174240`; source file `20260921173141_cora_chatgpt_mcp.sql`).
- [CI run 35633877773](https://github.com/kmazur-HCPA/HCPA-Command/actions/runs/35633877773) passed application and disposable Supabase checks. The suite includes 120 unit/database tests, 31 browser workflows, two PWA tests, native Auth/PostgREST and recovery validation. Dependency audit: no reported vulnerabilities. Compressed JS/CSS: 163 KiB against the 190 KiB budget.
- [Cora agent](https://chatgpt.com/agents/a/agt_6ab1695d307081919f999a6dd9c2f9c6) created in HCPA_IT with the checked-in instructions. Kevin connected the private Command Cora app (`asdk_app_6ab16d7fd6788191ae60c4b5fdfabab6`); the agent update was saved and the preview confirms “Private to you.”

Live verification completed at 17:53 UTC through the ChatGPT agent: `get_my_tasks`, `get_outlook_calendar`, `search_outlook_mail`, `read_outlook_message`, `list_teams_chats`, `read_teams_chat`, `search_teams_messages`, and `read_teams_message` all recorded successful server-side audits. Selected Outlook and Teams reads used references discovered in earlier HTTP calls. The agent reported successful bounded reads without quoting message contents. No task proposal, work item, message or schedule was created during the live check. Unauthenticated production MCP requests return HTTP 401.

The initial connection expires December 20, 2026. Renew it in Command Settings and update the private ChatGPT app credential before continuing after expiry. No secret or token value is included in this delivery record.
