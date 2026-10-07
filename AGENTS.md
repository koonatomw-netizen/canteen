# Project instructions

## Source of truth and scope

- Read `CANTEEN_TRACKING_SYSTEM_SPEC.md` before changing behavior. It is the product authority; this file controls implementation practice.
- Implement the seven Phase 1 milestones in the order documented in the spec. Do not add out-of-scope accounting, ingredients, POS, OCR, supplier, or revenue features.
- Keep the interface readable for busy, non-technical staff, with large touch targets and a usable phone layout.
- Use `Asia/Bangkok` for business-date decisions and `THB` for money. Treat database `DATE` values as calendar dates, not UTC instants.

## Data integrity and security

- Stock is a ledger derived by batch. Never force FIFO, permit negative stock, or turn expiry into waste without staff confirmation.
- Write a stock movement and its source record in one database transaction. Do not add a second, independently editable stock balance.
- Important business edits and soft deletes must be auditable. Preserve before/after values and never edit or delete audit events from the app.
- All tables in exposed schemas need deliberate grants and RLS. All photo buckets must be private and have RLS policies. Use only a publishable key in browser code; never expose a service/secret key.
- Do not add client-side direct deletion for operational records. Use soft deletion or a reviewed reversal flow.
- Do not apply migrations to a hosted project or deploy the app unless the user explicitly asks for that external action.

## Implementation

- Keep workflow code under `src/features/<workflow>/`; shared primitives belong in `src/components/`; date and stock calculations belong in `src/lib/` and must be deterministic.
- Validate user-entered values at the app boundary and enforce business invariants again in Postgres.
- Use parameterized Supabase client queries and reviewed SQL migrations. Do not fabricate test data in a live project.
- Keep credentials in ignored local environment files. Maintain `.env.example` with names only.
- Preserve the existing product spec. Propose changes when a decision materially affects stock, reconciliation, or money.
- Do not report production deployment, live Supabase setup, visual acceptance, or manual kitchen testing without evidence for each.

## Verification

- Run the focused stock/date rules tests and a production build after implementation changes.
- Exercise SQL migrations against a disposable local Supabase database when Docker and the CLI are available. If they are unavailable, state that clearly and keep all SQL reviewable.
- Required workflow coverage includes multiple batches, carried stock, batch-specific waste, expiry, closing discrepancy, negative-stock prevention, receipt access, and soft-delete/audit behavior.
