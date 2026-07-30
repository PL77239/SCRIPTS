# Website → Sheets

Browser extension that saves company details from any website into a **Google Spreadsheet**, with a **spreadsheet switcher** (same idea as switching repositories in Cursor).

**Browsers:** Chrome, Edge, Opera, Opera GX out of the box. Safari needs a short conversion step — see [BROWSERS.md](./BROWSERS.md).

## What it saves

| Column | Source |
| --- | --- |
| Company name | Auto-detected from the page (editable) |
| Website address | Current site origin (editable) |
| E-mail address | Current page + related Contact/About pages (editable; suggestions in a list) |
| Products / services | Meta/headings on current page + Products/Services pages when linked (editable) |
| Saved at | Timestamp (added automatically) |

### How scanning works (important)

It does **not** crawl the entire website.

When you open the popup (or click **Re-scan site**), it:

1. Reads the **page you are on**
2. Finds same-site links / common paths such as Contact, About, Products, Services, Impressum, Kontakt…
3. Fetches up to **6** of those related pages on the **same domain**
4. Merges emails and product/service text it finds

So an email only on `/contact` is usually picked up even if you started on the homepage. An email buried on an unlinked blog post or a different subdomain will **not** be found unless you open that page (or it appears in nav).

## Spreadsheet switcher

In the extension popup, the top control lists every spreadsheet you’ve linked. Click one to make it **active** — the next Save goes there until you switch again.

You can:

- Add a sheet by pasting its Google Sheets URL or ID  
- Browse recent spreadsheets from Google Drive  
- Remove a sheet from the list (does not delete the Google file)

## Install (unpacked)

### Chrome / Edge / Opera / Opera GX

1. Clone this repo (or download the `website-to-sheets` folder).
2. Complete **Google Cloud OAuth setup** (below) and put your Client ID in `manifest.json`.
3. Open the extensions page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
   - Opera / Opera GX: `opera://extensions`
4. Enable **Developer mode** → **Load unpacked** → select `website-to-sheets`.
5. Open **Options** if you need the extension ID for the OAuth client.

### Safari

See [BROWSERS.md](./BROWSERS.md) (requires macOS + Xcode converter + a Web OAuth client).

## Google Cloud setup

1. Create a project in [Google Cloud Console](https://console.cloud.google.com/).
2. Enable **Google Sheets API** and **Google Drive API**.
3. Configure the **OAuth consent screen** (External is fine for personal use; add yourself as a test user).
4. Create credentials → **OAuth client ID** → application type **Chrome Extension**.
5. Paste the extension ID shown on the Options page into that client.
6. Copy the Client ID into `manifest.json`:

```json
"oauth2": {
  "client_id": "123456789-xxxx.apps.googleusercontent.com",
  "scopes": [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.readonly"
  ]
}
```

7. Reload the extension.

For Safari (or if `getAuthToken` fails), also create a **Web application** client and paste it on the Options page — redirect URI is shown there.

## Daily use

1. Open a company website.
2. Click the extension icon (it scans the page + related Contact/Products links).
3. Confirm / edit the four fields.
4. Pick the active spreadsheet in the switcher if needed.
5. **Save to sheet**.

## Permissions

- `activeTab` / `scripting` — read the current page to prefill fields  
- `storage` — remember your spreadsheet list + active selection  
- `identity` — Google OAuth  
- Sheets + Drive API hosts — write rows / list recent files  

## Folder layout

```
website-to-sheets/
  manifest.json
  background.js          # auth + Sheets API message hub
  lib/storage.js         # spreadsheet list / active sheet
  lib/sheets.js          # Google Sheets + Drive + OAuth helpers
  content/extract.js     # page + related-page scraping
  popup/                 # switcher + save form
  options/               # setup guide + sign-in
  BROWSERS.md            # Chrome / Edge / Opera / Safari notes
  icons/
```

## Notes

- The extension creates the header row on first write if the sheet is empty / missing those headers.
- Default tab name is `Sheet1`; you can set another tab name when adding a spreadsheet.
- Chrome-style OAuth requires the Client ID to match this extension’s ID after you load it unpacked (IDs can differ per browser).
