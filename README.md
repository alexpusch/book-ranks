# Book ranks

A client-only book tier list app built with React, Vite, and TypeScript. Chrome's on-device AI extracts books and matches Open Library search results. Rankings, book metadata, and cover choices stay in your browser. There is no application backend, database, API key, or server configuration.

## Run

Use Node.js 22.12+ (or a newer supported release) and npm for development/building:

```sh
npm install
npm run dev
```

Open the Vite URL printed in the terminal (normally `http://127.0.0.1:5173`).

```sh
npm run build
npm start
```

`npm start` previews the static production build locally. Deploy the contents of `dist/` to any HTTPS static host; Node.js is not needed in production. Configure the host to serve `index.html` for SPA navigation. No `.env` file or Open Library contact configuration is required. Old backend `.env` settings and SQLite cache files are unused; browser boards are unaffected.

## Deploy to GitHub Pages

In the repository's **Settings → Pages**, set **Source** to **GitHub Actions**.
Push to `main`, or manually run **Deploy to GitHub Pages** from the **Actions** tab.
The [deployment workflow](./.github/workflows/deploy-pages.yml) installs dependencies,
type-checks and builds the app with Node.js 22, then deploys `dist/`.
It uses the base path reported by GitHub Pages, supporting repository subpaths and custom domains.

The default site URL for this repository is <https://alexpusch.github.io/book-ranks/>.
No deployment secrets or backend are required.

## Build your list

Add **one book at a time**, then click **+ Add book**. When the Prompt API is supported, the toggle at the top of the form offers two modes:

- **AI assisted** (shown and selected by default only when the Prompt API reports an available, downloadable, or downloading model): paste a book's title, optionally including its author, into the compact input, for example `Children of Ruin` or `The Lord of the Rings by J. R. R. Tolkien`. The explanation below the toggle links to the Prompt API documentation.
- **Manual entry** (the only mode when the Prompt API is missing or unavailable): enter the **Book name** and optional **Author** in separate fields. Adding a book this way does not require AI.

Manual entry is available while the app checks Prompt API support, without downloading or creating a model session. While checking, or when the API is missing or unavailable, only the form is shown, without mode tabs. Starting a manual draft or selecting manual entry keeps that mode active when the check completes. If the check fails, the app shows an error and keeps the mode tabs hidden.

Switching modes or collapsing the panel preserves unfinished drafts. In AI assisted mode, **+ Add book** sits to the right of the input; manual entry mode places it to the right of the fields on desktop and below them on narrow screens. Submitting a AI assisted entry immediately adds a placeholder card to the reading pile, displaying **exactly the text you entered** and a spinning Chrome icon. The input clears immediately and stays available so you can submit more books while earlier ones are processed. A progress bar below the input appears only while Chrome downloads its on-device model on first use (including an already-running download), not when initializing a cached model or extracting book details. It disappears when initialization finishes, fails, or is canceled. Manual additions also clear only their own fields.

Chrome's built-in model uses the Prompt API and structured output to extract search-ready title/author pairs. It removes list markers, retailer/edition annotations, marketing suffixes such as **: A Novel**, and redundant series labels: **The Infinite Extent: Bobiverse, Book 6** becomes **The Infinite Extent**. Optional subtitles are omitted when the main title and supplied author identify the book; distinguishing subtitle wording and volume identifiers are retained. Essential title numbers (for example, **2001: A Space Odyssey**), punctuation, accents, and original languages are preserved. Missing authors remain **Unknown author**.

AI assisted entry and AI matching require an up-to-date **desktop Chrome with the Prompt API available**, a supported device, and HTTPS or localhost. Manual entry and automatic cover lookup also work without Chrome AI: the local matcher always chooses a candidate when search returns results, without requiring exact title or author matches. It checks one page of up to 20 editions for each candidate with artwork and prefers the newest parseable release date with a cover. If there are no dated edition covers, it uses the first search result with artwork, or the first result if none have artwork. Equal dates preserve search/edition order. See Chrome's [Prompt API requirements](https://developer.chrome.com/docs/ai/prompt-api#hardware-requirements). Text and search candidates are processed on-device, not by a cloud LLM; Open Library receives the normalized title/author for searching.

Loss of AI support after the initial check, model failures, normalized duplicates, and AI output containing zero or multiple books keep the original placeholder with an error. Use **Retry** on the card or edit its book details manually; other pending entries continue processing. Empty input and duplicate raw submissions are rejected by the form. You can manually switch to manual entry; there is no automatic parser or cloud fallback. Duplicate matching uses title and author, ignoring case and repeated whitespace; an omitted author is equivalent to **Unknown author**.

Normalization replaces the placeholder's raw text with the extracted title and author on the **same card**, then begins cover lookup. You can rank or remove pending cards; late results never restore removed entries or overwrite manual metadata edits. Explicitly chosen artwork is preserved. Pending submissions are saved with the board and resume after reload. Lookup failures never roll back the addition and can be retried in the editor.

### Search and cover selection

Each book follows a FIFO queue: pending extraction (spinning Chrome icon), waiting for cover search (clock), searching/matching (spinner), then matched, no match, review required, or an explicit error. New imports and retries join that queue; removed books are skipped and late results from edited/deleted books are ignored.

1. Fetch one Open Library search page with up to **10 results**, requesting only IDs, titles, authors, and representative cover IDs. Missing authors use a title-only search. Legacy edition records are excluded without discarding valid work results.
2. When supported, Chrome AI compares the requested book with every candidate's title and authors. It returns a supplied work ID or explicitly declines to match. Invented IDs and malformed output are rejected. When the Prompt API is missing or reports unavailable, the liberal local matcher described above chooses a candidate and prefers a recent edition cover. Actual API/model and edition-request failures are still reported rather than silently bypassed.
3. Copy the chosen result's title and authors into the card, save its work ID, and use the selected edition cover or representative cover (`cover_i`). Edition cover selections also retain their edition ID. The model does not generate canonical metadata. A correct work without artwork is still saved as matched and can be explored for editions.

Ambiguous AI results require review rather than a forced match; non-AI lookup deliberately chooses liberally from search results. A canonical title/author collision with another board entry leaves the original entry intact and shows a warning; books and rankings are not silently merged.

**AI lookup and merely opening the editor do not request editions.** Non-AI lookup fetches only the first page of up to 20 editions per search candidate with artwork, so its preference is the newest dated cover found in those pages, not necessarily the newest edition in the entire catalog. All requests use the shared rate-limited queue. Click **Find additional editions and covers** in the editor to fetch up to 20 editions of the matched work. **More editions and covers** explicitly fetches the next page. Errors offer a retry of the same page; pages are never automatically followed. Loaded pages are reused while that editor remains open.

The keyboard-accessible cover gallery deduplicates artwork by cover ID, preserving a saved edition association where possible. Tiles show release dates when available. Selecting an edition cover changes the artwork, not the canonical title/author. A selectable placeholder remains available during loading and errors.

To use your own artwork, open the pencil editor and choose **Upload photo** in the cover gallery, or click **Paste image** and press **Ctrl+V** (**Command+V** on Mac) after copying an image. **Cancel paste** restores normal text pasting. Choosing an image immediately applies it, just like choosing an Open Library cover. JPEG, PNG, WebP, GIF, and AVIF files smaller than 15 MB and at most 40 million pixels are supported when the browser can decode them. Images are flattened onto white and saved as JPEGs, resized to at most 1200 pixels on the longest side; animated images become still covers. Images too large to save show an error. Processing stays on-device: custom cover bytes are stored with the board and included in exports, never uploaded to a server.

**Retry cover search** saves the editor's current fields, clears its matched work/cover choice, and queues a new search. Saving ordinary metadata edits preserves selected artwork. Existing saved covers and placeholders are not automatically replaced. A saved matched work without artwork does not trigger another automatic search on reload; old snapshots with a saved Open Library cover can use its work ID for edition discovery.

All metadata requests—including searches, edition pages, and retries—share one browser-tab queue: **at most one in flight, with at least one second between starts**, a bounded queue, ten-second request timeouts, and at most three attempts. Throttling honors `Retry-After`; excessive delays are reported explicitly. Model prompts are also serialized, with separate sessions and cleanup for each task.

Open Library metadata is requested directly from `openlibrary.org`, and artwork from `covers.openlibrary.org`. External metadata/artwork requires network access. Rate limits are per tab, not coordinated across tabs or users sharing an IP. There is no persistent metadata cache or offline artwork guarantee. CORS restrictions and provider outages are shown as errors. Attribution does not establish cover-art redistribution permission for downloaded images.

## Ranking and editing

The gallery forms the bottom of the Add books panel, has no heading or subtitle, and shows "your books" when empty. Collapsing Add books hides only the entry form, not the gallery. As you scroll through lower tiers, the heading and form scroll away while only the gallery stays pinned to the top of the viewport, on desktop and mobile. Its books remain horizontally scrollable and available to drag into the visible ranks.

Hover over a card or focus its controls to reveal the drag handle, pencil editor, and remove button. Only the handle starts a drag: move it into a tier, between tiers, onto another card to reorder, or back to the reading pile. For keyboard dragging, focus the handle, press Space, use arrows, then Space to drop; Escape cancels. On touchscreens, controls remain visible: hold the handle briefly to drag, or swipe card content to scroll.

The remove button on a ranked book returns it to the end of the unranked reading pile, keeping its details and cover. Removing a book from the reading pile deletes it from the list.

The pencil opens a sliding editor with accessible title/author inputs and cover choices. Empty titles and duplicate metadata are rejected. Close with its x icon, Escape, or a click outside the panel. Tier settings support adding, renaming, recoloring, reordering, and deleting tiers. At least one tier remains; deleting one returns its books to the reading pile.

Use the moon/sun switch beside **Tier settings** to change the page, forms, and dialogs between light and dark themes. It has no visible text: the moon changes to a sun in dark mode, with a tooltip and accessible label indicating the theme you can switch to. The choice lasts until you reload the page. JPEG downloads use the theme selected when the export starts, without changing tier colors or cover artwork.

## Saving and recovery

The version-1 board is saved automatically in localStorage, specific to the browser and origin. Existing saved boards and cover selections remain compatible. Persisted matched work IDs and custom cover JPEG data are additive; transient queues, model sessions, request states, and remote image URLs are not stored.

Malformed saved data is not overwritten automatically. A warning offers an explicit reset of saved data **and the current list**. Storage-access/quota failures also show warnings and a retry action; custom covers consume browser storage and can reach its quota sooner. Clearing site data removes your saved list and custom covers. There are no accounts, server-side uploads, or multiple saved lists.

## JPEG export

**Export JPEG** downloads the entire tier board, including empty tiers and offscreen books, with narrow 8px outer padding. The current URL, with its query string removed, appears at the bottom left. The image has no title or app branding. The reading pile and controls are excluded. A separate rendering wraps long labels and snapshots current metadata/selections without waiting for lookup.

Selected covers are preflighted at larger size with timeouts and reused as verified embedded bytes. Missing, invalid, blocked, or stalled artwork names the affected books and offers **Retry export** or **Export with placeholders for failed covers**. Display image errors independently show the bundled placeholder and an explicit retry.

Images export at 1x resolution (normally 1100px wide), with height determined by the board content. Large exports reduce pixel ratio to stay within canvas limits; excessively large boards fail visibly rather than being cropped. Browser memory limits can still cause export failures.

## Validation

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium  # once, if Chromium is not installed
npm run test:e2e
```

Unit/UI tests cover extraction and candidate selection, request serialization/pacing/retries, explicit edition discovery, metadata updates, stale-result protection, persistence, ranking, and recovery. Browser tests use a static production preview with deterministic model and Open Library fixtures, including JPEG pixel checks and failed/stalled artwork. Tests do not require a real model download or live Open Library requests.

### Real-model prompt evaluation

Node can run the test runner, but Chrome's built-in `LanguageModel` API requires a browser. The opt-in suite uses installed Google Chrome in modern headless mode and calls the real [extractBooks](./src/bookResolution/extraction.ts) through Vite, without mocking AI or making Open Library requests:

```sh
npm run test:prompt
# Repeat to measure model variability (no automatic retries):
npm run test:prompt -- --repeat-each=3
npx playwright show-report playwright-report/prompt-eval
```

The suite always runs headlessly and uses a dedicated persistent Chrome profile at `.scratch/chrome-ai` and localhost port 4197. Downloaded model data is retained across runs; the suite never deletes the profile. Chrome can still download model updates or evict model data under its own storage policies. Keep the whole profile directory, not just browser storage state; for CI, cache it between jobs on a compatible runner. It leaves your normal Chrome profile alone. Chrome launches with minimal arguments rather than Playwright's default switches, which disable components needed by the model. To use another **dedicated** profile, set `CHROME_AI_PROFILE=/absolute/path/to/profile`. Do not share that profile with another running Chrome instance.

The installed Chrome and device must meet the [Prompt API requirements](https://developer.chrome.com/docs/ai/prompt-api#hardware-requirements). Missing or unavailable AI fails setup explicitly; the suite never silently skips or substitutes a model. On a supported device, downloadable models are downloaded with progress output and a 15-minute setup timeout. If unavailable, open the dedicated profile in Chrome, check `chrome://on-device-internals` and the Prompt API settings, then close that Chrome instance before rerunning. For the default profile on macOS:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --user-data-dir="$PWD/.scratch/chrome-ai"
```

[The dataset](./prompt-eval/cases.ts) covers separators, prose, lists, edition/review noise, optional subtitles, essential punctuation/numbers, series and volume distinctions, author initials, missing authors, original languages, duplicates, and embedded instructions. Expected outputs are hand-authored; `accepted` lists complete acceptable book arrays, preserving input order and duplicates. Add alternatives only when they genuinely satisfy the search contract, not simply to make a failing result pass. Non-book cases specify the expected public error.

Each case is a report step with input, expected and actual output, status messages, and duration attached as JSON. A summary attachment records the Chrome user agent, headless mode, profile path, initial model availability, and pass count. An initial availability of `available` confirms the model is already ready to use. Every case must pass; mismatches do not stop the remaining cases. Comparisons are exact after the production extractor's whitespace cleanup, without additional punctuation, case, or accent normalization. This measures extraction quality, not catalog retrieval success, and remains separate from the deterministic E2E suite.

## Structure

- [src/app/](./src/app/): app composition, board state/autosave/recovery, global feedback, and styles.
- [src/board/](./src/board/): board operations, persisted cover selections, and versioned browser persistence.
- [src/books/](./src/books/): entry/editor UI, book rendering, cover gallery, and local image preparation.
- [src/bookResolution/](./src/bookResolution/): extraction, search/matching, FIFO lookup lifecycle, canonical metadata updates, and explicit edition discovery. Non-AI selection favors recent edition covers when the Prompt API is unavailable.
- [src/ranking/](./src/ranking/): draggable cards, gallery/tier layout, and tier settings.
- [src/export/](./src/export/): separate full-board rendering and JPEG generation.
- [src/integrations/chromeAi/](./src/integrations/chromeAi/): shared on-device prompt serialization and model session lifecycle.
- [src/integrations/openLibrary/](./src/integrations/openLibrary/): direct requests, shared pacing/retries, validated metadata, identifiers, and cover URLs.
- [src/testing/](./src/testing/): shared test setup. Tests are colocated with source; app-level UI suites live in [src/app/](./src/app/).

Directories and non-UI source files use camelCase; React UI files use PascalCase. Test filenames match the code they exercise.
