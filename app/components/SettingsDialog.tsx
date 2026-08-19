"use client";

import { Dialog, DialogClose } from "./Dialog";
import { useI18n, type Locale } from "@/lib/i18n";

const LOCALES: { value: Locale; label: string }[] = [
  { value: "en", label: "English" },
  { value: "ar", label: "العربية" },
];

export function SettingsDialog({
  onClose,
  accountEmail,
  guestMode,
  demoMode,
}: {
  onClose: () => void;
  accountEmail?: string;
  guestMode: boolean;
  demoMode: boolean;
}) {
  const { t, locale, setLocale } = useI18n();

  return (
    <Dialog onClose={onClose} labelledBy="settings-title" className="settings-dialog">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2
            id="settings-title"
            className="type-subheading"
            style={{ color: "var(--text)" }}
          >
            {t("settings.title")}
          </h2>
          <p className="type-body mt-1" style={{ color: "var(--text-muted)" }}>
            {t("settings.subtitle")}
          </p>
        </div>
        <DialogClose label={t("settings.close")} onClick={onClose} />
      </div>

      <section className="mt-7">
        <p className="detail-label">{t("settings.language")}</p>
        <div
          className="segmented mt-3 w-full"
          role="radiogroup"
          aria-label={t("settings.language")}
        >
          {LOCALES.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={locale === value}
              onClick={() => setLocale(value)}
              className="flex-1"
              lang={value}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section
        className="mt-7 border-t pt-6"
        style={{ borderColor: "var(--border)" }}
      >
        <p className="detail-label">{t("settings.account")}</p>
        <p className="type-body mt-3" style={{ color: "var(--text-muted)" }}>
          {accountEmail ? (
            <>
              {t("settings.signedInAs")}{" "}
              <span dir="ltr" className="bidi-isolate font-medium" style={{ color: "var(--text)" }}>
                {accountEmail}
              </span>
            </>
          ) : guestMode ? (
            t("settings.guestMode")
          ) : demoMode ? (
            t("settings.previewMode")
          ) : null}
        </p>
      </section>
    </Dialog>
  );
}
