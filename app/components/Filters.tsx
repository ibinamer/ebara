"use client";

import { ChevronDown } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { SortOrder } from "@/lib/words";

/** Sort order control — a bordered popup button standing in for native select chrome. */
export function Filters({
  sort,
  onSortChange,
}: {
  sort: SortOrder;
  onSortChange: (sort: SortOrder) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="flex justify-start">
      <label className="popup-button shrink-0">
        <span className="sr-only">{t("filter.sort")}</span>
        <select
          value={sort}
          onChange={(event) => onSortChange(event.target.value as SortOrder)}
          className="popup-button-select"
        >
          <option value="newest">{t("filter.newest")}</option>
          <option value="oldest">{t("filter.oldest")}</option>
          <option value="alphabetical">{t("filter.alphabetical")}</option>
        </select>
        <ChevronDown size={14} className="popup-button-chevron" aria-hidden="true" />
      </label>
    </div>
  );
}
