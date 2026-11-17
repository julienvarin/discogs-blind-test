import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Button } from "@plexui/ui/components/Button";
import { Progress } from "@plexui/ui/components/Progress";
import { ReleaseCard, type CardResult } from "./ReleaseCard";
import { SettingsDialog } from "./SettingsDialog";
import type { Identity } from "../lib/auth";
import { fetchCollection, getCachedCollection } from "../lib/discogs";
import { Deck } from "../lib/deck";
import { buildCandidates } from "../lib/fuzzy";
import { startIndexer, type IndexState } from "../lib/indexer";
import { engine, useYouTubeHost } from "../lib/player";
import { useSettings } from "../lib/settings";
import type { CollectionItem, Field, GameCard } from "../lib/types";

const DAY = 24 * 60 * 60 * 1000;
const BEST_KEY = "dbt:best";

const readBest = () => {
  try {
    return Number(localStorage.getItem(BEST_KEY) ?? 0);
  } catch {
    return 0;
  }
};

function useDeck(deck: Deck | null) {
  return useSyncExternalStore(
    useCallback((l: () => void) => (deck ? deck.subscribe(l) : () => {}), [deck]),
    () => (deck ? `${deck.hasNext}|${deck.preparing}|${deck.exhausted}|${deck.stats.filtered}|${deck.stats.unplayable}` : ""),
  );
}

export function Game({ identity, onLogout }: { identity: Identity; onLogout: () => void }) {
  const [settings] = useSettings();
  const [items, setItems] = useState<CollectionItem[] | null>(null);
  const [loadProgress, setLoadProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [index, setIndex] = useState<IndexState | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [card, setCard] = useState<GameCard | null>(null);
  const [cardSeq, setCardSeq] = useState(0);
  const [started, setStarted] = useState(false);
  const [score, setScore] = useState({ total: 0, cards: 0, perfect: 0, byField: { track: 0, artist: 0, album: 0, label: 0 } as Record<Field, number> });
  const [best, setBest] = useState(readBest);
  const ytHost = useYouTubeHost();

  // --- Load collection (cache first, refresh daily) -------------------------
  const refresh = useCallback(async () => {
    setRefreshing(true);
    setLoadError(null);
    try {
      const fresh = await fetchCollection(identity.username, (loaded, total) => setLoadProgress({ loaded, total }));
      setItems(fresh);
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setRefreshing(false);
      setLoadProgress(null);
    }
  }, [identity.username]);

  useEffect(() => {
    let cancelled = false;
    getCachedCollection(identity.username).then((cached) => {
      if (cancelled) return;
      if (cached?.items.length) {
        setItems(cached.items);
        if (Date.now() - cached.fetchedAt > DAY) void refresh();
      } else void refresh();
    });
    return () => {
      cancelled = true;
    };
  }, [identity.username, refresh]);

  // --- Background tracklist indexing (for Track suggestions) ----------------
  useEffect(() => {
    if (!items) return;
    const indexer = startIndexer(items, setIndex);
    return () => indexer.stop();
  }, [items]);

  // --- Deck ------------------------------------------------------------------
  const deck = useMemo(() => (items ? new Deck(items, settings) : null), [items]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    deck?.updateSettings(settings);
    engine.setVolume(settings.volume);
    engine.startRange = [settings.ytStartMinPct / 100, settings.ytStartMaxPct / 100];
  }, [deck, settings]);
  useDeck(deck);

  // --- Suggestions -----------------------------------------------------------
  const baseCandidates = useMemo(() => {
    const list = items ?? [];
    return {
      artist: buildCandidates(list.flatMap((i) => i.artists)),
      album: buildCandidates(list.map((i) => i.title)),
      label: buildCandidates(list.flatMap((i) => i.labels)),
    };
  }, [items]);
  const trackCandidates = useMemo(
    () => buildCandidates([...(index?.titles ?? []), ...(card?.tracks.map((t) => t.title) ?? [])]),
    [index?.titles, card],
  );
  const candidates = useMemo(
    () => ({
      ...baseCandidates,
      artist: card?.tracks.some((t) => t.artists.length)
        ? buildCandidates([...baseCandidates.artist.map((c) => c.value), ...card.tracks.flatMap((t) => t.artists)])
        : baseCandidates.artist,
      track: trackCandidates,
    }),
    [baseCandidates, trackCandidates, card],
  );

  // --- Game flow ---------------------------------------------------------------
  const nextCard = () => {
    if (!deck) return;
    const c = deck.next();
    if (c) {
      setCard(c);
      setCardSeq((n) => n + 1);
    }
  };

  const start = () => {
    setStarted(true);
    nextCard();
  };

  // If we pressed Start before a card was ready, take the first one as soon as it is.
  useEffect(() => {
    if (started && !card && deck?.hasNext) nextCard();
  });

  const onDone = useCallback((r: CardResult) => {
    setScore((s) => {
      const byField = { ...s.byField };
      r.correct.forEach((f) => byField[f]++);
      const next = { total: s.total + r.points, cards: s.cards + 1, perfect: s.perfect + (r.perfect ? 1 : 0), byField };
      setBest((b) => {
        if (next.total > b) {
          try {
            localStorage.setItem(BEST_KEY, String(next.total));
          } catch {
            /* ignore */
          }
          return next.total;
        }
        return b;
      });
      return next;
    });
  }, []);

  const noSource = !settings.useApple && !settings.useYoutube;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-4 px-4 py-4 sm:px-6">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-3 tabular-nums">
          {started ? (
            <>
              <span className="text-3xl font-bold">{score.total}</span>
              <span className="text-xs text-tertiary">
                {score.cards} cards · best {best}
              </span>
            </>
          ) : (
            <span className="font-semibold">💿 Crate</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" color="secondary" pill size="md" uniform onClick={refresh} disabled={refreshing || !items} aria-label="Refresh collection" title="Refresh collection">
            ⟳
          </Button>
          <Button variant="ghost" color="secondary" pill size="md" uniform onClick={() => setSettingsOpen(true)} aria-label="Settings" title="Settings">
            ⚙
          </Button>
          <Button variant="ghost" color="secondary" pill size="md" uniform onClick={onLogout} aria-label="Log out" title={`Log out ${identity.username}`}>
            ⏏
          </Button>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-6 pb-6">
        {!items ? (
          <div className="w-full max-w-xs text-center">
            {loadError ? (
              <>
                <p className="mb-3 text-danger">{loadError}</p>
                <Button onClick={refresh}>Retry</Button>
              </>
            ) : (
              <>
                <Progress value={loadProgress?.loaded ?? 0} max={loadProgress?.total || 100} />
                <p className="mt-2 text-xs text-tertiary tabular-nums">
                  {loadProgress ? `${loadProgress.loaded} / ${loadProgress.total}` : "…"}
                </p>
              </>
            )}
          </div>
        ) : !started ? (
          <div className="flex flex-col items-center gap-8">
            <button
              onClick={start}
              disabled={noSource}
              aria-label="Start"
              className="group relative grid size-60 place-items-center rounded-full transition-transform active:scale-95 disabled:opacity-40"
              style={{ background: "repeating-radial-gradient(circle, #0d0d0d 0 2px, #191919 2px 4px)", boxShadow: "0 30px 60px -20px rgba(0,0,0,.9), inset 0 0 30px rgba(0,0,0,.9)" }}
            >
              <span className="grid size-20 place-items-center rounded-full text-2xl text-black/80 transition-transform group-hover:scale-110" style={{ background: "var(--vinyl-accent)" }}>
                ▶
              </span>
            </button>
            <p className="text-sm text-tertiary">
              {noSource ? "Turn on a source in ⚙" : `${items.length} records`}
            </p>
          </div>
        ) : card ? (
          <ReleaseCard
            key={cardSeq}
            card={card}
            settings={settings}
            candidates={candidates}
            onDone={onDone}
            onNext={nextCard}
            nextReady={Boolean(deck?.hasNext)}
          />
        ) : deck?.exhausted ? (
          <p className="text-center text-secondary">Nothing playable. Check ⚙</p>
        ) : (
          <div className="size-24 rounded-full vinyl-spin" style={{ background: "repeating-radial-gradient(circle, #0d0d0d 0 2px, #191919 2px 4px)" }}>
            <div className="m-auto mt-8 size-8 rounded-full" style={{ background: "var(--vinyl-accent)" }} />
          </div>
        )}
      </main>

      {/* YouTube player lives here, out of sight (the card shows a vinyl instead of the video). */}
      <div ref={ytHost} aria-hidden inert className="pointer-events-none fixed -bottom-[220px] left-0 size-[200px] opacity-0" />

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
