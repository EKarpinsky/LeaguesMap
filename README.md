# LeaguesMap

LeaguesMap is an interactive map for Old School RuneScape's Demonic Pacts league, built with React, TypeScript, Vite, and Leaflet. It places 1,177 mappable tasks on a tiled world map, with filters for region, difficulty, skill, and pact. You can mark tasks complete or import progress from RuneLite; filters and progress stay in your browser's local storage.

![Varlamore task pins with the region filter sidebar open](docs/screenshot.png)

Filter to Varlamore, open a task pin, and mark a task complete:

![Region filtering, pin selection, and task completion in LeaguesMap](docs/demo.gif)

[1440px desktop](docs/desktop-1440.png) · [390px mobile map](docs/mobile-390.png) · [390px mobile filters](docs/mobile-filters-390.png)

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

`npm run preview` serves the static build. `npm run dev` also serves `/api/report-bug` through the Vite development bridge. Without an email key, `POST /api/report-bug` returns HTTP 500 with `{"error":"Email backend not configured"}`. For local email testing, export `RESEND_API_KEY` in the shell before starting Vite. Sending a report with a valid key sends a real email.

## Regenerate the demo

Install FFmpeg (including `ffprobe`) and the Playwright Chromium browser, then build and serve the app:

```sh
npm ci
npx playwright install chromium
npm run build
npm run preview -- --host 127.0.0.1 --port 4173 --strictPort
```

In a second terminal, from the repository root:

```sh
npm run capture:demo
# Optional: copy the outputs into the company repo.
npm run capture:demo -- --artifacts-dir ../../artifacts/LeaguesMap
```

`scripts/capture-demo.ts` calls `scripts/capture/leaguesmap.ts`. It uses fresh browser contexts and real UI clicks against the checked-in task data. It writes the five media files above plus `docs/capture-report.json`, which records file sizes, pin counts, the completed task, and GIF duration. The script checks that clearing regions removes pins, selecting Varlamore restores a smaller set, and completion and the region choice survive reload. It rejects browser errors, failed HTTP responses, horizontal overflow at 390px, PNGs of 1 MB or more, and GIFs of 5 MB or 15 seconds or more. PNGs use a 256-color palette; the GIF uses 128 colors at 10 fps and 1120px wide. Temporary recording frames are removed after each run.

## Why the calibration is piecewise

The wiki world map is a stitched image, with the western continent separated from the mainland by a wider ocean gap than a uniform coordinate scale predicts. A single affine fit put western pins roughly 50 to 80 game tiles away from their landmarks. The calibration uses separate segment origins and was refined against hand-measured landmarks, reducing the worst western horizontal error from 189 to 61 pixels. `src/lib/calibration.ts` documents the fit, and `scripts/verify-calibration.ts` records the reference landmarks and checks coordinate round trips.

## Import progress from RuneLite

In RuneLite's Tasks Tracker plugin, export your Demonic Pacts progress to JSON. Open **Sync from RuneLite** in LeaguesMap and paste the export or select the file. The browser decodes the export's 62 player-variable bitfields into task IDs and applies the completed tasks locally. It does not send the export to a backend or call the WikiSync API.

## Hosting

LeaguesMap stays on its existing hosting project, connected through the GitHub integration. Branch pushes create preview deployments automatically; merging to `main` updates production. No manual deployment is needed.

- Project root: repository root.
- Build command: `npm run build` after dependency installation (`npm ci`).
- Build output directory: `dist`.
- Node version: Node 22 LTS.
- `api/report-bug.ts` handles `/api/report-bug` as an Edge Function.

| Variable | Where | Purpose |
| --- | --- | --- |
| `RESEND_API_KEY` | Project environment variables | Enables bug-report email. Without it, the endpoint returns HTTP 500. Never prefix this secret with `VITE_`. |
| `RESEND_FROM` | Project environment variables | Optional verified sender. Default: `LeaguesMap <onboarding@resend.dev>`. |
| `REPORT_BUG_TO` | Project environment variables | Optional recipient. Default: `eli@karpinsky.io`. |

Configure email variables for the intended Preview or Production environment in the existing project. The host's Web Analytics component and typed custom-event wrapper are gated to `leagues-map.karpinsky.io`, so local and preview visits do not count toward production analytics.

The hosting configuration at the repository root retains the current security and cache rules. The map tiles are checked in, so ordinary builds do not require Python or regeneration of the tile pyramid.

This is an unofficial fan tool, not affiliated with Jagex. Old School RuneScape and its assets belong to Jagex; the map imagery and task data come from the OSRS Wiki.
