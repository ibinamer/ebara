-- EBARA: private user profiles and vocabulary records.
-- Supabase Auth remains the source of truth for identity in auth.users.

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  created_at timestamptz not null default now(),

  constraint profiles_email_length check (
    email is null or char_length(email) <= 320
  )
);

comment on table public.profiles is
  'Private application profile linked one-to-one with auth.users.';

create table public.words (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  word text not null,
  meaning_ar text not null,
  definition_en text not null,
  pronunciation text not null default '',
  ipa text not null default '',
  part_of_speech text not null,
  example_sentence text not null default '',
  created_at timestamptz not null default now(),

  constraint words_word_valid check (
    word = btrim(word)
    and char_length(word) between 1 and 80
  ),
  constraint words_meaning_ar_valid check (
    meaning_ar = btrim(meaning_ar)
    and char_length(meaning_ar) between 1 and 512
  ),
  constraint words_definition_en_valid check (
    definition_en = btrim(definition_en)
    and char_length(definition_en) between 1 and 1500
  ),
  constraint words_pronunciation_valid check (
    pronunciation = btrim(pronunciation)
    and char_length(pronunciation) <= 160
  ),
  constraint words_ipa_valid check (
    ipa = btrim(ipa)
    and char_length(ipa) <= 180
  ),
  constraint words_part_of_speech_valid check (
    part_of_speech = btrim(part_of_speech)
    and char_length(part_of_speech) between 1 and 80
  ),
  constraint words_example_sentence_valid check (
    example_sentence = btrim(example_sentence)
    and char_length(example_sentence) <= 1000
  )
);

comment on table public.words is
  'Vocabulary entries that are visible only to their owning user.';

-- Main dashboard query: owner-scoped, newest first.
create index words_user_created_at_idx
  on public.words (user_id, created_at desc);

-- Treat differently-cased spellings as the same saved word for one user.
-- This is the race-safe database guard after both client and server check the
-- owner's saved collection before making any dictionary requests.
create unique index words_user_word_unique_idx
  on public.words (user_id, lower(word));

-- Support fast partial, case-insensitive searches in either language.
create index words_word_search_idx
  on public.words using gin (lower(word) extensions.gin_trgm_ops);

create index words_meaning_ar_search_idx
  on public.words using gin (lower(meaning_ar) extensions.gin_trgm_ops);

-- Backfill profiles if this migration is applied to a project with users.
insert into public.profiles (id, email, created_at)
select id, email, created_at
from auth.users
on conflict (id) do update
set email = excluded.email;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, created_at)
  values (new.id, new.email, new.created_at)
  on conflict (id) do update
  set email = excluded.email;

  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.profiles force row level security;
alter table public.words enable row level security;
alter table public.words force row level security;

create policy "Users can read their own profile"
on public.profiles
for select
to authenticated
using ((select auth.uid()) = id);

create policy "Users can read their own words"
on public.words
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can add their own words"
on public.words
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update their own words"
on public.words
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can delete their own words"
on public.words
for delete
to authenticated
using ((select auth.uid()) = user_id);

-- Keep anonymous clients locked out and prevent ownership/timestamp rewrites.
revoke all on table public.profiles from anon, authenticated;
revoke all on table public.words from anon, authenticated;

grant select on table public.profiles to authenticated;

grant select, delete on table public.words to authenticated;
grant insert (
  user_id,
  word,
  meaning_ar,
  definition_en,
  pronunciation,
  ipa,
  part_of_speech,
  example_sentence
) on public.words to authenticated;
grant update (
  word,
  meaning_ar,
  definition_en,
  pronunciation,
  ipa,
  part_of_speech,
  example_sentence
) on public.words to authenticated;

-- The server-only service role remains available for trusted maintenance.
grant all on table public.profiles, public.words to service_role;
