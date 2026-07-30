# Browser support

| Browser | Works with this folder? | Notes |
| --- | --- | --- |
| **Google Chrome** | Yes | Primary target |
| **Microsoft Edge** | Yes | Chromium — load unpacked the same way |
| **Opera** | Yes | Chromium — see below |
| **Opera GX** | Yes | Same as Opera |
| **Safari** | Partial / extra steps | Needs Apple’s converter + different Google sign-in |

## Chrome / Edge

1. `chrome://extensions` or `edge://extensions`
2. Developer mode → **Load unpacked** → select `website-to-sheets`

## Opera / Opera GX

Opera and Opera GX are Chromium-based and can run this extension.

1. Open `opera://extensions` (Opera GX: same URL).
2. Enable **Developer mode**.
3. **Load unpacked** → select the `website-to-sheets` folder.
4. Use the same Google Cloud **Chrome Extension** OAuth client ID in `manifest.json`.

If Opera asks to allow extensions from other stores / unpacked sources, allow it for local development.

Optional: install [Install Chrome Extensions](https://chrome.google.com/webstore) helper from Opera add-ons if you later publish to the Chrome Web Store and want one-click install.

## Safari (macOS)

Safari does **not** load Chrome extensions directly. You convert this project on a Mac with Xcode:

### 1. Convert

```bash
xcrun safari-web-extension-converter /path/to/website-to-sheets \
  --project-location ~/SafariWebExtensions \
  --app-name "Website to Sheets" \
  --bundle-identifier com.yourname.websitetosheets
```

Open the generated Xcode project, enable the Safari extension capability, and run it (Developer mode in Safari → Develop → Allow Unsigned Extensions for local testing).

### 2. Google sign-in on Safari

`chrome.identity.getAuthToken` (used by Chrome/Edge/Opera) is **not** available the same way in Safari.

For Safari you typically:

1. Create a second OAuth client in Google Cloud of type **Web application**.
2. Add the redirect URI that Safari’s `browser.identity.getRedirectURL()` returns (shown after conversion / in the extension).
3. Use `browser.identity.launchWebAuthFlow` instead of `getAuthToken`.

This repo’s auth helper tries `getAuthToken` first, then falls back to `launchWebAuthFlow` when configured — see `lib/sheets.js` and optional `oauth.webClientId` in extension storage / Options.

### 3. Distribution

Shipping on the Mac App Store / Safari Extensions Gallery requires an Apple Developer account and notarization. Local “Allow Unsigned Extensions” is enough for personal use.

## What “works” means for Google Sheets

All of these browsers can show the popup and scrape the page. **Writing to Google Sheets** always needs a working OAuth client for that browser:

- Chrome / Edge / Opera / Opera GX → one **Chrome Extension** OAuth client (extension ID may differ per browser — create one client per extension ID, or use the ID shown on the Options page in that browser).
- Safari → **Web application** OAuth client + `launchWebAuthFlow` fallback.
