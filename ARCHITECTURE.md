# Architecture

## Current modules

- `src/core/document.ts` handles local format adapters and normalizes supported files to `Story → Chapter → Paragraph`.
- `server/index.mjs` handles optional delegated Microsoft OAuth, Graph lookup, download size checks, and constrained download redirects. Vite proxies `/api` to it in development.
- `src/ui/App.tsx` owns the reader session and composes import, navigation, search, settings, bookmarks, playback, and privacy controls.
- `src/ui/styles.css` contains responsive design tokens, reader themes, layout, and reduced motion behavior.
- `src/core/reader.test.ts` covers normalization and chapter segmentation.

## Provider boundaries

Local parsers are selected by file extension inside `extractFile`. Microsoft uses the Graph `/shares` API on a fixed Graph host; the browser never receives client secrets or access tokens. OAuth state validation protects the callback, and delegated `Files.Read` is requested. A signed in user must already be allowed to read the selected document.

The link form and API validate HTTPS and an exact OneDrive/SharePoint domain suffix. The API passes the link only as an encoded identifier to the fixed Microsoft Graph host. It checks metadata and size before downloading, allows only Microsoft storage redirect domains, pins a resolved public IP for the download, and rejects restricted network ranges. Bytes are held in memory and are not written to disk. Tokens and a pending share URL live in the development session store until expiry or restart. Replace the in-memory session store before production deployment.

## Speech and playback

The application uses the browser `SpeechSynthesis` API behind the UI's playback controls. This requires no API key and sends text to the browser's configured speech subsystem. It is a local fallback, not a neural speech service abstraction or prebuffered audio queue. Browser speech does not expose accurate word or time offsets. A server TTS provider should be added behind a `SpeechProvider` interface, produce bounded chunks, keep keys server side, apply explicit short lived cache retention, and provide cache cleanup.

## Persistence and cleanup

Story text remains in React memory while the tab is open. Only the current chapter and paragraph indices are written to local storage, keyed by source filename and extracted text length. This is a lightweight resume hint, not a collision resistant document fingerprint. Clear story removes that key and resets in memory. Bookmarks and settings currently remain in page memory.
