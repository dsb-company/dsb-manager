-- DSB MANAGER · MÓDULO DE CHAMADOS · 28/09/2026
-- Execute UMA VEZ no SQL Editor do MESMO projeto Supabase usado pelo DSB Manager.
-- Este arquivo somente ADICIONA o módulo de chamados. Não altera dsb_records, clientes,
-- projetos, tarefas, financeiro, agenda ou configurações existentes.

begin;

-- Usuários futuros do Portal do Cliente. Um usuário pertence a uma empresa/cliente.
create table if not exists public.dsb_customer_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  client_id uuid not null references public.dsb_records(id) on delete restrict,
  name text not null check(char_length(trim(name)) between 2 and 120),
  email text not null check(char_length(trim(email)) between 3 and 254),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists dsb_customer_users_client_idx on public.dsb_customer_users(client_id);

create table if not exists public.dsb_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_number bigint generated always as identity unique,
  client_id uuid not null references public.dsb_records(id) on delete restrict,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  requester_name text check(requester_name is null or char_length(requester_name) between 2 and 120),
  requester_email text check(requester_email is null or char_length(requester_email) between 3 and 254),
  subject text not null check(char_length(trim(subject)) between 3 and 180),
  category text not null default 'Outro' check(category in ('Site','Hospedagem','Domínio','E-mail','Alteração','Bug','Outro')),
  priority text not null default 'Normal' check(priority in ('Baixa','Normal','Alta')),
  status text not null default 'Novo' check(status in ('Novo','Aberto','Em atendimento','Aguardando cliente','Resolvido','Fechado')),
  assigned_to uuid references public.dsb_members(user_id) on delete set null,
  page_url text check(page_url is null or char_length(page_url)<=1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  closed_at timestamptz
);
create index if not exists dsb_tickets_client_idx on public.dsb_tickets(client_id);
create index if not exists dsb_tickets_status_idx on public.dsb_tickets(status);
create index if not exists dsb_tickets_assigned_idx on public.dsb_tickets(assigned_to);
create index if not exists dsb_tickets_activity_idx on public.dsb_tickets(last_activity_at desc);

create table if not exists public.dsb_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.dsb_tickets(id) on delete cascade,
  author_user_id uuid references auth.users(id) on delete set null,
  author_kind text not null default 'client' check(author_kind in ('client','staff')),
  author_name text not null default 'Usuário' check(char_length(author_name) between 2 and 120),
  body text not null check(char_length(trim(body)) between 1 and 5000),
  created_at timestamptz not null default now()
);
create index if not exists dsb_ticket_messages_ticket_idx on public.dsb_ticket_messages(ticket_id,created_at);

create table if not exists public.dsb_ticket_attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.dsb_tickets(id) on delete cascade,
  message_id uuid not null references public.dsb_ticket_messages(id) on delete cascade,
  storage_path text not null unique check(char_length(storage_path) between 10 and 700),
  file_name text not null check(char_length(file_name) between 1 and 180),
  mime_type text not null check(mime_type in ('image/png','image/jpeg','image/webp','application/pdf','text/plain')),
  file_size bigint not null check(file_size between 1 and 10485760),
  created_at timestamptz not null default now()
);
create index if not exists dsb_ticket_attachments_ticket_idx on public.dsb_ticket_attachments(ticket_id);
create index if not exists dsb_ticket_attachments_message_idx on public.dsb_ticket_attachments(message_id);

-- Verifica se o usuário autenticado está vinculado ao cliente informado.
create or replace function public.dsb_is_customer_for(target_client uuid)
returns boolean
language sql stable security definer set search_path=''
as $$
  select exists(
    select 1 from public.dsb_customer_users
    where user_id=(select auth.uid()) and client_id=target_client and active=true
  );
$$;
revoke all on function public.dsb_is_customer_for(uuid) from public,anon;
grant execute on function public.dsb_is_customer_for(uuid) to authenticated;

-- Verifica acesso a um chamado, usado também pelas regras de anexos.
create or replace function public.dsb_ticket_access(target_ticket uuid)
returns boolean
language sql stable security definer set search_path=''
as $$
  select (select public.dsb_is_member()) or exists(
    select 1 from public.dsb_tickets t
    join public.dsb_customer_users cu on cu.client_id=t.client_id
    where t.id=target_ticket and cu.user_id=(select auth.uid()) and cu.active=true
  );
$$;
revoke all on function public.dsb_ticket_access(uuid) from public,anon;
grant execute on function public.dsb_ticket_access(uuid) to authenticated;

-- Valida e prepara o chamado. Cliente externo nunca escolhe outra empresa.
create or replace function public.dsb_prepare_ticket()
returns trigger
language plpgsql security definer set search_path=''
as $$
declare
  customer public.dsb_customer_users%rowtype;
begin
  if TG_OP='INSERT' then
    if (select public.dsb_is_member()) then
      if not exists(select 1 from public.dsb_records r where r.id=new.client_id and r.type='client') then
        raise exception 'Cliente inválido';
      end if;
      new.created_by:=(select auth.uid());
    else
      select * into customer from public.dsb_customer_users
      where user_id=(select auth.uid()) and active=true;
      if customer.user_id is null then raise exception 'Usuário sem empresa autorizada'; end if;
      new.client_id:=customer.client_id;
      new.created_by:=(select auth.uid());
      new.requester_name:=customer.name;
      new.requester_email:=lower(customer.email);
      new.status:='Novo';
      new.assigned_to:=null;
    end if;
    new.created_at:=now();
    new.last_activity_at:=now();
  else
    if pg_trigger_depth()=1 and not (select public.dsb_is_member()) then raise exception 'Apenas a equipe DSB pode alterar o chamado'; end if;
    if new.client_id<>old.client_id or new.ticket_number<>old.ticket_number or new.created_by is distinct from old.created_by then
      raise exception 'Empresa, número e autor do chamado são imutáveis';
    end if;
    if new.status in ('Resolvido','Fechado') and old.status not in ('Resolvido','Fechado') then new.closed_at:=now(); end if;
    if new.status not in ('Resolvido','Fechado') then new.closed_at:=null; end if;
  end if;
  new.updated_at:=now();
  return new;
end;
$$;
revoke all on function public.dsb_prepare_ticket() from public,anon,authenticated;
drop trigger if exists dsb_prepare_ticket on public.dsb_tickets;
create trigger dsb_prepare_ticket before insert or update on public.dsb_tickets for each row execute function public.dsb_prepare_ticket();

-- Define automaticamente se a mensagem veio da equipe ou do cliente.
create or replace function public.dsb_prepare_ticket_message()
returns trigger
language plpgsql security definer set search_path=''
as $$
declare
  staff_name text;
  customer_name text;
begin
  if not public.dsb_ticket_access(new.ticket_id) then raise exception 'Sem acesso a este chamado'; end if;
  new.author_user_id:=(select auth.uid());
  select name into staff_name from public.dsb_members where user_id=(select auth.uid());
  if staff_name is not null then
    new.author_kind:='staff';new.author_name:=staff_name;
  else
    select cu.name into customer_name
    from public.dsb_customer_users cu
    join public.dsb_tickets t on t.client_id=cu.client_id
    where cu.user_id=(select auth.uid()) and cu.active=true and t.id=new.ticket_id;
    if customer_name is null then raise exception 'Usuário do cliente não autorizado'; end if;
    new.author_kind:='client';new.author_name:=customer_name;
  end if;
  new.created_at:=now();
  return new;
end;
$$;
revoke all on function public.dsb_prepare_ticket_message() from public,anon,authenticated;
drop trigger if exists dsb_prepare_ticket_message on public.dsb_ticket_messages;
create trigger dsb_prepare_ticket_message before insert on public.dsb_ticket_messages for each row execute function public.dsb_prepare_ticket_message();

-- Atualiza a atividade do chamado e reabre automaticamente quando o cliente responde.
create or replace function public.dsb_touch_ticket_from_message()
returns trigger
language plpgsql security definer set search_path=''
as $$
begin
  update public.dsb_tickets
  set last_activity_at=now(),updated_at=now(),
      status=case when new.author_kind='client' and status in ('Aguardando cliente','Resolvido','Fechado') then 'Aberto' else status end,
      closed_at=case when new.author_kind='client' and status in ('Aguardando cliente','Resolvido','Fechado') then null else closed_at end
  where id=new.ticket_id;
  return new;
end;
$$;
revoke all on function public.dsb_touch_ticket_from_message() from public,anon,authenticated;
drop trigger if exists dsb_touch_ticket_from_message on public.dsb_ticket_messages;
create trigger dsb_touch_ticket_from_message after insert on public.dsb_ticket_messages for each row execute function public.dsb_touch_ticket_from_message();

-- Garante que o anexo pertence à mesma mensagem/chamado.
create or replace function public.dsb_validate_ticket_attachment()
returns trigger
language plpgsql security definer set search_path=''
as $$
begin
  if not public.dsb_ticket_access(new.ticket_id) then raise exception 'Sem acesso a este chamado'; end if;
  if not exists(select 1 from public.dsb_ticket_messages m where m.id=new.message_id and m.ticket_id=new.ticket_id) then
    raise exception 'Mensagem e chamado não correspondem';
  end if;
  return new;
end;
$$;
revoke all on function public.dsb_validate_ticket_attachment() from public,anon,authenticated;
drop trigger if exists dsb_validate_ticket_attachment on public.dsb_ticket_attachments;
create trigger dsb_validate_ticket_attachment before insert on public.dsb_ticket_attachments for each row execute function public.dsb_validate_ticket_attachment();

-- RLS: equipe vê tudo; cliente vê somente a própria empresa.
alter table public.dsb_customer_users enable row level security;
alter table public.dsb_tickets enable row level security;
alter table public.dsb_ticket_messages enable row level security;
alter table public.dsb_ticket_attachments enable row level security;

revoke all on public.dsb_customer_users,public.dsb_tickets,public.dsb_ticket_messages,public.dsb_ticket_attachments from public,anon,authenticated;
grant select on public.dsb_customer_users to authenticated;
grant select,insert,update,delete on public.dsb_tickets to authenticated;
grant select,insert,delete on public.dsb_ticket_messages to authenticated;
grant select,insert,delete on public.dsb_ticket_attachments to authenticated;
grant all on public.dsb_customer_users,public.dsb_tickets,public.dsb_ticket_messages,public.dsb_ticket_attachments to service_role;
grant usage,select on sequence public.dsb_tickets_ticket_number_seq to authenticated,service_role;

drop policy if exists dsb_customer_users_read on public.dsb_customer_users;
create policy dsb_customer_users_read on public.dsb_customer_users for select to authenticated
using((select public.dsb_is_member()) or user_id=(select auth.uid()));

drop policy if exists dsb_tickets_read on public.dsb_tickets;
create policy dsb_tickets_read on public.dsb_tickets for select to authenticated
using((select public.dsb_is_member()) or public.dsb_is_customer_for(client_id));
drop policy if exists dsb_tickets_insert on public.dsb_tickets;
create policy dsb_tickets_insert on public.dsb_tickets for insert to authenticated
with check((select public.dsb_is_member()) or public.dsb_is_customer_for(client_id));
drop policy if exists dsb_tickets_update on public.dsb_tickets;
create policy dsb_tickets_update on public.dsb_tickets for update to authenticated
using((select public.dsb_is_member())) with check((select public.dsb_is_member()));
drop policy if exists dsb_tickets_delete on public.dsb_tickets;
create policy dsb_tickets_delete on public.dsb_tickets for delete to authenticated
using((select public.dsb_is_admin()));

drop policy if exists dsb_ticket_messages_read on public.dsb_ticket_messages;
create policy dsb_ticket_messages_read on public.dsb_ticket_messages for select to authenticated
using(public.dsb_ticket_access(ticket_id));
drop policy if exists dsb_ticket_messages_insert on public.dsb_ticket_messages;
create policy dsb_ticket_messages_insert on public.dsb_ticket_messages for insert to authenticated
with check(public.dsb_ticket_access(ticket_id));
drop policy if exists dsb_ticket_messages_delete on public.dsb_ticket_messages;
create policy dsb_ticket_messages_delete on public.dsb_ticket_messages for delete to authenticated
using((select public.dsb_is_admin()));

drop policy if exists dsb_ticket_attachments_read on public.dsb_ticket_attachments;
create policy dsb_ticket_attachments_read on public.dsb_ticket_attachments for select to authenticated
using(public.dsb_ticket_access(ticket_id));
drop policy if exists dsb_ticket_attachments_insert on public.dsb_ticket_attachments;
create policy dsb_ticket_attachments_insert on public.dsb_ticket_attachments for insert to authenticated
with check(public.dsb_ticket_access(ticket_id));
drop policy if exists dsb_ticket_attachments_delete on public.dsb_ticket_attachments;
create policy dsb_ticket_attachments_delete on public.dsb_ticket_attachments for delete to authenticated
using((select public.dsb_is_admin()));

-- Bucket privado de anexos. Limite e tipos também são validados no banco/frontend.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('dsb-ticket-attachments','dsb-ticket-attachments',false,10485760,array['image/png','image/jpeg','image/webp','application/pdf','text/plain'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create or replace function public.dsb_ticket_storage_access(object_name text)
returns boolean
language plpgsql stable security definer set search_path=''
as $$
declare first_part text;ticket_id uuid;
begin
  first_part:=split_part(object_name,'/',1);
  if first_part !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then return false; end if;
  ticket_id:=first_part::uuid;
  return public.dsb_ticket_access(ticket_id);
exception when others then return false;
end;
$$;
revoke all on function public.dsb_ticket_storage_access(text) from public,anon;
grant execute on function public.dsb_ticket_storage_access(text) to authenticated;

drop policy if exists dsb_ticket_storage_read on storage.objects;
create policy dsb_ticket_storage_read on storage.objects for select to authenticated
using(bucket_id='dsb-ticket-attachments' and public.dsb_ticket_storage_access(name));
drop policy if exists dsb_ticket_storage_insert on storage.objects;
create policy dsb_ticket_storage_insert on storage.objects for insert to authenticated
with check(bucket_id='dsb-ticket-attachments' and public.dsb_ticket_storage_access(name));
drop policy if exists dsb_ticket_storage_delete on storage.objects;
create policy dsb_ticket_storage_delete on storage.objects for delete to authenticated
using(bucket_id='dsb-ticket-attachments' and (select public.dsb_is_member()) and public.dsb_ticket_storage_access(name));

commit;

-- PORTAL DO CLIENTE (próxima etapa)
-- O portal poderá usar a mesma autenticação Supabase. Para vincular um usuário a um
-- cliente já cadastrado no DSB Manager, criaremos a interface apropriada no próximo passo.
