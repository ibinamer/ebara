-- Allow EBARA to save a short translated expression or sentence without
-- inventing dictionary-only fields. Existing word records remain unchanged.

alter table public.words
  drop constraint if exists words_word_valid;

alter table public.words
  add constraint words_word_valid check (
    word = btrim(word)
    and char_length(word) between 1 and 160
  );

alter table public.words
  drop constraint if exists words_definition_en_valid;

alter table public.words
  add constraint words_definition_en_valid check (
    definition_en = btrim(definition_en)
    and char_length(definition_en) between 0 and 1500
  );

comment on column public.words.definition_en is
  'Dictionary definition when available; empty only for translation-only expressions and sentences.';
