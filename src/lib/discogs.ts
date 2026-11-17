// Direct browser access to the Discogs API (it allows CORS) with a personal token.
// A small priority queue keeps us under Discogs' 60 req/min limit:
// card preparation ("high") always jumps ahead of background indexing ("low").
import { createStore, get, set, getMany } from "idb-keyval";
import { getToken } from "./auth";
import type { CollectionItem, DiscogsFormat, DiscogsTrack, DiscogsVideo, ReleaseDetails } from "./types";

const store = createStore("dbt-discogs", "kv");

type Job = { path: string; resolve: (v: unknown) => void; reject: (e: unknown) => void };
const queues: Record<"high" | "low", Job[]> = { high: [], low: [] };
let running = false;
let minGapMs = 1100;
export const DISCOGS_API = "https://api.discogs.com";

async function pump() {
  if (running) return;
  running = true;
  try {
    while (queues.high.length || queues.low.length) {
      const job = (queues.high.shift() ?? queues.low.shift())!;
      const started = Date.now();
      try {
        job.resolve(await rawGet(job.path));
      } catch (e) {
        job.reject(e);
      }
      const wait = minGapMs - (Date.now() - started);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
  } finally {
    running = false;
  }
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function rawGet(path: string, attempt = 0): Promise<unknown> {
  // The token goes in the query string (supported by Discogs): a plain GET with no
  // custom headers avoids a CORS preflight, which would double our request count.
  const url = `${DISCOGS_API}${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(getToken())}`;
  let res: Response | null = null;
  try {
    res = await fetch(url);
  } catch {
    // Discogs' 429 responses carry no CORS headers, so a rate limit shows up as a
    // network error in the browser. Treat it the same way.
  }
  if ((!res || res.status === 429) && attempt < 6) {
    if (import.meta.env.DEV) console.info("[discogs] throttled on", path);
    minGapMs = 2500;
    await new Promise((r) => setTimeout(r, 8000 * (attempt + 1)));
    return rawGet(path, attempt + 1);
  }
  if (!res) throw new HttpError(0, `Network error on ${path}`);
  minGapMs = Math.max(1100, minGapMs - 100);
  if (!res.ok) throw new HttpError(res.status, `Discogs ${res.status} on ${path}`);
  return res.json();
}

function discogsGet<T>(path: string, priority: "high" | "low" = "high"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queues[priority].push({ path, resolve: resolve as (v: unknown) => void, reject });
    void pump();
  });
}

// ---------------------------------------------------------------------------
// Collection

type RawCollectionPage = {
  pagination: { page: number; pages: number; items: number };
  releases: {
    id: number;
    basic_information: {
      id: number;
      title: string;
      year: number;
      thumb?: string;
      cover_image?: string;
      artists: { name: string }[];
      labels: { name: string; catno?: string }[];
      formats: DiscogsFormat[];
    };
  }[];
};

const toItem = (r: RawCollectionPage["releases"][number]): CollectionItem => {
  const b = r.basic_information;
  return {
    id: b.id,
    title: b.title,
    year: b.year,
    artists: b.artists.map((a) => a.name),
    labels: [...new Set(b.labels.map((l) => l.name))],
    catno: b.labels[0]?.catno,
    formats: b.formats ?? [],
    thumb: b.thumb,
    cover: b.cover_image,
  };
};

const collectionKey = (username: string) => `collection:${username}`;

export async function getCachedCollection(username: string) {
  return get<{ items: CollectionItem[]; fetchedAt: number }>(collectionKey(username), store);
}

export async function fetchCollection(
  username: string,
  onProgress?: (loaded: number, total: number) => void,
): Promise<CollectionItem[]> {
  const items: CollectionItem[] = [];
  let page = 1;
  let pages = 1;
  do {
    const data = await discogsGet<RawCollectionPage>(
      `/users/${encodeURIComponent(username)}/collection/folders/0/releases?per_page=100&page=${page}&sort=added&sort_order=desc`,
    );
    pages = data.pagination.pages;
    items.push(...data.releases.map(toItem));
    onProgress?.(items.length, data.pagination.items);
    page++;
  } while (page <= pages);
  // The same release can be in the collection several times (multiple copies).
  const unique = [...new Map(items.map((i) => [i.id, i])).values()];
  await set(collectionKey(username), { items: unique, fetchedAt: Date.now() }, store);
  return unique;
}

// ---------------------------------------------------------------------------
// Release details

type RawRelease = {
  id: number;
  tracklist?: { position: string; title: string; duration?: string; type_?: string; artists?: { name: string }[]; sub_tracks?: RawRelease["tracklist"] }[];
  videos?: { uri: string; title: string; duration?: number }[];
};

const detailsKey = (id: number) => `release:${id}`;

function flattenTracks(list: RawRelease["tracklist"] = []): DiscogsTrack[] {
  const out: DiscogsTrack[] = [];
  for (const t of list) {
    if (t.type_ === "heading") continue;
    if (t.type_ === "index" && t.sub_tracks?.length) {
      out.push(...flattenTracks(t.sub_tracks));
      continue;
    }
    if (!t.title) continue;
    out.push({
      position: t.position,
      title: t.title,
      duration: t.duration || undefined,
      artists: t.artists?.map((a) => a.name),
    });
  }
  return out;
}

export async function getCachedDetails(ids: number[]) {
  const values = await getMany<ReleaseDetails | undefined>(ids.map(detailsKey), store);
  return values;
}

export async function getReleaseDetails(id: number, priority: "high" | "low" = "high"): Promise<ReleaseDetails> {
  const cached = await get<ReleaseDetails>(detailsKey(id), store);
  if (cached) return cached;
  const raw = await discogsGet<RawRelease>(`/releases/${id}`, priority);
  const details: ReleaseDetails = {
    id,
    tracklist: flattenTracks(raw.tracklist),
    videos: (raw.videos ?? [])
      .filter((v) => youtubeId(v.uri))
      .map((v): DiscogsVideo => ({ uri: v.uri, title: v.title, duration: v.duration })),
    fetchedAt: Date.now(),
  };
  await set(detailsKey(id), details, store);
  return details;
}

export function youtubeId(uri: string): string | null {
  const m = uri.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : null;
}

export const releaseUrl = (id: number) => `https://www.discogs.com/release/${id}`;
