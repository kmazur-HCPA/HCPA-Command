# People directory

People retains existing work-item IDs, notes, organization, job title, and related records. Email, phone, mobile, department, and location are stored in validated contact details and included in global search. The directory searches all contact fields and notes, lists contacts alphabetically, and loads 50 at a time. Archived contacts are available through the View selector.

Use **People → Import CSV** to download the template, select a UTF-8 file, and review it before importing. The importer accepts up to 500 contacts and 2 MB per file, including common Outlook column aliases and quoted multiline notes. Invalid rows and matches by email or name plus organization are excluded. Matches include archived contacts. Imports add records only; edit existing contacts individually.

The server validates the complete batch, uses existing owner-scoped permissions and audit triggers, and commits atomically. Stable record IDs make a retry safe if the acknowledgement is lost. Existing matches are never overwritten. No uploaded CSV is stored separately.

Cora can create contacts with the new detail fields using its existing create_record tool. Existing-record edits retain the established review workflow.

Validation: 150 unit/database tests and 35 browser tests passed, including isolation, atomic rollback, duplicate matching, lost acknowledgement retry, mobile overflow, and automated accessibility checks.

Rollback: revert the application commit if needed; the additive database functions and indexes can remain. Preserve contact details and do not restore the older detail-validation trigger while contacts use these fields.
