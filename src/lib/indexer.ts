// Background indexing of release tracklists (low priority, throttled) so the
// "Track" field can suggest titles from the whole collection, not only the
// releases that have been played.
import { getCachedDetails, getReleaseDetails } from "./discogs";
import type { CollectionItem } from "./types";

export type IndexState = { done: number; total: number; titles: string[]; running: boolean };

export function startIndexer(items: CollectionItem[], onUpdate: (s: IndexState) => void) {
  let stopped = false;
  const titles = new Set<string>();
  const state: IndexState = { done: 0, total: items.length, titles: [], running: true };
  const publish = () => onUpdate({ ...state, titles: [...titles] });

  (async () => {
    const cached = await getCachedDetails(items.map((i) => i.id));
    const missing: CollectionItem[] = [];
    cached.forEach((d, idx) => {
      if (d) {
        d.tracklist.forEach((t) => titles.add(t.title));
        state.done++;
      } else missing.push(items[idx]);
    });
    publish();
    let sincePublish = 0;
    for (const item of missing) {
      if (stopped) return;
      try {
        const d = await getReleaseDetails(item.id, "low");
        d.tracklist.forEach((t) => titles.add(t.title));
      } catch {
        /* skip; retried next session */
      }
      state.done++;
      if (++sincePublish >= 10) {
        sincePublish = 0;
        publish();
      }
    }
    state.running = false;
    publish();
  })();

  return {
    stop: () => {
      stopped = true;
    },
    /** Add titles discovered elsewhere (e.g. while building a card). */
    addTitles: (more: string[]) => {
      let added = false;
      for (const t of more) if (!titles.has(t)) (titles.add(t), (added = true));
      if (added) publish();
    },
  };
}
