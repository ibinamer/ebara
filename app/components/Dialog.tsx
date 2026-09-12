"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";

/**
 * Shared modal shell: backdrop dismissal, Escape handling, scroll locking and
 * initial focus. Every dialog in EBARA builds on this so behaviour stays
 * identical across the app.
 */
export function Dialog({
  onClose,
  labelledBy,
  describedBy,
  className = "",
  role = "dialog",
  dismissible = true,
  children,
}: {
  onClose: () => void;
  labelledBy: string;
  describedBy?: string;
  className?: string;
  role?: "dialog" | "alertdialog";
  dismissible?: boolean;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && dismissible) onClose();
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const controls = Array.from(panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex="0"]',
      )).filter((element) => element.getClientRects().length > 0);
      const first = controls[0];
      const last = controls.at(-1);
      if (!first || !last) { event.preventDefault(); panel.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel)) {
        event.preventDefault(); first.focus();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [dismissible, onClose]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const panel = panelRef.current;
      if (!panel || panel.contains(document.activeElement)) return;
      panel.focus({ preventScroll: true });
    }, 40);
    return () => window.clearTimeout(timeout);
  }, []);

  return (
    <div
      className="dialog-layer"
      role="presentation"
      onMouseDown={(event) => {
        if (dismissible && event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={panelRef}
        tabIndex={-1}
        className={`dialog-panel ${className}`.trim()}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
      >
        {children}
      </section>
    </div>
  );
}

export function DialogClose({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="icon-button" aria-label={label}>
      <X size={17} aria-hidden="true" />
    </button>
  );
}
