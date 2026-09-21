# Learning, AI Lab and private Library

Kevin authorized Phases 6 and 7 on September 21, 2026, continuing development while the earlier physical-device and five-workday pilot gates remain open. Implementation order is Learning/AI Lab, then Library. Kevin requested PDF, plain text and Office files.

## Phase 6

Learning records include provider, source URL, type, dates, progress, topic, takeaways, usefulness and HCPA applicability. AI Lab contains Program & governance, Use Cases and Experiments. Program records hold objectives, milestones, roadmap, current state, accomplishments, risks, upcoming work and governance references. Use cases follow Idea → Researching → Proposed → Approved → Pilot → Production, with Rejected and Retired available. Experiments hold hypothesis, tool/model version, setup, inputs, results, problems, conclusion and next action.

Links connect learning, programs, use cases, experiments, projects and Journal Decisions. Linked records must belong to the same active member and have the expected type. Decisions remain Journal entries; their originals and revisions are preserved. The new record types also receive immutable revision snapshots. Approval, pilot, production, rejection and retirement statuses require a decision rationale. These are tracking records, not organizational permission to process data.

Use Learning to save a course or source. In AI Lab → Experiments, link the learning source and record the test and outcome. Create a Journal Decision linked to the experiment; the experiment's Related work displays it. Program status, governance and upcoming work are manually maintained and remain available without AI.

## Phase 7

Create a Library record, set Public or Internal classification and category, add source/author/date/tags and relevant links, then open it to upload an original. Restricted information remains excluded under the existing approved-data boundary. Labels do not authorize storage of sensitive information.

Supported formats: PDF, UTF-8 TXT/MD/CSV/JSON, and macro-free DOCX/XLSX/PPTX. Maximum original size is **5 MiB**. Legacy Office formats, macro-enabled files, encrypted PDFs, PDF scripts/automatic actions/embedded content, Office embedded objects, external Office relationships and oversized archives are rejected. Office hyperlinks may therefore require removal or PDF export. Archives are bounded by entry count and expanded size; XML and package types are checked. Files are not sanitized or modified. These checks do not constitute antivirus scanning or guarantee a file is harmless; originals should be opened using managed HCPA applications and endpoint protection.

All files reside in a private Supabase Storage bucket with **no direct client Storage access**. A Supabase Edge Function validates the caller's live Auth identity and active membership and looks up the owned Library record before using its server-side Storage credential. Clients cannot insert or modify file-version metadata. The service streams a bounded request, validates file structure and content restrictions, computes SHA-256 and reserves an upload ID. Pending originals are unavailable for download until finalization. Invalid files are rejected before persistence; pending files are retained for retry, not automatically deleted.

Every new upload is a separate immutable original version. Retrying the same ID/content reconciles a lost acknowledgement or object-success/metadata-failure state. Reusing that ID with different content fails. The browser keeps retry metadata, not file bytes; after a reload, reselect the original. Pending versions remain visible with a recovery action. Progress distinguishes transfer from server validation. Archiving a record preserves its originals and links. Downloads verify size and hash, return attachment/octet-stream with no-store/nosniff headers, and use no signed URL or inline document preview. No OCR, extraction, embedding, AI processing or Office execution occurs.

## Validation and acceptance

Local checks cover types, lint, build, record authorization, progress/decision constraints, source links, revisions, file size/type/structure limits, PDF actions, Office external relationships/macros, archive expansion, and unauthenticated function access. Browser tests cover learning → experiment → decision, upload failure/reload/retry and download, plus existing authentication/draft/PWA flows. The client bundle remains approximately 141 KiB gzip, below the 190 KiB budget; validators load only on the server.

The disposable Supabase CI test exercises real Auth, REST, private Storage and the deployed-local Edge Function. It verifies owner isolation, revoked membership, direct Storage bypass denial, supported file types, original immutability and idempotency. It simulates an object saved before metadata finalization, then reconciles it. The restore drill independently backs up original bytes and version metadata, removes the synthetic originals from the local stack, restores them and verifies SHA-256 and project/learning links. No production files or identities are used in this drill.

Actual Mini/iPhone acceptance, HCPA network latency and Kevin's own complete learning-to-experiment-to-decision example remain acceptance tasks. The five-workday pilot and independent operational backup ownership/destination are not implied complete by CI. No production-device latency is inferred from local measurements.

## File recovery and operations

Supabase database backups do not include Storage file contents ([Supabase backup guidance](https://supabase.com/docs/guides/platform/backups)). Back up the database and the private bucket separately, at a coordinated point. Preserve each file at `user_id/document_id/version_id`, the `library_versions` metadata (including SHA-256), linked `work_items`, membership identifiers and revision history. Encrypt and restrict the independent backup destination; keep filenames, file contents and credentials out of operational logs.

For an isolated recovery drill, use the CI local stack and `scripts/test-local-auth.mjs`, which calls `scripts/test-library-local.mjs`. It refuses non-local Supabase endpoints. For actual recovery, Kevin coordinates an isolated restored database and private bucket, preserves identifiers, restores linked work before version rows, uploads original bytes using a server-side administrator client, and verifies every hash and authorized/unauthorized download before cutover. Do not test destructive restoration in production. Review pending versions before cleanup; do not delete a pending object just because finalization failed. No automated retention purge is installed.

Deploy the two migrations in order, deploy the authenticated Library Edge Function, check security advisors, then publish the UI through the main branch. On UI rollback, retain the additive schema and files and republish the previous Netlify deployment. Retain or roll back the function version separately; never remove original files as an application rollback.

Implementation references: [Storage access control](https://supabase.com/docs/guides/storage/security/access-control), [Edge Function authentication](https://supabase.com/docs/guides/functions/auth), [private file downloads](https://supabase.com/docs/reference/javascript/storage-from-download).

## Release evidence — September 21, 2026

[Release CI](https://github.com/kmazur-HCPA/HCPA-Command/actions/runs/35607080719) passed: 68 unit/database tests, 22 browser tests, two built-PWA tests, 23 native pgTAP assertions, real Auth/REST/Storage/Edge Function checks, and the isolated original-file recovery drill. Production migrations are `20260921134309` and `20260921134325`; Library function version 1 is active with JWT verification enabled. Production CORS preflight passed. The post-migration security advisor returned no findings. Performance notices are informational: [unused indexes](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index) on new/low-use paths and the existing [Auth connection allocation](https://supabase.com/docs/guides/deployment/going-into-prod). Review these after representative pilot use rather than removing access-path indexes prematurely.
