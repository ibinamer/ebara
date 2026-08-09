"use client";

import { useI18n } from "@/lib/i18n";

/** Placeholder rows matching the glossary's rhythm, so nothing shifts on load. */
export function WordGridSkeleton() {
  const { t } = useI18n();

  return (
    <ul className="glossary" role="status" aria-label={t("loading.words")}>
      {[0, 1, 2, 3, 4, 5].map((item) => (
        <li key={item} className="word-row">
          <div className="word-row-open">
            <span className="skeleton h-6 w-2/5" />
            <span className="skeleton h-5 w-1/2" />
            <span className="skeleton hidden h-3 w-16 md:block" />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function StatsSkeleton() {
  return (
    <div className="colophon" aria-hidden="true">
      {[0, 1, 2, 3].map((item) => (
        <span key={item} className="skeleton h-5 w-28" />
      ))}
    </div>
  );
}
