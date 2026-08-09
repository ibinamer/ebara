"use client";

import { Trash2 } from "lucide-react";
import { Dialog, DialogClose } from "./Dialog";
import { WordFacts, WordHeadline } from "./WordFacts";
import { formatDate, useI18n } from "@/lib/i18n";
import type { WordRecord } from "@/lib/words";

export function WordDetailsDialog({
  entry,
  onClose,
  onDelete,
}: {
  entry: WordRecord;
  onClose: () => void;
  onDelete: () => void;
}) {
  const { t, locale } = useI18n();

  return (
    <Dialog onClose={onClose} labelledBy="word-title" className="details-dialog">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="detail-label mb-3">
            {t("word.added")}{" "}
            <time dateTime={entry.created_at}>{formatDate(entry.created_at, locale)}</time>
          </p>
          <WordHeadline
            id="word-title"
            word={entry.word}
            partOfSpeech={entry.part_of_speech}
          />
        </div>
        <DialogClose label={t("word.closeDetails")} onClick={onClose} />
      </div>

      <div className="mt-8">
        <WordFacts entry={entry} />
      </div>

      <div className="mt-8 flex justify-end border-t pt-6" style={{ borderColor: "var(--border)" }}>
        <button type="button" onClick={onDelete} className="danger-button">
          <Trash2 size={15} aria-hidden="true" />
          {t("delete.confirm")}
        </button>
      </div>
    </Dialog>
  );
}
