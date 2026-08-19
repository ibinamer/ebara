-- EBARA: adds a translated Arabic definition alongside the existing short
-- Arabic meaning. meaning_ar stays a headword-level gloss (e.g. "بكاء");
-- definition_ar is a full Arabic translation of definition_en itself, so a
-- saved word carries both a quick gloss and the full definition in Arabic.

alter table public.words
  add column definition_ar text not null default '';

-- No lower bound, unlike definition_en: existing rows get '' from the
-- default above and must remain valid. The application always supplies a
-- real translated value for new inserts and updates going forward.
alter table public.words
  add constraint words_definition_ar_valid check (
    definition_ar = btrim(definition_ar)
    and char_length(definition_ar) <= 1500
  );

comment on column public.words.definition_ar is
  'Arabic translation of definition_en. Distinct from meaning_ar, which is a short headword-level gloss rather than a translated definition.';

grant insert (definition_ar) on public.words to authenticated;
grant update (definition_ar) on public.words to authenticated;
