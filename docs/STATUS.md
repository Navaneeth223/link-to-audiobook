# Implementation status

Audit date: 2026-10-02. Status is based on the tracked source and current package scripts. `DONE` means implemented in this repository, not independently audited in production.

## Project facts and workflow

| Requirement | Status | Evidence |
|---|---|---|
| AGPL-3.0-or-later license, badge, and license section | DONE | `LICENSE`, `README.md`, `CONTRIBUTING.md`. |
| Contact email on required legal/security policies | DONE | `SECURITY.md`, `docs/PRIVACY.md`, `docs/TERMS.md`, `docs/COPYRIGHT-AND-TAKEDOWN.md`, `docs/VOICE-DATA.md`. |
| Describe voluntary donations accurately | PARTIAL | `README.md`, `docs/DONATIONS.md`, `src/core/donationLinks.ts`; no real destination is configured. |
| No paid service or mandatory API key | PARTIAL | `README.md`; optional Microsoft OAuth is required for current shared-link path. |
| Domain values configured through env and documented | MISSING | No `docs/DEPLOYMENT.md`. |
| Baseline commit on a new branch and commit after each phase | MISSING | Current Git history has feature commits; this environment exposes `.git` as read-only. |

## Phase 0 — Audit

| Requirement | Status | Evidence |
|---|---|---|
| File-backed project status audit | DONE | This file. |
| Structured API errors | DONE | `server/index.mjs`, `src/core/http.ts`, `server/security.test.ts`, `src/core/http.test.ts`. |
| Reliable file drag and drop | DONE | `src/core/uploads.ts`, `src/core/uploads.test.ts`. |
| Scrollable chapter navigation and title containment | PARTIAL | `src/ui/App.tsx`, `src/ui/styles.css`; tablet visual tests absent. |
| Bookmark manager, locator-only persistence, JSON import/export, resume prompt | DONE | `src/core/bookmarks.ts`, `src/ui/App.tsx`, `src/core/bookmarks.test.ts`. |
| Skip control hierarchy | PARTIAL | `src/ui/App.tsx`; sentence and paragraph/chapter controls exist, but time skip, tap-to-seek, and controls help are not verified. |
| Configurable donation links | DONE | `src/core/donationLinks.ts`, `src/core/donationLinks.test.ts`. |
| Privacy/policy pages and device data controls | PARTIAL | `docs/*.md`, `src/ui/LegalDialog.tsx`, `src/core/privacyData.ts`; all data stores and result verification need production review. |
| 31 unit tests | PARTIAL | `npm test` exists; count may have changed. |
| Lint, Playwright, tablet visual tests | MISSING | No lint/e2e/visual scripts or Playwright dependency in `package.json`. |
| Neural TTS, Voice Studio, voice donation | MISSING | No corresponding provider or UI modules. |
| Theme coverage, custom scrollbars and controls | PARTIAL | `src/ui/styles.css`; High Contrast/System themes and full component audit absent. |
| Browse Voices | MISSING | No voice browser dialog in `src/ui`. |
| Volume control | DONE | `src/ui/VolumeControl.tsx`, `src/core/speech.ts`, `src/core/volumePreferences.ts` and tests. |
| Tablet title overflow, tap-to-seek, word highlighting | PARTIAL | `src/ui/styles.css`, `src/ui/App.tsx`; no visual tests, word-level provider support absent. |

## Phase 1 — API and deployment

| Requirement | Status | Evidence |
|---|---|---|
| Health response with version/provider flags | DONE | `server/index.mjs` returns `{ok, version, providersConfigured.microsoftOAuth}`. |
| Startup env self-check without secrets | DONE | `server/env.mjs` logs presence booleans only; `server/index.mjs` calls it at startup. |
| Clear API-down/sign-in/provider/access/document UI states | PARTIAL | `src/core/http.ts`, `src/ui/App.tsx`; no status check action verified. |
| Local Node and Vercel API entry points | PARTIAL | `server/index.mjs`, `api/[...path].mjs`, `vercel.json`; Express remains the shared implementation, not framework-agnostic handlers. |
| Vercel payload/time limits and chunking | PARTIAL | `server/env.mjs` caps Vercel downloads to 4 MiB and `vercel.json` sets 10 seconds; no chunk/range protocol. |
| Typed fail-fast env loader and complete variable documentation | PARTIAL | `server/env.mjs`, `.env.example`, `docs/DEPLOYMENT.md`; runtime config has JSDoc typing, not compile-time schema validation. |
| Anonymous OneDrive and 1drv.ms links | MISSING | `server/index.mjs` requires OAuth before Graph retrieval. |
| Redirect-by-redirect SSRF/DNS-rebinding protection | PARTIAL | `server/security.mjs`, `server/index.mjs`; download host is pinned, but short-link redirect resolution is not implemented. |
| MIME/disposition/magic-byte document detection | PARTIAL | `server/security.mjs` checks MIME, suggested filename, HTML signatures and file magic; DOCX/EPUB ZIP contents are not inspected server-side. |
| OAuth PKCE/state/server-side token storage | PARTIAL | `server/index.mjs` uses state, PKCE and session memory; scopes include `User.Read`; storage is not production durable. |
| Required API/security regression tests | PARTIAL | `server/security.test.ts`; no route integration coverage for listed cases. |
| Click-by-click deployment documentation | PARTIAL | `docs/DEPLOYMENT.md` describes Vercel, Entra, API alternative, env values, redeploy and health check; screenshots and verified current portal labels are not supplied. |

## Phase 2 — Tooling and checks

| Requirement | Status | Evidence |
|---|---|---|
| ESLint flat config, Prettier, lint/format/typecheck/check scripts | MISSING | `package.json`; no lint config. |
| Playwright Chromium/WebKit/Firefox and viewport profiles | MISSING | `package.json`; no Playwright config/tests. |
| Visual regression and geometry assertions | MISSING | No visual/e2e tests. |
| axe checks | MISSING | No axe dependency or tests. |
| GitHub Actions PR workflow | MISSING | `.github/` has no workflow. |
| Full document/playback/privacy E2E flows | MISSING | No browser tests. |

## Phase 3 — UI/UX

| Requirement | Status | Evidence |
|---|---|---|
| Light/Sepia/Dark/High Contrast/System theme tokens on all surfaces | PARTIAL | `src/ui/styles.css`, `src/ui/App.tsx`; High Contrast/System not implemented. |
| Theme-aware custom scrollbars | PARTIAL | `src/ui/styles.css`; cross-browser/touch audit absent. |
| Accessible custom select, slider, switch, popover, tooltip, dialog, tabs, toast | PARTIAL | `src/ui/VolumeControl.tsx`, `src/ui/LegalDialog.tsx`; broad custom component set is absent. |
| Independent chapter/section scrolling and current-item visibility | PARTIAL | `src/ui/App.tsx`, `src/ui/styles.css`; automated geometry coverage absent. |
| Searchable/recommended/favorite voice browser | MISSING | No voice browser module. |
| Persistent volume, mute and accessible slider | DONE | `src/core/volumePreferences.ts`, `src/core/speech.ts`, `src/ui/VolumeControl.tsx` and tests. |
| Time skips, controls help, tap-to-seek and word boundary highlighting | MISSING | `src/ui/App.tsx`, `src/core/speech.ts`; no such feature modules found. |

## Phase 4 — Neural TTS

| Requirement | Status | Evidence |
|---|---|---|
| In-browser neural provider, model download/cache/worker/progress/fallback | MISSING | `src/core/speech.ts` implements browser speech only. |
| Verify model/runtime code and weight licenses | MISSING | No neural assets/dependencies; `THIRD_PARTY_LICENSES.md` has no model entry. |

## Phase 5 — Voice Studio

| Requirement | Status | Evidence |
|---|---|---|
| Consent, guided recording, profile creation, preview and management | MISSING | No Voice Studio UI/provider. |
| Safe `.psvoice` import/export | MISSING | No archive import/export implementation. |
| Local-first storage and explicit sharing | MISSING | No voice data feature. |

## Phase 6 — Voice donation

| Requirement | Status | Evidence |
|---|---|---|
| Separate consent, license, submission package and withdrawal/moderation flow | MISSING | No submission workflow or maintainer moderation guide. |
| README describes implementation and maintainer setup | MISSING | `README.md` does not document a voice donation feature. |

## Phase 7 — Support, legal and license

| Requirement | Status | Evidence |
|---|---|---|
| Support action/page, validated configured links, no payment handling | PARTIAL | `src/core/donationLinks.ts`, `src/ui/App.tsx`, `docs/DONATIONS.md`; separate page/complete host policy needs audit. |
| GitHub funding file and README support instructions | PARTIAL | `.github/FUNDING.yml`, `README.md`; funding destinations remain empty/configurable. |
| Privacy, terms, takedown, storage, voice and donations policies | PARTIAL | `docs/PRIVACY.md`, `docs/TERMS.md`, `docs/COPYRIGHT-AND-TAKEDOWN.md`, `docs/LOCAL-STORAGE.md`, `docs/VOICE-DATA.md`, `docs/DONATIONS.md`; legal contact/review wording needs audit. |
| Exact privacy-at-a-glance message and data deletion verification | PARTIAL | `src/ui/App.tsx`, `src/core/privacyData.ts`; exact copy and storage-backend verification need audit. |
| LICENSE, third-party records, DCO, code of conduct, security, templates | DONE | `LICENSE`, `THIRD_PARTY_LICENSES.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `.github/ISSUE_TEMPLATE/`, `.github/PULL_REQUEST_TEMPLATE.md`; maintainers still need to supply real funding destinations. |

## Phase 8 — Security regression

| Requirement | Status | Evidence |
|---|---|---|
| SSRF, redirects, DNS rebinding, size/MIME/archive limits | PARTIAL | `server/security.mjs`, `server/index.mjs`, `server/security.test.ts`; redirect/DNS rebinding and several parser cases absent. |
| Malformed documents, traversal, XSS, CSRF, OAuth, rate limiting, CSP | PARTIAL | `server/index.mjs`, `src/core/document.ts`, tests; full listed regression suite is absent. |
| Voice import and donation URL validation tests | PARTIAL | `src/core/donationLinks.test.ts`; voice import absent. |

## Environment check notes

- `git status --short` was clean at audit start; latest commit was `72cc3fd`.
- The workspace Git metadata is mounted read-only, so this run cannot create a branch or commits. Source files in the workspace are writable.
- Current API implementation is directly coupled to Express and local startup. A Vercel adapter is not present, so the reported Vercel error cannot yet be confirmed from production logs; missing deployed API support is a concrete deployment gap consistent with the symptom.
