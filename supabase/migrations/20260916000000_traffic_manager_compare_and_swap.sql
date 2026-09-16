-- Compare the whole JSON document in the same atomic statement as the write.
-- This catches updates made by the web UI as well as other collectors.
create or replace function public.traffic_manager_compare_and_swap(
  p_row_id text,
  p_expected jsonb,
  p_next jsonb
)
returns boolean
language sql
security invoker
set search_path = public
as $$
  with changed as (
    update public.app_data
       set data = p_next
     where id = p_row_id
       and p_row_id = '2'
       and data = p_expected
    returning id
  )
  select exists (select 1 from changed);
$$;

revoke all on function public.traffic_manager_compare_and_swap(text, jsonb, jsonb) from public;
grant execute on function public.traffic_manager_compare_and_swap(text, jsonb, jsonb) to anon, authenticated;
