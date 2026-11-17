import { buildCard, passesBasicFilters } from "./cards";
import { eligibilityKey, type Settings } from "./settings";
import type { CollectionItem, GameCard } from "./types";

export type DeckStats = { eligible: number; seen: number; filtered: number; unplayable: number };

const shuffle = <T,>(arr: T[]) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/**
 * Endless shuffled deck over the collection. Keeps `AHEAD` cards prepared so the
 * next one is instant, and silently skips releases that are filtered out or have
 * no playable source.
 */
export class Deck {
  static AHEAD = 2;
  private pool: CollectionItem[] = [];
  private ready: GameCard[] = [];
  private filling = false;
  private generation = 0;
  private listeners = new Set<() => void>();
  private skipped = new Map<number, "filtered" | "unplayable">();
  private key = "";
  stats: DeckStats = { eligible: 0, seen: 0, filtered: 0, unplayable: 0 };
  exhausted = false;
  private producedSinceShuffle = false;

  constructor(private items: CollectionItem[], private settings: Settings) {
    this.reset(settings, false);
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    if (!this.started) {
      this.started = true;
      void this.fill();
    }
    return () => this.listeners.delete(l);
  };
  private emit() {
    this.listeners.forEach((l) => l());
  }

  private started = false;

  reset(settings: Settings, fill = true) {
    const key = eligibilityKey(settings);
    if (key !== this.key) this.skipped.clear();
    this.key = key;
    this.settings = settings;
    this.generation++;
    this.filling = false;
    this.producedSinceShuffle = false;
    this.ready = [];
    this.exhausted = false;
    const eligible = this.items.filter((i) => passesBasicFilters(i, settings));
    this.stats = { eligible: eligible.length, seen: 0, filtered: 0, unplayable: 0 };
    this.pool = shuffle(eligible.filter((i) => !this.skipped.has(i.id)));
    if (fill) void this.fill();
  }

  /** Update settings that don't affect eligibility (points, timer…) without reshuffling. */
  updateSettings(settings: Settings) {
    if (eligibilityKey(settings) !== this.key) return this.reset(settings);
    this.settings = settings;
  }

  get hasNext() {
    return this.ready.length > 0;
  }
  get preparing() {
    return this.filling;
  }

  next(): GameCard | null {
    const card = this.ready.shift() ?? null;
    if (card) this.stats.seen++;
    void this.fill();
    this.emit();
    return card;
  }

  private async fill() {
    if (this.filling) return;
    this.filling = true;
    this.emit();
    const gen = this.generation;
    try {
      while (this.ready.length < Deck.AHEAD && gen === this.generation) {
        const item = this.pool.shift();
        if (!item) {
          // Endless game: reshuffle everything that's still playable.
          const again = this.items.filter((i) => passesBasicFilters(i, this.settings) && !this.skipped.has(i.id));
          if (!again.length || !this.producedSinceShuffle) {
            this.exhausted = !this.ready.length;
            break;
          }
          this.producedSinceShuffle = false;
          this.pool = shuffle(again);
          continue;
        }
        const result = await buildCard(item, this.settings);
        if (gen !== this.generation) return;
        if ("card" in result) {
          this.ready.push(result.card);
          this.producedSinceShuffle = true;
        }
        else if (result.skip !== "error") {
          this.skipped.set(item.id, result.skip);
          this.stats[result.skip]++;
        }
        this.emit();
      }
    } finally {
      if (gen === this.generation) this.filling = false;
      this.emit();
    }
  }
}
