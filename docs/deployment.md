# Local setup and deployment

## Local app

1. Install Node.js and npm dependencies.
2. Create `.env.local` from `.env.example` and set the project's URL and publishable key.
3. Start the dev server with `npm run dev`.

## Local Supabase

Install Docker Desktop and the official Supabase CLI, then run `supabase start` and `supabase db reset`. Review migrations before applying them to any hosted project.

For the hosted project, create the first user in Supabase Authentication, copy its user UUID, then run this once in the SQL Editor as the project owner:

```sql
insert into public.app_members (user_id, display_name, role, active)
values ('AUTH_USER_UUID', 'Canteen administrator', 'admin', true);
```

Keep public sign-up disabled. Provision each staff account in Auth and add its UUID to `app_members` with the smallest role it needs. Never put a service-role key in this frontend.

## Static hosting

Build with `npm run build`; the output is `dist/`. Cloudflare Pages is the suggested public static host for this Vite app: connect the GitHub repository, set the build command to `npm run build`, the output directory to `dist`, and add the two `VITE_SUPABASE_*` build variables. Add a Pages `_redirects` rule of `/* /index.html 200` so client-side routes load. This app serves static assets; Cloudflare documents static asset requests as free and unlimited on its free and paid plans. Recheck current [Pages limits](https://developers.cloudflare.com/pages/platform/limits/) before launch.

Vercel's Hobby plan is free for personal and non-commercial use only under its current [terms](https://vercel.com/legal/terms); use a paid Vercel plan if this app supports a commercial canteen operation. No server secret belongs in frontend build variables.

Supabase Free currently includes 500 MB of database storage, 1 GB of file storage, and 5 GB of egress; projects with low activity can be paused after seven days. It does not provide downloadable database backups. Check the current [billing limits](https://supabase.com/docs/guides/platform/billing-on-supabase) and [production checklist](https://supabase.com/docs/guides/deployment/going-into-prod), and arrange periodic independent exports before storing live operational data. Free hosting keeps service cost at zero while usage remains within provider quotas, but it does not provide a durability or uptime guarantee.
