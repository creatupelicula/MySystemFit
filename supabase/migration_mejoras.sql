-- ============================================================
-- MySystemFit — Migración de mejoras (ejecutar UNA vez en el
-- SQL Editor de Supabase, sobre un proyecto que ya tiene schema.sql).
-- Es idempotente: se puede correr varias veces sin romper nada.
-- ============================================================

-- Fecha de fin de membresía del alumno (además de member_since = inicio)
alter table students add column if not exists membership_end date;

-- Permitir objetivos/seguimientos SIN alumno vinculado (objetivos generales del coach)
alter table follow_ups alter column student_id drop not null;

-- Índices para acelerar las consultas más frecuentes
create index if not exists idx_students_coach   on students(coach_id);
create index if not exists idx_payments_coach    on payments(coach_id);
create index if not exists idx_payments_student  on payments(student_id);
create index if not exists idx_followups_coach   on follow_ups(coach_id);
create index if not exists idx_messages_convo     on messages(coach_id, student_id, created_at);

-- ============================================================
-- Realtime: publicar cambios de estas tablas (mensajes, pagos, seguimientos)
-- Idempotente: ignora si la tabla ya está en la publicación.
-- ============================================================
do $$
begin
  begin execute 'alter publication supabase_realtime add table messages';   exception when duplicate_object then null; end;
  begin execute 'alter publication supabase_realtime add table payments';    exception when duplicate_object then null; end;
  begin execute 'alter publication supabase_realtime add table follow_ups';  exception when duplicate_object then null; end;
end $$;

-- ============================================================
-- Storage: bucket PRIVADO para fotos de progreso (se sirven con URLs
-- firmadas temporales, no públicas) + metadatos
-- ============================================================
insert into storage.buckets (id, name, public)
  values ('progress', 'progress', false)
  on conflict (id) do nothing;
-- Si el bucket ya existía como público (de una corrida previa), volverlo privado
update storage.buckets set public = false where id = 'progress';

-- Políticas de acceso al bucket 'progress': solo usuarios autenticados suben,
-- y solo autenticados pueden leer (necesario para firmar URLs).
drop policy if exists "progress_insert" on storage.objects;
create policy "progress_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'progress');
drop policy if exists "progress_select" on storage.objects;
create policy "progress_select" on storage.objects for select to authenticated
  using (bucket_id = 'progress');

-- Tabla de metadatos de fotos de progreso (guardamos el PATH, no la URL,
-- porque las URLs firmadas caducan)
create table if not exists progress_photos (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  path text not null,
  taken_at date not null default now(),
  created_at timestamptz not null default now()
);
-- Compatibilidad si la tabla existía con columna 'url'
alter table progress_photos add column if not exists path text;
create index if not exists idx_progress_photos_student on progress_photos(student_id, taken_at);

alter table progress_photos enable row level security;
-- El coach ve las fotos de sus alumnos
drop policy if exists "progress_photos_coach_select" on progress_photos;
create policy "progress_photos_coach_select" on progress_photos for select
  using (exists (select 1 from students s where s.id = progress_photos.student_id and s.coach_id = auth.uid()));
-- El alumno gestiona (ve/sube/borra) las suyas
drop policy if exists "progress_photos_student_all" on progress_photos;
create policy "progress_photos_student_all" on progress_photos for all
  using (exists (select 1 from students s where s.id = progress_photos.student_id and s.profile_id = auth.uid()))
  with check (exists (select 1 from students s where s.id = progress_photos.student_id and s.profile_id = auth.uid()));
