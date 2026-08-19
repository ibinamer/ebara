-- EBARA: adds a free-text personal note to each saved word, e.g. where the
-- learner heard it. Unlike the dictionary fields, this is entirely
-- user-authored and can be added or edited at any time after saving, not
-- just at save time.

alter table public.words
  add column notes text not null default '';

-- No lower bound: most words will never have a note, and that is the
-- expected, valid state, not a data-quality problem the way an empty
-- definition would be.
alter table public.words
  add constraint words_notes_valid check (
    notes = btrim(notes)
    and char_length(notes) <= 2000
  );

comment on column public.words.notes is
  'Free-text personal note the learner writes themselves, e.g. where they heard the word. Not sourced from any dictionary.';

grant insert (notes) on public.words to authenticated;
grant update (notes) on public.words to authenticated;
