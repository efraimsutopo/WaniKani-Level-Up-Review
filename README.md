# WaniKani Level-Up Review

A local React app for doing WaniKani reviews in an order that favors faster level progression:

1. Current-level radicals
2. Current-level kanji
3. All remaining reviews use the selected sort mode:
   - Lower SRS first
   - Lower level first
4. Inside every group: radicals, then kanji, then vocabulary

Reviews are only submitted to WaniKani after every required part for an item has been answered correctly. Incorrect answers show accepted answers, increment the matching incorrect counter, and put that question back into the queue.

## Setup

Install Node.js, then run:

```sh
npm install
npm run dev
```

Open the Vite URL, paste a WaniKani v2 API token with review permissions, and click **Sync**.

## Scripts

```sh
npm run dev
npm run build
npm test
```

## Notes

- The API token is stored in browser `localStorage`.
- The app calls WaniKani API v2 directly from the browser using revision `20170710`.
- Sync uses `immediately_available_for_review` assignments instead of fetching `summary` and then refetching assignments by subject ID.
- Subjects are cached aggressively in browser `localStorage`; study materials are cached and refreshed with `updated_after`.
- Reading inputs use WaniKani's `wanakana` package for romaji-to-hiragana conversion.
- Answer checking is conservative: official accepted answers, auxiliary whitelist meanings, and study-material meaning synonyms are accepted; broad typo/fuzzy matching is not.
