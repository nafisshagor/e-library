-- JCC E-Library — Hardened Schema & RLS Policies
-- Turn OFF "Confirm email" in Supabase -> Auth -> Providers -> Email
-- Re-run this entire script in the Supabase SQL Editor to apply fixes

-- Ensure faculty is allowed in the role check constraint (for existing DBs)
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('cadet','faculty','principal','vice_principal','adjutant','admin'));

create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  user_id text unique not null,
  full_name text not null,
  role text not null default 'cadet' check (role in ('cadet','faculty','principal','vice_principal','adjutant','admin')),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz default now()
);

create table if not exists books (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  author text,
  genre text not null,
  path text not null,
  cover text,
  size bigint,
  created_at timestamptz default now()
);

-- Secure Functions with explicit search_path
create or replace function is_admin() returns boolean 
language sql security definer set search_path = public stable as
$$ select exists(select 1 from profiles where id = auth.uid() and role = 'admin' and status = 'approved') $$;

create or replace function is_approved() returns boolean 
language sql security definer set search_path = public stable as
$$ select exists(select 1 from profiles where id = auth.uid() and status = 'approved') $$;

-- Trigger for secure new user creation (now includes faculty)
create or replace function handle_new_user() returns trigger 
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, user_id, full_name, role)
  values (
    new.id,
    lower(trim(new.raw_user_meta_data->>'user_id')),
    coalesce(trim(new.raw_user_meta_data->>'full_name'), 'Cadet'),
    case when new.raw_user_meta_data->>'role' in ('cadet','faculty','principal','vice_principal','adjutant')
         then new.raw_user_meta_data->>'role' else 'cadet' end
  );
  return new;
end $$;

drop trigger if exists on_signup on auth.users;
create trigger on_signup after insert on auth.users for each row execute function handle_new_user();

-- Enable RLS
alter table profiles enable row level security;
alter table books enable row level security;

-- Profiles Policies
drop policy if exists "own or admin read" on profiles;
create policy "own or admin read" on profiles for select using (id = auth.uid() or is_admin());

drop policy if exists "admin update" on profiles;
create policy "admin update" on profiles for update using (is_admin());

drop policy if exists "admin delete" on profiles;
create policy "admin delete" on profiles for delete using (is_admin());

-- Books Policies (Strictly approved users only)
drop policy if exists "approved read" on books;
create policy "approved read" on books for select using (is_approved());

drop policy if exists "admin write" on books;
create policy "admin write" on books for all using (is_admin()) with check (is_admin());

-- Storage bucket (private)
insert into storage.buckets (id, name, public) 
values ('books', 'books', false) 
on conflict (id) do update set public = false;

-- Storage Policies — approved users can read; admin can write/delete
drop policy if exists "approved read files" on storage.objects;
create policy "approved read files" on storage.objects
  for select using (bucket_id = 'books' and is_approved());

drop policy if exists "admin add files" on storage.objects;
create policy "admin add files" on storage.objects
  for insert with check (bucket_id = 'books' and is_admin());

drop policy if exists "admin update files" on storage.objects;
create policy "admin update files" on storage.objects
  for update using (bucket_id = 'books' and is_admin());

drop policy if exists "admin remove files" on storage.objects;
create policy "admin remove files" on storage.objects
  for delete using (bucket_id = 'books' and is_admin());

-- Realtime
do $$ begin
  alter publication supabase_realtime add table profiles;
exception when duplicate_object then null;
end $$;
