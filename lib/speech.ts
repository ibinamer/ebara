let activeAudio: HTMLAudioElement | null = null;

function stopActiveAudio(): void {
  if (!activeAudio) return;
  activeAudio.pause();
  activeAudio.removeAttribute("src");
  activeAudio.load();
  activeAudio = null;
}

function speakWithBrowser(value: string): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(value);
  utterance.lang = "en-US";
  utterance.rate = 0.86;
  window.speechSynthesis.speak(utterance);
}

/**
 * Plays the shared Chirp 3 HD pronunciation. If the hosted voice is not yet
 * configured or is temporarily unavailable, the device voice remains a
 * seamless fallback instead of making pronunciation fail.
 */
export function speakWord(value: string): void {
  if (typeof window === "undefined") return;

  stopActiveAudio();
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();

  const audio = new Audio(`/api/pronunciation?word=${encodeURIComponent(value)}`);
  activeAudio = audio;
  audio.preload = "auto";
  let finished = false;

  const cleanup = () => {
    if (activeAudio === audio) activeAudio = null;
  };
  const fallback = () => {
    if (finished) return;
    finished = true;
    cleanup();
    speakWithBrowser(value);
  };

  audio.addEventListener(
    "ended",
    () => {
      finished = true;
      cleanup();
    },
    { once: true },
  );
  audio.addEventListener("error", fallback, { once: true });
  void audio.play().catch(fallback);
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
