import { findAppleAlbum } from "./apple";
import { getReleaseDetails, youtubeId } from "./discogs";
import { cleanDiscogsName, normalize, similarity } from "./fuzzy";
import type { Settings } from "./settings";
import type { AppleAlbum, CollectionItem, DiscogsVideo, GameCard, PlayableTrack, ReleaseDetails } from "./types";

const CD_FORMATS = new Set(["CD", "CDr", "SACD", "CDV", "Minidisc", "HDCD"]);
const NON_CD_AUDIO = new Set(["Vinyl", "Cassette", "Shellac", "Reel-To-Reel", "Lathe Cut", "Flexi-disc", "8-Track Cartridge", "Acetate"]);

/** A CD release (a vinyl that ships with a bonus CD still counts as vinyl). */
export function isCD(item: CollectionItem) {
  const names = item.formats.map((f) => f.name);
  return names.some((n) => CD_FORMATS.has(n)) && !names.some((n) => NON_CD_AUDIO.has(n));
}

export function isCompilation(item: CollectionItem) {
  return (
    item.formats.some((f) => f.descriptions?.some((d) => /compilation/i.test(d))) ||
    item.artists.some((a) => /^various/i.test(cleanDiscogsName(a)))
  );
}

/** Cheap pre-filter using only collection data. */
export function passesBasicFilters(item: CollectionItem, s: Settings) {
  if (s.excludeCDs && isCD(item)) return false;
  return true;
}

export function passesDetailFilters(item: CollectionItem, details: ReleaseDetails, s: Settings) {
  if (s.excludeBigCompilations && isCompilation(item) && details.tracklist.length > s.compilationMaxTracks) return false;
  return true;
}

// ---------------------------------------------------------------------------

/** "Artist - Title (Original Mix)" → "Title (Original Mix)" */
function videoTrackTitle(video: DiscogsVideo, item: CollectionItem) {
  const parts = video.title.split(/\s+[-–—|]\s+/);
  if (parts.length < 2) return video.title;
  const artists = item.artists.map((a) => normalize(a));
  const first = normalize(parts[0]);
  if (artists.some((a) => first.includes(a) || a.includes(first))) return parts.slice(1).join(" - ");
  return parts[parts.length - 1];
}

const titleSim = (a: string, b: string) => {
  const na = normalize(a, { stripDecorations: true });
  const nb = normalize(b, { stripDecorations: true });
  if (!na || !nb) return 0;
  if (na.length >= 5 && nb.length >= 5 && (na.includes(nb) || nb.includes(na))) return 0.95;
  return similarity(na, nb);
};

function bestMatch<T>(title: string, pool: T[], getTitle: (t: T) => string, min = 0.8) {
  let best: T | undefined;
  let bestScore = min;
  for (const candidate of pool) {
    const score = titleSim(title, getTitle(candidate));
    if (score >= bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

const APPLE_TIMEOUT_MS = 5000;
const MAX_VIDEO_SECONDS = 15 * 60; // skip full-album uploads

export function assembleCard(
  item: CollectionItem,
  details: ReleaseDetails,
  apple: AppleAlbum | null,
  s: Settings,
): GameCard | null {
  const appleTracks = s.useApple && apple ? apple.tracks.filter((t) => t.previewUrl) : [];
  const videos = s.useYoutube
    ? details.videos.filter((v) => youtubeId(v.uri) && (!v.duration || v.duration <= MAX_VIDEO_SECONDS))
    : [];
  const usedApple = new Set<number>();
  const usedVideos = new Set<string>();

  const tracks: PlayableTrack[] = details.tracklist.map((t, i) => {
    const sources: PlayableTrack["sources"] = [];
    const altTitles: string[] = [];
    const a = bestMatch(t.title, appleTracks.filter((x) => !usedApple.has(x.trackId)), (x) => x.name);
    if (a?.previewUrl) {
      usedApple.add(a.trackId);
      sources.push({ kind: "apple", previewUrl: a.previewUrl });
      altTitles.push(a.name);
    }
    const v = bestMatch(
      t.title,
      videos.filter((x) => !usedVideos.has(x.uri)),
      (x) => videoTrackTitle(x, item),
      0.82,
    );
    if (v) {
      usedVideos.add(v.uri);
      sources.push({ kind: "youtube", videoId: youtubeId(v.uri)!, durationSec: v.duration });
    }
    return { key: `${t.position || i}-${t.title}`, position: t.position || String(i + 1), title: t.title, altTitles, artists: t.artists ?? [], sources };
  });

  // Releases without a Discogs tracklist: fall back to the Apple album order.
  if (!tracks.length && appleTracks.length) {
    for (const a of appleTracks) {
      usedApple.add(a.trackId);
      tracks.push({
        key: `apple-${a.trackId}`,
        position: String(a.trackNumber),
        title: a.name,
        altTitles: [],
        artists: [a.artist],
        sources: [{ kind: "apple", previewUrl: a.previewUrl! }],
      });
    }
  }

  // YouTube videos that didn't match a listed track (e.g. alternate titles) are still playable.
  if (tracks.every((t) => !t.sources.some((s) => s.kind === "youtube"))) {
    for (const v of videos) {
      if (usedVideos.has(v.uri)) continue;
      tracks.push({
        key: `yt-${v.uri}`,
        position: "▶",
        title: videoTrackTitle(v, item),
        altTitles: [],
        artists: [],
        sources: [{ kind: "youtube", videoId: youtubeId(v.uri)!, durationSec: v.duration }],
      });
    }
  }

  const playable = tracks.map((t, i) => ({ t, i })).filter(({ t }) => t.sources.length);
  if (!playable.length) return null;

  // Best-known track: Apple popularity order first, then the first track with a video.
  let featured = playable[0].i;
  if (apple && s.useApple) {
    const byId = new Map(apple.tracks.map((t) => [t.trackId, t]));
    for (const id of apple.popularity) {
      const at = byId.get(id);
      if (!at?.previewUrl) continue;
      const idx = tracks.findIndex((t) => t.sources.some((src) => src.kind === "apple" && src.previewUrl === at.previewUrl));
      if (idx !== -1) {
        featured = idx;
        break;
      }
    }
  }
  return { release: item, tracks, featured };
}

export type BuildResult = { card: GameCard } | { skip: "filtered" | "unplayable" | "error" };

export async function buildCard(item: CollectionItem, s: Settings): Promise<BuildResult> {
  const t0 = performance.now();
  const r = await buildCardInner(item, s);
  if (import.meta.env.DEV) console.info(`[card] ${item.id} ${item.title}: ${Math.round(performance.now() - t0)}ms`, "card" in r ? "ok" : r.skip);
  return r;
}

async function buildCardInner(item: CollectionItem, s: Settings): Promise<BuildResult> {
  try {
    const details = await getReleaseDetails(item.id, "high");
    if (!passesDetailFilters(item, details, s)) return { skip: "filtered" };
    let apple: AppleAlbum | null = null;
    if (s.useApple) {
      const lookup = findAppleAlbum(item).catch((e) => {
        console.warn("Apple lookup failed", item.title, e);
        return null;
      });
      // When iTunes is rate-limiting, don't stall the game if YouTube can cover this
      // release; the lookup keeps running and is cached for next time.
      const hasVideos = s.useYoutube && details.videos.length > 0;
      apple = hasVideos
        ? await Promise.race([lookup, new Promise<null>((r) => setTimeout(() => r(null), APPLE_TIMEOUT_MS))])
        : await lookup;
    }
    const card = assembleCard(item, details, apple, s);
    return card ? { card } : { skip: "unplayable" };
  } catch (e) {
    console.warn("Could not build card", item.id, e);
    return { skip: "error" };
  }
}
