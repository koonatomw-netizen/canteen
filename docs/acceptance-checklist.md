# Phase 1 acceptance checklist

This checklist records end-to-end acceptance, not whether a screen or database function has been implemented. Check an item only after exercising it with a disposable Supabase project and the app.

Verified in this workspace: `npm run build` and the focused Vitest business-rule suite. The database migration and full operational workflow still need a local Supabase run; Docker is installed but its daemon is unavailable in this environment, and the Supabase CLI is not installed.

- [ ] Staff can sign in; unprovisioned accounts cannot read or write canteen data.
- [ ] Manage menus, stores, categories, and app settings.
- [ ] Create distinct production batches with suggested and editable expiry.
- [ ] Carry multiple batches across business days and see expiry statuses.
- [ ] Record batch-specific waste and reject more than available stock.
- [ ] Close a day from physical batch counts, derive sold, and require a reason for positive stock adjustments.
- [ ] Reopen a day with an audit event; prevent duplicate closing movements.
- [ ] Add expenses and upload/read optional photos from a private bucket.
- [ ] Review dashboard, reports, and activity history; export core records as CSV.
- [ ] Soft-delete and restore supported records without corrupting stock.
- [ ] Complete common daily actions on phone and desktop with clear validation and error feedback.
- [ ] Run focused tests, production build, and local database checks.
