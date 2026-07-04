-- ============================================================
-- MySystemFit — Migración de auditoría (YA APLICADA al proyecto
-- fqlwirnaproktxrtdqya vía MCP el 2026-07-03; este archivo es
-- referencia para reproducir el entorno desde cero).
-- Idempotente.
-- ============================================================

-- ---------- Seguridad: search_path fijo y sin EXECUTE público ----------
alter function public.gen_referral_code() set search_path = public;
alter function public.plan_student_limit(text) set search_path = public;
revoke execute on function public.enforce_student_limit() from anon, authenticated, public;
revoke execute on function public.handle_new_user() from anon, authenticated, public;
revoke execute on function public.gen_referral_code() from anon, authenticated, public;
revoke execute on function public.plan_student_limit(text) from anon, authenticated, public;

-- ---------- Índices de FKs (los del advisor de performance) ----------
create index if not exists idx_profiles_coach on profiles(coach_id);
create index if not exists idx_profiles_referred_by on profiles(referred_by);
create index if not exists idx_students_coach on students(coach_id);
create index if not exists idx_students_profile on students(profile_id);
create index if not exists idx_payments_coach on payments(coach_id);
create index if not exists idx_payments_student on payments(student_id);
create index if not exists idx_routines_coach on routines(coach_id);
create index if not exists idx_routines_student on routines(student_id);
create index if not exists idx_routine_exercises_day on routine_exercises(routine_day_id);
create index if not exists idx_followups_coach on follow_ups(coach_id);
create index if not exists idx_followups_student on follow_ups(student_id);
create index if not exists idx_weight_logs_student on weight_logs(student_id, logged_at);
create index if not exists idx_progress_photos_student on progress_photos(student_id, taken_at);
create index if not exists idx_community_posts_coach on community_posts(coach_id, created_at);
create index if not exists idx_community_posts_author on community_posts(author_id);
create index if not exists idx_community_likes_profile on community_likes(profile_id);
create index if not exists idx_community_comments_post on community_comments(post_id);
create index if not exists idx_community_comments_author on community_comments(author_id);
create index if not exists idx_messages_convo on messages(coach_id, student_id, created_at);
create index if not exists idx_messages_student on messages(student_id);
create index if not exists idx_messages_sender on messages(sender_id);
create index if not exists idx_referrals_referrer on referrals(referrer_id);

-- ---------- RLS: (select auth.uid()) — una evaluación por consulta ----------
-- Todas las políticas se recrearon envolviendo auth.uid() en (select auth.uid()).
-- Ver el detalle completo en la migración rls_initplan_optimization del proyecto;
-- la semántica es idéntica a las políticas de schema.sql.

-- ---------- El alumno puede ver el perfil de SU coach ----------
-- (con función definer para evitar recursión de la política sobre profiles)
create or replace function public.my_coach_id()
returns uuid as $$
  select coach_id from public.profiles where id = auth.uid();
$$ language sql stable security definer set search_path = public;
revoke execute on function public.my_coach_id() from anon, public;
grant execute on function public.my_coach_id() to authenticated;
drop policy if exists "profiles_select_own_coach" on profiles;
create policy "profiles_select_own_coach" on profiles for select
  using (id = public.my_coach_id());

-- ---------- Validación del ID de coach en el registro ----------
create or replace function public.coach_exists(cid uuid)
returns boolean as $$
  select exists (select 1 from public.profiles where id = cid and role = 'coach');
$$ language sql stable security definer set search_path = public;
grant execute on function public.coach_exists(uuid) to anon, authenticated;

-- ---------- handle_new_user v3 ----------
-- (a) alumno auto-registrado: valida el coach y crea su ficha en students
-- (b) alta desde panel: metadata created_by_coach='1' → el panel crea la ficha
-- (c) coach: plan Star + código de referido + registro de referidos
create or replace function public.handle_new_user()
returns trigger as $$
declare
  v_role text := coalesce(new.raw_user_meta_data->>'role', 'alumno');
  v_ref_code text := nullif(new.raw_user_meta_data->>'referral_code', '');
  v_coach uuid := nullif(new.raw_user_meta_data->>'coach_id', '')::uuid;
  v_by_coach boolean := coalesce(new.raw_user_meta_data->>'created_by_coach', '') = '1';
  v_referrer uuid;
begin
  if v_role = 'alumno' and v_coach is not null then
    if not exists (select 1 from public.profiles where id = v_coach and role = 'coach') then
      v_coach := null;
    end if;
  end if;

  insert into public.profiles (id, role, full_name, email, avatar_initials, coach_id, plan, referral_code)
  values (
    new.id,
    v_role,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.email,
    upper(left(coalesce(new.raw_user_meta_data->>'full_name', new.email), 2)),
    v_coach,
    case when v_role = 'coach' then 'Star' else null end,
    case when v_role = 'coach' then public.gen_referral_code() else null end
  );

  if v_role = 'alumno' and v_coach is not null and not v_by_coach then
    insert into public.students (coach_id, profile_id, full_name, email, training_type, state)
    values (v_coach, new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), new.email, 'Online', 'pend');
  end if;

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
revoke execute on function public.handle_new_user() from anon, authenticated, public;
