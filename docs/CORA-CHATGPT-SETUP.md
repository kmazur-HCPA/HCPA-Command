# Cora in ChatGPT

Cora’s private ChatGPT agent uses the same Command tools and Microsoft connection as the website. Command remains the source of truth. ChatGPT conversations do not automatically appear in Command; task proposals do, with an explicit Add task review card.

## Connection

- MCP endpoint: `https://cmd.hillspafl.gov/api/mcp` (stateless Streamable HTTP, official TypeScript SDK).
- ChatGPT agent builder: custom app, **Access token / API key**, **Bearer**. This option was verified in the HCPA_IT agent builder on September 21, 2026.
- Create the personal token in Command → Settings → Cora in ChatGPT. Enter it directly in the private app’s authentication dialog. Never put it in agent instructions, URLs, source control, chats or environment screenshots.
- One token per Command owner; 90-day expiry. Replacing or revoking it immediately invalidates the previous token. Membership revocation removes it as well. A token cannot sign in to Command, access Supabase directly, manage credentials, send messages or save work.
- Only a SHA-256 digest of a random 256-bit token is stored. Microsoft credentials stay encrypted server-side. No new Entra registration, Supabase project, OAuth server, or AI API key is needed.

The agent instructions are maintained in [CORA-CHATGPT-INSTRUCTIONS.md](CORA-CHATGPT-INSTRUCTIONS.md). Keep the agent and app private. No schedules or autonomous triggers are configured.

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

Local validation covers MCP negotiation/tool discovery, token and membership rejection, owner filters, schema rejection, task-proposal retry identity, absence of work writes, reference isolation/expiry, database permissions/quotas, exported audit ownership, credential controls and explicit task confirmation. PWA checks ensure authenticated API responses remain uncached. Exact production deployment and live-agent verification are recorded below when completed.
