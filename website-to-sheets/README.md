# Website → Sheets

Chrome / Edge extension that saves company details from any website into a **Google Spreadsheet**, with a **spreadsheet switcher** (same idea as switching repositories in Cursor).

## What it saves

| Column | Source |
| --- | --- |
| Company name | Auto-detected from the page (editable) |
| Website address | Current site origin (editable) |
| E-mail address | `mailto:` links + page text (editable; suggestions in a list) |
| Products / services | Meta description / headline (editable) |
| Saved at | Timestamp (added automatically) |

## Spreadsheet switcher

In the extension popup, the top control lists every spreadsheet you’ve linked. Click one to make it **active** — the next Save goes there until you switch again.

You can:

- Add a sheet by pasting its Google Sheets URL or ID  
- Browse recent spreadsheets from Google Drive  
- Remove a sheet from the list (does not delete the Google file)

## Install (unpacked)

1. Clone this repo (or download the `website-to-sheets` folder).
2. Complete **Google Cloud OAuth setup** (see [Setup](#google-cloud-setup) below) and put your Client ID in `manifest.json`.
3. Open `chrome://extensions` (or `edge://extensions`).
4. Enable **Developer mode**.
5. **Load unpacked** → select the `website-to-sheets` directory.
6. Pin the extension, open its **Options** page if you need the extension ID for the OAuth client.

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

## Daily use

1. Open a company website.
2. Click the extension icon.
3. Confirm / edit the four fields (re-scan page if needed).
4. Pick the active spreadsheet in the switcher if it isn’t already right.
5. **Save to sheet**.

First save triggers Google sign-in if you aren’t connected yet.

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
  lib/sheets.js          # Google Sheets + Drive helpers
  content/extract.js     # page scraping
  popup/                 # switcher + save form
  options/               # setup guide + sign-in
  icons/
```

## Notes

- The extension creates the header row on first write if the sheet is empty / missing those headers.
- Default tab name is `Sheet1`; you can set another tab name when adding a spreadsheet.
- Chrome extension OAuth requires the Client ID to match this extension’s ID after you load it unpacked.
