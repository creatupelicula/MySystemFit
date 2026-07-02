-- ============================================================
-- MySystemFit — Schema de Supabase
-- Ejecutar completo en el SQL Editor de tu proyecto Supabase.
-- Requiere: extensión pgcrypto (activada por defecto en Supabase).
-- ============================================================

-- ---------- Perfiles (coach o alumno) ----------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('coach', 'alumno')),
  full_name text not null,
  email text not null,
  phone text,
  avatar_initials text,
  specialty text,               -- solo coach
  plan text default 'Star Plus',-- solo coach
  coach_id uuid references profiles(id) on delete set null, -- solo alumno: a qué coach pertenece
  created_at timestamptz not null default now()
);

-- ---------- Alumnos (datos de negocio, separados del auth) ----------
create table if not exists students (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references profiles(id) on delete cascade,
  profile_id uuid references profiles(id) on delete set null, -- null hasta que el alumno acepte la invitación
  full_name text not null,
  age int,
  email text,
  phone text,
  training_type text not null default 'Online' check (training_type in ('Online','Presencial')),
  goal text,
  state text not null default 'pend' check (state in ('ok','pend','late')),
  weight_current numeric,
  weight_goal numeric,
  height numeric,
  member_since date default now(),
  private_notes text,
  created_at timestamptz not null default now()
);

-- ---------- Pagos ----------
create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references profiles(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  concept text not null,
  amount numeric not null,
  due_date date not null,
  state text not null default 'pend' check (state in ('ok','pend','late')),
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------- Rutinas ----------
create table if not exists routines (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references profiles(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  name text not null default 'Rutina',
  phase text,
  week int default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists routine_days (
  id uuid primary key default gen_random_uuid(),
  routine_id uuid not null references routines(id) on delete cascade,
  day_name text not null,       -- 'lunes', 'martes', ...
  sort_order int not null default 0,
  label text                    -- ej. 'Pecho', 'Descanso'
);

create table if not exists routine_exercises (
  id uuid primary key default gen_random_uuid(),
  routine_day_id uuid not null references routine_days(id) on delete cascade,
  name text not null,
  sets int,
  reps int,
  kg numeric,
  rest_seconds int,
  sort_order int not null default 0
);

-- ---------- Seguimientos / check-ins ----------
create table if not exists follow_ups (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references profiles(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  title text not null,
  subtitle text,
  due_at timestamptz not null default now(),
  is_done boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists weight_logs (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  weight numeric not null,
  logged_at date not null default now()
);

-- ---------- Comunidad ----------
create table if not exists community_posts (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references profiles(id) on delete cascade,
  author_id uuid not null references profiles(id) on delete cascade,
  body text not null,
  image_url text,
  created_at timestamptz not null default now()
);

create table if not exists community_likes (
  post_id uuid not null references community_posts(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, profile_id)
);

create table if not exists community_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references community_posts(id) on delete cascade,
  author_id uuid not null references profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

-- ---------- Mensajes ----------
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references profiles(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  sender_id uuid not null references profiles(id),
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

-- ============================================================
-- Row Level Security
-- ============================================================
alter table profiles enable row level security;
alter table students enable row level security;
alter table payments enable row level security;
alter table routines enable row level security;
alter table routine_days enable row level security;
alter table routine_exercises enable row level security;
alter table follow_ups enable row level security;
alter table weight_logs enable row level security;
alter table community_posts enable row level security;
alter table community_likes enable row level security;
alter table community_comments enable row level security;
alter table messages enable row level security;

-- profiles: cada quien ve su propio perfil + el coach ve los de sus alumnos
create policy "profiles_select_own_or_coach" on profiles for select
  using (id = auth.uid() or coach_id = auth.uid());
create policy "profiles_update_own" on profiles for update
  using (id = auth.uid());
create policy "profiles_insert_own" on profiles for insert
  with check (id = auth.uid());

-- students: el coach ve/edita los suyos; el alumno ve su propia fila
create policy "students_coach_all" on students for all
  using (coach_id = auth.uid()) with check (coach_id = auth.uid());
create policy "students_self_select" on students for select
  using (profile_id = auth.uid());

-- payments
create policy "payments_coach_all" on payments for all
  using (coach_id = auth.uid()) with check (coach_id = auth.uid());
create policy "payments_student_select" on payments for select
  using (exists (select 1 from students s where s.id = payments.student_id and s.profile_id = auth.uid()));

-- routines
create policy "routines_coach_all" on routines for all
  using (coach_id = auth.uid()) with check (coach_id = auth.uid());
create policy "routines_student_select" on routines for select
  using (exists (select 1 from students s where s.id = routines.student_id and s.profile_id = auth.uid()));

create policy "routine_days_via_routine" on routine_days for all
  using (exists (select 1 from routines r where r.id = routine_days.routine_id and
    (r.coach_id = auth.uid() or exists (select 1 from students s where s.id = r.student_id and s.profile_id = auth.uid()))))
  with check (exists (select 1 from routines r where r.id = routine_days.routine_id and r.coach_id = auth.uid()));

create policy "routine_exercises_via_day" on routine_exercises for all
  using (exists (select 1 from routine_days d join routines r on r.id = d.routine_id where d.id = routine_exercises.routine_day_id and
    (r.coach_id = auth.uid() or exists (select 1 from students s where s.id = r.student_id and s.profile_id = auth.uid()))))
  with check (exists (select 1 from routine_days d join routines r on r.id = d.routine_id where d.id = routine_exercises.routine_day_id and r.coach_id = auth.uid()));

-- follow_ups
create policy "follow_ups_coach_all" on follow_ups for all
  using (coach_id = auth.uid()) with check (coach_id = auth.uid());

-- weight_logs
create policy "weight_logs_coach_all" on weight_logs for all
  using (exists (select 1 from students s where s.id = weight_logs.student_id and s.coach_id = auth.uid()))
  with check (exists (select 1 from students s where s.id = weight_logs.student_id and s.coach_id = auth.uid()));
create policy "weight_logs_student_all" on weight_logs for all
  using (exists (select 1 from students s where s.id = weight_logs.student_id and s.profile_id = auth.uid()))
  with check (exists (select 1 from students s where s.id = weight_logs.student_id and s.profile_id = auth.uid()));

-- community: visible para el coach y todos sus alumnos
create policy "community_posts_coach_all" on community_posts for all
  using (coach_id = auth.uid()) with check (coach_id = auth.uid() and author_id = auth.uid());
create policy "community_posts_student_select" on community_posts for select
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.coach_id = community_posts.coach_id));
create policy "community_posts_student_insert" on community_posts for insert
  with check (author_id = auth.uid() and exists (select 1 from profiles p where p.id = auth.uid() and p.coach_id = community_posts.coach_id));

create policy "community_likes_all" on community_likes for all
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());
create policy "community_likes_select" on community_likes for select using (true);

create policy "community_comments_insert" on community_comments for insert
  with check (author_id = auth.uid());
create policy "community_comments_select" on community_comments for select using (true);

-- messages: solo coach y el alumno de esa conversación
create policy "messages_participants" on messages for all
  using (
    coach_id = auth.uid()
    or exists (select 1 from students s where s.id = messages.student_id and s.profile_id = auth.uid())
  )
  with check (
    sender_id = auth.uid() and (
      coach_id = auth.uid()
      or exists (select 1 from students s where s.id = messages.student_id and s.profile_id = auth.uid())
    )
  );

-- ============================================================
-- Trigger: crear profile automáticamente al registrarse
-- (rol y nombre vienen del metadata pasado en signUp())
-- ============================================================
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, role, full_name, email, avatar_initials, coach_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'role', 'alumno'),
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.email,
    upper(left(coalesce(new.raw_user_meta_data->>'full_name', new.email), 2)),
    nullif(new.raw_user_meta_data->>'coach_id', '')::uuid
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
