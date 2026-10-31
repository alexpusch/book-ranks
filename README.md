> **Disclaimer:** This repository is mostly AI-generated.

# <img src="./public/app-icon.svg" alt="" width="32" height="32"> Book ranks

A browser-based book tier list app. Add books, choose covers from Open Library, drag them into customizable tiers, and export your rankings as a JPEG. Your board is saved locally in your browser.

[Try it live](https://alexpusch.github.io/book-ranks/).

## Run locally

Requires Node.js 22.12+ and npm.

```sh
npm install
npm run dev
```

Open the URL printed in the terminal (normally http://localhost:5173). No API keys, backend, or `.env` file are needed.

Manual entry and Bulk insert are always available. For Bulk insert, paste one book per line as `book title | author(s) name`, then click **+ Add books**. Authors can be omitted; blank lines are ignored. Fix any reported invalid lines before adding the batch.

AI-assisted entry is hidden by default. Add `?ai=true` to the URL (or `&ai=true` if it already has query parameters) to enable it. It requires desktop Chrome with the [Prompt API](https://developer.chrome.com/docs/ai/prompt-api) available. Manual entry and Bulk insert work without it.
