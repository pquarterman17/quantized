// The ⌘K palette's ranker (Quantized-side; `lib/fuzzy.ts` stays the shared
// fermiviewer matcher and is only the LAST resort here).
//
// WHY NOT JUST `fuzzy()`. A subsequence matcher scores "fit" highest on
// "Film thickness (FFT)" (f..i..t scattered over a long label), so the
// command a scientist means ("Curve fit…") lost to an accident. The order
// here is the one VS Code / Linear / Figma use:
//
//   1. a whole word of the label           (100)   "fit" in "Curve fit…"
//   2. a stem or prefix of a label word    (90 / 80)  "errors" / "deriv"
//   3. a synonym of the term               ( 60 label / 45 keywords)
//   4. a hidden keyword                    ( 50 word / 40 prefix)
//   5. a word of the description           ( 30 / 20), then its category (20)
//   6. fuzzy subsequence on label/keywords (<= 10)
//
// A synonym that names the command's label ALSO adds a canonical bonus to a
// direct word match, so "fit" lands on "Curve fit…" ahead of "Fit Y by X…".
// Multi-word queries are AND: every term must score. Usage (frequency x
// recency, `lib/paletteUsage.ts`) adds at most MAX_USAGE_BOOST, which is below
// the narrowest tier gap, so it reorders inside a tier and never promotes a
// weak match past a strong one.

import type { Action } from "../store/commands";
import { fuzzy } from "./fuzzy";
import { synonymPhrases } from "./paletteSynonyms";
import { usageBoost, type UsageMap } from "./paletteUsage";

export interface Ranked {
  a: Action;
  score: number;
  /** Indices into `a.label` to highlight. */
  hits: number[];
}

interface Word {
  w: string;
  start: number;
}

interface Prepared {
  label: Word[];
  keywords: Word[];
  description: Word[];
  category: Word[];
  labelText: string;
}

const WORD = /[\p{L}\p{N}]+/gu;

/** Words too common to say what a command DOES: ignored in descriptions, where
 *  "the" in "Toggle the grid" would otherwise make "theme" and "then" match
 *  half the registry. */
const STOP = new Set(["the", "and", "for", "with", "that", "this", "from", "into", "its", "are", "any", "each", "one", "not", "can", "has", "was", "per", "via", "all", "your"]);

/** Typed words that are filler ("smooth DATA", "set the column"): they add
 *  score where they match but never rule a command out. Never optional when the
 *  query is nothing but filler. */
const FILLER = new Set(["data", "the", "a", "an", "of", "to", "my", "for", "and", "in", "on", "with", "it", "this", "that"]);

/** The only endings a query word may add to a command word and still count as
 *  the same word ("peaks", "fitted"), so "setup" is not "set" and "theme" is
 *  not "the". */
const INFLECTIONS = new Set(["s", "es", "ed"]);

function words(text: string | undefined): Word[] {
  if (!text) return [];
  return Array.from(text.toLowerCase().matchAll(WORD), (m) => ({ w: m[0], start: m.index }));
}

const prepared = new WeakMap<Action, Prepared>();

/** Description words that say something: three letters or more, not a stopword. */
const meaningful = (ws: Word[]): Word[] => ws.filter((x) => x.w.length >= 3 && !STOP.has(x.w));

function prepare(a: Action): Prepared {
  let p = prepared.get(a);
  if (!p) {
    const label = words(a.label);
    p = {
      label,
      keywords: words(a.keywords),
      description: meaningful(words(a.description)),
      category: words(`${a.group} ${a.section ?? ""}`),
      labelText: label.map((x) => x.w).join(" "),
    };
    prepared.set(a, p);
  }
  return p;
}

/** The typed terms of a query (lower-case words). */
export function queryTerms(query: string): string[] {
  return words(query).map((x) => x.w);
}

type Kind = "exact" | "stem" | "prefix";

/** A match on the label's first word. Small on purpose: with the usage boost
 *  (lib/paletteUsage.ts, below 3) it stays under the 5-point step between
 *  sub-tiers, so neither can turn a stem into an exact match. */
const FIRST_WORD = 2;

/** Points for a word match in a field whose whole-word score is `exact`: a
 *  stem ("errors" for "error") is a little less, a prefix a little less again. */
function points(kind: Kind, exact: number): number {
  return kind === "exact" ? exact : kind === "stem" ? exact - 5 : exact - 10;
}

/** Best word match of `t` in `ws`: `exact` for a whole word, `stem` for a
 *  word `t` merely extends by up to two letters (a plural), `prefix` for a
 *  word that starts with `t`; the word's index so the caller can award a
 *  first-word bonus and highlight it. */
function wordMatch(t: string, ws: readonly Word[]): { kind: Kind; at: number } | null {
  let stem = -1;
  let prefix = -1;
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i].w;
    if (w === t) return { kind: "exact", at: i };
    if (stem < 0 && w.length >= 3 && t.startsWith(w) && INFLECTIONS.has(t.slice(w.length))) stem = i;
    if (prefix < 0 && w.startsWith(t)) prefix = i;
  }
  if (stem >= 0) return { kind: "stem", at: stem };
  return prefix >= 0 ? { kind: "prefix", at: prefix } : null;
}

/** A synonym phrase matches `ws` when each of its words is a word (or word
 *  prefix) there. */
function phraseIn(phrase: string, ws: readonly Word[]): boolean {
  // A stem does not count here: "find peaks" must not light up "Peak Analyzer".
  return phrase.split(" ").every((p) => {
    const m = wordMatch(p, ws);
    return m !== null && m.kind !== "stem";
  });
}

function termScore(t: string, p: Prepared, hits: Set<number>, fuzzyOk: boolean): number {
  if (t.length === 1) {
    // One letter is only ever the start of a label word ("y" in "Link Y axis"):
    // matching it anywhere else (descriptions, fuzzy) is noise.
    const one = p.label.find((x) => x.w.startsWith(t));
    // ...or a keyword that IS that letter ("tau vs T": the T a curated keyword
    // spells out), but never a prefix of a longer keyword.
    if (!one) return p.keywords.some((x) => x.w === t) ? 20 : 0;
    hits.add(one.start);
    return 25;
  }
  let direct = 0;
  const lm = wordMatch(t, p.label);
  if (lm) {
    direct = points(lm.kind, 100) + (lm.at === 0 ? FIRST_WORD : 0);
    const { w, start } = p.label[lm.at];
    for (let k = 0; k < Math.min(t.length, w.length); k++) hits.add(start + k);
  }
  const syns = synonymPhrases(t);
  const synLabel = syns.some((s) => phraseIn(s, p.label));
  if (direct >= 80 && synLabel) return direct + 30; // canonical: the command named for this word
  let best = direct;
  if (synLabel) best = Math.max(best, 60);
  else if (syns.some((s) => phraseIn(s, p.keywords))) best = Math.max(best, 45);
  if (best < 50) {
    const km = wordMatch(t, p.keywords);
    if (km) best = Math.max(best, points(km.kind, 50));
  }
  if (best < 30) {
    const dm = wordMatch(t, p.description);
    if (dm) best = Math.max(best, points(dm.kind, 30));
  }
  if (best < 20 && wordMatch(t, p.category)?.kind === "exact") best = 20;
  if (best === 0 && fuzzyOk && t.length >= 3) {
    // Last resort: a typo-tolerant subsequence over the visible label, then
    // the hidden keywords. Never reached for a term that matched any word.
    // The first typed letter must open a word: "theme" is not "the-n-ew-graph-M-E".
    const opensWord = (text: string, h: readonly number[]): boolean => h.length > 0 && (h[0] === 0 || text[h[0] - 1] === " ");
    const f = fuzzy(t, p.labelText);
    if (f && opensWord(p.labelText, f.hits)) {
      mapFuzzyHits(f.hits, p, hits);
      return 5 + Math.min(5, Math.max(0, f.score) / 4);
    }
    const kwText = p.keywords.map((x) => x.w).join(" ");
    const fk = fuzzy(t, kwText);
    if (fk && opensWord(kwText, fk.hits)) return 3 + Math.min(2, Math.max(0, fk.score) / 8);
  }
  return best;
}

/** `fuzzy` ran over the label's words joined by single spaces; map each hit
 *  back to the index in the original label. */
function mapFuzzyHits(joinedHits: readonly number[], p: Prepared, hits: Set<number>): void {
  let offset = 0;
  const starts: { from: number; start: number; len: number }[] = [];
  for (const x of p.label) {
    starts.push({ from: offset, start: x.start, len: x.w.length });
    offset += x.w.length + 1;
  }
  for (const h of joinedHits) {
    const seg = starts.find((s) => h >= s.from && h < s.from + s.len);
    if (seg) hits.add(seg.start + (h - seg.from));
  }
}

/** Rank `actions` for `query`, best first. An empty query returns every
 *  action in its given order (the caller decides what to show). */
export function rankActions(
  actions: readonly Action[],
  query: string,
  usage: UsageMap = {},
  now: number = Date.now(),
): Ranked[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return actions.map((a) => ({ a, score: 0, hits: [] }));
  const phrase = terms.join(" ");
  // Filler words are optional, unless that would leave nothing to match.
  const required = terms.some((t) => !FILLER.has(t)) ? terms.map((t) => !FILLER.has(t)) : terms.map(() => true);
  // A loose subsequence may carry a one-word query, never one of several: it
  // would let "set column values" through on "set" ~ "separate".
  const fuzzyOk = terms.length === 1;
  const out: Ranked[] = [];
  for (const a of actions) {
    const p = prepare(a);
    const hits = new Set<number>();
    let score = 0;
    let ok = true;
    for (let i = 0; i < terms.length; i++) {
      const s = termScore(terms[i], p, hits, fuzzyOk);
      if (s <= 0) {
        if (required[i]) {
          ok = false;
          break;
        }
        continue;
      }
      score += s;
    }
    if (!ok) continue;
    if (terms.length > 1 && p.labelText.includes(phrase)) score += 40; // the whole phrase, in order
    score += usageBoost(usage[a.id], now);
    score -= a.label.length * 0.01; // shorter label wins an otherwise equal match
    out.push({ a, score, hits: [...hits].sort((x, y) => x - y) });
  }
  return out.sort((x, y) => y.score - x.score);
}
