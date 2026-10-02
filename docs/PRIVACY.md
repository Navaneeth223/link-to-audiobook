# Privacy policy

**Status:** Good-faith project template, not legal advice. A qualified lawyer should review this for applicable GDPR, India DPDP Act 2023, CCPA, children's privacy, and voice-data requirements before public launch. Contact: navaneethkv.dev@gmail.com.

Your story is processed for reading and isn't publicly shared.

## What the reader processes

When you select a local file, parsing and reading happen in the browser. The extracted story stays in page memory for the active reading session. Browser speech receives the current sentence through the device's SpeechSynthesis implementation. The browser or operating system may use its own speech service; the reader cannot describe or control that service's processing. Audiobook export is available only for the local Piper voice, which runs in a Web Worker and returns audio samples to the browser for encoding.

When you provide a Microsoft sharing link, the configured reader API uses delegated Microsoft Graph access after sign-in. The API receives the link and access token in a server-side session, requests the document from Microsoft, and holds the downloaded bytes in memory while returning them to the browser. The API does not write document bytes to disk. Microsoft account permissions and tenant restrictions apply. The API's current session store is in memory and its session cookie expires after one hour; production operators must configure storage and retention appropriate to their deployment.

## Data stored in this browser

- Playback position: chapter and paragraph numbers in a localStorage key derived from the source filename and extracted text length.
- Bookmarks: labels, chapter/paragraph identifiers, sentence locator, estimated reading time, and a content-derived document fingerprint. The bookmark value does not include the story text.
- Volume and mute preference: the selected app volume and the last non-zero level in localStorage.
- The active story text remains in memory while the page is open. The Piper voice model is downloaded from its documented public model host and stored in this origin's private file system (OPFS). Runtime WASM files are fetched from pinned public hosts with browser caching disabled and used in worker memory. While an export is in progress or resumable, encoded chapter files, temporary PCM chunks, and a manifest are stored in OPFS. They remain while the finished dialog is open so the user can download or preview the file without buffering the whole book in memory. Choosing **Done**, closing the finished dialog, or choosing **Delete generated audio** removes the export and its unshared cache. **Export another format** retains reusable chunks only while continuing the next export.
- No story text or generated audio is sent to the model/runtime hosts or reader API by audiobook export. The model and runtime are downloaded over the network from their pinned public hosts. The runtime is not persisted by the app. Local-file uploads do not send story text to the reader API.

The current **Forget this story** action removes the current story's position and bookmark keys and clears the active story from the page. It does not remove volume preferences or Microsoft server sessions. The device-data viewer lists localStorage preferences, resumable/generated export records, and a downloaded Piper model when present; it supports per-item deletion and **Clear cached audio**. **Clear everything** attempts to remove app-owned `psr-*` localStorage values, app-prefixed Cache Storage and IndexedDB entries, audiobook export/cache OPFS directories, the Piper model directory, and then requests Microsoft session logout. The in-app report states which browser-storage removals completed and whether the API confirmed session logout; it does not claim cleanup succeeded if a store reports failure. If the API is unavailable, sign out through Microsoft and clear browser site data for this origin.

## Third parties and security limits

Microsoft receives requests for documents opened through its sharing service. When the user chooses to download the Piper voice, the browser requests the pinned voice model and runtime files from their public hosts; those requests do not contain the user's story text. Donation pages, when configured by the maintainer, are hosted by the selected provider and process transactions on that provider's site. This app does not collect payment card or bank details. No cloud TTS provider is included. A public deployment may have hosting-provider logs and operational access governed by that operator's policies; do not upload material you are not authorized to process.

## Your choices

You can use local files without signing in, remove the current story's local position and bookmarks with **Forget this story**, remove an export or downloaded voice in the device-data viewer, and clear browser site data using browser controls. Microsoft sign-in is required when the deployment's configured Graph flow requests it. Contact navaneethkv.dev@gmail.com for privacy questions or requests.

## Children and updates

The reader does not provide voice recording or voice cloning features. The downloadable Piper model is a published LibriTTS voice and is not a user voice profile. Voice Studio export is not supported. Policy changes should be dated and summarized here.
