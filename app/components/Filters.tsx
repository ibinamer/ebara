"use client";

import { formatNumber, translatePartOfSpeech, useI18n } from "@/lib/i18n";
import type { SortOrder, WordTypeCount } from "@/lib/words";

/**
 * Word-type filters, generated from the types actually present in the
 * collection. Set as a line of words with the current one ruled underneath —
 * the way a magazine marks its sections — rather than a tray of pills.
 */
export function Filters({
  types,
  activeType,
  onTypeChange,
  sort,
  onSortChange,
  totalCount,
}: {
  types: WordTypeCount[];
  activeType: string | null;
  onTypeChange: (type: string | null) => void;
  sort: SortOrder;
  onSortChange: (sort: SortOrder) => void;
  totalCount: number;
}) {
  const { t, locale } = useI18n();

  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
      {types.length > 0 ? (
        <div className="filter-nav" role="group" aria-label={t("filter.label")}>
          <button
            type="button"
            className="filter-link"
            aria-pressed={activeType === null}
            onClick={() => onTypeChange(null)}
          >
            {t("filter.all")}
            <span className="filter-count">{formatNumber(totalCount, locale)}</span>
          </button>

          {types.map(({ type, count }) => (
            <button
              key={type}
              type="button"
              className="filter-link"
              aria-pressed={activeType === type}
              onClick={() => onTypeChange(activeType === type ? null : type)}
            >
              {translatePartOfSpeech(t, type)}
              <span className="filter-count">{formatNumber(count, locale)}</span>
            </button>
          ))}
        </div>
      ) : (
        <span />
      )}

      <label className="shrink-0">
        <span className="sr-only">{t("filter.sort")}</span>
        <select
          value={sort}
          onChange={(event) => onSortChange(event.target.value as SortOrder)}
          className="sort-select"
        >
          <option value="newest">{t("filter.newest")}</option>
          <option value="oldest">{t("filter.oldest")}</option>
          <option value="alphabetical">{t("filter.alphabetical")}</option>
        </select>
      </label>
    </div>
  );
}
