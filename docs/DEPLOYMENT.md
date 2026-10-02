# Deployment

Private Story Reader is a free, independent, open-source project supported by voluntary donations. It has no paid service requirement. Domain purchase is a later manual step; use environment values for host-specific URLs.

## Vercel: frontend and API in one project

The repository includes `vercel.json` and `api/[...path].mjs`. Both the local Node server and Vercel route use the same Express API implementation in `server/index.mjs`.

1. In Vercel, choose **Add New → Project**, import the public GitHub repository, and select the repository root as the project root.
2. Keep the framework preset as **Vite**. The build command is `npm run build`; the output directory is `dist`; the install command is `npm install`.
3. Open **Settings → Environment Variables**. Set `SESSION_SECRET` to a randomly generated value of at least 32 characters. Set `APP_ORIGINS` to the exact deployed origin, such as `https://your-project.vercel.app`. Add each preview/custom origin explicitly as a comma-separated origin when needed.
4. Optional Microsoft sign-in: set `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID` (`common` supports personal and organizational accounts), and `MICROSOFT_REDIRECT_URI` to `https://your-project.vercel.app/api/auth/callback`. Never create a `VITE_` variable for a secret.
5. Set `VITE_API_BASE_URL` empty for the same-project API. `VITE_` values are compiled into browser code and are public. Optional `VITE_DONATION_LINKS` is a JSON array of verified voluntary support destinations.
6. Click **Deploy**. Whenever an environment value changes, redeploy so the build and function receive the updated settings.
7. Open `https://your-project.vercel.app/api/health`. A working API returns JSON with `ok`, `version`, `providersConfigured.microsoftOAuth`, and safe `configurationIssues` names; it never returns credentials. If Microsoft link reading is not configured, the page's **Check status** message lists the missing settings.
8. Paste a public or account-authorized OneDrive/SharePoint link. Current link retrieval uses delegated Microsoft Graph OAuth; anonymous public-link access is not implemented yet. When the link is account-protected, the user must sign in using the configured Microsoft app. Local file upload works without OAuth.

### Optional Microsoft Entra registration

1. In the Azure/Entra portal, create an **App registration** and choose **Accounts in any organizational directory and personal Microsoft accounts** if both are needed.
2. Add a **Web** redirect URI exactly matching `MICROSOFT_REDIRECT_URI`, including `/api/auth/callback`.
3. Under **API permissions**, add delegated Microsoft Graph `Files.Read` and `offline_access` (the sign-in flow also requests the standard OpenID scopes supplied by MSAL as needed). Grant admin consent only if the tenant requires it.
4. Create a client secret and copy its value directly into Vercel's server-only `MICROSOFT_CLIENT_SECRET`. Do not put it in Vite, source control, screenshots, or client-side settings.
5. Redeploy and check `/api/health`.

### Current Vercel limits

The current handler buffers a document before returning it. On Vercel it enforces a 4 MiB maximum to leave headroom under the 4.5 MB function response limit. Larger files receive a size error; chapter paging alone would not help because the current frontend needs the original file bytes for PDF/DOCX/EPUB extraction. The configured function duration is 10 seconds, so slow Microsoft downloads can time out. A streaming/range protocol that works across supported document formats is future work.

For larger documents or longer transfers, run the Node API as a separate free service on Render or Koyeb and set the frontend build variable `VITE_API_BASE_URL=https://your-api-host.example`. On that API, set `APP_ORIGINS` to the exact Vercel origin (plus any explicitly trusted preview origin), `SESSION_SECRET`, and the Microsoft values above. The API sends credentialed CORS responses only to configured origins; keep this allowlist narrow. The current Express session store is in memory and is not suitable for multi-instance production OAuth sessions; use a persistent protected session store for that deployment topology.

## Environment variables

| Variable | Used by | Purpose |
|---|---|---|
| `PORT` | API server | Listen port; defaults to `8787`. |
| `HOST` | API server | Bind address; local example is loopback. Production defaults to `0.0.0.0` if unset. |
| `NODE_ENV` | API server | `production` enables secure cookies, proxy trust, and the required session secret. |
| `APP_ORIGINS` | API server | Comma-separated exact frontend origins permitted by CORS; `APP_ORIGIN` remains a single-origin compatibility fallback. |
| `SESSION_SECRET` | API server | Server-only cookie signing secret; at least 32 characters in production. |
| `MICROSOFT_CLIENT_ID` | API server | Optional Entra application client ID. |
| `MICROSOFT_CLIENT_SECRET` | API server | Optional server-only Entra client secret. Never use a `VITE_` prefix. |
| `MICROSOFT_TENANT_ID` | API server | Optional tenant selector; defaults to `common`. |
| `MICROSOFT_REDIRECT_URI` | API server | Exact OAuth callback URL registered with Entra. |
| `VITE_API_BASE_URL` | Browser build | Optional API origin for a separate API service; empty uses same-origin `/api`. Public. |
| `VITE_DONATION_LINKS` | Browser build | Optional validated public JSON array of support links. Public. |

All example values are in `.env.example`. Never place secrets in a `VITE_` variable: Vite embeds these values in downloadable browser assets.

## Local development

1. Copy `.env.example` to `.env` and set a random local `SESSION_SECRET`.
2. Run `npm install`.
3. In one terminal, run `npm run api`; in another, run `npm run dev`.
4. Vite proxies `/api` to `http://127.0.0.1:8787`.
5. Run `npm run check`, `npm test`, and `npm run build` before publishing.

## Before public launch

- Configure GitHub Sponsors or other support links in `VITE_DONATION_LINKS` only after verifying the maintainer-owned account URLs. The app never handles card details and gifts do not unlock features.
- Add an owned domain later, configure it with the hosting provider, then update `APP_ORIGINS`, `MICROSOFT_REDIRECT_URI`, and any `VITE_API_BASE_URL` before redeploying.
- Have a qualified lawyer review the good-faith policy templates for applicable GDPR, India DPDP Act 2023, CCPA, and voice/biometric rules.
- Configure a protected production session store before enabling Microsoft OAuth on a multi-instance deployment.
