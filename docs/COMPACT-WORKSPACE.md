# Compact workspace — September 22, 2026

Work Day places Waiting On immediately below Reminders on desktop and mobile. Its task panel lists all open, unarchived tasks grouped by project in a bounded scroll region. It loads 50 records initially and offers Load more inside the panel; later pages are not silently omitted. Chosen priorities remain in Focus Today.

Tasks, Projects, People, Journal, Initiatives, Learning, Library and the AI Lab sections use the same compact row layout. Circular completion controls save through the existing version-checked record API. Tasks default to Open tasks; completed work is available through the status filter. Secondary actions remain in each row's More actions menu.

Up/down controls reorder tasks within their project and reorder projects, including the visible project groups on Tasks and Work Day. Ordering is persisted in Supabase and shared across devices. New records append to the saved order. Filters retain the saved order of matching records; arrows exchange positions with the previous/next loaded matching record. Load more to reach additional records. Archived projects keep their task grouping but cannot be reordered until restored.

The additive sort_order column uses a database sequence. swap_work_order locks both records in a consistent order, checks owner, kind, project, archive state and expected versions, then swaps their positions in one transaction under existing RLS. Existing audit/version triggers apply. Editors omit sort_order so ordinary edits cannot reset the order. Exports include the column automatically. Initial backfill preserves newest-first ordering and increments record versions through existing triggers; already-open stale drafts follow the existing conflict flow.

Validation: 133 unit/database tests; browser coverage for completion failures/retries, persisted task/project ordering, pagination, iPad/mobile layout and populated-list accessibility. Rollback: revert the frontend commit while retaining the additive column, sequence and function. No records need deletion or conversion.
