"use client";

import { LoaderCircle, Trash2 } from "lucide-react";
import { useState } from "react";
import { Dialog, DialogClose } from "./Dialog";
import { WordFacts, WordHeadline } from "./WordFacts";
import { formatDate, useI18n } from "@/lib/i18n";
import type { WordRecord } from "@/lib/words";

export function WordDetailsDialog({
  entry,
  onClose,
  onDelete,
  onSaveNotes,
}: {
  entry: WordRecord;
  onClose: () => void;
  onDelete: () => void;
  onSaveNotes: (notes: string) => Promise<void>;
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

      {/* Words saved before this field existed have no `notes` property at
          all in storage, not just an empty string. */}
      <NotesEditor notes={entry.notes ?? ""} onSave={onSaveNotes} />

      <div className="mt-8 flex justify-end border-t pt-6" style={{ borderColor: "var(--border)" }}>
        <button type="button" onClick={onDelete} className="danger-button">
          <Trash2 size={15} aria-hidden="true" />
          {t("delete.confirm")}
        </button>
      </div>
    </Dialog>
  );
}

/**
 * A personal note, entirely separate from the dictionary data above it —
 * where the learner heard the word, or anything else they want to remember.
 * Saving is explicit rather than on blur, matching every other write in the
 * app (add, delete): a stray click away from the field should never silently
 * commit a half-finished note.
 */
function NotesEditor({
  notes,
  onSave,
}: {
  notes: string;
  onSave: (notes: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(notes);
  const [savedValue, setSavedValue] = useState(notes);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isDirty = draft.trim() !== savedValue;

  async function handleSave() {
    setIsSaving(true);
    setError(null);
    try {
      const trimmed = draft.trim();
      await onSave(trimmed);
      setDraft(trimmed);
      setSavedValue(trimmed);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("word.notesSaveError"));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="mt-8 border-t pt-6" style={{ borderColor: "var(--border)" }}>
      <label htmlFor="word-notes" className="detail-label">
        {t("word.notes")}
      </label>
      <textarea
        id="word-notes"
        dir="auto"
        rows={3}
        maxLength={2000}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          setError(null);
        }}
        placeholder={t("word.notesPlaceholder")}
        className="field-input type-body mt-2.5 resize-none py-2.5"
        style={{ color: "var(--text)" }}
      />

      {error && (
        <p className="type-caption mt-2" style={{ color: "var(--danger-text)" }}>
          {error}
        </p>
      )}

      {isDirty && (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={isSaving}
            className="secondary-button"
          >
            {isSaving && <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />}
            {t("word.saveNote")}
          </button>
        </div>
      )}
    </div>
  );
}
