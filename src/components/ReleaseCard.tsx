import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@plexui/ui/components/Button";
import { GuessBox, type FieldStatus } from "./GuessBox";
import { releaseUrl } from "../lib/discogs";
import { cleanDiscogsName, isMatch } from "../lib/fuzzy";
import { engine, useElapsed, usePlayer } from "../lib/player";
import type { Settings } from "../lib/settings";
import { FIELDS, type Field, type GameCard, type PlayableTrack } from "../lib/types";

export type CardResult = { points: number; correct: Field[]; perfect: boolean };

type Candidates = Record<Field, { value: string; norm: string }[]>;

type Props = {
  card: GameCard;
  settings: Settings;
  candidates: Candidates;
  onDone: (result: CardResult) => void;
  onNext: () => void;
  nextReady: boolean;
};

const SLOT_LABEL: Record<Field, string> = { track: "Track", artist: "Artist", label: "Label", album: "Album" };

export function ReleaseCard({ card, settings, candidates, onDone, onNext, nextReady }: Props) {
  const { release } = card;
  const player = usePlayer();
  const [trackIdx, setTrackIdx] = useState(card.featured);
  const [sourceIdx, setSourceIdx] = useState(0);
  const [played, setPlayed] = useState<Set<number>>(() => new Set([card.featured]));
  const [status, setStatus] = useState<Record<Field, FieldStatus>>({ track: "open", artist: "open", album: "open", label: "open" });
  const [wrong, setWrong] = useState<Record<Field, number>>({ track: 0, artist: 0, album: 0, label: 0 });
  const [earned, setEarned] = useState<Partial<Record<Field, number>>>({});
  const [guessed, setGuessed] = useState<Partial<Record<Field, string>>>({});
  const [revealed, setRevealed] = useState(false);
  const startedRef = useRef(false);
  const fieldsByPoints = useMemo(() => [...FIELDS].sort((a, b) => settings.points[b] - settings.points[a]), [settings.points]);
  const [target, setTarget] = useState<Field>(fieldsByPoints[0]);

  const track: PlayableTrack = card.tracks[trackIdx];
  const source = track?.sources[sourceIdx] ?? track?.sources[0];

  // Timer starts once audio actually plays.
  if (player.status === "playing") startedRef.current = true;
  const elapsed = useElapsed(startedRef.current && !revealed, card.release.id);
  const late = elapsed > settings.timerSeconds;

  // Play the featured track when the card appears.
  useEffect(() => {
    const t = card.tracks[card.featured];
    if (t?.sources[0]) void engine.play(t.sources[0]);
    return () => engine.stop();
  }, [card]);

  const playTrack = (i: number, srcIdx = 0) => {
    const t = card.tracks[i];
    if (!t?.sources[srcIdx]) return;
    setTrackIdx(i);
    setSourceIdx(srcIdx);
    setPlayed((p) => new Set(p).add(i));
    void engine.play(t.sources[srcIdx]);
  };

  // Accepted answers per field.
  const answers = useMemo((): Record<Field, string[]> => {
    const playedTracks = [...played].map((i) => card.tracks[i]);
    return {
      track: playedTracks.flatMap((t) => [t.title, ...t.altTitles]),
      artist: [...release.artists, ...playedTracks.flatMap((t) => t.artists)].map(cleanDiscogsName),
      album: [release.title],
      label: release.labels.map(cleanDiscogsName),
    };
  }, [played, card, release]);

  const displayAnswer: Record<Field, string> = {
    track: guessed.track ?? track?.title ?? "",
    artist: guessed.artist ?? release.artists.map(cleanDiscogsName).join(", "),
    album: release.title,
    label: release.labels.map(cleanDiscogsName).join(", "),
  };

  const pointsFor = (f: Field) => Math.ceil(settings.points[f] * (late ? settings.latePointsFactor : 1));

  const finish = useCallback(
    (finalStatus: Record<Field, FieldStatus>, finalEarned: Partial<Record<Field, number>>) => {
      const correct = FIELDS.filter((f) => finalStatus[f] === "correct");
      const perfect = correct.length === FIELDS.length;
      const points = Object.values(finalEarned).reduce((a, b) => a + (b ?? 0), 0) + (perfect ? settings.allFourBonus : 0);
      setRevealed(true);
      onDone({ points, correct, perfect });
    },
    [onDone, settings.allFourBonus],
  );

  /** Move the target to the next open field (by points) after `from` closes. */
  const advance = (st: Record<Field, FieldStatus>, from: Field) => {
    const order = fieldsByPoints;
    const start = order.indexOf(from);
    for (let k = 1; k <= order.length; k++) {
      const f = order[(start + k) % order.length];
      if (st[f] === "open") return setTarget(f);
    }
  };

  const markCorrect = (f: Field, value: string) => {
    if (status[f] !== "open" || revealed) return;
    const nextStatus = { ...status, [f]: "correct" as const };
    const nextEarned = { ...earned, [f]: pointsFor(f) };
    setStatus(nextStatus);
    setEarned(nextEarned);
    advance(nextStatus, f);
    if (f === "track" || f === "artist") setGuessed((g) => ({ ...g, [f]: value }));
    if (FIELDS.every((x) => nextStatus[x] !== "open")) finish(nextStatus, nextEarned);
  };

  const markWrong = (f: Field) => {
    const n = wrong[f] + 1;
    setWrong({ ...wrong, [f]: n });
    if (n >= settings.maxWrongPerField) {
      const nextStatus = { ...status, [f]: "missed" as const };
      setStatus(nextStatus);
      advance(nextStatus, f);
      if (FIELDS.every((x) => nextStatus[x] !== "open")) finish(nextStatus, earned);
    }
  };

  const reveal = () => !revealed && finish(status, earned);

  // Auto-fallback when a source can't play (e.g. a video with embedding disabled):
  // next source of the same track, then the next playable track.
  const failed = useRef(new Set<string>());
  useEffect(() => {
    if (player.status !== "error" || !track) return;
    failed.current.add(`${trackIdx}:${sourceIdx}`);
    const order = [trackIdx, ...card.tracks.map((_, i) => i).filter((i) => i !== trackIdx)];
    for (const i of order) {
      const srcs = card.tracks[i].sources;
      for (let j = 0; j < srcs.length; j++) {
        if (!failed.current.has(`${i}:${j}`)) {
          playTrack(i, j);
          return;
        }
      }
    }
  }, [player.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard: Esc = reveal, Enter (after reveal) = next card, Ctrl/⌘+Space = play/pause
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Esc inside a field first closes its suggestion list; otherwise it reveals.
      if (e.key === "Escape" && !revealed && !document.querySelector('[role="listbox"]')) reveal();
      else if (e.key === "Enter" && revealed && nextReady) onNext();
      else if (e.code === "Space" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        engine.toggle();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  useEffect(() => {
    if (revealed) (document.activeElement as HTMLElement | null)?.blur?.();
  }, [revealed]);

  const total = Object.values(earned).reduce((a, b) => a + (b ?? 0), 0);
  const perfect = FIELDS.every((f) => status[f] === "correct");
  const progress = Math.min(1, elapsed / settings.timerSeconds);
  const playing = player.status === "playing";
  const cover = release.cover && !release.cover.includes("spacer.gif") ? release.cover : release.thumb;
  const allFailed = player.status === "error" && failed.current.size >= card.tracks.reduce((n, t) => n + t.sources.length, 0);

  const slotValue = (f: Field) =>
    status[f] === "correct" ? (
      <span className="truncate text-success">{displayAnswer[f]}</span>
    ) : revealed ? (
      <span className="truncate text-default">{displayAnswer[f]}</span>
    ) : status[f] === "missed" ? (
      <span className="text-danger">✗</span>
    ) : (
      <span className="text-tertiary">?</span>
    );

  const slotPoints = (f: Field) =>
    status[f] === "correct" ? (
      <span className="text-success">+{earned[f]}</span>
    ) : revealed || status[f] === "missed" ? (
      <span className="text-danger">✗</span>
    ) : (
      <span className="text-tertiary">{pointsFor(f)}</span>
    );

  const slots = (
    <ul className="flex flex-col divide-y divide-[var(--color-border-subtle,rgba(255,255,255,.08))]">
      {fieldsByPoints.map((f) => (
        <li key={f} className="flex items-center gap-3 py-2">
          <span className="w-12 shrink-0 text-[11px] font-medium uppercase tracking-wider text-tertiary">{SLOT_LABEL[f]}</span>
          <span className="min-w-0 flex-1 truncate font-semibold">{slotValue(f)}</span>
          <span className="shrink-0 text-xs font-semibold tabular-nums">{slotPoints(f)}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="mx-auto flex w-full max-w-[24rem] flex-col items-center gap-4">
      {/* The card: front = mystery record, back = sleeve + answers */}
      <div className="flip-card w-full">
        <div className={`flip-inner grid ${revealed ? "flipped" : ""}`}>
          {/* FRONT */}
          <div className="flip-face card-surface flex flex-col rounded-[28px] p-5 [grid-area:1/1]">
            <div className="flex items-center justify-between text-xs text-tertiary">
              <span className="flex items-center gap-1.5">
                <span className={`inline-block size-1.5 rounded-full ${source?.kind === "apple" ? "bg-[#fa2d48]" : "bg-[#ff0033]"}`} />
                {source?.kind === "apple" ? "Apple Music" : "YouTube"} · {track?.position}
              </span>
              <span className="font-semibold tabular-nums text-default">{total} pts</span>
            </div>

            <div className="grid flex-1 place-items-center py-5">
            <button
              onClick={() => engine.toggle()}
              aria-label={playing ? "Pause" : "Play"}
              className="relative grid size-56 place-items-center rounded-full p-[5px] transition-transform active:scale-95 sm:size-60"
              style={{
                background: `conic-gradient(${late ? "var(--color-text-tertiary, #777)" : "var(--vinyl-accent)"} ${progress * 360}deg, rgba(255,255,255,.07) 0)`,
              }}
            >
              <div className={`relative grid size-full place-items-center rounded-full ${playing ? "vinyl-spin" : ""}`} style={{ background: "repeating-radial-gradient(circle, #0d0d0d 0 2px, #191919 2px 4px)", boxShadow: "inset 0 0 24px rgba(0,0,0,.9)" }}>
                <div className="absolute inset-0 rounded-full" style={{ background: "linear-gradient(135deg, rgba(255,255,255,.10), transparent 40%, transparent 60%, rgba(255,255,255,.06))" }} />
                <div className="grid size-16 place-items-center rounded-full" style={{ background: "var(--vinyl-accent)" }}>
                  <span className="size-2 rounded-full bg-black" />
                </div>
              </div>
              <span className="absolute grid size-16 place-items-center text-xl text-black/80">
                {player.status === "loading" ? "" : playing ? "" : "▶"}
              </span>
            </button>
            </div>
            {allFailed && <p className="-mt-3 mb-2 text-center text-xs text-danger">Can't play this one</p>}

            {slots}
          </div>

          {/* BACK */}
          <div className="flip-face flip-back card-surface flex flex-col overflow-hidden rounded-[28px] [grid-area:1/1]">
            <div className="relative aspect-square w-full bg-black">
              {cover && <img src={cover} alt="" className="size-full object-cover" />}
              <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/85 to-transparent" />
              <div className="absolute inset-x-4 bottom-3 flex items-end justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-lg font-bold text-white">{release.title}</div>
                  <div className="truncate text-sm text-white/70">
                    {release.year || ""} {release.catno ? `· ${release.catno}` : ""}
                  </div>
                </div>
                <a
                  href={releaseUrl(release.id)}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open on Discogs"
                  className="shrink-0 rounded-full bg-white/15 px-2.5 py-1 text-xs text-white backdrop-blur hover:bg-white/25"
                >
                  Discogs ↗
                </a>
              </div>
              <div className="absolute right-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-sm font-bold text-white backdrop-blur tabular-nums">
                +{total + (perfect ? settings.allFourBonus : 0)}
                {perfect && <span className="ml-1 text-[var(--vinyl-accent)]">★</span>}
              </div>
            </div>
            <div className="px-5 pb-3 pt-1">{slots}</div>
          </div>
        </div>
      </div>

      {/* Other tracks */}
      {card.tracks.length > 1 && (
        <div className="flex max-w-full flex-wrap justify-center gap-1.5">
          {card.tracks.map((t, i) => {
            const ap = t.sources.findIndex((s) => s.kind === "apple");
            return (
              <button
                key={t.key}
                disabled={!t.sources.length}
                onClick={() => playTrack(i, ap !== -1 ? ap : 0)}
                title={revealed ? t.title : undefined}
                className={`min-w-9 rounded-full px-2.5 py-1 text-xs font-medium tabular-nums transition-colors disabled:opacity-25 ${
                  i === trackIdx ? "bg-primary-solid text-primary-solid" : "bg-secondary-soft text-secondary hover:text-default"
                }`}
              >
                {t.position}
              </button>
            );
          })}
        </div>
      )}

      {/* Guess or next */}
      {revealed ? (
        <Button color="primary" size="xl" pill block onClick={onNext} disabled={!nextReady} loading={!nextReady}>
          Next
        </Button>
      ) : (
        <>
          <GuessBox
            fields={fieldsByPoints}
            target={target}
            onTarget={setTarget}
            status={status}
            wrong={wrong}
            maxWrong={settings.maxWrongPerField}
            points={pointsFor}
            candidates={candidates}
            check={(f, v) => isMatch(v, answers[f])}
            onCorrect={markCorrect}
            onWrong={markWrong}
            disabled={revealed}
          />
          <button onClick={reveal} className="text-sm text-tertiary underline-offset-4 hover:text-secondary hover:underline">
            Reveal
          </button>
        </>
      )}
    </div>
  );
}
