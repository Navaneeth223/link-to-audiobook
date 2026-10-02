# Implementation status

Audit date: 2026-10-02. Status is based on the tracked source and current package scripts. `DONE` means implemented in this repository, not independently audited in production.

## Project facts and workflow

| Requirement                                                 | Status  | Evidence                                                                                                   |
| ----------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------- |
| AGPL-3.0-or-later license, badge, and license section       | DONE    | `LICENSE`, `README.md`, `CONTRIBUTING.md`.                                                                 |
| Contact email on required legal/security policies           | DONE    | `SECURITY.md`, `docs/PRIVACY.md`, `docs/TERMS.md`, `docs/COPYRIGHT-AND-TAKEDOWN.md`, `docs/VOICE-DATA.md`. |
| Describe voluntary donations accurately                     | PARTIAL | `README.md`, `docs/DONATIONS.md`, `src/core/donationLinks.ts`; no real destination is configured.          |
| No paid service or mandatory API key                        | PARTIAL | `README.md`; optional Microsoft OAuth is required for current shared-link path.                            |
| Domain values configured through env and documented         | MISSING | No `docs/DEPLOYMENT.md`.                                                                                   |
| Baseline commit on a new branch and commit after each phase | MISSING | Current Git history has feature commits; this environment exposes `.git` as read-only.                     |

## Audiobook export — current feature branch

| Requirement                                                                                                   | Status          | Evidence / limit                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser-only Piper PCM synthesis in a dedicated worker                                                        | PARTIAL         | `src/core/piper.ts`, `src/core/piper.worker.ts`; speech-only sanitization and voice-config phoneme-ID filtering guard ONNX inference; live model download/inference smoke test passes on Chromium.                                |
| MP3 chapter ZIP, chapter-marked MP3, and streaming WAV                                                        | PARTIAL         | `src/core/audioExport.ts`, `src/core/audiobookExport.worker.ts`; format primitives, mocked ZIP download, and live Piper MP3 decode smoke test pass; real chapter tagging and WAV output parsing remain outstanding.           |
| Progress, pause/resume, cancellation, retry, storage cleanup, and interrupted-job restore                     | PARTIAL         | `src/ui/AudiobookExportDialog.tsx`, `src/core/audioExportStore.ts`, `src/core/audioSynthesis.ts`; bounded sentence recovery inserts silence and tracks skipped locations; storage-full behavior remains unverified.             |
| Personal-use confirmation, browser-voice explanation, privacy viewer and model deletion                       | DONE            | `src/ui/AudiobookExportDialog.tsx`, `src/ui/App.tsx`, `src/core/privacyData.ts`; deletion status is surfaced, while the browser may refuse local storage removal.                                                         |
| Cross-browser export verification, M4B/AAC, covers, Voice Studio, cloud TTS, and pitch/pronunciation controls | NOT IMPLEMENTED | Chromium mock-only export path is tested; Firefox/WebKit model inference, M4B/AAC, cover art, Voice Studio, cloud TTS, pitch, and pronunciation dictionaries are not shipped.                                             |
| Actual generation-speed measurement on this development machine                                               | PARTIAL         | `tests/e2e/real-piper.spec.ts` reports end-to-end speed including model preparation; the isolated 5-sentence benchmark and warmed-inference RTF requested in Step 2 are not yet measured.                                   |

### Latest validation

| Command              | Result                                                                                                           |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `npm run check`      | Passed: TypeScript typecheck, ESLint (10 legacy warnings, 0 errors), and 55 unit tests across 14 files.          |
| `npm run build`      | Passed. Vite warned that Piper-package imports of `fs`, `path`, and `crypto` are externalized for browser builds. |
| `npm run test:e2e`   | Passed: 22 tests; 26 skipped by viewport-only/live-test opt-ins. Six Chromium viewport profiles ran.              |
| `npm run test:visual`| Passed: 7 tests; 5 intentionally skipped because four-theme dialog captures run at desktop size only.             |

Dialog screenshots were attached for Light, Sepia, Dark, and High Contrast, and each passed axe checks. These are screenshot captures, not image-diff baselines. The headed real-Piper smoke test passed after a 94.76-second cold end-to-end run, produced a 3.81-second MP3, and decoded it in Chromium; it is opt-in because it downloads the model. Mocked worker tests cover pause/resume/cancel and reload recovery. Cross-browser export and real storage-full behavior remain unverified.

## Phase 0 — Audit

| Requirement                                                                   | Status  | Evidence                                                                                                                                                             |
| ----------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| File-backed project status audit                                              | DONE    | This file.                                                                                                                                                           |
| Structured API errors                                                         | DONE    | `server/index.mjs`, `src/core/http.ts`, `server/security.test.ts`, `src/core/http.test.ts`.                                                                          |
| Reliable file drag and drop                                                   | DONE    | `src/core/uploads.ts`, `src/core/uploads.test.ts`.                                                                                                                   |
| Scrollable chapter navigation and title containment                           | PARTIAL | `src/ui/App.tsx`, `src/ui/styles.css`; tablet visual tests absent.                                                                                                   |
| Bookmark manager, locator-only persistence, JSON import/export, resume prompt | DONE    | `src/core/bookmarks.ts`, `src/ui/App.tsx`, `src/core/bookmarks.test.ts`.                                                                                             |
| Skip control hierarchy                                                        | PARTIAL | `src/ui/App.tsx`; sentence and paragraph/chapter controls exist, but time skip, tap-to-seek, and controls help are not verified.                                     |
| Configurable donation links                                                   | DONE    | `src/core/donationLinks.ts`, `src/core/donationLinks.test.ts`.                                                                                                       |
| Privacy/policy pages and device data controls                                 | PARTIAL | `docs/*.md`, `src/ui/LegalDialog.tsx`, `src/core/privacyData.ts`; all data stores and result verification need production review.                                    |
| 31 unit tests                                                                 | PARTIAL | `npm test` exists; count may have changed.                                                                                                                           |
| Lint, Playwright, tablet visual tests                                         | PARTIAL | Phase 2 now provides lint/e2e/visual commands and viewport coverage; Chromium smoke and axe tests exist, while visual baselines and full reader flows remain absent. |
| Neural TTS, Voice Studio, voice donation                                      | MISSING | No corresponding provider or UI modules.                                                                                                                             |
| Theme coverage, custom scrollbars and controls                                | PARTIAL | `src/ui/styles.css`; High Contrast/System themes and full component audit absent.                                                                                    |
| Browse Voices                                                                 | MISSING | No voice browser dialog in `src/ui`.                                                                                                                                 |
| Volume control                                                                | DONE    | `src/ui/VolumeControl.tsx`, `src/core/speech.ts`, `src/core/volumePreferences.ts` and tests.                                                                         |
| Tablet title overflow, tap-to-seek, word highlighting                         | PARTIAL | `src/ui/styles.css`, `src/ui/App.tsx`; no visual tests, word-level provider support absent.                                                                          |

## Phase 1 — API and deployment

| Requirement                                                    | Status  | Evidence                                                                                                                                                               |
| -------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Health response with version/provider flags                    | DONE    | `server/index.mjs` returns `{ok, version, providersConfigured.microsoftOAuth}`.                                                                                        |
| Startup env self-check without secrets                         | DONE    | `server/env.mjs` logs presence booleans only; `server/index.mjs` calls it at startup.                                                                                  |
| Clear API-down/sign-in/provider/access/document UI states      | PARTIAL | `src/core/http.ts`, `src/ui/App.tsx`; no status check action verified.                                                                                                 |
| Local Node and Vercel API entry points                         | PARTIAL | `server/index.mjs`, `api/[...path].mjs`, `vercel.json`; Express remains the shared implementation, not framework-agnostic handlers.                                    |
| Vercel payload/time limits and chunking                        | PARTIAL | `server/env.mjs` caps Vercel downloads to 4 MiB and `vercel.json` sets 10 seconds; no chunk/range protocol.                                                            |
| Typed fail-fast env loader and complete variable documentation | PARTIAL | `server/env.mjs`, `.env.example`, `docs/DEPLOYMENT.md`; runtime config has JSDoc typing, not compile-time schema validation.                                           |
| Anonymous OneDrive and 1drv.ms links                           | MISSING | `server/index.mjs` requires OAuth before Graph retrieval.                                                                                                              |
| Redirect-by-redirect SSRF/DNS-rebinding protection             | PARTIAL | `server/security.mjs`, `server/index.mjs`; download host is pinned, but short-link redirect resolution is not implemented.                                             |
| MIME/disposition/magic-byte document detection                 | PARTIAL | `server/security.mjs` checks MIME, suggested filename, HTML signatures and file magic; DOCX/EPUB ZIP contents are not inspected server-side.                           |
| OAuth PKCE/state/server-side token storage                     | PARTIAL | `server/index.mjs` uses state, PKCE and session memory; scopes include `User.Read`; storage is not production durable.                                                 |
| Required API/security regression tests                         | PARTIAL | `server/security.test.ts`; no route integration coverage for listed cases.                                                                                             |
| Click-by-click deployment documentation                        | PARTIAL | `docs/DEPLOYMENT.md` describes Vercel, Entra, API alternative, env values, redeploy and health check; screenshots and verified current portal labels are not supplied. |

## Phase 2 — Tooling and checks

| Requirement                                                       | Status  | Evidence                                                                                                                                                                                                                    |
| ----------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ESLint flat config, Prettier, lint/format/typecheck/check scripts | DONE    | `eslint.config.js`, `.prettierrc.json`, `package.json`; existing legacy warnings are listed below.                                                                                                                          |
| Playwright Chromium/WebKit/Firefox and viewport profiles          | PARTIAL | `playwright.config.ts`, `tests/e2e/`; Chromium viewport projects run by default and cross-browser projects are opt-in. Firefox installation hit local disk exhaustion.                                                      |
| Visual regression and geometry assertions                         | PARTIAL | `tests/e2e/visual.spec.ts` captures non-empty screenshots of the home page at six Chromium viewports and the dialog in four themes; image-diff baselines and geometry assertions are not configured.                         |
| axe checks                                                        | DONE    | `tests/e2e/smoke.spec.ts` scans the landing page; `tests/e2e/visual.spec.ts` scans the audiobook dialog in all four themes.                                                                                              |
| GitHub Actions PR workflow                                        | DONE    | `.github/workflows/ci.yml` runs checks, build and browser E2E.                                                                                                                                                              |
| Full document/playback/privacy E2E flows                          | PARTIAL | `tests/e2e/smoke.spec.ts`, `tests/e2e/audiobook-export.spec.ts` cover local multi-chapter TXT import, audiobook eligibility, mocked export controls/download, and OPFS cleanup; real speech and playback remain unverified. |

The lint gate currently reports legacy findings in `src/core/document.ts` (intentional control-character filtering) and `src/ui/App.tsx` / `src/ui/LegalDialog.tsx` (state update in the Microsoft callback effect, drag/drop-only targets with an equivalent file-picker control, and a backdrop click handler alongside the dialog's close button). They remain non-blocking warnings. React Hook dependency warnings in the existing reader effects are also pre-existing; new code must not add lint warnings.

## Phase 3 — UI/UX

| Requirement                                                                     | Status  | Evidence                                                                                              |
| ------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------- |
| Light/Sepia/Dark/High Contrast/System theme tokens on all surfaces              | PARTIAL | Light/Sepia/Dark/High Contrast are selectable; System theme and a full component audit remain absent. |
| Theme-aware custom scrollbars                                                   | PARTIAL | `src/ui/styles.css`; cross-browser/touch audit absent.                                                |
| Accessible custom select, slider, switch, popover, tooltip, dialog, tabs, toast | PARTIAL | `src/ui/VolumeControl.tsx`, `src/ui/LegalDialog.tsx`; broad custom component set is absent.           |
| Independent chapter/section scrolling and current-item visibility               | PARTIAL | `src/ui/App.tsx`, `src/ui/styles.css`; automated geometry coverage absent.                            |
| Searchable/recommended/favorite voice browser                                   | MISSING | No voice browser module.                                                                              |
| Persistent volume, mute and accessible slider                                   | DONE    | `src/core/volumePreferences.ts`, `src/core/speech.ts`, `src/ui/VolumeControl.tsx` and tests.          |
| Time skips, controls help, tap-to-seek and word boundary highlighting           | MISSING | `src/ui/App.tsx`, `src/core/speech.ts`; no such feature modules found.                                |

## Phase 4 — Neural TTS

| Requirement                                                               | Status  | Evidence                                                                                                                                                                                                         |
| ------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| In-browser neural provider, model download/cache/worker/progress/fallback | PARTIAL | `src/core/piper.ts`, `src/core/piper.worker.ts` implement a local Piper voice for export; runtime inference has not been executed here and is not wired into reader playback.                                    |
| Verify model/runtime code and weight licenses                             | PARTIAL | `THIRD_PARTY_LICENSES.md` records pinned runtime/model licenses and the eSpeak embedded-source provenance limitation; legal/provenance review remains necessary before redistributing a different runtime build. |

## Phase 5 — Voice Studio

| Requirement                                                         | Status  | Evidence                                 |
| ------------------------------------------------------------------- | ------- | ---------------------------------------- |
| Consent, guided recording, profile creation, preview and management | MISSING | No Voice Studio UI/provider.             |
| Safe `.psvoice` import/export                                       | MISSING | No archive import/export implementation. |
| Local-first storage and explicit sharing                            | MISSING | No voice data feature.                   |

## Phase 6 — Voice donation

| Requirement                                                                  | Status  | Evidence                                                |
| ---------------------------------------------------------------------------- | ------- | ------------------------------------------------------- |
| Separate consent, license, submission package and withdrawal/moderation flow | MISSING | No submission workflow or maintainer moderation guide.  |
| README describes implementation and maintainer setup                         | MISSING | `README.md` does not document a voice donation feature. |

## Phase 7 — Support, legal and license

| Requirement                                                             | Status  | Evidence                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Support action/page, validated configured links, no payment handling    | PARTIAL | `src/core/donationLinks.ts`, `src/ui/App.tsx`, `docs/DONATIONS.md`; separate page/complete host policy needs audit.                                                                                                      |
| GitHub funding file and README support instructions                     | PARTIAL | `.github/FUNDING.yml`, `README.md`; funding destinations remain empty/configurable.                                                                                                                                      |
| Privacy, terms, takedown, storage, voice and donations policies         | PARTIAL | `docs/PRIVACY.md`, `docs/TERMS.md`, `docs/COPYRIGHT-AND-TAKEDOWN.md`, `docs/LOCAL-STORAGE.md`, `docs/VOICE-DATA.md`, `docs/DONATIONS.md`; legal contact/review wording needs audit.                                      |
| Exact privacy-at-a-glance message and data deletion verification        | PARTIAL | `src/ui/App.tsx`, `src/core/privacyData.ts`; exact copy and storage-backend verification need audit.                                                                                                                     |
| LICENSE, third-party records, DCO, code of conduct, security, templates | DONE    | `LICENSE`, `THIRD_PARTY_LICENSES.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `.github/ISSUE_TEMPLATE/`, `.github/PULL_REQUEST_TEMPLATE.md`; maintainers still need to supply real funding destinations. |

## Phase 8 — Security regression

| Requirement                                                          | Status  | Evidence                                                                                                                      |
| -------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------- |
| SSRF, redirects, DNS rebinding, size/MIME/archive limits             | PARTIAL | `server/security.mjs`, `server/index.mjs`, `server/security.test.ts`; redirect/DNS rebinding and several parser cases absent. |
| Malformed documents, traversal, XSS, CSRF, OAuth, rate limiting, CSP | PARTIAL | `server/index.mjs`, `src/core/document.ts`, tests; full listed regression suite is absent.                                    |
| Voice import and donation URL validation tests                       | PARTIAL | `src/core/donationLinks.test.ts`; voice import absent.                                                                        |

## Environment check notes

- `git status --short` was clean at audit start; latest commit was `72cc3fd`.
- The workspace Git metadata is mounted read-only, so this run cannot create a branch or commits. Source files in the workspace are writable.
- Current API implementation is directly coupled to Express and local startup. A Vercel adapter is not present, so the reported Vercel error cannot yet be confirmed from production logs; missing deployed API support is a concrete deployment gap consistent with the symptom.
