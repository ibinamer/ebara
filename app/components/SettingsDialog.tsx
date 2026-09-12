"use client";

import Link from "next/link";
import { Check, Download, LoaderCircle, Trash2 } from "lucide-react";
import { FormEvent, useState } from "react";
import { Dialog, DialogClose } from "./Dialog";
import { useI18n, type Locale } from "@/lib/i18n";

const LOCALES: { value: Locale; label: string }[] = [
  { value: "en", label: "English" },
  { value: "ar", label: "العربية" },
];

export function SettingsDialog({
  onClose,
  accountEmail,
  displayName,
  guestMode,
  demoMode,
  onUpdateDisplayName,
  onExport,
  onClearGuest,
  onDeleteAccount,
}: {
  onClose: () => void;
  accountEmail?: string;
  displayName: string;
  guestMode: boolean;
  demoMode: boolean;
  onUpdateDisplayName: (displayName: string) => Promise<void>;
  onExport: () => void;
  onClearGuest: () => void;
  onDeleteAccount: () => Promise<void>;
}) {
  const { t, locale, setLocale } = useI18n();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [displayNameDraft, setDisplayNameDraft] = useState(displayName);
  const [isSavingName, setIsSavingName] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveDisplayName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSavingName(true);
    setNameSaved(false);
    setError(null);
    try {
      await onUpdateDisplayName(displayNameDraft);
      setDisplayNameDraft(displayNameDraft.trim().replace(/\s+/g, " "));
      setNameSaved(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("settings.actionError"));
    } finally {
      setIsSavingName(false);
    }
  }

  async function deleteAccount() {
    setIsDeleting(true);
    setError(null);
    try {
      await onDeleteAccount();
    } catch {
      setError(t("settings.actionError"));
      setIsDeleting(false);
    }
  }

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
        {accountEmail ? (
          <div className="account-settings-card mt-3">
            <form onSubmit={saveDisplayName}>
              <label className="block">
                <span className="field-label">{t("settings.displayName")}</span>
                <input
                  type="text"
                  dir="auto"
                  className="field-input"
                  value={displayNameDraft}
                  onChange={(event) => {
                    setDisplayNameDraft(event.target.value);
                    setNameSaved(false);
                  }}
                  placeholder={t("settings.displayNamePlaceholder")}
                  autoComplete="name"
                  minLength={2}
                  maxLength={40}
                  required
                />
              </label>
              <p className="type-caption mt-2" style={{ color: "var(--text-faint)" }}>
                {t("settings.displayNameHint")}
              </p>
              <button
                type="submit"
                className="secondary-button mt-3 w-full"
                disabled={
                  isSavingName ||
                  displayNameDraft.trim().replace(/\s+/g, " ") === displayName
                }
              >
                {isSavingName ? (
                  <LoaderCircle size={15} className="animate-spin" aria-hidden="true" />
                ) : nameSaved ? (
                  <Check size={15} aria-hidden="true" />
                ) : null}
                {nameSaved ? t("settings.displayNameSaved") : t("settings.saveDisplayName")}
              </button>
            </form>
            <div className="account-email-row">
              <span>{t("settings.email")}</span>
              <span dir="ltr" className="bidi-isolate truncate font-medium" title={accountEmail}>
                {accountEmail}
              </span>
            </div>
          </div>
        ) : (
          <p className="type-body mt-3" style={{ color: "var(--text-muted)" }}>
            {guestMode
              ? t("settings.guestMode")
              : demoMode
                ? t("settings.previewMode")
                : null}
          </p>
        )}
        {error && !confirmDelete && (
          <div className="notice error-notice mt-3" role="alert">
            {error}
          </div>
        )}
      </section>

      {!demoMode && (
        <section
          className="mt-7 border-t pt-6"
          style={{ borderColor: "var(--border)" }}
        >
          <p className="detail-label">{t("settings.yourData")}</p>
          <p className="type-caption mt-3" style={{ color: "var(--text-faint)" }}>
            {t("settings.exportHint")}
          </p>
          <button type="button" onClick={onExport} className="secondary-button mt-3 w-full">
            <Download size={15} aria-hidden="true" />
            {t("settings.export")}
          </button>

          {guestMode ? (
            <button
              type="button"
              onClick={() => {
                if (window.confirm(t("settings.clearGuestConfirm"))) onClearGuest();
              }}
              className="danger-button mt-3 w-full"
            >
              <Trash2 size={15} aria-hidden="true" />
              {t("settings.clearGuest")}
            </button>
          ) : accountEmail ? (
            <div className="mt-5 border-t pt-5" style={{ borderColor: "var(--border)" }}>
              {!confirmDelete ? (
                <>
                  <p className="type-caption" style={{ color: "var(--text-faint)" }}>
                    {t("settings.deleteAccountHint")}
                  </p>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    className="danger-button mt-3 w-full"
                  >
                    <Trash2 size={15} aria-hidden="true" />
                    {t("settings.deleteAccount")}
                  </button>
                </>
              ) : (
                <div className="notice error-notice block">
                  <p className="font-semibold">{t("settings.deleteConfirmTitle")}</p>
                  <p className="type-caption mt-1">{t("settings.deleteConfirmBody")}</p>
                  {error && <p className="type-caption mt-2" role="alert">{error}</p>}
                  <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmDelete(false);
                        setError(null);
                      }}
                      className="secondary-button"
                      disabled={isDeleting}
                    >
                      {t("settings.cancel")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteAccount()}
                      className="danger-button"
                      disabled={isDeleting}
                    >
                      {isDeleting ? (
                        <LoaderCircle size={15} className="animate-spin" aria-hidden="true" />
                      ) : (
                        <Trash2 size={15} aria-hidden="true" />
                      )}
                      {t("settings.deleteForever")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </section>
      )}

      <section
        className="mt-7 border-t pt-6"
        style={{ borderColor: "var(--border)" }}
      >
        <p className="detail-label">{t("settings.legal")}</p>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <Link className="link-button" href="/terms" onClick={onClose}>
            {t("legal.terms")}
          </Link>
          <Link className="link-button" href="/privacy" onClick={onClose}>
            {t("legal.privacy")}
          </Link>
        </div>
      </section>
    </Dialog>
  );
}
