-- Save the trusted pronunciation recording returned by Free Dictionary API.
-- Empty remains valid because not every dictionary entry includes audio.

alter table public.words
  add column audio_url text not null default '';

alter table public.words
  add constraint words_audio_url_valid check (
    audio_url = btrim(audio_url)
    and char_length(audio_url) <= 1024
    and (
      audio_url = ''
      or audio_url ~ '^https://(api[.]dictionaryapi[.]dev|ssl[.]gstatic[.]com)/[^[:space:]]+$'
    )
  );

comment on column public.words.audio_url is
  'Optional trusted English pronunciation recording supplied by Free Dictionary API.';

grant insert (audio_url) on public.words to authenticated;
