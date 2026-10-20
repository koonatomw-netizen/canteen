begin;
select plan(16);

select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.app_members'::regclass), 'app_members has RLS');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.menu_items'::regclass), 'menu_items has RLS');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.stores'::regclass), 'stores has RLS');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.expense_categories'::regclass), 'expense_categories has RLS');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.expenses'::regclass), 'expenses has RLS');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.production_batches'::regclass), 'production_batches has RLS');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.daily_closings'::regclass), 'daily_closings has RLS');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.stock_movements'::regclass), 'stock_movements has RLS');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.waste_records'::regclass), 'waste_records has RLS');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.activity_logs'::regclass), 'activity_logs has RLS');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.waste_reasons'::regclass), 'waste_reasons has RLS');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.stock_out_reasons'::regclass), 'stock_out_reasons has RLS');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.post_close_stock_outs'::regclass), 'post_close_stock_outs has RLS');
select ok(not has_table_privilege('anon', 'public.expenses', 'SELECT'), 'anonymous users cannot read expenses');
select ok(not has_table_privilege('anon', 'public.post_close_stock_outs', 'SELECT'), 'anonymous users cannot read post-close removals');
select ok(not has_function_privilege('anon', 'public.reopen_canteen_day(date,text)', 'EXECUTE'), 'anonymous users cannot call the reopen function');

select * from finish();
rollback;
