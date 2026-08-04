/**
 * Google Sheets API helpers.
 * Auth: chrome.identity.getAuthToken when the browser supports it (Chrome/Edge).
 * Opera/Safari and other Chromium forks often stub getAuthToken as
 * "function unsupported" — those use launchWebAuthFlow + a Web OAuth client.
 */

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const DRIVE_API = "https://www.googleapis.com/drive/v3/files";

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.readonly",
].join(" ");

const TOKEN_KEY = "oauthAccessToken";
const TOKEN_EXPIRES_KEY = "oauthAccessTokenExpires";
const WEB_CLIENT_ID_KEY = "oauthWebClientId";

const HEADER_ROW = [
  "Company name",
  "Website address",
  "E-mail address",
  "Products / services",
  "Saved at",
];

/** Cached probe: null = unknown, true/false = getAuthToken usable */
let getAuthTokenSupported = null;

function hasGetAuthTokenApi() {
  return typeof chrome.identity?.getAuthToken === "function";
}

function isUnsupportedIdentityError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  return (
    msg.includes("unsupported") ||
    msg.includes("not supported") ||
    msg.includes("is not available")
  );
}

function looksLikeOpera() {
  try {
    const ua = self.navigator?.userAgent || "";
    // Opera / Opera GX include "OPR/" ; avoid matching Chrome alone
    return /\bOPR\/|\bOpera\b/i.test(ua);
  } catch {
    return false;
  }
}

/**
 * Probe whether getAuthToken actually works (Opera exposes it but rejects).
 */
async function probeGetAuthTokenSupport() {
  if (!hasGetAuthTokenApi()) return false;
  // Opera: don't bother — always unsupported for extension OAuth
  if (looksLikeOpera()) return false;

  try {
    await getTokenViaGetAuthToken(false);
    return true;
  } catch (err) {
    if (isUnsupportedIdentityError(err)) return false;
    // Other failures (not signed in, OAuth not granted) mean the API exists
    return true;
  }
}

async function getStoredWebClientId() {
  const data = await chrome.storage.sync.get(WEB_CLIENT_ID_KEY);
  return data[WEB_CLIENT_ID_KEY] || "";
}

/** Prefer Options Web client ID; fall back to manifest oauth2.client_id. */
async function resolveWebClientId() {
  const stored = await getStoredWebClientId();
  if (stored) return stored;
  const fromManifest = chrome.runtime.getManifest()?.oauth2?.client_id || "";
  if (fromManifest && !fromManifest.startsWith("YOUR_CLIENT_ID")) {
    return fromManifest;
  }
  return "";
}

export async function setWebClientId(clientId) {
  await chrome.storage.sync.set({ [WEB_CLIENT_ID_KEY]: (clientId || "").trim() });
}

export async function getWebClientId() {
  return getStoredWebClientId();
}

async function getStoredAccessToken() {
  const data = await chrome.storage.local.get([TOKEN_KEY, TOKEN_EXPIRES_KEY]);
  const token = data[TOKEN_KEY];
  const expires = data[TOKEN_EXPIRES_KEY] || 0;
  if (!token) return null;
  if (expires && Date.now() > expires - 60_000) return null;
  return token;
}

async function storeAccessToken(token, expiresInSec) {
  await chrome.storage.local.set({
    [TOKEN_KEY]: token,
    [TOKEN_EXPIRES_KEY]: Date.now() + (expiresInSec || 3600) * 1000,
  });
}

async function clearStoredAccessToken() {
  await chrome.storage.local.remove([TOKEN_KEY, TOKEN_EXPIRES_KEY]);
}

function parseTokenFromRedirect(redirectUrl) {
  // Implicit flow returns tokens in the hash; some browsers use query.
  const url = new URL(redirectUrl);
  const hash = url.hash.replace(/^#/, "");
  const fromHash = new URLSearchParams(hash);
  const fromQuery = url.searchParams;
  const token =
    fromHash.get("access_token") || fromQuery.get("access_token");
  const expiresIn = Number(
    fromHash.get("expires_in") || fromQuery.get("expires_in") || "3600"
  );
  const error =
    fromHash.get("error") ||
    fromQuery.get("error") ||
    fromHash.get("error_description") ||
    fromQuery.get("error_description");
  if (!token) {
    throw new Error(
      error
        ? `Google sign-in failed: ${error}`
        : "Google sign-in did not return an access token. Create a Web application OAuth client (not Chrome Extension), add the redirect URI from Options, and paste that Client ID on the Options page."
    );
  }
  return { token, expiresIn };
}

function webAuthSetupError() {
  const redirect = getOAuthRedirectUri() || "(open Options to see redirect URI)";
  return new Error(
    `Opera / this browser cannot use Chrome’s getAuthToken (“function unsupported”). ` +
      `Open the extension Options page → create a Google Cloud OAuth client of type “Web application” → ` +
      `add redirect URI ${redirect} → paste the Web Client ID there → Sign in, then Save again.`
  );
}

/**
 * Cross-browser OAuth via launchWebAuthFlow + Web application client ID.
 * @param {boolean} interactive
 */
async function getTokenViaWebAuthFlow(interactive) {
  const cached = await getStoredAccessToken();
  if (cached) return cached;
  if (!interactive) {
    throw new Error("Not signed in.");
  }

  const clientId = await resolveWebClientId();
  if (!clientId) {
    throw webAuthSetupError();
  }

  if (typeof chrome.identity?.launchWebAuthFlow !== "function") {
    throw new Error(
      "launchWebAuthFlow is not available in this browser. Try Chrome or Edge, or update Opera."
    );
  }

  const redirectUri = chrome.identity.getRedirectURL();
  const authUrl =
    "https://accounts.google.com/o/oauth2/v2/auth" +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&response_type=token` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&prompt=consent`;

  const redirectUrl = await new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      { url: authUrl, interactive: true },
      (responseUrl) => {
        if (chrome.runtime.lastError || !responseUrl) {
          const msg = chrome.runtime.lastError?.message || "Sign-in was cancelled.";
          // Common when Chrome Extension client ID is used with web flow
          if (/redirect|client|invalid|mismatch/i.test(msg)) {
            reject(
              new Error(
                `${msg} — Use a Web application OAuth client (not “Chrome Extension”) and add this redirect URI in Google Cloud: ${redirectUri}`
              )
            );
            return;
          }
          reject(new Error(msg));
          return;
        }
        resolve(responseUrl);
      }
    );
  });

  const { token, expiresIn } = parseTokenFromRedirect(redirectUrl);
  await storeAccessToken(token, expiresIn);
  return token;
}

async function getTokenViaGetAuthToken(interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(
          new Error(
            chrome.runtime.lastError?.message ||
              "Could not get Google auth token. Check your OAuth client ID in manifest.json."
          )
        );
        return;
      }
      resolve(token);
    });
  });
}

/**
 * @param {boolean} [interactive=true]
 * @returns {Promise<string>}
 */
export async function getAuthToken(interactive = true) {
  if (getAuthTokenSupported === null) {
    getAuthTokenSupported = await probeGetAuthTokenSupport();
  }

  if (getAuthTokenSupported) {
    try {
      return await getTokenViaGetAuthToken(interactive);
    } catch (err) {
      if (isUnsupportedIdentityError(err)) {
        getAuthTokenSupported = false;
        return getTokenViaWebAuthFlow(interactive);
      }
      // Signed-out / revoked on Chrome: still try web flow if configured
      const webId = await resolveWebClientId();
      if (webId && interactive) {
        try {
          return await getTokenViaWebAuthFlow(interactive);
        } catch {
          throw err;
        }
      }
      throw err;
    }
  }

  return getTokenViaWebAuthFlow(interactive);
}

/** Clear cached token so the next call can re-auth. */
export async function revokeAuthToken() {
  const stored = await getStoredAccessToken().catch(() => null);
  if (stored) {
    await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${stored}`);
    await clearStoredAccessToken();
  }

  if (getAuthTokenSupported === null) {
    getAuthTokenSupported = await probeGetAuthTokenSupport();
  }
  if (!getAuthTokenSupported) return;

  const token = await getTokenViaGetAuthToken(false).catch(() => null);
  if (!token) return;
  await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`);
  return new Promise((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, resolve);
  });
}

/**
 * @param {string} path
 * @param {RequestInit} [options]
 */
async function sheetsFetch(path, options = {}) {
  const token = await getAuthToken(true);
  const res = await fetch(`${SHEETS_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (res.status === 401) {
    if (getAuthTokenSupported) {
      await new Promise((r) =>
        chrome.identity.removeCachedAuthToken({ token }, r)
      );
    }
    await clearStoredAccessToken();
    const retryToken = await getAuthToken(true);
    const retry = await fetch(`${SHEETS_API}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${retryToken}`,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
    if (!retry.ok) {
      const err = await retry.text();
      throw new Error(`Sheets API error (${retry.status}): ${err}`);
    }
    return retry.json();
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Sheets API error (${res.status}): ${err}`);
  }
  return res.json();
}

/** @param {string} spreadsheetId */
export async function getSpreadsheetMeta(spreadsheetId) {
  return sheetsFetch(
    `/${spreadsheetId}?fields=spreadsheetId,properties.title,sheets.properties.title`
  );
}

/** @param {string} spreadsheetId */
export async function getSpreadsheetTitle(spreadsheetId) {
  const meta = await getSpreadsheetMeta(spreadsheetId);
  return meta.properties?.title || "Untitled spreadsheet";
}

/**
 * Ensure the first row has our expected headers.
 * @param {string} spreadsheetId
 * @param {string} [sheetName="Sheet1"]
 */
export async function ensureHeaderRow(spreadsheetId, sheetName = "Sheet1") {
  const range = encodeURIComponent(`'${sheetName}'!A1:E1`);
  const existing = await sheetsFetch(
    `/${spreadsheetId}/values/${range}`
  ).catch(() => ({ values: [] }));

  const first = existing.values?.[0];
  if (first && first[0] === HEADER_ROW[0]) return;

  await sheetsFetch(
    `/${spreadsheetId}/values/${range}?valueInputOption=RAW`,
    {
      method: "PUT",
      body: JSON.stringify({ values: [HEADER_ROW] }),
    }
  );
}

/**
 * Append one company row to the active sheet.
 * @param {string} spreadsheetId
 * @param {{ companyName: string, website: string, email: string, products: string }} row
 * @param {string} [sheetName="Sheet1"]
 */
export async function appendCompanyRow(spreadsheetId, row, sheetName = "Sheet1") {
  await ensureHeaderRow(spreadsheetId, sheetName);

  const range = encodeURIComponent(`'${sheetName}'!A:E`);
  const savedAt = new Date().toISOString();

  return sheetsFetch(
    `/${spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      body: JSON.stringify({
        values: [
          [
            row.companyName || "",
            row.website || "",
            row.email || "",
            row.products || "",
            savedAt,
          ],
        ],
      }),
    }
  );
}

/**
 * List recent spreadsheets the user can access (Drive API).
 * @param {number} [pageSize=20]
 */
export async function listRecentSpreadsheets(pageSize = 20) {
  const token = await getAuthToken(true);
  const q = encodeURIComponent(
    "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false"
  );
  const url = `${DRIVE_API}?q=${q}&pageSize=${pageSize}&fields=files(id,name,webViewLink)&orderBy=viewedByMeTime desc`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Drive API error (${res.status}): ${err}`);
  }
  const data = await res.json();
  return data.files || [];
}

/** Redirect URI helpers for Options / Safari setup. */
export function getOAuthRedirectUri() {
  try {
    return chrome.identity.getRedirectURL();
  } catch {
    return "";
  }
}
