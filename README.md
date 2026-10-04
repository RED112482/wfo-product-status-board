# WFO Mobile Product Status Board

GitHub Pages frontend for the WFO Mobile operational product status board.

## Architecture
- GitHub Pages hosts the permanent dashboard URL.
- Google Apps Script remains the live backend/API for NWS/NOAA data.
- The page refreshes live data automatically.

## Setup
1. Deploy the supplied Product Status Board Google Apps Script as a Web App:
   - Execute as: **Me**
   - Who has access: **Anyone**
2. Copy the deployment URL ending in `/exec`.
3. Put that URL in `docs/config.js`.
4. In GitHub: **Settings → Pages → Deploy from a branch → main → /docs**.

Expected public URL:
`https://RED112482.github.io/wfo-product-status-board/`

Do not place credentials, passwords, API keys, or private tokens in this repository.
