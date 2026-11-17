// Normalisation + fuzzy matching tuned for music metadata.

/** Strip Discogs disambiguation suffixes: "Prince (2)", "Kraftwerk*" */
export const cleanDiscogsName = (s: string) =>
  s.replace(/\s*\(\d+\)$/, "").replace(/\*$/, "").trim();

const DECORATIONS =
  /\s*[([](?:original|extended|radio|album|single|club|dub|instrumental|vocal|remaster(?:ed)?|\d{4} remaster(?:ed)?|mono|stereo|live|edit|version|mix|remix|feat\.?|ft\.?)[^)\]]*[)\]]/gi;

export function normalize(input: string, opts: { stripDecorations?: boolean } = {}) {
  let s = cleanDiscogsName(input);
  if (opts.stripDecorations) s = s.replace(DECORATIONS, " ");
  s = s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\s+-\s+.*(remaster|version|mix|edit|live).*$/i, "")
    .replace(/[''`´]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^(the|a|an|le|la|les|el|los|die|der|das) /, "")
    .replace(/,? (the)$/, "");
  return s;
}

export function levenshtein(a: string, b: string) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** 0..1 similarity on already-normalised strings */
export function similarity(a: string, b: string) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const compactA = a.replace(/ /g, "");
  const compactB = b.replace(/ /g, "");
  if (compactA === compactB) return 1;
  return 1 - levenshtein(compactA, compactB) / Math.max(compactA.length, compactB.length);
}

/** Tolerance grows a little with length: short names must be (almost) exact. */
const threshold = (len: number) => (len <= 4 ? 1 : len <= 8 ? 0.84 : 0.8);

const STOPWORDS = /\b(the|a|an|of|and|le|la|les|de|des|du|et|el|y)\b/g;
const withoutStopwords = (s: string) => s.replace(STOPWORDS, " ").replace(/\s+/g, " ").trim();

/** Does the guess match one of the accepted answers? */
export function isMatch(guess: string, answers: string[]) {
  const g = normalize(guess, { stripDecorations: true });
  if (!g) return false;
  const g2 = withoutStopwords(g);
  return answers.some((answer) => {
    const a = normalize(answer, { stripDecorations: true });
    if (!a) return false;
    if (similarity(g, a) >= threshold(a.length)) return true;
    const a2 = withoutStopwords(a);
    return a2.length >= 4 && similarity(g2, a2) >= threshold(a2.length);
  });
}

export type Suggestion = { value: string; score: number };

/** Rank suggestion candidates for an in-progress query. */
export function suggest(query: string, candidates: { value: string; norm: string }[], limit = 8): Suggestion[] {
  const q = normalize(query);
  if (q.length < 1) return [];
  const out: Suggestion[] = [];
  for (const c of candidates) {
    let score = 0;
    if (c.norm.startsWith(q)) score = 3 + q.length / c.norm.length;
    else if (c.norm.includes(` ${q}`)) score = 2.5 + q.length / c.norm.length;
    else if (q.length >= 3 && c.norm.includes(q)) score = 2;
    else if (q.length >= 3) {
      const head = c.norm.slice(0, q.length + 1);
      const sim = similarity(q, head);
      if (sim >= 0.7) score = sim;
    }
    if (score > 0) out.push({ value: c.value, score });
  }
  out.sort((a, b) => b.score - a.score || a.value.length - b.value.length);
  return out.slice(0, limit);
}

/** Dedupe display values by normalised form. */
export function buildCandidates(values: Iterable<string>) {
  const map = new Map<string, string>();
  for (const v of values) {
    const display = cleanDiscogsName(v);
    const norm = normalize(display);
    if (norm && !map.has(norm)) map.set(norm, display);
  }
  return [...map].map(([norm, value]) => ({ norm, value }));
}
