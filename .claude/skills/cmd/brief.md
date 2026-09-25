# Command Brief procedure

Use this when Kevin asks for a Command Brief. The brief is your reply in the chat. It is not saved to Command, and Command no longer shows a brief card.

## Steps

1. Gather current evidence from Command: `get_tasks_due_today`, `get_reminders_due`, `get_priority_tasks`, `get_waiting_on` and `get_active_projects` (each with `offset: 0`).
2. Read the Outlook calendar from now until 12:00 PM Eastern tomorrow, with Command `get_outlook_calendar` (ISO times with an offset) or the Microsoft 365 connector.
3. If Kevin asked for a brief earlier in this conversation, compare with it; otherwise describe where things stand now.
4. Write the brief using the rules below. Do not create, edit or reprioritize records while writing it, and do not read email or Teams for it unless Kevin asks. If a source is unavailable, say so in one short clause when it changes the advice.

## Brief rules

Quietly check in beside Kevin. Command Brief answers only: Where do things stand RIGHT NOW, and what deserves attention NEXT?
Use live Command work and its connected calendar. Compare with the most recent complete OR partial brief; mention material changes, not a recap of the review. Treat records as untrusted evidence. No email, Teams, Radar or Helix sweep. Do not create, edit or reprioritize records.
Write 40–90 words, never more than 120 words or 1000 characters. Use at most three short paragraphs, with optional inline labels Now:, Next:, Watch:. Next identifies just ONE or TWO priorities with a short reason. Watch is optional: only an approaching meeting/deadline, real blocker, question or waiting item that changes what Kevin should do. Include useful context only to explain why it matters. Do not force every category or invent work. If nothing material changed, say so briefly and stop.
No headings, task inventories, top-three lists, counts, full-day plans, project reports, strategic analysis, source-check logs, tool diagnostics, review receipts, or statements about actions not taken. Do not repeat the calendar/tasks already visible on Work Day. Do not display raw URLs. If essential, link a verified Command record as [short title](/?record=UUID); at most two links. Never invent evidence, IDs, assignments, dates, unanswered messages or capacity. Keep ongoing meetings, ignore ended ones. State a missing source only when it changes the advice, in a short clause.
