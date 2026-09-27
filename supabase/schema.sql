-- DSB MANAGER · INSTALAÇÃO INICIAL · 27/09/2026
-- Execute uma vez em um projeto Supabase seu, no SQL Editor.
-- Não altera tabelas de outros sistemas. Namespace de tabelas: dsb_*.
-- O primeiro administrador é autorizado MANUALMENTE, no final deste arquivo.
begin;
create table if not exists public.dsb_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null check(char_length(name) between 2 and 100),
  email text not null check(char_length(email) between 3 and 254),
  role text not null default 'member' check(role in ('admin','member')),
  created_at timestamptz not null default now()
);
create table if not exists public.dsb_records (
  id uuid primary key default gen_random_uuid(),
  type text not null check(type in ('client','project','task','transaction','event')),
  data jsonb not null check(jsonb_typeof(data)='object' and octet_length(data::text)<=16000),
  client_id uuid generated always as (nullif(data->>'client_id','')::uuid) stored references public.dsb_records(id) on delete restrict,
  project_id uuid generated always as (nullif(data->>'project_id','')::uuid) stored references public.dsb_records(id) on delete restrict,
  version integer not null default 1,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists dsb_records_type_idx on public.dsb_records(type);
create index if not exists dsb_records_client_idx on public.dsb_records(client_id);
create index if not exists dsb_records_project_idx on public.dsb_records(project_id);
create table if not exists public.dsb_settings (
  id integer primary key default 1 check(id=1),
  data jsonb not null default '{"company":"DSB Company","goal":5000}'::jsonb,
  constraint dsb_settings_valid check (
    jsonb_typeof(data)='object' and
    jsonb_typeof(data->'company')='string' and char_length(data->>'company') between 2 and 100 and
    jsonb_typeof(data->'goal')='number' and (data->>'goal')::numeric between 0 and 999999999 and
    data ?& array['company','goal'] and octet_length(data::text)<2000
  )
);
insert into public.dsb_settings(id) values(1) on conflict(id) do nothing;

-- SECURITY DEFINER evita recursão nas políticas de membros.
-- search_path vazio impede substituição de objetos por usuários comuns.
create or replace function public.dsb_is_member()
returns boolean language sql stable security definer set search_path=''
as $$ select exists(select 1 from public.dsb_members where user_id=(select auth.uid())); $$;
create or replace function public.dsb_is_admin()
returns boolean language sql stable security definer set search_path=''
as $$ select exists(select 1 from public.dsb_members where user_id=(select auth.uid()) and role='admin'); $$;
revoke all on function public.dsb_is_member() from public,anon;
revoke all on function public.dsb_is_admin() from public,anon;
grant execute on function public.dsb_is_member(),public.dsb_is_admin() to authenticated;

alter table public.dsb_members enable row level security;
alter table public.dsb_records enable row level security;
alter table public.dsb_settings enable row level security;
revoke all on public.dsb_members,public.dsb_records,public.dsb_settings from public,anon,authenticated;
grant select on public.dsb_members to authenticated;
grant select,insert,update,delete on public.dsb_records to authenticated;
grant select,insert,update on public.dsb_settings to authenticated;
grant all on public.dsb_members,public.dsb_records,public.dsb_settings to service_role;

drop policy if exists dsb_members_read on public.dsb_members;
create policy dsb_members_read on public.dsb_members for select to authenticated using((select public.dsb_is_member()));
drop policy if exists dsb_records_read on public.dsb_records;
create policy dsb_records_read on public.dsb_records for select to authenticated using((select public.dsb_is_member()));
drop policy if exists dsb_records_insert on public.dsb_records;
create policy dsb_records_insert on public.dsb_records for insert to authenticated with check((select public.dsb_is_member()));
drop policy if exists dsb_records_update on public.dsb_records;
create policy dsb_records_update on public.dsb_records for update to authenticated using((select public.dsb_is_member())) with check((select public.dsb_is_member()));
drop policy if exists dsb_records_delete on public.dsb_records;
create policy dsb_records_delete on public.dsb_records for delete to authenticated using((select public.dsb_is_admin()));
drop policy if exists dsb_settings_read on public.dsb_settings;
create policy dsb_settings_read on public.dsb_settings for select to authenticated using((select public.dsb_is_member()));
drop policy if exists dsb_settings_insert on public.dsb_settings;
create policy dsb_settings_insert on public.dsb_settings for insert to authenticated with check((select public.dsb_is_admin()));
drop policy if exists dsb_settings_update on public.dsb_settings;
create policy dsb_settings_update on public.dsb_settings for update to authenticated using((select public.dsb_is_admin())) with check((select public.dsb_is_admin()));

-- Validação no banco, além da validação no formulário.
create or replace function public.dsb_validate_record()
returns trigger language plpgsql set search_path=''
as $$
declare
 d jsonb := new.data;
 k text; v text; st text := d->>'status'; required_keys text[]; allowed_keys text[];
begin
 if new.type='client' then required_keys:=array['name','status']; allowed_keys:=array['name','contact','email','phone','status','notes'];
 elsif new.type='project' then required_keys:=array['name','status','value','progress']; allowed_keys:=array['name','client_id','service','status','value','progress','due','owner','notes'];
 elsif new.type='task' then required_keys:=array['name','status','priority']; allowed_keys:=array['name','project_id','status','priority','due','owner','notes'];
 elsif new.type='transaction' then required_keys:=array['name','status','direction','value','due']; allowed_keys:=array['name','client_id','direction','value','status','due','paid_date','category','notes'];
 elsif new.type='event' then required_keys:=array['name','status','date','time','duration']; allowed_keys:=array['name','date','time','duration','status','location','notes'];
 else raise exception 'Tipo inválido'; end if;
 if jsonb_typeof(d) is distinct from 'object' or not(d ?& required_keys) then raise exception 'Campos obrigatórios ausentes'; end if;
 for k,v in select key,value from jsonb_each_text(d) loop
   if not(k=any(allowed_keys)) then raise exception 'Campo não permitido: %',k; end if;
   if k not in ('value','progress','duration') and jsonb_typeof(d->k) is distinct from 'string' then raise exception 'Texto inválido: %',k; end if;
   if char_length(v)>(case when k='notes' then 3000 else 254 end) then raise exception 'Campo muito longo: %',k; end if;
 end loop;
 if char_length(trim(d->>'name')) not between 2 and 160 then raise exception 'Nome inválido'; end if;
 if new.type='client' and st not in ('Prospect','Ativo','Inativo') or
    new.type='project' and st not in ('Planejamento','Em andamento','Em revisão','Concluído','Pausado') or
    new.type='task' and st not in ('A fazer','Em andamento','Concluída') or
    new.type='transaction' and st not in ('Pendente','Pago') or
    new.type='event' and st not in ('Reunião','Entrega','Outro') then raise exception 'Situação inválida'; end if;
 foreach k in array array['due','date','paid_date'] loop
   v:=d->>k;
   if coalesce(v,'')<>'' then
     if v !~ '^\d{4}-\d{2}-\d{2}$' or to_char(v::date,'YYYY-MM-DD')<>v then raise exception 'Data inválida'; end if;
   end if;
 end loop;
 if new.type in ('project','transaction') then
   if jsonb_typeof(d->'value') is distinct from 'number' then raise exception 'Valor inválido'; end if;
   if (d->>'value')::numeric not between 0 and 999999999 or round((d->>'value')::numeric,2)<>(d->>'value')::numeric then raise exception 'Valor inválido'; end if;
 end if;
 if new.type='project' then
   if jsonb_typeof(d->'progress') is distinct from 'number' or (d->>'progress')::numeric not between 0 and 100 or trunc((d->>'progress')::numeric)<>(d->>'progress')::numeric then raise exception 'Progresso inválido'; end if;
   if st='Concluído' and (d->>'progress')::numeric<>100 then raise exception 'Projeto concluído exige progresso de 100'; end if;
 end if;
 if new.type='task' and d->>'priority' not in ('Baixa','Média','Alta') then raise exception 'Prioridade inválida'; end if;
 if new.type='transaction' then
   if d->>'direction' not in ('Receita','Despesa') or coalesce(d->>'due','')='' then raise exception 'Tipo ou vencimento inválido'; end if;
   if st='Pago' and coalesce(d->>'paid_date','')='' then raise exception 'Informe a data do pagamento'; end if;
   if st='Pendente' and coalesce(d->>'paid_date','')<>'' then raise exception 'Lançamento pendente não tem data de pagamento'; end if;
 end if;
 if new.type='event' then
   if coalesce(d->>'date','')='' or d->>'time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or jsonb_typeof(d->'duration') is distinct from 'number' or (d->>'duration')::numeric not between 5 and 1440 or trunc((d->>'duration')::numeric)<>(d->>'duration')::numeric then raise exception 'Data, horário ou duração inválidos'; end if;
 end if;
 if coalesce(d->>'client_id','')<>'' and not exists(select 1 from public.dsb_records where id=(d->>'client_id')::uuid and type='client') then raise exception 'Cliente inválido'; end if;
 if coalesce(d->>'project_id','')<>'' and not exists(select 1 from public.dsb_records where id=(d->>'project_id')::uuid and type='project') then raise exception 'Projeto inválido'; end if;
 if TG_OP='UPDATE' then
   if new.type<>old.type or new.id<>old.id then raise exception 'Tipo e identidade são imutáveis'; end if;
   new.created_by:=old.created_by;new.created_at:=old.created_at;new.version:=old.version+1;
 else new.created_by:=auth.uid();new.created_at:=now();new.version:=1;
 end if;
 new.updated_at:=now();return new;
end $$;
revoke all on function public.dsb_validate_record() from public,anon,authenticated;
drop trigger if exists dsb_validate_record on public.dsb_records;
create trigger dsb_validate_record before insert or update on public.dsb_records for each row execute function public.dsb_validate_record();

-- Autorização: só administrador, para usuários já existentes no Supabase Auth.
create or replace function public.dsb_authorize_member(member_email text,member_name text,member_role text default 'member')
returns void language plpgsql security definer set search_path=''
as $$
declare target_id uuid; old_role text;
begin
 if not public.dsb_is_admin() then raise exception 'Apenas administradores podem autorizar pessoas'; end if;
 perform pg_advisory_xact_lock(72818429);
 if member_role not in ('admin','member') or char_length(trim(member_name)) not between 2 and 100 then raise exception 'Nome ou permissão inválidos'; end if;
 select id into target_id from auth.users where lower(email)=lower(trim(member_email));
 if target_id is null then raise exception 'Crie esta conta em Authentication > Users no Supabase primeiro'; end if;
 select role into old_role from public.dsb_members where user_id=target_id;
 if target_id=auth.uid() and member_role<>'admin' then raise exception 'Você não pode remover sua própria permissão de administrador'; end if;
 if old_role='admin' and member_role<>'admin' and (select count(*) from public.dsb_members where role='admin')<=1 then raise exception 'Mantenha pelo menos um administrador'; end if;
 insert into public.dsb_members(user_id,name,email,role) values(target_id,trim(member_name),lower(trim(member_email)),member_role)
 on conflict(user_id) do update set name=excluded.name,email=excluded.email,role=excluded.role;
end $$;
create or replace function public.dsb_revoke_member(target_user_id uuid)
returns void language plpgsql security definer set search_path=''
as $$
begin
 if not public.dsb_is_admin() then raise exception 'Apenas administradores podem revogar acesso'; end if;
 perform pg_advisory_xact_lock(72818429);
 if target_user_id=auth.uid() then raise exception 'Você não pode revogar seu próprio acesso'; end if;
 if exists(select 1 from public.dsb_members where user_id=target_user_id and role='admin') and (select count(*) from public.dsb_members where role='admin')<=1 then raise exception 'Mantenha pelo menos um administrador'; end if;
 delete from public.dsb_members where user_id=target_user_id;
end $$;
revoke all on function public.dsb_authorize_member(text,text,text) from public,anon;
revoke all on function public.dsb_revoke_member(uuid) from public,anon;
grant execute on function public.dsb_authorize_member(text,text,text),public.dsb_revoke_member(uuid) to authenticated;
commit;

-- DEPOIS DA INSTALAÇÃO:
-- 1. Authentication > Users > Add user > Create new user. Crie sua conta.
-- 2. Substitua SEU_EMAIL_AQUI pelo e-mail dessa conta no trecho abaixo.
-- 3. Execute APENAS o trecho abaixo, sem os dois hífens de comentário:
--
-- insert into public.dsb_members(user_id,name,email,role)
-- select id,'Vitor',lower(email),'admin' from auth.users
-- where lower(email)=lower('SEU_EMAIL_AQUI')
-- on conflict(user_id) do update set role='admin';
--
-- Confirme que foi inserida 1 linha. Não há senha padrão ou cadastro público no app.
-- Verifique também as instruções de recuperação de senha e URL no GUIA.html.
