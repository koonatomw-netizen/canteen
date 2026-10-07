# Architecture

The application is a React and TypeScript single-page app built to static assets by Vite. Supabase Auth supplies staff identity, Postgres holds operational records and stock movements, and a private Storage bucket holds optional receipt and waste photos.

The browser uses only a Supabase publishable key. Postgres row-level security restricts exposed tables to provisioned canteen members; the application never relies on a hidden frontend route as authorization. Important writes use database functions/triggers so source records, stock changes, and audit events commit together.

`stock_movements` is the source for each batch's remaining quantity. Production adds stock, waste removes it, closing records inferred sales, and a justified adjustment records any difference. The batch view derives current quantities from that ledger. A physical count cannot reveal why stock disappeared, so unrecorded loss may be indistinguishable from a sale.

Business dates are stored as PostgreSQL `DATE` values and interpreted in `Asia/Bangkok`. Timestamps use `timestamptz`. Monetary amounts use PostgreSQL `NUMERIC(12,2)` in Thai baht so the database stores decimal currency exactly.
