-- DSB · REALTIME, NÃO LIDOS, NOTIFICAÇÕES E FOTOS DE PERFIL · 30/09/2026
-- Execute UMA VEZ no mesmo projeto Supabase usado pelo DSB Manager e DSB Client.
-- Pré-requisitos: schema.sql + chamados.sql + portal-setup.sql já aplicados.

begin;

-- 1) Fotos de perfil ---------------------------------------------------------
alter table public.dsb_members
  add column if not exists avatar_path text;

alter table public.dsb_customer_users
  add column if not exists avatar_path text;

-- Bucket privado para avatares. O arquivo é lido por URL assinada.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('dsb-avatars','dsb-avatars',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
set public=false,
    file_size_limit=5242880,
    allowed_mime_types=array['image/jpeg','image/png','image/webp'];

-- Policies do Storage. Cada usuário grava/apaga apenas a própria pasta.
drop policy if exists dsb_avatars_read on storage.objects;
create policy dsb_avatars_read on storage.objects
for select to authenticated
using (bucket_id='dsb-avatars');

drop policy if exists dsb_avatars_insert_own on storage.objects;
create policy dsb_avatars_insert_own on storage.objects
for insert to authenticated
with check (
  bucket_id='dsb-avatars'
  and (storage.foldername(name))[1]=(select auth.uid())::text
);

drop policy if exists dsb_avatars_update_own on storage.objects;
create policy dsb_avatars_update_own on storage.objects
for update to authenticated
using (
  bucket_id='dsb-avatars'
  and (storage.foldername(name))[1]=(select auth.uid())::text
)
with check (
  bucket_id='dsb-avatars'
  and (storage.foldername(name))[1]=(select auth.uid())::text
);

drop policy if exists dsb_avatars_delete_own on storage.objects;
create policy dsb_avatars_delete_own on storage.objects
for delete to authenticated
using (
  bucket_id='dsb-avatars'
  and (storage.foldername(name))[1]=(select auth.uid())::text
);

create or replace function public.dsb_set_my_avatar(p_avatar_path text)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  uid uuid := (select auth.uid());
  cleaned text := nullif(trim(coalesce(p_avatar_path,'')),'');
begin
  if uid is null then raise exception 'Sessão inválida'; end if;
  if cleaned is not null and cleaned !~ ('^' || uid::text || '/[A-Za-z0-9._/-]+$') then
    raise exception 'Caminho de avatar inválido';
  end if;

  update public.dsb_members set avatar_path=cleaned where user_id=uid;
  update public.dsb_customer_users set avatar_path=cleaned where user_id=uid;

  if not found and not exists(select 1 from public.dsb_members where user_id=uid) then
    raise exception 'Usuário sem perfil autorizado';
  end if;
end;
$$;
revoke all on function public.dsb_set_my_avatar(text) from public,anon;
grant execute on function public.dsb_set_my_avatar(text) to authenticated;

-- Perfis visíveis dentro de um chamado. Não expõe e-mail.
create or replace function public.dsb_ticket_profiles(p_ticket_id uuid)
returns table(user_id uuid,name text,avatar_path text,kind text)
language sql
stable
security definer
set search_path=''
as $$
  with allowed as (
    select t.client_id
    from public.dsb_tickets t
    where t.id=p_ticket_id and public.dsb_ticket_access(t.id)
  )
  select m.user_id,m.name,m.avatar_path,'staff'::text
  from public.dsb_members m
  where exists(select 1 from allowed)
  union all
  select cu.user_id,cu.name,cu.avatar_path,'client'::text
  from public.dsb_customer_users cu
  where cu.active=true
    and exists(select 1 from allowed a where a.client_id=cu.client_id);
$$;
revoke all on function public.dsb_ticket_profiles(uuid) from public,anon;
grant execute on function public.dsb_ticket_profiles(uuid) to authenticated;

-- Atualiza o perfil do Client para também devolver avatar_path.
create or replace function public.dsb_customer_portal_profile()
returns table(
  user_id uuid,
  client_id uuid,
  name text,
  email text,
  company_name text,
  company_status text,
  avatar_path text
)
language sql
stable
security definer
set search_path=''
as $$
  select
    cu.user_id,
    cu.client_id,
    cu.name,
    cu.email,
    coalesce(r.data->>'name','Cliente DSB') as company_name,
    coalesce(r.data->>'status','') as company_status,
    cu.avatar_path
  from public.dsb_customer_users cu
  join public.dsb_records r on r.id=cu.client_id and r.type='client'
  where cu.user_id=(select auth.uid())
    and cu.active=true
  limit 1;
$$;
revoke all on function public.dsb_customer_portal_profile() from public,anon;
grant execute on function public.dsb_customer_portal_profile() to authenticated;

-- 2) Controle de leitura -----------------------------------------------------
create table if not exists public.dsb_ticket_reads (
  ticket_id uuid not null references public.dsb_tickets(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key(ticket_id,user_id)
);
create index if not exists dsb_ticket_reads_user_idx on public.dsb_ticket_reads(user_id,last_read_at desc);

alter table public.dsb_ticket_reads enable row level security;
grant select on public.dsb_ticket_reads to authenticated;
grant all on public.dsb_ticket_reads to service_role;

drop policy if exists dsb_ticket_reads_own_select on public.dsb_ticket_reads;
create policy dsb_ticket_reads_own_select on public.dsb_ticket_reads
for select to authenticated
using (user_id=(select auth.uid()) and public.dsb_ticket_access(ticket_id));

create or replace function public.dsb_mark_ticket_read(p_ticket_id uuid)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'Sessão inválida'; end if;
  if not public.dsb_ticket_access(p_ticket_id) then raise exception 'Sem acesso a este chamado'; end if;
  insert into public.dsb_ticket_reads(ticket_id,user_id,last_read_at)
  values(p_ticket_id,uid,now())
  on conflict(ticket_id,user_id) do update set last_read_at=excluded.last_read_at;
end;
$$;
revoke all on function public.dsb_mark_ticket_read(uuid) from public,anon;
grant execute on function public.dsb_mark_ticket_read(uuid) to authenticated;

create or replace function public.dsb_ticket_unread_summary()
returns table(ticket_id uuid, unread_count bigint)
language sql
stable
security definer
set search_path=''
as $$
  select
    t.id as ticket_id,
    count(m.id)::bigint as unread_count
  from public.dsb_tickets t
  join public.dsb_ticket_messages m on m.ticket_id=t.id
  left join public.dsb_ticket_reads r
    on r.ticket_id=t.id and r.user_id=(select auth.uid())
  where public.dsb_ticket_access(t.id)
    and m.created_at > coalesce(r.last_read_at,'1970-01-01'::timestamptz)
    and (
      ((select public.dsb_is_member()) and m.author_kind='client')
      or
      (not (select public.dsb_is_member()) and m.author_kind='staff')
    )
  group by t.id
  having count(m.id)>0;
$$;
revoke all on function public.dsb_ticket_unread_summary() from public,anon;
grant execute on function public.dsb_ticket_unread_summary() to authenticated;

-- 3) Realtime ---------------------------------------------------------------
-- Adiciona as tabelas à publicação do Supabase Realtime apenas se necessário.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='dsb_ticket_messages'
  ) then
    alter publication supabase_realtime add table public.dsb_ticket_messages;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='dsb_tickets'
  ) then
    alter publication supabase_realtime add table public.dsb_tickets;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='dsb_ticket_attachments'
  ) then
    alter publication supabase_realtime add table public.dsb_ticket_attachments;
  end if;
end $$;

alter table public.dsb_tickets replica identity full;
alter table public.dsb_ticket_messages replica identity full;
alter table public.dsb_ticket_attachments replica identity full;

-- 4) Preferência de som por usuário -----------------------------------------
alter table public.dsb_members add column if not exists notification_sound text not null default 'suave';
alter table public.dsb_customer_users add column if not exists notification_sound text not null default 'suave';

create or replace function public.dsb_set_my_notification_sound(p_sound text)
returns void language plpgsql security definer set search_path='' as $$
declare uid uuid := (select auth.uid()); choice text := lower(trim(coalesce(p_sound,'')));
begin
  if uid is null then raise exception 'Sessão inválida'; end if;
  if choice not in ('none','suave','pop','alerta') then raise exception 'Som inválido'; end if;
  update public.dsb_members set notification_sound=choice where user_id=uid;
  update public.dsb_customer_users set notification_sound=choice where user_id=uid;
  if not exists(select 1 from public.dsb_members where user_id=uid) and not exists(select 1 from public.dsb_customer_users where user_id=uid) then raise exception 'Usuário sem perfil autorizado'; end if;
end;$$;
revoke all on function public.dsb_set_my_notification_sound(text) from public,anon;
grant execute on function public.dsb_set_my_notification_sound(text) to authenticated;

create or replace function public.dsb_get_my_notification_sound()
returns text language sql stable security definer set search_path='' as $$
  select coalesce((select m.notification_sound from public.dsb_members m where m.user_id=(select auth.uid()) limit 1),(select cu.notification_sound from public.dsb_customer_users cu where cu.user_id=(select auth.uid()) and cu.active=true limit 1),'suave');
$$;
revoke all on function public.dsb_get_my_notification_sound() from public,anon;
grant execute on function public.dsb_get_my_notification_sound() to authenticated;

notify pgrst, 'reload schema';

commit;
