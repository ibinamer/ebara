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
 * The shared vocabulary read-out: pronunciation, IPA, the short Arabic
 * meaning (a headword-level gloss, e.g. "بكاء"), and the definition set in
 * both languages — the English original from the dictionary, and its Arabic
 * translation directly beneath it. Used by both the detail dialog and the
 * add-word review step so a word always looks the same wherever it appears.
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
        {entry.definition_ar && (
          <p
            lang="ar"
            dir="rtl"
            className="bidi-isolate text-ui-start type-body mt-2.5 max-w-2xl"
            style={{ color: "var(--text-muted)" }}
          >
            {entry.definition_ar}
          </p>
        )}
      </Row>
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
