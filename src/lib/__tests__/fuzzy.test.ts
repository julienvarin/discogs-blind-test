import { describe, expect, it } from "vitest";
import { buildCandidates, isMatch, normalize, suggest } from "../fuzzy";

describe("normalize", () => {
  it("strips Discogs suffixes, accents, articles and punctuation", () => {
    expect(normalize("Prince (2)")).toBe("prince");
    expect(normalize("Kraftwerk*")).toBe("kraftwerk");
    expect(normalize("The Beatles")).toBe("beatles");
    expect(normalize("Beatles, The")).toBe("beatles");
    expect(normalize("Björk")).toBe("bjork");
    expect(normalize("Simon & Garfunkel")).toBe("simon and garfunkel");
  });
});

describe("isMatch", () => {
  it("accepts typos on long names but not short ones", () => {
    expect(isMatch("Aphex Twinn", ["Aphex Twin"])).toBe(true);
    expect(isMatch("daft punk", ["Daft Punk"])).toBe(true);
    expect(isMatch("Moby", ["Mobb"])).toBe(false);
    expect(isMatch("Air", ["Air (2)"])).toBe(true);
  });
  it("ignores mix/version decorations", () => {
    expect(isMatch("Strings of Life", ["Strings Of Life (Original Mix)"])).toBe(true);
    expect(isMatch("Windowlicker", ["Windowlicker (Radio Edit)"])).toBe(true);
  });
  it("accepts any of several answers (multiple labels)", () => {
    expect(isMatch("warp", ["Bleep", "Warp Records"])).toBe(false);
    expect(isMatch("warp records", ["Bleep", "Warp Records"])).toBe(true);
  });
  it("rejects partial prefixes", () => {
    expect(isMatch("Daft", ["Daft Punk"])).toBe(false);
  });
});

describe("suggest", () => {
  const c = buildCandidates(["Daft Punk", "Dave Clarke", "Underground Resistance", "Prince (2)", "The Prodigy"]);
  it("ranks prefix matches first and dedupes", () => {
    expect(suggest("da", c).map((s) => s.value)).toEqual(["Daft Punk", "Dave Clarke"]);
    expect(suggest("prodi", c)[0].value).toBe("The Prodigy");
    expect(suggest("resist", c)[0].value).toBe("Underground Resistance");
    expect(suggest("prince", c)[0].value).toBe("Prince");
  });
});

describe("stopwords", () => {
  it("forgives missing little words", () => {
    expect(isMatch("around world", ["Around The World"])).toBe(true);
    expect(isMatch("dark side moon", ["The Dark Side Of The Moon"])).toBe(true);
    expect(isMatch("the", ["The The"])).toBe(true);
  });
});
