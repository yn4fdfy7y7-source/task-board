begin;

create table if not exists public.board_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','executor'))
);
create unique index if not exists board_single_owner on public.board_members (role) where role='admin';
create table if not exists public.board_tasks (
  id uuid primary key,
  title text not null check (length(trim(title)) between 1 and 140),
  brief text not null check (length(trim(brief)) between 1 and 5000),
  outcome text not null check (length(trim(outcome)) between 1 and 3000),
  email text not null check (length(email) <= 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'),
  category text not null check (category in ('general','design','dev','content')),
  status text not null default 'new' check (status in ('new','urgent','active','review','done')),
  created timestamptz not null default now(),
  assignee uuid references auth.users(id) on delete set null,
  revision integer not null default 0
);
create index if not exists board_tasks_order on public.board_tasks(created desc,id);
alter table public.board_tasks enable row level security;
alter table public.board_members enable row level security;
revoke all on public.board_tasks,public.board_members from public,anon,authenticated;
grant select on public.board_tasks,public.board_members to authenticated;
drop policy if exists board_own_membership on public.board_members;
create policy board_own_membership on public.board_members for select to authenticated using (user_id=(select auth.uid()));
drop policy if exists board_team_read on public.board_tasks;
create policy board_team_read on public.board_tasks for select to authenticated
using (exists(select 1 from public.board_members where user_id=(select auth.uid())));

create or replace function public.board_submit(request_id uuid, task_title text, task_brief text, task_outcome text, contact text, lane text)
returns void language plpgsql security definer set search_path='' as $$
begin
  insert into public.board_tasks(id,title,brief,outcome,email,category)
  values (request_id,trim(task_title),trim(task_brief),trim(task_outcome),trim(contact),lane)
  on conflict (id) do nothing;
  if not found and not exists (
    select 1 from public.board_tasks t where t.id=request_id and t.title=trim(task_title)
      and t.brief=trim(task_brief) and t.outcome=trim(task_outcome) and t.email=trim(contact) and t.category=lane
  ) then raise exception 'Новая отправка требует нового номера заявки.'; end if;
end $$;

create or replace function public.board_move(request_id uuid, expected_version integer, new_status text)
returns void language plpgsql security definer set search_path='' as $$
declare staff_role text;
begin
  select role into staff_role from public.board_members where user_id=auth.uid();
  if staff_role is null then raise exception 'Требуется доступ к доске.'; end if;
  update public.board_tasks set status=new_status, revision=revision+1,
    assignee=case when new_status='new' then null else coalesce(assignee,auth.uid()) end
  where id=request_id and revision=expected_version
    and (staff_role='admin' or assignee=auth.uid() or (assignee is null and new_status='active'));
  if not found then raise exception 'Заявка уже изменилась или назначена другому исполнителю.'; end if;
end $$;

create or replace function public.board_executor(account_email text, enabled boolean)
returns void language plpgsql security definer set search_path='' as $$
declare member_id uuid;
begin
  if not exists (select 1 from public.board_members where user_id=auth.uid() and role='admin')
    then raise exception 'Требуется доступ администратора.'; end if;
  select id into member_id from auth.users where lower(email)=lower(trim(account_email)) and email_confirmed_at is not null;
  if member_id is null then raise exception 'Создайте и подтвердите пользователя в Supabase Auth.'; end if;
  if exists (select 1 from public.board_members where user_id=member_id and role='admin')
    then raise exception 'Это владелец доски.'; end if;
  if enabled then
    insert into public.board_members values (member_id,'executor') on conflict do nothing;
  else
    delete from public.board_members where user_id=member_id and role='executor';
    update public.board_tasks set assignee=null,revision=revision+1 where assignee=member_id;
  end if;
end $$;

revoke all on function public.board_submit(uuid,text,text,text,text,text),public.board_move(uuid,integer,text),public.board_executor(text,boolean) from public,anon,authenticated;
grant execute on function public.board_submit(uuid,text,text,text,text,text) to anon,authenticated;
grant execute on function public.board_move(uuid,integer,text),public.board_executor(text,boolean) to authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime') and not exists
    (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='board_tasks')
  then alter publication supabase_realtime add table public.board_tasks; end if;
end $$;
create or replace function public.board_ready()
returns boolean language sql stable security invoker set search_path='' as $$ select true $$;
revoke all on function public.board_ready() from public,anon,authenticated;
grant execute on function public.board_ready() to anon,authenticated;
commit;
