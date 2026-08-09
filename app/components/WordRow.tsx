"use client";

import { X } from "lucide-react";
import { formatDate, translatePartOfSpeech, useI18n } from "@/lib/i18n";
import type { WordRecord } from "@/lib/words";

/**
 * One entry in the glossary. Laid out like a dictionary line — headword and
 * its part of speech, then the Arabic, then the date in the margin — rather
 * than as a card. The row owns no border of its own; the hairline above it
 * belongs to the list.
 */
export function WordRow({
  entry,
  index,
  onOpen,
  onDelete,
}: {
  entry: WordRecord;
  index: number;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const { t, locale } = useI18n();

  return (
    <li
      className="word-row"
      style={{ animationDelay: `${Math.min(index, 12) * 18}ms` }}
    >
      <button type="button" onClick={onOpen} className="word-row-open">
        <span className="min-w-0">
          <span dir="ltr" className="word-term bidi-isolate">
            {entry.word}
          </span>
          {entry.part_of_speech && (
            <>
              {" "}
              <span className="word-pos">
                {translatePartOfSpeech(t, entry.part_of_speech)}
              </span>
            </>
          )}
        </span>

        <span lang="ar" dir="rtl" className="word-gloss bidi-isolate text-ui-start">
          {entry.meaning_ar}
        </span>

        <time className="word-date" dateTime={entry.created_at}>
          {formatDate(entry.created_at, locale)}
        </time>
      </button>

      <button
        type="button"
        onClick={onDelete}
        className="row-delete"
        aria-label={t("word.delete", { word: entry.word })}
      >
        <X size={15} aria-hidden="true" />
      </button>
    </li>
  );
}
