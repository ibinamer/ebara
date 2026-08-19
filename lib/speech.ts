/** Speaks an English word using the browser's built-in speech synthesis. */
export function speakWord(value: string): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(value);
  utterance.lang = "en-US";
  utterance.rate = 0.86;
  window.speechSynthesis.speak(utterance);
}

export function normalizeCandidate(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Filters a live keystroke to the allowed character set without trimming.
 * `normalizeCandidate` trims trailing whitespace, which is correct for a
 * completed value but wrong on every keystroke: the instant a user typed a
 * space after "catch", the trim would eat it before it ever rendered, making
 * it impossible to type a second word of a phrase like "catch up". This
 * keeps whatever whitespace the user actually typed; `normalizeCandidate`
 * still runs once on submission to collapse and trim the final value.
 */
export function sanitizeLiveInput(value: string): string {
  return value.toLowerCase().replace(/[^a-z\s'-]/g, "");
}

export function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
