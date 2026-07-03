-- ============================================================
-- MySystemFit — Migración: planes Star / Star Plus
-- Ejecutar en el SQL Editor de Supabase DESPUÉS de schema.sql.
-- Idempotente: se puede correr más de una vez sin romper nada.
-- Agrega: límites de alumnos por plan, código de referido + tabla
-- de referidos, asistencia diaria (presencial) y grupo muscular
-- en los ejercicios.
-- ============================================================

-- ---------- Plan del coach ----------
-- Normaliza el plan a los 2 planes actuales (Kings llegará después).
alter table profiles alter column plan set default 'Star';
update profiles set plan = 'Star Plus' where plan not in ('Star', 'Star Plus') and role = 'coach';

-- ---------- Código de referido ----------
alter table profiles add column if not exists referral_code text unique;
alter table profiles add column if not exists referred_by uuid references profiles(id) on delete set null;

-- Genera un código corto tipo MSF-AB12CD para los coaches que no tengan.
create or replace function public.gen_referral_code()
returns text as $$
declare code text;
begin
  loop
    code := 'MSF-' || upper(substr(md5(gen_random_uuid()::text), 1, 6));
    exit when not exists (select 1 from profiles where referral_code = code);
  end loop;
  return code;
end;
$$ language plpgsql volatile;

update profiles set referral_code = public.gen_referral_code()
  where role = 'coach' and referral_code is null;

-- ---------- Tabla de referidos ----------
create table if not exists referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references profiles(id) on delete cascade, -- coach que refirió
  referred_id uuid not null references profiles(id) on delete cascade, -- coach nuevo
  code_used text not null,
  created_at timestamptz not null default now(),
  unique (referred_id)
);
alter table referrals enable row level security;
drop policy if exists "referrals_referrer_select" on referrals;
create policy "referrals_referrer_select" on referrals for select
  using (referrer_id = auth.uid() or referred_id = auth.uid());

-- ---------- Asistencia diaria (alumnos presenciales) ----------
create table if not exists attendance (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  date date not null default now(),
  attending boolean not null,
  reason text,                -- motivo cuando no asiste (o comentario)
  created_at timestamptz not null default now(),
  unique (student_id, date)
);
alter table attendance enable row level security;
drop policy if exists "attendance_coach_select" on attendance;
create policy "attendance_coach_select" on attendance for select
  using (exists (select 1 from students s where s.id = attendance.student_id and s.coach_id = auth.uid()));
drop policy if exists "attendance_student_all" on attendance;
create policy "attendance_student_all" on attendance for all
  using (exists (select 1 from students s where s.id = attendance.student_id and s.profile_id = auth.uid()))
  with check (exists (select 1 from students s where s.id = attendance.student_id and s.profile_id = auth.uid()));

-- ---------- Grupo muscular en ejercicios ----------
alter table routine_exercises add column if not exists muscle_group text;

-- ---------- Límite de alumnos por plan (enforcement en BD) ----------
create or replace function public.plan_student_limit(p text)
returns int as $$
  select case p
    when 'Star' then 30
    when 'Star Plus' then 100
    when 'Kings' then 500
    else 30
  end;
$$ language sql immutable;

create or replace function public.enforce_student_limit()
returns trigger as $$
declare
  coach_plan text;
  current_count int;
  max_allowed int;
begin
  select plan into coach_plan from profiles where id = new.coach_id;
  max_allowed := public.plan_student_limit(coalesce(coach_plan, 'Star'));
  select count(*) into current_count from students where coach_id = new.coach_id;
  if current_count >= max_allowed then
    raise exception 'PLAN_LIMIT: tu plan % permite máximo % alumnos', coalesce(coach_plan, 'Star'), max_allowed
      using errcode = 'P0001';
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_student_limit on students;
create trigger trg_student_limit
  before insert on students
  for each row execute function public.enforce_student_limit();

-- ---------- Trigger de registro: código de referido + vínculo ----------
-- Reemplaza handle_new_user para que: (a) todo coach nuevo reciba su
-- referral_code, (b) si el signup trae referral_code de otro coach,
-- se registre en referrals.
create or replace function public.handle_new_user()
returns trigger as $$
declare
  v_role text := coalesce(new.raw_user_meta_data->>'role', 'alumno');
  v_ref_code text := nullif(new.raw_user_meta_data->>'referral_code', '');
  v_referrer uuid;
begin
  insert into public.profiles (id, role, full_name, email, avatar_initials, coach_id, plan, referral_code)
  values (
    new.id,
    v_role,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.email,
    upper(left(coalesce(new.raw_user_meta_data->>'full_name', new.email), 2)),
    nullif(new.raw_user_meta_data->>'coach_id', '')::uuid,
    case when v_role = 'coach' then 'Star' else null end,
    case when v_role = 'coach' then public.gen_referral_code() else null end
  );
  if v_role = 'coach' and v_ref_code is not null then
    select id into v_referrer from public.profiles
      where referral_code = v_ref_code and role = 'coach';
    if v_referrer is not null and v_referrer <> new.id then
      update public.profiles set referred_by = v_referrer where id = new.id;
      insert into public.referrals (referrer_id, referred_id, code_used)
        values (v_referrer, new.id, v_ref_code)
        on conflict (referred_id) do nothing;
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;
