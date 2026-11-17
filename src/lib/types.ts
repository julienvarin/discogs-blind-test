export type Field = "track" | "artist" | "album" | "label";
export const FIELDS: Field[] = ["track", "artist", "album", "label"];
export const FIELD_LABEL: Record<Field, string> = {
  track: "Track",
  artist: "Artist",
  album: "Album / EP",
  label: "Label",
};

export type DiscogsFormat = { name: string; qty?: string; descriptions?: string[]; text?: string };

/** One release in the user's collection (from the collection listing, cheap). */
export type CollectionItem = {
  id: number;
  title: string;
  year: number;
  artists: string[];
  labels: string[];
  catno?: string;
  formats: DiscogsFormat[];
  thumb?: string;
  cover?: string;
};

export type DiscogsTrack = { position: string; title: string; duration?: string; artists?: string[] };
export type DiscogsVideo = { uri: string; title: string; duration?: number };

/** Per-release details (one Discogs API call each, cached in IndexedDB). */
export type ReleaseDetails = {
  id: number;
  tracklist: DiscogsTrack[];
  videos: DiscogsVideo[];
  fetchedAt: number;
};

export type AppleTrack = {
  trackId: number;
  name: string;
  artist: string;
  trackNumber: number;
  discNumber: number;
  previewUrl?: string;
};

export type AppleAlbum = {
  collectionId: number;
  name: string;
  artist: string;
  artworkUrl?: string;
  tracks: AppleTrack[];
  /** trackIds ordered by popularity (best-known first) when known */
  popularity: number[];
};

export type PlayableSource =
  | { kind: "apple"; previewUrl: string }
  | { kind: "youtube"; videoId: string; durationSec?: number };

export type PlayableTrack = {
  key: string;
  position: string;
  title: string;
  /** Alternate accepted titles (e.g. Apple's spelling of the same track) */
  altTitles: string[];
  /** Track-level artists (compilations, splits) */
  artists: string[];
  sources: PlayableSource[];
};

export type GameCard = {
  release: CollectionItem;
  tracks: PlayableTrack[];
  featured: number;
};
