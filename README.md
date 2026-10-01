# LeaguesMap

LeaguesMap is an interactive map for Old School RuneScape's Demonic Pacts league, built with React, TypeScript, Vite, and Leaflet. It places 1,177 mappable tasks on a tiled world map, with filters for region, difficulty, skill, and pact. You can mark tasks complete or import progress from RuneLite; filters and progress stay in your browser's local storage.

Screenshot placeholder: `docs/screenshot.png` (to be supplied by the Demo Engineer).

## Run locally

Use Node.js 22.22.3 or newer in the Node 22 LTS line, with npm 10 or newer.

```sh
git clone git@github.com:EKarpinsky/LeaguesMap.git
cd LeaguesMap
npm ci
npm run dev
```

Open the URL Vite prints, normally http://localhost:5173. The private repository requires GitHub access. No API key or external service is needed to browse the map or import progress. The `predev`, `pretest`, and `prebuild` scripts generate runtime task and location data automatically from the checked-in data.

```sh
npm run lint
npm test
npm run build
npm run preview
```

`npm run preview` serves the static build. To also run the bug-report endpoint in the Pages runtime:

```sh
npx wrangler pages dev dist
```

Open http://localhost:8788. Without an email key, `POST /api/report-bug` returns HTTP 503 with `{"error":"Email backend not configured"}`. For local email testing, set `RESEND_API_KEY` in `.env.local` for Vite or `.dev.vars` for Wrangler. Both files are ignored by Git. Sending a report with a valid key sends a real email.

## Why the calibration is piecewise

The wiki world map is a stitched image, with the western continent separated from the mainland by a wider ocean gap than a uniform coordinate scale predicts. A single affine fit put western pins roughly 50 to 80 game tiles away from their landmarks. The calibration uses separate segment origins and was refined against hand-measured landmarks, reducing the worst western horizontal error from 189 to 61 pixels. `src/lib/calibration.ts` documents the fit, and `scripts/verify-calibration.ts` records the reference landmarks and checks coordinate round trips.

## Import progress from RuneLite

In RuneLite's Tasks Tracker plugin, export your Demonic Pacts progress to JSON. Open **Sync from RuneLite** in LeaguesMap and paste the export or select the file. The browser decodes the export's 62 player-variable bitfields into task IDs and applies the completed tasks locally. It does not send the export to a backend or call the WikiSync API.

## Cloudflare Pages

The repository is prepared for Pages; configuring or publishing a deployment is a separate step.

- Project root: repository root.
- Build command: `npm run build` after dependency installation (`npm ci`).
- Build output directory: `dist`.
- Node version: `22.22.3` (`NODE_VERSION` in the Pages build environment).
- `functions/api/report-bug.ts` handles `/api/report-bug`; deploy from the repository root so Pages discovers it.

| Variable | Where | Purpose |
| --- | --- | --- |
| `VITE_CF_BEACON_TOKEN` | Build environment | Optional public Cloudflare Web Analytics token. When unset or blank, the app adds no beacon script. Rebuild after changing it. |
| `RESEND_API_KEY` | Pages Function secret | Enables bug-report email. Without it, the endpoint returns HTTP 503. Never prefix this secret with `VITE_`. |
| `RESEND_FROM` | Pages Function environment | Optional verified sender. Default: `LeaguesMap <onboarding@resend.dev>`. |
| `REPORT_BUG_TO` | Pages Function environment | Optional recipient. Default: `eli@karpinsky.io`. |

The analytics beacon records page analytics; custom event calls are intentionally no-ops. Leave the beacon token unset for local or preview builds when you do not want those visits counted, and use only one beacon installation method.

`public/_headers` retains security and cache rules, with the content security policy allowing the Cloudflare beacon. The Function sets its own security headers because Pages static header rules do not apply to Function responses. There were no custom rewrites to port; Pages supplies the static SPA fallback. The map tiles are checked in, so ordinary builds do not require Python or regeneration of the tile pyramid.

Cloudflare references: [Functions and environment bindings](https://developers.cloudflare.com/pages/functions/bindings/), [static response headers](https://developers.cloudflare.com/pages/configuration/headers/), and [analytics for SPAs](https://developers.cloudflare.com/web-analytics/get-started/web-analytics-spa/).

This is an unofficial fan tool, not affiliated with Jagex. Old School RuneScape and its assets belong to Jagex; the map imagery and task data come from the OSRS Wiki.
