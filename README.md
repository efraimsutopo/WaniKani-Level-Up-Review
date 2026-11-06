# WaniKani Level-Up Review

A local React app for doing WaniKani reviews in an order that favors faster level progression:

1. Current-level radicals
2. Current-level kanji
3. All remaining reviews use the selected sort mode:
   - Lower SRS first
   - Lower level first
4. Inside every group: radicals, then kanji, then vocabulary

Reviews are only submitted to WaniKani after every required part for an item has been answered correctly. Incorrect answers show accepted answers and put that question back into the queue. Enable **Send mistakes to WaniKani** in the right-side review settings to include meaning and reading mistake counts in the completed review. This setting is off by default and your choice is saved in this browser. The setting at submission time applies to all mistakes recorded for that item.

## Setup

Install Node.js, then run:

```sh
npm install
npm run dev
```

Open the Vite URL, paste a WaniKani v2 API token with review permissions, and click **Sync**.

If the app looks out of date, click the version badge beside the title to check for updates. If a different version is available, finish your current session before choosing **Reload to update**.

## Kanji lessons

Open **Lessons** to study kanji currently unlocked for your account. Read the meanings, readings, and mnemonics, then answer the meaning and reading quiz. Click **Complete lesson & save to WaniKani** to start the assignment and its review schedule. Your API token needs **assignments:start** permission in WaniKani's token settings.

Only available lessons within your account's level and subscription are shown. Failed saves keep the completed quiz available for retry; retries check whether WaniKani already started the assignment before sending another request. Switching tabs preserves the current quiz. The **Learn** tab remains a level reference browser.

Lesson completion uses [`PUT /assignments/:id/start`](https://docs.api.wanikani.com/20170710/#start-an-assignment). Lesson quizzes do not submit reviews or count toward Guru immediately.

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
