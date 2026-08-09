"use client";

/** EBARA wordmark. Always Latin, so it keeps Inter's successor face and its own
 *  tracking regardless of the interface language. */
export function AppMark({ size = "md" }: { size?: "sm" | "md" }) {
  return (
    <span
      dir="ltr"
      className={`${
        size === "sm" ? "text-[0.95rem]" : "text-lg"
      } bidi-isolate font-semibold tracking-[0.16em]`}
      style={{ color: "var(--text)" }}
    >
      EBARA
    </span>
  );
}
