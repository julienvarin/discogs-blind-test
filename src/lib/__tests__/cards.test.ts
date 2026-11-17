import { describe, expect, it } from "vitest";
import { assembleCard, isCD, isCompilation, passesDetailFilters } from "../cards";
import { DEFAULT_SETTINGS } from "../settings";
import type { AppleAlbum, CollectionItem, ReleaseDetails } from "../types";

const item = (over: Partial<CollectionItem> = {}): CollectionItem => ({
  id: 1,
  title: "Homework",
  year: 1997,
  artists: ["Daft Punk"],
  labels: ["Virgin"],
  formats: [{ name: "Vinyl", descriptions: ["LP", "Album"] }],
  ...over,
});

const details = (over: Partial<ReleaseDetails> = {}): ReleaseDetails => ({
  id: 1,
  tracklist: [
    { position: "A1", title: "Daftendirekt" },
    { position: "A2", title: "WDPK 83.7 FM" },
    { position: "B1", title: "Around The World" },
  ],
  videos: [{ uri: "https://www.youtube.com/watch?v=K0HSD_i2DvA", title: "Daft Punk - Around The World (Official Video)", duration: 240 }],
  fetchedAt: 0,
  ...over,
});

const apple: AppleAlbum = {
  collectionId: 9,
  name: "Homework",
  artist: "Daft Punk",
  tracks: [
    { trackId: 1, name: "Daftendirekt", artist: "Daft Punk", trackNumber: 1, discNumber: 1, previewUrl: "https://a/1.m4a" },
    { trackId: 3, name: "Around the World", artist: "Daft Punk", trackNumber: 7, discNumber: 1, previewUrl: "https://a/3.m4a" },
  ],
  popularity: [3, 1],
};

describe("filters", () => {
  it("detects CDs but keeps vinyl + bonus CD", () => {
    expect(isCD(item({ formats: [{ name: "CD" }] }))).toBe(true);
    expect(isCD(item({ formats: [{ name: "Vinyl" }, { name: "CD" }] }))).toBe(false);
    expect(isCD(item())).toBe(false);
  });
  it("excludes only big compilations", () => {
    const comp = item({ artists: ["Various"], formats: [{ name: "Vinyl", descriptions: ["Compilation"] }] });
    expect(isCompilation(comp)).toBe(true);
    const many = details({ tracklist: Array.from({ length: 20 }, (_, i) => ({ position: String(i), title: `T${i}` })) });
    expect(passesDetailFilters(comp, many, DEFAULT_SETTINGS)).toBe(false);
    expect(passesDetailFilters(comp, details(), DEFAULT_SETTINGS)).toBe(true);
    expect(passesDetailFilters(comp, many, { ...DEFAULT_SETTINGS, excludeBigCompilations: false })).toBe(true);
  });
});

describe("assembleCard", () => {
  it("matches sources and features the best-known track", () => {
    const card = assembleCard(item(), details(), apple, DEFAULT_SETTINGS)!;
    expect(card.tracks).toHaveLength(3);
    expect(card.tracks[card.featured].title).toBe("Around The World");
    expect(card.tracks[2].sources.map((s) => s.kind)).toEqual(["apple", "youtube"]);
    expect(card.tracks[1].sources).toHaveLength(0);
  });
  it("respects source toggles and skips releases with no source", () => {
    const yt = assembleCard(item(), details(), apple, { ...DEFAULT_SETTINGS, useApple: false })!;
    expect(yt.tracks[yt.featured].sources).toEqual([{ kind: "youtube", videoId: "K0HSD_i2DvA", durationSec: 240 }]);
    expect(assembleCard(item(), details({ videos: [] }), null, DEFAULT_SETTINGS)).toBeNull();
    expect(assembleCard(item(), details(), apple, { ...DEFAULT_SETTINGS, useApple: false, useYoutube: false })).toBeNull();
  });
});
