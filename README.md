# WFO Mobile Product Status Board

A GitHub-only operational status board for WFO Mobile and backup offices LIX, TAE, and KEY.

## How it works
- GitHub Pages hosts the permanent dashboard.
- GitHub Actions queries official NOAA/NWS sources every 5 minutes.
- The workflow writes refreshed JSON into `docs/data/`.
- The browser reads those local JSON files, so there is **no Google Apps Script dependency**.

## GitHub Pages
In **Settings → Pages**, select:
- **Deploy from a branch**
- Branch: **main**
- Folder: **/docs**

Public URL:
`https://RED112482.github.io/wfo-product-status-board/`

## Live-data workflow
`.github/workflows/update-status.yml` runs:
- every 5 minutes,
- on relevant source-code pushes,
- manually through **Actions → Update live status data → Run workflow**.

The data builder reuses the status-board parsing logic in `scripts/status-core.js` with a GitHub/Node compatibility layer.

## Data sources
Official NOAA/NWS services are used for routine products, hazards, TAFs, radar, river observations/forecasts, river Flood Warnings, and NOAA Weather Radio status checks.

No credentials or private tokens are required.
