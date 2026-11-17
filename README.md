# Crate Blind Test

A blind test built from **your own Discogs collection**. Each card is one release: a snippet of its best-known track plays, and you guess:

| Field | Points |
| --- | --- |
| Track | 5 |
| Artist | 3 |
| Label | 2 |
| Album / EP | 1 |

Getting all four earns a +2 bonus. Answering inside the 30s timer gives full points, after that half (all of this is adjustable in Settings).

- **One box, one tap**: tap Track / Artist / Label / Album to choose what you're guessing, then type. Suggestions come from your collection, and an answer counts as soon as it matches, with typos, accents and "The" forgiven. A wrong pick costs one of 3 tries. Once a field is found, the next open one is selected for you.
- **Flip card**: the front shows a spinning record with a timer ring and four "?" slots that fill in. Revealing flips the card to the sleeve and the answers.
- **Sources**: Apple Music 30s previews first, then the YouTube videos attached to the release on Discogs. YouTube playback starts somewhere in the middle of the track, never at 0:00. Each source can be switched off. Releases with no playable source are skipped.
- **Filters** (toggleable): no CDs (vinyl with a bonus CD still counts), and no compilations or Various Artists releases over 15 tracks.
- **Listen to the rest**: every other track of the release is playable from the card.
- Keyboard: `Tab` switches the guess target, `Esc` reveals, `Enter` goes to the next card, `Ctrl/⌘ + Space` plays or pauses.

## Use it

1. Get a personal token at <https://www.discogs.com/settings/developers> ("Generate new token").
2. Open the site and paste it. The token is stored only in your browser's localStorage and is sent only to `api.discogs.com`.

The first visit loads the whole collection (about 1s per 100 releases, Discogs rate limit). After that it's cached in the browser, and tracklists are indexed in the background to power track suggestions.

## Deploy (GitHub Pages)

Every push to `main` builds and deploys through `.github/workflows/deploy.yml`.

One-time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**. On a free plan the repo must be public. The site is then served at `https://<user>.github.io/discogs-blind-test/`.

## Develop

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # unit tests (fuzzy matching, filters, card assembly)
npm run build
```

Stack: Vite + React 19 + [Plex UI](https://plexui.com) (Tailwind 4). There is no backend: Discogs and the iTunes Search API both allow direct browser calls (CORS), and data is cached in IndexedDB.
