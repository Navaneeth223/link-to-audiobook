# Architecture

## Current modules

- `src/core/document.ts` handles local format adapters and normalizes supported files to `Story → Chapter → Paragraph`.
- `server/index.mjs` handles optional delegated Microsoft OAuth, Graph lookup, download size checks, and constrained download redirects. Vite proxies `/api` to it in development.
- `src/ui/App.tsx` owns the reader session and composes import, navigation, search, settings, bookmarks, playback, and privacy controls.
- `src/core/bookmarks.ts`, `src/core/privacyData.ts`, and `src/core/donationLinks.ts` keep bookmark locators, device cleanup, and donation URL validation independent from UI rendering.
- `src/ui/LegalDialog.tsx` renders the policy Markdown files in themed, in-app dialogs.
- `src/ui/styles.css` contains responsive design tokens, reader themes, layout, and reduced motion behavior.
- `src/core/reader.test.ts` covers normalization and chapter segmentation.

## Provider boundaries

Local parsers are selected by file extension inside `extractFile`. Microsoft uses the Graph `/shares` API on a fixed Graph host; the browser never receives client secrets or access tokens. OAuth state validation protects the callback, and delegated `Files.Read` is requested. A signed in user must already be allowed to read the selected document.

The link form and API validate HTTPS and an exact OneDrive/SharePoint domain suffix. The API passes the link only as an encoded identifier to the fixed Microsoft Graph host. It checks metadata and size before downloading, allows only Microsoft storage redirect domains, pins a resolved public IP for the download, and rejects restricted network ranges. Bytes are held in memory and are not written to disk. Tokens and a pending share URL live in the development session store until expiry or restart. Replace the in-memory session store before production deployment. Microsoft metadata responses are read as text and parsed safely so empty or non-JSON provider bodies become a readable structured API error instead of an uncaught JSON parsing exception. API errors use `{ ok: false, error: { code, message } }`.

## Speech and playback

The application uses browser `SpeechSynthesis` through the `SpeechProvider` volume interface and speaks one sentence at a time. The browser provider applies volume to each utterance. `GainNodeSpeechProvider` provides a short ramp for future audio providers; no neural or remote audio provider is currently implemented. Browser speech does not expose accurate word or time offsets. Any future server TTS provider must keep keys server side, bound chunks, define cache retention, and provide cache cleanup.

## Persistence and cleanup

Story text remains in React memory while the tab is open and is not written to localStorage. Position keys store chapter/paragraph indices. Bookmark keys use a content-derived FNV-1a 64-bit fingerprint and store chapter/paragraph identifiers, sentence index, estimate, label, and timestamp, not story text. Volume and mute preferences use their own key. The device-data viewer removes app-owned localStorage keys and app-prefixed Cache Storage/IndexedDB entries; the app currently has no cache or database. Clear everything also requests Microsoft session logout and reports whether the API confirmed it.
