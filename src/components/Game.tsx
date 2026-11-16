import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Button } from "@plexui/ui/components/Button";
import { Badge } from "@plexui/ui/components/Badge";
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
  const indexing = index && index.done < index.total;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-6 px-4 py-5 sm:px-6">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl">💿</span>
          <div>
            <div className="font-semibold leading-tight">Crate Blind Test</div>
            <div className="text-xs text-tertiary">
              {identity.username} · {items ? `${items.length} releases` : "loading…"}
              {indexing ? ` · indexing tracks ${index.done}/${index.total}` : ""}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {started && (
            <div className="flex items-center gap-4 text-sm tabular-nums">
              <div>
                <div className="text-xs text-tertiary">Score</div>
                <div className="text-xl font-bold">{score.total}</div>
              </div>
              <div>
                <div className="text-xs text-tertiary">Cards</div>
                <div className="text-xl font-semibold">{score.cards}</div>
              </div>
              <div className="hidden sm:block">
                <div className="text-xs text-tertiary">Best</div>
                <div className="text-xl font-semibold text-secondary">{best}</div>
              </div>
            </div>
          )}
          <Button variant="soft" color="secondary" pill size="sm" onClick={() => setSettingsOpen(true)}>
            ⚙ Settings
          </Button>
          <Button variant="ghost" color="secondary" pill size="sm" onClick={onLogout}>
            Log out
          </Button>
        </div>
      </header>

      {/* Body */}
      <main className="flex flex-1 flex-col items-center justify-center gap-6">
        {!items ? (
          <div className="w-full max-w-sm text-center">
            {loadError ? (
              <>
                <p className="mb-3 text-danger">{loadError}</p>
                <Button onClick={refresh}>Retry</Button>
              </>
            ) : (
              <>
                <p className="mb-3 text-secondary">Loading your collection…</p>
                <Progress value={loadProgress?.loaded ?? 0} max={loadProgress?.total || 100} />
                {loadProgress && (
                  <p className="mt-2 text-xs text-tertiary tabular-nums">
                    {loadProgress.loaded} / {loadProgress.total}
                  </p>
                )}
              </>
            )}
          </div>
        ) : !started ? (
          <div className="flex max-w-lg flex-col items-center gap-5 text-center">
            <h1 className="heading-3xl">Ready to dig?</h1>
            <p className="text-secondary">
              One release per card. Guess the <b>track</b> ({settings.points.track} pts), <b>artist</b> ({settings.points.artist}),{" "}
              <b>label</b> ({settings.points.label}) and <b>album/EP</b> ({settings.points.album}). Full points for{" "}
              {settings.timerSeconds}s, then ×{settings.latePointsFactor}.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {settings.useApple && <Badge pill>Apple Music</Badge>}
              {settings.useYoutube && <Badge pill>YouTube</Badge>}
              {settings.excludeCDs && <Badge pill variant="outline">No CDs</Badge>}
              {settings.excludeBigCompilations && (
                <Badge pill variant="outline">No compilations over {settings.compilationMaxTracks} tracks</Badge>
              )}
            </div>
            <Button color="primary" size="xl" pill onClick={start} disabled={noSource}>
              ▶ Start blind test
            </Button>
            {noSource && <p className="text-sm text-danger">Turn on Apple Music or YouTube in settings.</p>}
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
          <div className="max-w-md text-center text-secondary">
            No playable release found with these settings ({deck.stats.unplayable} without a source, {deck.stats.filtered} filtered).
            Try turning on another source or relaxing the filters.
          </div>
        ) : (
          <div className="text-center text-secondary">
            <div className="mb-2 text-4xl vinyl-spin inline-block">💿</div>
            <p>Digging through your crates…</p>
            {deck && deck.stats.unplayable + deck.stats.filtered > 0 && (
              <p className="mt-1 text-xs text-tertiary">
                skipped {deck.stats.unplayable} without a preview, {deck.stats.filtered} filtered
              </p>
            )}
          </div>
        )}
      </main>

      <footer className="flex flex-wrap items-center justify-between gap-2 text-xs text-tertiary">
        <span>
          {started && score.cards > 0 && (
            <>
              Found: track {score.byField.track} · artist {score.byField.artist} · label {score.byField.label} · album {score.byField.album} ·
              perfect {score.perfect}
            </>
          )}
        </span>
        <span className="flex items-center gap-3">
          {refreshing && loadProgress && items && <span>refreshing collection…</span>}
          {items && !refreshing && (
            <button className="underline-offset-2 hover:underline" onClick={refresh}>
              Refresh collection
            </button>
          )}
          <span>Data: Discogs · Previews: Apple Music, YouTube</span>
        </span>
      </footer>

      {/* YouTube player lives here, out of sight (the card shows a vinyl instead of the video). */}
      <div ref={ytHost} aria-hidden inert className="pointer-events-none fixed -bottom-[220px] left-0 size-[200px] opacity-0" />

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
