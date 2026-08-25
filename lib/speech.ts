let activeAudio: HTMLAudioElement | null = null;

function stopActiveAudio(): void {
  if (!activeAudio) return;
  activeAudio.onerror = null;
  activeAudio.onended = null;
  activeAudio.pause();
  activeAudio.removeAttribute("src");
  activeAudio.load();
  activeAudio = null;
}

function voiceScore(voice: SpeechSynthesisVoice): number {
  const language = voice.lang.toLowerCase();
  const name = voice.name.toLowerCase();
  let score = language === "en-us" ? 100 : language.startsWith("en") ? 50 : 0;

  if (/samantha|google us english|microsoft aria/.test(name)) score += 45;
  else if (/ava|alex|karen|daniel/.test(name)) score += 35;
  if (/premium|enhanced|natural/.test(name)) score += 25;
  if (voice.localService) score += 5;
  return score;
}

function bestEnglishVoice(): SpeechSynthesisVoice | undefined {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return undefined;
  return window.speechSynthesis
    .getVoices()
    .filter((voice) => voice.lang.toLowerCase().startsWith("en"))
    .sort((left, right) => voiceScore(right) - voiceScore(left))[0];
}

function speakWithBrowser(value: string): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(value);
  utterance.lang = "en-US";
  utterance.rate = 0.9;
  utterance.pitch = 1;
  const voice = bestEnglishVoice();
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
}

function trustedDictionaryAudioUrl(value: string | undefined): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    const trustedHost =
      url.hostname === "api.dictionaryapi.dev" ||
      url.hostname === "ssl.gstatic.com";
    return url.protocol === "https:" && trustedHost ? url.href : null;
  } catch {
    return null;
  }
}

/** Plays dictionary audio first, then the best English device voice. */
export function speakWord(value: string, dictionaryAudioUrl?: string): void {
  if (typeof window === "undefined") return;

  stopActiveAudio();
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();

  const source = trustedDictionaryAudioUrl(dictionaryAudioUrl);
  if (!source) {
    speakWithBrowser(value);
    return;
  }

  const audio = new Audio(source);
  activeAudio = audio;
  audio.preload = "auto";
  const fallback = () => {
    if (activeAudio !== audio) return;
    activeAudio = null;
    speakWithBrowser(value);
  };

  audio.onended = () => {
    if (activeAudio === audio) activeAudio = null;
  };
  audio.onerror = fallback;
  void audio.play().catch(fallback);
}

export function normalizeCandidate(value: string): string {
  return normalizeVocabularyInput(value)
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Preserves the casing and punctuation needed to translate a short sentence. */
export function normalizeVocabularyInput(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?])/g, "$1")
    .trim();
}

/** Stable duplicate key without changing the value shown or translated. */
export function vocabularyInputKey(value: string): string {
  return normalizeVocabularyInput(value).toLocaleLowerCase("en");
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
  return value
    .normalize("NFKC")
    .replace(/[’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/[^a-zA-Z\s,'\-.!?]/g, "")
    .slice(0, 160);
}

export function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
