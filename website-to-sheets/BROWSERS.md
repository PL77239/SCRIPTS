# Browser support

| Browser | Works with this folder? | Notes |
| --- | --- | --- |
| **Google Chrome** | Yes | Chrome Extension OAuth client in `manifest.json` |
| **Microsoft Edge** | Yes | Same as Chrome |
| **Opera** | Yes, with Web OAuth | `getAuthToken` is **unsupported** — use Web application client |
| **Opera GX** | Yes, with Web OAuth | Same as Opera |
| **Safari** | Extra steps | Xcode converter + Web OAuth client |

## Chrome / Edge

1. `chrome://extensions` or `edge://extensions`
2. Developer mode → **Load unpacked** → select `website-to-sheets`
3. Create a Google Cloud OAuth client of type **Chrome Extension** (use the extension ID from Options)
4. Put that Client ID in `manifest.json` → `oauth2.client_id`
5. Reload the extension → Save to sheet (Google sign-in prompt)

## Opera / Opera GX (important)

Opera shows **“function unsupported”** if the extension tries Chrome’s `identity.getAuthToken`. That API is stubbed in Opera.

### Fix

1. Open `opera://extensions` → Developer mode → **Load unpacked** → `website-to-sheets`
2. Open the extension **Options** page (copy the redirect URI shown there)
3. In [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials):
   - Create OAuth client → type **Web application** (not Chrome Extension)
   - Authorized redirect URIs → paste the Options redirect URI  
     (looks like `https://<extension-id>.chromiumapp.org/`)
4. Copy the Web Client ID → paste it in Options → **Save Web client ID**
5. Click **Sign in with Google** on the Options page
6. Then use **Save to sheet** in the popup

You can keep a Chrome Extension client in `manifest.json` for Chrome/Edge; Opera needs the **Web application** client in Options.

The spreadsheet must be editable by the Google account you sign in with. Making the sheet “public” does not replace sign-in.

## Safari (macOS)

Safari does **not** load Chrome extensions directly. Convert on a Mac with Xcode:

```bash
xcrun safari-web-extension-converter /path/to/website-to-sheets \
  --project-location ~/SafariWebExtensions \
  --app-name "Website to Sheets" \
  --bundle-identifier com.yourname.websitetosheets
```

Use the same **Web application** OAuth flow as Opera (`launchWebAuthFlow` + redirect URI from Options).

## Auth methods by browser

| Browser | Method |
| --- | --- |
| Chrome / Edge | `chrome.identity.getAuthToken` + Chrome Extension client |
| Opera / Opera GX / Safari | `launchWebAuthFlow` + Web application client (Options page) |
