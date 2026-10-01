# Privacy policy

**Status:** Good-faith project template, not legal advice. The maintainer should have this reviewed for the places where the hosted application is offered, including applicable GDPR, India DPDP Act, CCPA, children's privacy, and voice-data requirements. Add a private contact method before public launch.

Your story is processed for reading and isn't publicly shared.

## What the reader processes

When you select a local file, parsing and reading happen in the browser. The extracted story stays in page memory for the active reading session. Browser speech receives the current sentence through the device's SpeechSynthesis implementation. The browser or operating system may use its own speech service; the reader cannot describe or control that service's processing.

When you provide a Microsoft sharing link, the configured reader API uses delegated Microsoft Graph access after sign-in. The API receives the link and access token in a server-side session, requests the document from Microsoft, and holds the downloaded bytes in memory while returning them to the browser. The API does not write document bytes to disk. Microsoft account permissions and tenant restrictions apply. The API's current session store is in memory and its session cookie expires after one hour; production operators must configure storage and retention appropriate to their deployment.

## Data stored in this browser

- Playback position: chapter and paragraph numbers in a localStorage key derived from the source filename and extracted text length.
- Bookmarks: labels, chapter/paragraph identifiers, sentence locator, estimated reading time, and a content-derived document fingerprint. The bookmark value does not include the story text.
- Volume and mute preference: the selected app volume and the last non-zero level in localStorage.
- The active story text remains in memory while the page is open. The app does not currently use IndexedDB, Cache Storage, audio caching, analytics, advertising trackers, or a login account for local files.

The current **Forget this story** action removes the current story's position and bookmark keys and clears the active story from the page. It does not remove volume preferences or Microsoft server sessions. **Clear everything** removes app-owned `psr-*` localStorage values, app-prefixed Cache Storage and IndexedDB entries, then requests Microsoft session logout. The current build does not use app caches or databases. The in-app report states whether local removal completed and whether the API confirmed session logout; if the API is unavailable, sign out through Microsoft and clear browser site data for this origin.

## Third parties and security limits

Microsoft receives requests for documents opened through its sharing service. Donation pages, when configured by the maintainer, are hosted by the selected provider and process transactions on that provider's site. This app does not collect payment card or bank details. No optional external TTS provider is currently included. A public deployment may have hosting-provider logs and operational access governed by that operator's policies; do not upload material you are not authorized to process.

## Your choices

You can use local files without signing in, remove the current story's local position and bookmarks with **Forget this story**, and clear browser site data using browser controls. Microsoft sign-in is required when the deployment's configured Graph flow requests it. Contact the maintainer through the repository for privacy questions or requests; the maintainer should publish a dedicated contact address before a public service launch.

## Children and updates

The current reader does not provide voice recording or voice cloning features. The maintainer should publish an age policy and update this notice before introducing voice profiles, model downloads, analytics, or other new processing. Policy changes should be dated and summarized here.
