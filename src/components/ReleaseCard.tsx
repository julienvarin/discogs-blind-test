import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@plexui/ui/components/Button";
import { Badge } from "@plexui/ui/components/Badge";
import { Progress } from "@plexui/ui/components/Progress";
import { GuessInput, type FieldStatus } from "./GuessInput";
import { releaseUrl } from "../lib/discogs";
import { cleanDiscogsName, isMatch } from "../lib/fuzzy";
import { engine, useElapsed, usePlayer } from "../lib/player";
import type { Settings } from "../lib/settings";
import { FIELD_LABEL, FIELDS, type Field, type GameCard, type PlayableTrack } from "../lib/types";

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

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

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
  const firstInput = useRef<HTMLInputElement | null>(null);

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

  const markCorrect = (f: Field, value: string) => {
    if (status[f] !== "open" || revealed) return;
    const nextStatus = { ...status, [f]: "correct" as const };
    const nextEarned = { ...earned, [f]: pointsFor(f) };
    setStatus(nextStatus);
    setEarned(nextEarned);
    if (f === "track" || f === "artist") setGuessed((g) => ({ ...g, [f]: value }));
    if (FIELDS.every((x) => nextStatus[x] !== "open")) finish(nextStatus, nextEarned);
  };

  const markWrong = (f: Field) => {
    const n = wrong[f] + 1;
    setWrong({ ...wrong, [f]: n });
    if (n >= settings.maxWrongPerField) {
      const nextStatus = { ...status, [f]: "missed" as const };
      setStatus(nextStatus);
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
  const fieldsByPoints = [...FIELDS].sort((a, b) => settings.points[b] - settings.points[a]);
  const timeLeft = Math.max(0, settings.timerSeconds - elapsed);
  const playing = player.status === "playing";
  const cover = release.cover && !release.cover.includes("spacer.gif") ? release.cover : release.thumb;

  return (
    <div className="mx-auto w-full max-w-3xl rounded-2xl border border-subtle bg-surface-secondary p-4 shadow-2xl sm:p-6">
      {/* Player */}
      <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-stretch">
        <div className="relative size-40 shrink-0 overflow-hidden rounded-xl bg-black sm:size-44">
          {revealed && cover ? (
            <img src={cover} alt={release.title} className="size-full object-cover" />
          ) : (
            <div className={`absolute inset-0 grid place-items-center ${playing ? "vinyl-spin" : ""}`}>
              <div
                className="size-[92%] rounded-full"
                style={{
                  background:
                    "repeating-radial-gradient(circle, #111 0 2px, #1c1c1c 2px 4px), #111",
                  boxShadow: "inset 0 0 20px rgba(0,0,0,.8)",
                }}
              />
              <div className="absolute size-14 rounded-full" style={{ background: "var(--vinyl-accent)" }}>
                <div className="absolute left-1/2 top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black" />
              </div>
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col justify-between gap-3 self-stretch">
          <div className="flex flex-wrap items-center gap-2">
            {source && (
              <Badge color={source.kind === "apple" ? "danger" : "warning"} variant="soft" pill>
                {source.kind === "apple" ? "Apple Music preview" : "YouTube"}
              </Badge>
            )}
            <Badge color="secondary" variant="outline" pill>
              Track {track?.position}
            </Badge>
            {player.status === "loading" && <span className="text-xs text-tertiary">loading…</span>}
            {player.status === "error" && failed.current.size >= card.tracks.reduce((n, t) => n + t.sources.length, 0) && (
              <span className="text-xs text-danger">
                Couldn't play.{" "}
                {track && track.sources.length > sourceIdx + 1 ? (
                  <button className="underline" onClick={() => playTrack(trackIdx, sourceIdx + 1)}>
                    Try other source
                  </button>
                ) : (
                  "Try another track below."
                )}
              </span>
            )}
          </div>

          {revealed ? (
            <div className="min-w-0">
              <div className="truncate text-xl font-semibold">{release.title}</div>
              <div className="truncate text-secondary">
                {release.artists.map(cleanDiscogsName).join(", ")} · {release.year || "—"}
              </div>
              <div className="truncate text-sm text-tertiary">
                {release.labels.map(cleanDiscogsName).join(", ")} {release.catno ? `· ${release.catno}` : ""} ·{" "}
                {release.formats.map((f) => f.name).join(", ")}
              </div>
            </div>
          ) : (
            <div className="flex items-end gap-1 h-10" aria-hidden>
              {Array.from({ length: 24 }, (_, i) => (
                <span
                  key={i}
                  className={`w-1.5 flex-1 rounded-sm bg-primary-solid ${playing ? "eq-bar" : ""}`}
                  style={{ height: playing ? "100%" : "15%", animationDelay: `${(i * 137) % 900}ms`, opacity: 0.35 + ((i * 7) % 10) / 20 }}
                />
              ))}
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button color="primary" variant="solid" pill onClick={() => engine.toggle()} aria-label="Play / pause">
              {playing ? "❚❚ Pause" : "▶ Play"}
            </Button>
            <div className="flex-1">
              <Progress
                value={revealed ? 0 : Math.min(elapsed, settings.timerSeconds)}
                max={settings.timerSeconds}
                aria-label="Timer"
              />
              <div className="mt-1 flex justify-between text-xs text-tertiary tabular-nums">
                <span>
                  {source?.kind === "youtube" && player.duration
                    ? `${fmt(player.position)} / ${fmt(player.duration)}`
                    : player.duration
                      ? `${fmt(player.position)} / ${fmt(player.duration)}`
                      : ""}
                </span>
                <span className={late && !revealed ? "text-warning" : undefined}>
                  {revealed ? "" : late ? `late: ×${settings.latePointsFactor} points` : `${Math.ceil(timeLeft)}s full points`}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Guess fields */}
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {fieldsByPoints.map((f, i) => (
          <GuessInput
            key={`${release.id}-${f}`}
            label={FIELD_LABEL[f]}
            points={status[f] === "correct" ? earned[f] ?? 0 : pointsFor(f)}
            status={status[f]}
            revealed={revealed}
            answer={displayAnswer[f]}
            wrong={wrong[f]}
            maxWrong={settings.maxWrongPerField}
            candidates={candidates[f]}
            check={(v) => isMatch(v, answers[f])}
            onCorrect={(v) => markCorrect(f, v)}
            onWrong={() => markWrong(f)}
            autoFocus={i === 0}
            inputRef={i === 0 ? (el) => (firstInput.current = el) : undefined}
          />
        ))}
      </div>

      {/* Rest of the release */}
      {card.tracks.length > 1 && (
        <div className="mt-5">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-tertiary">Listen to the rest</div>
          <div className="flex flex-wrap gap-1.5">
            {card.tracks.map((t, i) => {
              const yt = t.sources.findIndex((s) => s.kind === "youtube");
              const ap = t.sources.findIndex((s) => s.kind === "apple");
              return (
                <Button
                  key={t.key}
                  size="sm"
                  pill
                  variant={i === trackIdx ? "solid" : "soft"}
                  color={i === trackIdx ? "primary" : "secondary"}
                  disabled={!t.sources.length}
                  onClick={() => playTrack(i, ap !== -1 ? ap : yt)}
                  title={t.sources.length ? undefined : "No preview available"}
                >
                  <span className="tabular-nums">{t.position}</span>
                  {revealed && <span className="max-w-40 truncate opacity-80">{t.title}</span>}
                  {t.sources.length > 0 && (
                    <span className="text-[10px] opacity-60">
                      {ap !== -1 ? "" : "YT"}
                    </span>
                  )}
                </Button>
              );
            })}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-subtle pt-4">
        <div className="text-sm text-secondary">
          This card: <span className="font-semibold text-default tabular-nums">{total}</span> pts
          {revealed && FIELDS.every((f) => status[f] === "correct") && (
            <Badge color="success" variant="solid" pill className="ml-2">
              Perfect +{settings.allFourBonus}
            </Badge>
          )}
          {revealed && (
            <a href={releaseUrl(release.id)} target="_blank" rel="noreferrer" className="ml-3 text-primary underline-offset-2 hover:underline">
              View on Discogs ↗
            </a>
          )}
        </div>
        {revealed ? (
          <Button color="primary" pill onClick={onNext} disabled={!nextReady} loading={!nextReady}>
            Next card <kbd className="ml-1 text-xs opacity-60">↵</kbd>
          </Button>
        ) : (
          <Button color="secondary" variant="soft" pill onClick={reveal}>
            Reveal <kbd className="ml-1 text-xs opacity-60">esc</kbd>
          </Button>
        )}
      </div>
    </div>
  );
}
