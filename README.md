# Private Story Reader

A local first audiobook style reader for documents you already have permission to access. Upload a TXT, Markdown, PDF, DOCX, or EPUB file, read it in a comfortable chapter view, and listen with the speech voices available in your browser or operating system.

## What works in this build

- Local file selection and in browser text extraction for TXT, Markdown, PDF, DOCX, and EPUB. PDF text extraction preserves page order; scanned PDFs need OCR, which is not included.
- Metadata only chapter detection and paragraph navigation. Extracted wording is not rewritten.
- Browser SpeechSynthesis playback in sentence chunks, automatic chapter advance, sentence highlighting, pause/resume, speed choices, and follow narration.
- Local story search, session bookmarks, reading themes, text sizing, keyboard shortcuts, and clear story.
- Playback position is stored as chapter and paragraph indices in local storage. The story contents are not stored there.
- 40 MB upload limit.

## Microsoft links

OneDrive and SharePoint retrieval uses the optional server side delegated OAuth/Graph integration in `server/index.mjs`. It needs a registered Entra application and environment secrets. If those values are absent, link retrieval returns a setup message; local file reading still works.

## Run locally

Requirements: Node.js 20 or later and npm.

```sh
npm install
npm run api     # in one terminal; serves the private API on 127.0.0.1:8787
npm run dev     # in another terminal; Vite proxies /api to the local API
```

Open the local URL printed by Vite. For Microsoft Graph, copy `.env.example` values into the API process environment and register the matching redirect URI in Microsoft Entra. Configure delegated `User.Read` and `Files.Read` permissions with consent as required by your organization. Keep the client secret in the API environment. `npm run build` creates the production frontend in `dist/`; `npm run preview` serves that build locally.

## Commands

```sh
npm run check   # strict TypeScript project check
npm test        # unit tests
npm run build   # type check and production build
```

## Privacy and security

Local uploads are processed in the browser. Speech uses the device's selected browser voice. The app does not upload local story text or audio. Position metadata is stored in local storage; use **Forget this story** to remove it. The browser may retain a file the user explicitly selects according to its own behavior. For shared links, the URL and Microsoft token are held in server session memory while Graph retrieves the selected document; the file bytes pass through memory and are not written to disk. The API uses an in-memory session store for development; replace it with a protected server side store before multi-process production deployment, serve over HTTPS, set `NODE_ENV=production`, and use a strong `SESSION_SECRET`. The app is not a hosted or security-audited service.

## Current limitations

- Microsoft Graph only reads documents the signed-in account can access; tenant policies and sharing restrictions still apply. No external neural TTS provider, OCR, audio chunk cache, permanent library, or deployment recipe for a particular host is included.
- Browser speech voice availability and voice quality vary by OS/browser. Browser speech does not expose precise word timing; sentence highlights follow the active speech chunk.
- Bookmarks live only for the current page session. Search stays in memory and in the browser.
- The reader currently renders one chapter at a time. Very large chapters are not virtualized.
- Theme follows the selected reading theme; a separate system dark mode preference is not implemented.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for module boundaries and the safe extension path for provider integrations.
