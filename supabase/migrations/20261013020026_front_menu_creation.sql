-- Front can add an active menu without access to administrative updates.
-- The existing insert grant and admin policy are preserved. Audit triggers
-- continue to record the authenticated actor and the created menu.
create policy menu_items_insert_front on public.menu_items
for insert to authenticated
with check (
  (select app_private.has_app_role(array['front']))
  and active
  and deleted_at is null
  and selling_price is null
  and estimated_cost_per_box is null
  and created_at = now()
  and updated_at = now()
  and (notes is null or char_length(notes) <= 2000)
);
