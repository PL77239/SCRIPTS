# Browser support

| Browser | Works with this folder? | Notes |
| --- | --- | --- |
| **Google Chrome** | Yes | Chrome Extension OAuth client in `manifest.json` |
| **Microsoft Edge** | Yes | Same as Chrome |
| **Opera** | Yes, with Web OAuth | Needs Web application **Client ID + secret** + Test user |
| **Opera GX** | Yes, with Web OAuth | Same as Opera |
| **Safari** | Extra steps | Xcode converter + Web OAuth |

## Fix: `access_denied` on Google login

This is almost never the spreadsheet. Google is blocking the OAuth consent.

1. Open [OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent)
2. If status is **Testing**, go to **Audience / Test users**
3. **Add the exact Gmail** you use to sign in → Save
4. Confirm the OAuth client is type **Web application** (for Opera)
5. Authorized redirect URIs must match the Options page **exactly**, including the trailing slash:
   `https://<extension-id>.chromiumapp.org/`
6. Reload the extension → Options → paste **Client ID** and **Client secret** → Sign in

Optional: set Publishing status to **In production** (sensitive scopes may show an “unverified app” warning; you can Advanced → Continue for personal use).

## Chrome / Edge

1. Load unpacked from `website-to-sheets`
2. Create OAuth client type **Chrome Extension** (item ID = extension ID from Options)
3. Put Client ID in `manifest.json` → `oauth2.client_id`
4. Reload → Save to sheet

## Opera / Opera GX

Opera returns **function unsupported** for `chrome.identity.getAuthToken`.

1. `opera://extensions` → Load unpacked → `website-to-sheets`
2. Open **Options** → copy the redirect URI
3. Google Cloud → Credentials → Create **Web application** client
4. Add that redirect URI under **Authorized redirect URIs**
5. Copy **Client ID** and **Client secret** into Options → Save
6. Add yourself as a **Test user** on the consent screen
7. Options → **Sign in with Google**
8. Use **Save to sheet** in the popup

Your Google account must be able to **edit** the target spreadsheet.

## Safari (macOS)

Convert with `xcrun safari-web-extension-converter`, then use the same Web application OAuth flow as Opera.

## Auth methods

| Browser | Method |
| --- | --- |
| Chrome / Edge | `getAuthToken` + Chrome Extension client |
| Opera / Opera GX / Safari | `launchWebAuthFlow` + auth code/PKCE + Web client ID/secret |
