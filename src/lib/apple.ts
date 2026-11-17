// Apple Music 30s previews via the public iTunes Search API (CORS-enabled, no key).
// The API allows roughly 20 calls/min, so calls are serialised and cached.
import { createStore, get, set } from "idb-keyval";
import { cleanDiscogsName, normalize, similarity } from "./fuzzy";
import type { AppleAlbum, AppleTrack, CollectionItem } from "./types";

const store = createStore("dbt-apple", "kv");
const MISS_TTL = 1000 * 60 * 60 * 24 * 30; // retry unmatched releases after 30 days

export const appleCountry = () => {
  const region = navigator.language.split("-")[1];
  return region && region.length === 2 ? region.toUpperCase() : "US";
};

let chain: Promise<unknown> = Promise.resolve();
let gapMs = 3000;

function itunes<T>(path: string): Promise<T> {
  const run = async (attempt = 0): Promise<T> => {
    const res = await fetch(`https://itunes.apple.com${path}`);
    if ((res.status === 403 || res.status === 429) && attempt < 2) {
      gapMs = 6000;
      await new Promise((r) => setTimeout(r, 15000 * (attempt + 1)));
      return run(attempt + 1);
    }
    if (!res.ok) throw new Error(`iTunes ${res.status}`);
    gapMs = Math.max(3000, gapMs - 500);
    return (await res.json()) as T;
  };
  const p = chain.then(async () => {
    try {
      return await run();
    } finally {
      await new Promise((r) => setTimeout(r, gapMs));
    }
  });
  chain = p.catch(() => undefined);
  return p;
}

type ItunesResult = {
  wrapperType: string;
  kind?: string;
  collectionId: number;
  collectionName: string;
  artistName: string;
  collectionArtistName?: string;
  trackId?: number;
  trackName?: string;
  trackNumber?: number;
  discNumber?: number;
  previewUrl?: string;
  artworkUrl100?: string;
  trackCount?: number;
};

const stripEdition = (s: string) =>
  s.replace(/\s*[([][^)\]]*(edition|remaster|deluxe|expanded|anniversary|version|reissue|bonus)[^)\]]*[)\]]/gi, "").replace(/\s+-\s+(EP|Single)$/i, "");

function scoreAlbum(r: ItunesResult, item: CollectionItem) {
  const title = normalize(stripEdition(r.collectionName));
  const wanted = normalize(stripEdition(item.title));
  const titleSim = similarity(title, wanted);
  const artistNames = item.artists.map((a) => normalize(cleanDiscogsName(a)));
  const appleArtist = normalize(r.collectionArtistName ?? r.artistName);
  const artistSim = Math.max(
    ...artistNames.map((a) => (appleArtist.includes(a) || a.includes(appleArtist) ? 1 : similarity(a, appleArtist))),
  );
  return { titleSim, artistSim, score: titleSim * 0.6 + artistSim * 0.4 };
}

const primaryArtist = (item: CollectionItem) => cleanDiscogsName(item.artists[0] ?? "");

async function findAlbumUncached(item: CollectionItem): Promise<AppleAlbum | null> {
  const country = appleCountry();
  const term = `${primaryArtist(item)} ${stripEdition(item.title)}`.slice(0, 120);
  const search = await itunes<{ results: ItunesResult[] }>(
    `/search?term=${encodeURIComponent(term)}&entity=album&limit=15&country=${country}`,
  );
  const ranked = search.results
    .map((r) => ({ r, ...scoreAlbum(r, item) }))
    .filter((x) => x.titleSim >= 0.75 && x.artistSim >= 0.7)
    .sort((a, b) => b.score - a.score);
  const best = ranked[0]?.r;
  if (!best) return null;

  const lookup = await itunes<{ results: ItunesResult[] }>(
    `/lookup?id=${best.collectionId}&entity=song&country=${country}`,
  );
  const tracks: AppleTrack[] = lookup.results
    .filter((r) => r.wrapperType === "track" && r.kind === "song" && r.trackId)
    .map((r) => ({
      trackId: r.trackId!,
      name: r.trackName!,
      artist: r.artistName,
      trackNumber: r.trackNumber ?? 0,
      discNumber: r.discNumber ?? 1,
      previewUrl: r.previewUrl,
    }))
    .sort((a, b) => a.discNumber - b.discNumber || a.trackNumber - b.trackNumber);
  if (!tracks.some((t) => t.previewUrl)) return null;

  return {
    collectionId: best.collectionId,
    name: best.collectionName,
    artist: best.collectionArtistName ?? best.artistName,
    artworkUrl: best.artworkUrl100?.replace("100x100", "600x600"),
    tracks,
    popularity: await popularityOrder(primaryArtist(item), tracks),
  };
}

/** Rank album tracks by where they appear in the artist's top songs (best-known first). */
async function popularityOrder(artist: string, tracks: AppleTrack[]): Promise<number[]> {
  try {
    const key = `top:${appleCountry()}:${normalize(artist)}`;
    let top = await get<string[]>(key, store);
    if (!top) {
      const res = await itunes<{ results: ItunesResult[] }>(
        `/search?term=${encodeURIComponent(artist)}&entity=song&attribute=artistTerm&limit=200&country=${appleCountry()}`,
      );
      top = res.results.map((r) => normalize(r.trackName ?? "", { stripDecorations: true }));
      await set(key, top, store);
    }
    const rank = (t: AppleTrack) => {
      const n = normalize(t.name, { stripDecorations: true });
      const i = top!.findIndex((x) => x === n);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    return [...tracks].sort((a, b) => rank(a) - rank(b) || a.trackNumber - b.trackNumber).map((t) => t.trackId);
  } catch {
    return tracks.map((t) => t.trackId);
  }
}

export async function findAppleAlbum(item: CollectionItem): Promise<AppleAlbum | null> {
  const key = `album:${appleCountry()}:${item.id}`;
  const cached = await get<{ album: AppleAlbum | null; at: number }>(key, store);
  if (cached && (cached.album || Date.now() - cached.at < MISS_TTL)) return cached.album;
  const album = await findAlbumUncached(item);
  await set(key, { album, at: Date.now() }, store);
  return album;
}
