"use client";

import { Volume2 } from "lucide-react";
import { translatePartOfSpeech, useI18n } from "@/lib/i18n";
import { speakWord } from "@/lib/speech";
import type { DictionaryEntry } from "@/lib/words";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-t pt-5" style={{ borderColor: "var(--border)" }}>
      <p className="detail-label">{label}</p>
      <div className="mt-2.5">{children}</div>
    </div>
  );
}

/**
 * The shared vocabulary read-out: pronunciation, IPA, Arabic meaning,
 * definition and example. Used by both the detail dialog and the add-word
 * review step so a word always looks the same wherever it appears.
 */
export function WordFacts({ entry }: { entry: DictionaryEntry }) {
  const { t } = useI18n();

  return (
    <div className="flex flex-col gap-5">
      {(entry.pronunciation || entry.ipa) && (
        <div className="flex flex-wrap items-baseline gap-x-10 gap-y-3">
          {entry.pronunciation && (
            <div>
              <p className="detail-label">{t("word.pronunciation")}</p>
              <button
                type="button"
                onClick={() => speakWord(entry.word)}
                className="pronunciation-button mt-2"
                aria-label={t("word.pronounce", { word: entry.word })}
              >
                <Volume2 size={15} aria-hidden="true" />
                <span dir="ltr" className="bidi-isolate">
                  {entry.pronunciation}
                </span>
              </button>
            </div>
          )}

          {entry.ipa && (
            <div>
              <p className="detail-label">{t("word.ipa")}</p>
              <p
                dir="ltr"
                className="bidi-isolate mt-2 font-mono text-sm"
                style={{ color: "var(--accent-text)" }}
              >
                {entry.ipa}
              </p>
            </div>
          )}
        </div>
      )}

      <Row label={t("word.arabic")}>
        <p
          lang="ar"
          dir="rtl"
          className="bidi-isolate text-ui-start type-meaning"
          style={{ color: "var(--text)" }}
        >
          {entry.meaning_ar}
        </p>
      </Row>

      <Row label={t("word.definition")}>
        <p
          dir="ltr"
          className="force-ltr type-body max-w-2xl"
          style={{ color: "var(--text-muted)" }}
        >
          {entry.definition_en}
        </p>
      </Row>

      {entry.example_sentence && (
        <Row label={t("word.example")}>
          <p
            dir="ltr"
            className="force-ltr type-body max-w-2xl border-l-2 pl-4 italic"
            style={{ borderColor: "var(--accent-border)", color: "var(--text-muted)" }}
          >
            {entry.example_sentence}
          </p>
        </Row>
      )}
    </div>
  );
}

export function WordHeadline({
  id,
  word,
  partOfSpeech,
  size = "lg",
}: {
  id?: string;
  word: string;
  partOfSpeech?: string;
  size?: "md" | "lg";
}) {
  const { t } = useI18n();

  return (
    <div className="min-w-0">
      <h2
        id={id}
        dir="ltr"
        className={`bidi-isolate text-ui-start ${
          size === "lg" ? "type-word-lg" : "type-word-md"
        }`}
        style={{ color: "var(--text)", overflowWrap: "anywhere" }}
      >
        {word}
      </h2>
      {partOfSpeech && (
        <p className="badge badge-accent mt-2">
          {translatePartOfSpeech(t, partOfSpeech)}
        </p>
      )}
    </div>
  );
}
