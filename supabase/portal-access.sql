-- DSB MANAGER · GESTÃO DE ACESSOS AO PORTAL · 28/09/2026
-- Execute UMA VEZ no SQL Editor do MESMO Supabase usado pelo DSB Manager.
-- Pré-requisito: supabase/chamados.sql já executado.
-- Este arquivo adiciona somente a administração dos acessos do DSB Client.

begin;

alter table public.dsb_customer_users
  add column if not exists portal_status text not null default 'active',
  add column if not exists invited_at timestamptz,
  add column if not exists activated_at timestamptz,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists invited_by uuid references public.dsb_members(user_id) on delete set null;

-- Garante valores válidos sem depender de um nome de constraint já existente.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.dsb_customer_users'::regclass
      and conname='dsb_customer_users_portal_status_check'
  ) then
    alter table public.dsb_customer_users
      add constraint dsb_customer_users_portal_status_check
      check (portal_status in ('pending','active','disabled'));
  end if;
end $$;

-- Normaliza registros criados antes deste complemento usando o estado real do Auth.
update public.dsb_customer_users cu
set portal_status=case
      when cu.active=false then 'disabled'
      when au.email_confirmed_at is not null or au.last_sign_in_at is not null then 'active'
      else 'pending'
    end,
    invited_at=coalesce(cu.invited_at,cu.created_at),
    activated_at=case
      when cu.active and (au.email_confirmed_at is not null or au.last_sign_in_at is not null) then coalesce(cu.activated_at,cu.created_at)
      else cu.activated_at
    end,
    updated_at=now()
from auth.users au
where au.id=cu.user_id;

create index if not exists dsb_customer_users_email_idx
  on public.dsb_customer_users(lower(email));
create index if not exists dsb_customer_users_status_idx
  on public.dsb_customer_users(portal_status);

create or replace function public.dsb_touch_customer_user()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  new.email:=lower(trim(new.email));
  new.name:=trim(new.name);
  new.updated_at:=now();
  if new.active=false then new.portal_status:='disabled'; end if;
  return new;
end;
$$;
revoke all on function public.dsb_touch_customer_user() from public,anon,authenticated;
drop trigger if exists dsb_touch_customer_user on public.dsb_customer_users;
create trigger dsb_touch_customer_user
before insert or update on public.dsb_customer_users
for each row execute function public.dsb_touch_customer_user();

-- Quando o convidado confirma o e-mail/entra pela primeira vez, o status muda para Ativo.
-- Um acesso desativado não é reativado por esse gatilho.
create or replace function public.dsb_sync_customer_portal_activation()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.email_confirmed_at is not null or new.last_sign_in_at is not null then
    update public.dsb_customer_users
       set portal_status='active',
           activated_at=coalesce(activated_at,now()),
           updated_at=now()
     where user_id=new.id
       and active=true
       and portal_status<>'active';
  end if;
  return new;
end;
$$;
revoke all on function public.dsb_sync_customer_portal_activation() from public,anon,authenticated;
drop trigger if exists dsb_sync_customer_portal_activation on auth.users;
create trigger dsb_sync_customer_portal_activation
after update of email_confirmed_at,last_sign_in_at on auth.users
for each row execute function public.dsb_sync_customer_portal_activation();

-- Vincula pelo e-mail um usuário que JÁ existe em Authentication.
-- Usado pelo Manager antes de chamar a Edge Function. Assim, usuários de teste
-- ou contas já criadas são vinculados sem copiar UUID ou executar INSERT manual.
create or replace function public.dsb_link_existing_customer_user(
  p_client_id uuid,
  p_name text,
  p_email text
)
returns public.dsb_customer_users
language plpgsql
security definer
set search_path=''
as $$
declare
  auth_user auth.users%rowtype;
  existing_link public.dsb_customer_users%rowtype;
  result_row public.dsb_customer_users%rowtype;
  normalized_email text:=lower(trim(coalesce(p_email,'')));
  normalized_name text:=trim(coalesce(p_name,''));
begin
  if not public.dsb_is_admin() then
    raise exception 'Apenas administradores podem gerenciar o Portal do Cliente';
  end if;
  if char_length(normalized_name) not between 2 and 120 then
    raise exception 'Informe um nome entre 2 e 120 caracteres';
  end if;
  if normalized_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Informe um e-mail válido';
  end if;
  if not exists(select 1 from public.dsb_records where id=p_client_id and type='client') then
    raise exception 'Cliente inválido';
  end if;

  select * into auth_user
    from auth.users
   where lower(email)=normalized_email
   order by created_at
   limit 1;

  if auth_user.id is null then
    raise exception 'AUTH_USER_NOT_FOUND';
  end if;

  select * into existing_link
    from public.dsb_customer_users
   where user_id=auth_user.id
      or lower(email)=normalized_email
   limit 1;

  if existing_link.user_id is not null and existing_link.client_id<>p_client_id then
    raise exception 'Este e-mail já está vinculado a outra empresa';
  end if;

  insert into public.dsb_customer_users as cu(
    user_id,client_id,name,email,active,portal_status,invited_at,activated_at,invited_by
  ) values (
    auth_user.id,
    p_client_id,
    normalized_name,
    normalized_email,
    true,
    case when auth_user.email_confirmed_at is not null or auth_user.last_sign_in_at is not null then 'active' else 'pending' end,
    coalesce(existing_link.invited_at,now()),
    case when auth_user.email_confirmed_at is not null or auth_user.last_sign_in_at is not null then coalesce(existing_link.activated_at,now()) else existing_link.activated_at end,
    (select auth.uid())
  )
  on conflict(user_id) do update set
    client_id=excluded.client_id,
    name=excluded.name,
    email=excluded.email,
    active=true,
    portal_status=excluded.portal_status,
    invited_at=coalesce(cu.invited_at,excluded.invited_at),
    activated_at=coalesce(cu.activated_at,excluded.activated_at),
    invited_by=excluded.invited_by
  returning * into result_row;

  return result_row;
end;
$$;
revoke all on function public.dsb_link_existing_customer_user(uuid,text,text) from public,anon;
grant execute on function public.dsb_link_existing_customer_user(uuid,text,text) to authenticated;

-- Ativa/desativa o vínculo sem excluir a conta do Authentication.
create or replace function public.dsb_set_customer_user_active(
  p_user_id uuid,
  p_active boolean
)
returns public.dsb_customer_users
language plpgsql
security definer
set search_path=''
as $$
declare
  auth_confirmed boolean:=false;
  result_row public.dsb_customer_users%rowtype;
begin
  if not public.dsb_is_admin() then
    raise exception 'Apenas administradores podem gerenciar o Portal do Cliente';
  end if;
  if not exists(select 1 from public.dsb_customer_users where user_id=p_user_id) then
    raise exception 'Acesso não encontrado';
  end if;

  select (email_confirmed_at is not null or last_sign_in_at is not null)
    into auth_confirmed
    from auth.users
   where id=p_user_id;

  update public.dsb_customer_users
     set active=p_active,
         portal_status=case
           when not p_active then 'disabled'
           when auth_confirmed then 'active'
           else 'pending'
         end,
         activated_at=case when p_active and auth_confirmed then coalesce(activated_at,now()) else activated_at end,
         updated_at=now()
   where user_id=p_user_id
  returning * into result_row;

  return result_row;
end;
$$;
revoke all on function public.dsb_set_customer_user_active(uuid,boolean) from public,anon;
grant execute on function public.dsb_set_customer_user_active(uuid,boolean) to authenticated;

commit;
