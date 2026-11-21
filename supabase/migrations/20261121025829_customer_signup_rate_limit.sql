create table delivery_demo_private.signup_windows (
  starts_at timestamptz primary key,
  requests integer not null check (requests > 0)
);
alter table delivery_demo_private.signup_windows enable row level security;
revoke all on delivery_demo_private.signup_windows from public, anon, authenticated;

create function public.bappilot_signup_permit() returns boolean
language plpgsql security invoker set search_path = '' as $$
declare
  bucket timestamptz := date_trunc('minute', statement_timestamp());
  allowed integer;
begin
  delete from delivery_demo_private.signup_windows where starts_at < bucket - interval '1 day';
  insert into delivery_demo_private.signup_windows as windows (starts_at, requests)
    values (bucket, 1)
    on conflict (starts_at) do update set requests=windows.requests+1
      where windows.requests < 45
    returning requests into allowed;
  return allowed is not null;
end;
$$;
revoke all on function public.bappilot_signup_permit() from public, anon, authenticated;
grant usage on schema delivery_demo_private to service_role;
grant select, insert, update, delete on delivery_demo_private.signup_windows to service_role;
grant execute on function public.bappilot_signup_permit() to service_role;
