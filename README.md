# Canteen Tracking System

A small, mobile-friendly daily operations app for food-box production, batch stock, expiry attention, waste, kitchen closing, expenses, and activity history. The product scope and business rules are defined in [CANTEEN_TRACKING_SYSTEM_SPEC.md](./CANTEEN_TRACKING_SYSTEM_SPEC.md).

## Stack

- React, TypeScript, and Vite for a static-hostable web app.
- Supabase Auth, Postgres, and private Storage for staff access, operational records, and optional photos.
- Bangkok business dates (`Asia/Bangkok`) and Thai baht (`THB`).

The frontend is built as a static site, so it can be hosted on a free static-hosting plan. The Supabase Free plan is intended for small projects and has finite database, storage, and transfer allowances; projects can pause after inactivity and do not include automatic backups. A production canteen should keep independent backups. Vercel Hobby is restricted to personal, non-commercial use, so check the hosting provider's current terms before deploying a business tool.

## Requirements

- Node.js 20.19+ or 22.12+.
- npm.
- A Supabase project for a connected installation. Local UI work can run without one and shows the setup screen.

## Run locally

```powershell
npm install
Copy-Item .env.example .env.local
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env.local`, then run:

```powershell
npm run dev
```

Use a Supabase **publishable** key in the browser. Never place the `service_role` or secret key in a `VITE_` environment variable. Database migrations live in `supabase/migrations/` and can be applied with the Supabase CLI after reviewing the SQL.

For local backend development, install Docker Desktop and the Supabase CLI, then run `supabase start` and `supabase db reset`. Staff can submit an account request from the sign-in screen. New accounts start inactive as Front staff and cannot access canteen records until a Website Admin assigns the right role and activates them. For a hosted project, enable email signups in Supabase Auth before staff can request accounts.

If a project has no Website Admin yet, use the Supabase SQL Editor once to activate the owner’s existing Auth account. Replace the placeholder with that account’s email:

```sql
update public.app_members
set role = 'admin', active = true
where lower(email) = lower('YOUR_EMAIL');
```

After that, manage staff and permissions from **Manage → Users**. The app never exposes a Supabase service or secret key in the browser.

## Staff access

- **Front:** Production, Stock, Waste, Daily Closing, and read-only Expenses.
- **Kitchen:** Expenses, including edits and additional receipt photos after the day closes.
- **Manager:** Dashboard and Reports only; managers can review stock and expense analysis but cannot change operations.
- **Website Admin:** All screens, staff roles, menus, meat options, stores, categories, reason lists, and audited corrections such as reopening a closing with a reason.

Food taken after closing is recorded from **Waste → Taken after closing**. It reduces the selected batch’s stock and appears separately from discarded-food waste and waste-rate calculations.

## Daily workflows

1. Add menu items and stores in **Manage**.
2. Record production batches. Expiry defaults from the menu shelf life and can be changed.
3. Review stock by batch and expiry status. Expired stock needs a staff decision; it never becomes waste automatically.
4. Record waste against the batch it came from. The database prevents waste from exceeding available stock.
5. At kitchen close, count every remaining batch. The app calculates sold quantity from the count and stock ledger. If counted stock exceeds expected stock, staff record the adjustment reason.
6. Kitchen staff add or correct expenses and optional receipt photos at any time. Managers review reports and export CSV files; Website Admins can review the audit history.

Sold quantity is inferred from stock movements and the physical count. An unrecorded loss can therefore look like a sale; record known staff meals, complimentary food, or other losses before closing.

## Project commands

```powershell
npm run dev       # local development server
npm run build     # TypeScript and production build
npm run test      # business-rule unit tests
npm run preview   # serve a production build locally
```

## Project map

```text
src/features/     daily workflows and management screens
src/lib/          Supabase client, date/stock helpers, shared data access
src/components/   reusable navigation, forms, status badges, and feedback
supabase/         database configuration, migrations, seed, and SQL checks
docs/             architecture, data rules, setup, deployment, and acceptance notes
```

## Scope

Phase 1 does not include ingredient inventory, recipe costing, accounting, POS integration, automatic receipt OCR, revenue/profit reporting, or historical spreadsheet import. Follow [AGENTS.md](./AGENTS.md) and the product specification before changing the scope.
