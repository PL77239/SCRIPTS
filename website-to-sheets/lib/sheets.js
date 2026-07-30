/**
 * Google Sheets API helpers.
 * Auth: chrome.identity.getAuthToken (Chrome/Edge/Opera) with
 * launchWebAuthFlow fallback (Safari / browsers without getAuthToken).
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

function supportsGetAuthToken() {
  return typeof chrome.identity?.getAuthToken === "function";
}

async function getStoredWebClientId() {
  const data = await chrome.storage.sync.get(WEB_CLIENT_ID_KEY);
  return data[WEB_CLIENT_ID_KEY] || "";
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
  const hash = new URL(redirectUrl).hash.replace(/^#/, "");
  const params = new URLSearchParams(hash);
  const token = params.get("access_token");
  const expiresIn = Number(params.get("expires_in") || "3600");
  if (!token) {
    throw new Error(
      "Google sign-in did not return an access token. Check the Web OAuth client ID and redirect URI."
    );
  }
  return { token, expiresIn };
}

/**
 * Safari / fallback OAuth via launchWebAuthFlow + Web application client ID.
 * @param {boolean} interactive
 */
async function getTokenViaWebAuthFlow(interactive) {
  const cached = await getStoredAccessToken();
  if (cached) return cached;
  if (!interactive) {
    throw new Error("Not signed in.");
  }

  const clientId = await getStoredWebClientId();
  if (!clientId) {
    throw new Error(
      "This browser needs a Web OAuth client ID (Safari). Set it on the Options page — see BROWSERS.md."
    );
  }

  if (typeof chrome.identity?.launchWebAuthFlow !== "function") {
    throw new Error("launchWebAuthFlow is not available in this browser.");
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
          reject(
            new Error(
              chrome.runtime.lastError?.message || "Sign-in was cancelled."
            )
          );
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
  if (supportsGetAuthToken()) {
    try {
      return await getTokenViaGetAuthToken(interactive);
    } catch (err) {
      // If getAuthToken exists but fails (e.g. bad Chrome client on Opera),
      // try web-flow when a web client id is configured.
      const webId = await getStoredWebClientId();
      if (!webId) throw err;
      return getTokenViaWebAuthFlow(interactive);
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

  if (!supportsGetAuthToken()) return;

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
    if (supportsGetAuthToken()) {
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
