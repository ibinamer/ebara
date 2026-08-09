"use client";

import { LoaderCircle, Trash2 } from "lucide-react";
import { useState } from "react";
import { Dialog } from "./Dialog";
import { useI18n } from "@/lib/i18n";
import type { WordRecord } from "@/lib/words";

export function DeleteDialog({
  entry,
  onCancel,
  onConfirm,
}: {
  entry: WordRecord;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [isDeleting, setIsDeleting] = useState(false);

  async function remove() {
    setIsDeleting(true);
    await onConfirm();
    setIsDeleting(false);
  }

  return (
    <Dialog
      onClose={onCancel}
      labelledBy="delete-title"
      describedBy="delete-description"
      role="alertdialog"
      className="confirm-dialog"
      dismissible={!isDeleting}
    >
      <span
        className="grid size-10 place-items-center rounded-[10px]"
        style={{ background: "var(--danger-soft)", color: "var(--danger-text)" }}
      >
        <Trash2 size={18} aria-hidden="true" />
      </span>

      <h2
        id="delete-title"
        className="type-subheading mt-5"
        style={{ color: "var(--text)" }}
      >
        {t("delete.title", { word: entry.word })}
      </h2>
      <p
        id="delete-description"
        className="type-body mt-2"
        style={{ color: "var(--text-muted)" }}
      >
        {t("delete.body")}
      </p>

      <div className="mt-7 grid grid-cols-2 gap-2.5">
        <button type="button" onClick={onCancel} className="secondary-button" disabled={isDeleting}>
          {t("delete.keep")}
        </button>
        <button
          type="button"
          onClick={() => void remove()}
          className="danger-button"
          disabled={isDeleting}
        >
          {isDeleting && <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />}
          {t("delete.confirm")}
        </button>
      </div>
    </Dialog>
  );
}
