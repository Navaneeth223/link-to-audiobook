# Private Story Reader

A local first audiobook style reader for documents you already have permission to access. Upload a TXT, Markdown, PDF, DOCX, or EPUB file, read it in a comfortable chapter view, and listen with the speech voices available in your browser or operating system.

## What works in this build

- Local file selection and in browser text extraction for TXT, Markdown, PDF, DOCX, and EPUB. PDF text extraction preserves page order; scanned PDFs need OCR, which is not included.
- Metadata only chapter detection and paragraph navigation. Extracted wording is not rewritten.
- Browser SpeechSynthesis playback in sentence chunks, automatic chapter advance, sentence highlighting, pause/resume, speed choices, and follow narration.
- Touch friendly drag and drop uploads, distinct previous/next sentence and paragraph controls, and a draggable paragraph progress slider.
- Local story search, persistent device-only bookmarks, reading themes, text sizing, keyboard shortcuts, and clear story.
- Bookmarks use content-derived locators (not story text), support rename/delete and JSON export/import for the matching document.
- App volume and mute preferences persist on this device. Sentence stepping stays in the player row; paragraph and chapter jumps are grouped under **More skip options**.
- In-app policies and a device-data viewer support per-item removal and a **Clear everything** action with a report for local data and Microsoft session logout.
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

Open the local URL printed by Vite. For Microsoft Graph, copy `.env.example` to `.env`, fill the API secrets, and register the matching redirect URI in Microsoft Entra. Configure delegated `User.Read` and `Files.Read` permissions with consent as required by your organization. Keep the client secret out of browser code. `npm run build` creates the production frontend in `dist/`; `npm run preview` serves that build locally.

## Commands

```sh
npm run check   # strict TypeScript project check
npm test        # unit tests
npm run build   # type check and production build
```

## Privacy and security

Local uploads are processed in the browser. Speech uses the device's selected browser voice. The app does not upload local story text or audio. Position and bookmark locators plus volume preferences are stored in localStorage; **Forget this story** removes that story's position and bookmarks. **Clear everything** removes app-owned localStorage entries, app-prefixed Cache Storage/IndexedDB entries (none are currently used), and requests Microsoft session logout. The browser may retain a file the user explicitly selects according to its own behavior. For shared links, the URL and Microsoft token are held in server session memory while Graph retrieves the selected document; the file bytes pass through memory and are not written to disk. The API uses an in-memory session store for development; replace it with a protected server side store before multi-process production deployment, serve over HTTPS, set `NODE_ENV=production`, and use a strong `SESSION_SECRET`. The app is not a hosted or security-audited service.

## Current limitations

- Microsoft Graph only reads documents the signed-in account can access; tenant policies and sharing restrictions still apply. No external neural TTS provider, OCR, audio chunk cache, permanent library, or deployment recipe for a particular host is included.
- Browser speech voice availability and voice quality vary by OS/browser. Browser speech does not expose precise word timing; sentence highlights follow the active speech chunk.
- Search stays in memory and in the browser. Browser speech does not expose precise word timing; playback volume changes restart the active sentence after a short debounce.
- The reader currently renders one chapter at a time. Very large chapters are not virtualized.
- Theme follows the selected reading theme; a separate system dark mode preference is not implemented.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for module boundaries and the safe extension path for provider integrations.

Policies are available in the app and as source documents: [Privacy](./docs/PRIVACY.md), [Terms](./docs/TERMS.md), [Copyright and takedown](./docs/COPYRIGHT-AND-TAKEDOWN.md), [Local storage](./docs/LOCAL-STORAGE.md), [Voice data](./docs/VOICE-DATA.md), and [Donations](./docs/DONATIONS.md). These are good-faith templates and need legal review before a public hosted launch.

## Optional project support

Support links are optional, externally processed, and configured with `VITE_DONATION_LINKS`. The value is a JSON array using only supported providers and approved HTTPS hosts. For example, after the maintainer has created and verified an account:

```dotenv
VITE_DONATION_LINKS=[{"provider":"ko-fi","label":"Buy me a coffee","url":"https://ko-fi.com/YOUR_ACCOUNT"}]
```

Supported providers are `github-sponsors`, `ko-fi`, `buy-me-a-coffee`, `open-collective`, `paypal`, and optional `upi`. Add only links that belong to the project maintainer. The UI renders only validated, configured links, opens them in a separate tab, and never handles payment details. Gifts are voluntary and do not unlock features. Provider availability, payout eligibility, processing fees, and tax treatment depend on the maintainer's country and circumstances; verify those details directly with the provider before publishing a link. No real account or payment destination is configured in this repository.

## License and launch readiness

This repository does not yet contain a selected open-source license. The maintainer must choose one before accepting contributions or publishing a release; until then, do not assume the source is licensed for reuse. Privacy and legal materials are good-faith project documentation, not legal advice, and require review for the jurisdictions in which the hosted service will operate.
