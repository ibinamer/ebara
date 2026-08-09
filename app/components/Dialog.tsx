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
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && dismissible) onClose();
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
