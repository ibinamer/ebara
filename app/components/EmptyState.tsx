"use client";

import { useI18n } from "@/lib/i18n";

export type EmptyKind = "empty" | "no-results" | "no-filter-match";

/**
 * Nothing to show is a quiet moment, not an event: a line of type in the space
 * the list would occupy. No dashed frame, no icon in a tile — both read as
 * placeholder furniture and neither tells the reader anything.
 */
export function EmptyState({
  kind,
  query,
  onAdd,
  onClearFilter,
}: {
  kind: EmptyKind;
  query?: string;
  onAdd: () => void;
  onClearFilter: () => void;
}) {
  const { t } = useI18n();

  const title =
    kind === "empty"
      ? t("empty.readyTitle")
      : kind === "no-results"
        ? t("empty.noResultsTitle")
        : t("empty.noFilterTitle");
  const body =
    kind === "empty"
      ? t("empty.readyBody")
      : kind === "no-results"
        ? t("empty.noResultsBody", { query: query ?? "" })
        : t("empty.noFilterBody");

  return (
    <div className="max-w-md py-16 sm:py-20">
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

      {kind === "no-filter-match" && (
        <button type="button" onClick={onClearFilter} className="link-button mt-5 text-sm">
          {t("empty.clearFilter")}
        </button>
      )}
    </div>
  );
}
