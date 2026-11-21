alter table delivery_demo_private.menu_changes
  add column details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object');

create function delivery_demo_private.save_menu_with_details(browser_key uuid, payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  facts jsonb := payload->'details';
  saved_id jsonb;
begin
  if jsonb_typeof(facts) is distinct from 'object' then
    raise exception '메뉴의 맛, 분량, 특징을 확인해 주세요.';
  end if;
  if exists (
    select 1 from jsonb_each(facts) as field(key, value)
    where case field.key
      when 'servings' then field.value <> 'null'::jsonb and (
        jsonb_typeof(field.value) <> 'number' or (field.value #>> '{}') !~ '^([1-9]|1[0-9]|20)$'
      )
      when 'taste' then jsonb_typeof(field.value) <> 'string' or length(field.value #>> '{}') > 60
      when 'portion' then jsonb_typeof(field.value) <> 'string' or length(field.value #>> '{}') > 60
      when 'features' then jsonb_typeof(field.value) <> 'string' or length(field.value #>> '{}') > 100
      when 'notes' then jsonb_typeof(field.value) <> 'string' or length(field.value #>> '{}') > 240
      else true
    end
  ) then
    raise exception '메뉴의 맛, 분량, 특징을 확인해 주세요.';
  end if;

  saved_id := delivery_demo_private.run('save_menu', browser_key, payload);
  update delivery_demo_private.menu_changes c
  set details = facts
  where c.browser_hash = pg_catalog.sha256(pg_catalog.convert_to(browser_key::text, 'UTF8'))
    and c.store_id = payload->>'target' and c.id = (saved_id #>> '{}');
  return saved_id;
end;
$$;

create function delivery_demo_private.recommendation_menu_changes(browser_key uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'store', c.store_id, 'name', c.name, 'desc', c.description,
    'price', c.price, 'available', c.available, 'removed', c.removed,
    'details', c.details - 'notes'
  ) order by c.store_id, c.id), '[]'::jsonb)
  from delivery_demo_private.menu_changes c
  join recommendation_catalog.stores s on s.store_id = c.store_id
  where c.browser_hash = pg_catalog.sha256(pg_catalog.convert_to(browser_key::text, 'UTF8'))
    and substring(browser_key::text, 15, 1) = '4'
    and s.is_synthetic and s.is_listed and s.is_open;
$$;

create function delivery_demo_private.menu_editor_details(browser_key uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(c.id, c.details), '{}'::jsonb)
  from delivery_demo_private.menu_changes c
  where c.browser_hash = pg_catalog.sha256(pg_catalog.convert_to(browser_key::text, 'UTF8'))
    and substring(browser_key::text, 15, 1) = '4' and not c.removed and c.details <> '{}'::jsonb;
$$;

revoke all on function delivery_demo_private.save_menu_with_details(uuid,jsonb),
  delivery_demo_private.recommendation_menu_changes(uuid), delivery_demo_private.menu_editor_details(uuid) from public;
grant execute on function delivery_demo_private.save_menu_with_details(uuid,jsonb),
  delivery_demo_private.recommendation_menu_changes(uuid), delivery_demo_private.menu_editor_details(uuid) to anon, authenticated;

create or replace function public.seoul_delivery_demo(action text, browser_key uuid, payload jsonb default '{}')
returns jsonb language sql security invoker set search_path = '' as $$
  select case
    when action = 'save_menu' and payload ? 'details' then
      delivery_demo_private.save_menu_with_details(browser_key, payload)
    when action = 'recommendation_menu_changes' then
      delivery_demo_private.recommendation_menu_changes(browser_key)
    when action = 'catalog' and payload @> '{"include_menu_details":true}'::jsonb then
      delivery_demo_private.run(action, browser_key, payload) ||
        jsonb_build_object('menu_details', delivery_demo_private.menu_editor_details(browser_key))
    else delivery_demo_private.run(action, browser_key, payload)
  end;
$$;
