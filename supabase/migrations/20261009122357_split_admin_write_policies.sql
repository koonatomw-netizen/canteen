-- Keep administrative writes out of SELECT policy evaluation. In particular,
-- FOR ALL policies overlap the member-read policy and create duplicate SELECT
-- checks for otherwise read-only staff.

drop policy if exists menu_items_write_admin on public.menu_items;
drop policy if exists menu_items_insert_admin on public.menu_items;
drop policy if exists menu_items_update_admin on public.menu_items;
create policy menu_items_insert_admin on public.menu_items for insert to authenticated
  with check ((select app_private.has_app_role(array['admin'])));
create policy menu_items_update_admin on public.menu_items for update to authenticated
  using ((select app_private.has_app_role(array['admin'])))
  with check ((select app_private.has_app_role(array['admin'])));

drop policy if exists meat_options_write_admin on public.meat_options;
drop policy if exists meat_options_insert_admin on public.meat_options;
drop policy if exists meat_options_update_admin on public.meat_options;
create policy meat_options_insert_admin on public.meat_options for insert to authenticated
  with check ((select app_private.has_app_role(array['admin'])));
create policy meat_options_update_admin on public.meat_options for update to authenticated
  using ((select app_private.has_app_role(array['admin'])))
  with check ((select app_private.has_app_role(array['admin'])));

drop policy if exists stores_write_admin on public.stores;
drop policy if exists stores_insert_admin on public.stores;
drop policy if exists stores_update_admin on public.stores;
create policy stores_insert_admin on public.stores for insert to authenticated
  with check ((select app_private.has_app_role(array['admin'])));
create policy stores_update_admin on public.stores for update to authenticated
  using ((select app_private.has_app_role(array['admin'])))
  with check ((select app_private.has_app_role(array['admin'])));

drop policy if exists expense_categories_write_admin on public.expense_categories;
drop policy if exists expense_categories_insert_admin on public.expense_categories;
drop policy if exists expense_categories_update_admin on public.expense_categories;
create policy expense_categories_insert_admin on public.expense_categories for insert to authenticated
  with check ((select app_private.has_app_role(array['admin'])));
create policy expense_categories_update_admin on public.expense_categories for update to authenticated
  using ((select app_private.has_app_role(array['admin'])))
  with check ((select app_private.has_app_role(array['admin'])));

drop policy if exists settings_write_admin on public.settings;
drop policy if exists settings_insert_admin on public.settings;
drop policy if exists settings_update_admin on public.settings;
create policy settings_insert_admin on public.settings for insert to authenticated
  with check ((select app_private.has_app_role(array['admin'])));
create policy settings_update_admin on public.settings for update to authenticated
  using ((select app_private.has_app_role(array['admin'])))
  with check ((select app_private.has_app_role(array['admin'])));

drop policy if exists waste_reasons_write_admin on public.waste_reasons;
drop policy if exists waste_reasons_insert_admin on public.waste_reasons;
drop policy if exists waste_reasons_update_admin on public.waste_reasons;
create policy waste_reasons_insert_admin on public.waste_reasons for insert to authenticated
  with check ((select app_private.has_app_role(array['admin'])));
create policy waste_reasons_update_admin on public.waste_reasons for update to authenticated
  using ((select app_private.has_app_role(array['admin'])))
  with check ((select app_private.has_app_role(array['admin'])));

drop policy if exists stock_out_reasons_write_admin on public.stock_out_reasons;
drop policy if exists stock_out_reasons_insert_admin on public.stock_out_reasons;
drop policy if exists stock_out_reasons_update_admin on public.stock_out_reasons;
create policy stock_out_reasons_insert_admin on public.stock_out_reasons for insert to authenticated
  with check ((select app_private.has_app_role(array['admin'])));
create policy stock_out_reasons_update_admin on public.stock_out_reasons for update to authenticated
  using ((select app_private.has_app_role(array['admin'])))
  with check ((select app_private.has_app_role(array['admin'])));
