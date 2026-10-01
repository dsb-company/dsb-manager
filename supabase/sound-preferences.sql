-- DSB · Preferência de som por usuário
-- Execute uma vez no mesmo projeto Supabase do Manager e Client.

begin;

alter table public.dsb_members
  add column if not exists notification_sound text not null default 'suave';

alter table public.dsb_customer_users
  add column if not exists notification_sound text not null default 'suave';

create or replace function public.dsb_set_my_notification_sound(p_sound text)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  uid uuid := (select auth.uid());
  choice text := lower(trim(coalesce(p_sound,'')));
  changed integer := 0;
begin
  if uid is null then raise exception 'Sessão inválida'; end if;
  if choice not in ('none','suave','pop','alerta') then raise exception 'Som inválido'; end if;

  update public.dsb_members set notification_sound=choice where user_id=uid;
  get diagnostics changed = row_count;
  update public.dsb_customer_users set notification_sound=choice where user_id=uid;
  changed := changed + (case when found then 1 else 0 end);

  if changed=0 and not exists(select 1 from public.dsb_customer_users where user_id=uid) then
    raise exception 'Usuário sem perfil autorizado';
  end if;
end;
$$;

revoke all on function public.dsb_set_my_notification_sound(text) from public,anon;
grant execute on function public.dsb_set_my_notification_sound(text) to authenticated;

create or replace function public.dsb_get_my_notification_sound()
returns text
language sql
stable
security definer
set search_path=''
as $$
  select coalesce(
    (select m.notification_sound from public.dsb_members m where m.user_id=(select auth.uid()) limit 1),
    (select cu.notification_sound from public.dsb_customer_users cu where cu.user_id=(select auth.uid()) and cu.active=true limit 1),
    'suave'
  );
$$;

revoke all on function public.dsb_get_my_notification_sound() from public,anon;
grant execute on function public.dsb_get_my_notification_sound() to authenticated;

notify pgrst, 'reload schema';

commit;
