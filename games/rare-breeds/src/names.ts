// Cute two-syllable baby names (Zibu, Momo, Kiri, Pexa). Pure and deterministic.

const FIRST = ["b", "d", "f", "g", "k", "l", "m", "n", "p", "r", "s", "t", "v", "z"] as const;
const SECOND = ["b", "d", "k", "l", "m", "n", "p", "r", "s", "t", "v", "x", "z"] as const;
const VOWELS = ["a", "e", "i", "o", "u"] as const;

/**
 * Substrings that must never appear in a name: slurs, insults and rude words in common languages,
 * including near spellings. Checked on the lowercase name, so every syllable combination is covered.
 */
const BLOCKED = [
  "nig", "neg", "fag", "kike", "dike", "dyke", "paki", "dago", "gook", "coon", "spic", "wop", "jap",
  "nazi", "rape", "pedo", "homo", "lesb", "tard", "mong", "retar", "kafir", "kufa",
  "puta", "puto", "pute", "puti", "kaka", "caca", "kak", "pipi", "pupu", "popo", "poo", "titi", "tit", "teta",
  "pene", "pito", "pija", "culo", "anal", "anus", "sex", "semen", "cum", "fuk", "fuc", "fick", "shit",
  "piss", "suka", "sik", "kus", "zeb", "bok", "dupa", "hure", "baka", "bozo", "mofo", "slut", "merd",
  "arse", "ass", "butt", "turd", "dick", "dik", "cock", "kok", "boob", "bitch", "damn", "kill", "dead",
  "sata", "dumb", "idio", "moro", "loco", "fat", "ugly", "stup", "lame", "pube", "lube", "pula", "zizi", "vag", "bite",
  "nud", "sodo", "bum", "gay", "sux", "vomi",
] as const;

export const isBlockedName = (name: string) => {
  const lower = name.toLowerCase();
  return BLOCKED.some(part => lower.includes(part));
};

/** Deterministic name for a breed seed: CV + CV, sometimes a cute repeat (Momo, Kiki). */
export function babyName(seed: number): string {
  // mulberry32, salted so names do not correlate with the genetics streams of the same seed.
  let state = (seed ^ 0x5bd1e995) >>> 0;
  const next = (n: number) => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) % n;
  };
  for (let attempt = 0; attempt < 64; attempt++) {
    const onset = FIRST[next(FIRST.length)], vowel = VOWELS[next(VOWELS.length)];
    const repeat = next(6) === 0;
    const name = repeat ? onset + vowel + onset + vowel
      : onset + vowel + SECOND[next(SECOND.length)] + VOWELS[next(VOWELS.length)];
    if (!isBlockedName(name)) return name[0].toUpperCase() + name.slice(1);
  }
  return "Momo";
}
