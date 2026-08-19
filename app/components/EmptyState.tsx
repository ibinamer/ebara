"use client";

import { useI18n } from "@/lib/i18n";

export type EmptyKind = "empty" | "no-results";

/**
 * Nothing to show is a quiet moment, not an event: a line of type in the space
 * the list would occupy. No dashed frame, no icon in a tile — both read as
 * placeholder furniture and neither tells the reader anything.
 */
export function EmptyState({
  kind,
  query,
  onAdd,
}: {
  kind: EmptyKind;
  query?: string;
  onAdd: () => void;
}) {
  const { t } = useI18n();

  const title = kind === "empty" ? t("empty.readyTitle") : t("empty.noResultsTitle");
  const body =
    kind === "empty" ? t("empty.readyBody") : t("empty.noResultsBody", { query: query ?? "" });

  return (
    <div className="max-w-md px-6 py-16 sm:px-8 sm:py-20">
      <h3 className="type-subheading" style={{ color: "var(--text)" }}>
        {title}
      </h3>
      <p className="type-body mt-2" style={{ color: "var(--text-muted)" }}>
        {body}
      </p>

      {kind === "empty" && (
        <button type="button" onClick={onAdd} className="primary-button mt-6">
          {t("empty.addFirst")}
        </button>
      )}
    </div>
  );
}
