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
const WEB_CLIENT_SECRET_KEY = "oauthWebClientSecret";

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

async function getStoredWebClientSecret() {
  // Keep secret in local storage (still visible to the extension, but not synced).
  const data = await chrome.storage.local.get(WEB_CLIENT_SECRET_KEY);
  return data[WEB_CLIENT_SECRET_KEY] || "";
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

export async function setWebClientSecret(clientSecret) {
  const value = (clientSecret || "").trim();
  if (value) {
    await chrome.storage.local.set({ [WEB_CLIENT_SECRET_KEY]: value });
  } else {
    await chrome.storage.local.remove(WEB_CLIENT_SECRET_KEY);
  }
}

export async function getWebClientId() {
  return getStoredWebClientId();
}

export async function getWebClientCredentials() {
  const [clientId, clientSecret, redirectUri] = await Promise.all([
    getStoredWebClientId(),
    getStoredWebClientSecret(),
    Promise.resolve(getOAuthRedirectUri()),
  ]);
  return {
    clientId,
    hasSecret: Boolean(clientSecret),
    redirectUri,
  };
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

function explainOAuthError(error, description = "") {
  const err = String(error || "").toLowerCase();
  const detail = description ? ` (${description})` : "";

  if (err.includes("access_denied")) {
    return (
      `Google returned access_denied${detail}. Almost always this means: ` +
      `(1) OAuth consent screen is in Testing and your Google account is NOT added under Test users, or ` +
      `(2) you clicked Cancel, or ` +
      `(3) the OAuth client is the wrong type. ` +
      `Fix: Google Cloud → OAuth consent screen → Audience/Test users → add your Gmail → save, then sign in again. ` +
      `Also confirm the client is “Web application” and the redirect URI matches Options exactly.`
    );
  }
  if (err.includes("redirect_uri")) {
    return (
      `Redirect URI mismatch${detail}. In the Web application OAuth client, Authorized redirect URIs must include exactly: ` +
      `${getOAuthRedirectUri()}`
    );
  }
  return `Google sign-in failed: ${error || "unknown"}${detail}`;
}

function parseOAuthRedirect(redirectUrl) {
  const url = new URL(redirectUrl);
  const hash = url.hash.replace(/^#/, "");
  const fromHash = new URLSearchParams(hash);
  const fromQuery = url.searchParams;

  const pick = (key) => fromHash.get(key) || fromQuery.get(key);

  const error = pick("error");
  const errorDescription = pick("error_description");
  if (error) {
    throw new Error(explainOAuthError(error, errorDescription || ""));
  }

  return {
    accessToken: pick("access_token"),
    expiresIn: Number(pick("expires_in") || "3600"),
    code: pick("code"),
  };
}

function webAuthSetupError() {
  const redirect = getOAuthRedirectUri() || "(open Options to see redirect URI)";
  return new Error(
    `Opera needs Web OAuth setup. Open Options → create a Google Cloud OAuth client of type “Web application” → ` +
      `add redirect URI ${redirect} → paste Client ID + Client secret → add yourself as a Test user on the consent screen → Sign in.`
  );
}

/** PKCE helpers */
function base64UrlEncode(buffer) {
  const bytes = new Uint8Array(buffer);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomVerifier() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

async function challengeFromVerifier(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(digest);
}

async function exchangeCodeForToken({
  code,
  clientId,
  clientSecret,
  redirectUri,
  codeVerifier,
}) {
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    code_verifier: codeVerifier,
  });
  if (clientSecret) body.set("client_secret", clientSecret);

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    const err = data.error || res.status;
    const desc = data.error_description || "";
    if (String(err).includes("unauthorized_client") || String(desc).includes("secret")) {
      throw new Error(
        `Token exchange failed (${err}: ${desc}). For a Web application client, paste the Client secret on the Options page.`
      );
    }
    throw new Error(explainOAuthError(err, desc));
  }
  return {
    token: data.access_token,
    expiresIn: Number(data.expires_in || 3600),
  };
}

/**
 * Cross-browser OAuth via launchWebAuthFlow.
 * Uses authorization code + PKCE (and client secret for Web application clients).
 * Falls back to legacy implicit token flow only if code flow isn't returned.
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
  const clientSecret = await getStoredWebClientSecret();

  if (typeof chrome.identity?.launchWebAuthFlow !== "function") {
    throw new Error(
      "launchWebAuthFlow is not available in this browser. Try Chrome or Edge, or update Opera."
    );
  }

  const redirectUri = chrome.identity.getRedirectURL();
  const codeVerifier = randomVerifier();
  const codeChallenge = await challengeFromVerifier(codeVerifier);

  const authUrl =
    "https://accounts.google.com/o/oauth2/v2/auth" +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&prompt=consent` +
    `&access_type=offline` +
    `&code_challenge=${encodeURIComponent(codeChallenge)}` +
    `&code_challenge_method=S256`;

  const redirectUrl = await new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      { url: authUrl, interactive: true },
      (responseUrl) => {
        if (chrome.runtime.lastError || !responseUrl) {
          const msg = chrome.runtime.lastError?.message || "Sign-in was cancelled.";
          if (/access.?denied/i.test(msg)) {
            reject(new Error(explainOAuthError("access_denied", msg)));
            return;
          }
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

  const parsed = parseOAuthRedirect(redirectUrl);

  if (parsed.code) {
    if (!clientSecret) {
      throw new Error(
        "Google returned an auth code, but no Client secret is saved. " +
          "Open Options → paste the Client secret from your Web application OAuth client → Save → Sign in again."
      );
    }
    const { token, expiresIn } = await exchangeCodeForToken({
      code: parsed.code,
      clientId,
      clientSecret,
      redirectUri,
      codeVerifier,
    });
    await storeAccessToken(token, expiresIn);
    return token;
  }

  if (parsed.accessToken) {
    await storeAccessToken(parsed.accessToken, parsed.expiresIn);
    return parsed.accessToken;
  }

  throw new Error(
    "Google sign-in did not return a code or token. Check Test users, redirect URI, and that the client type is Web application."
  );
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
    `/${spreadsheetId}?fields=spreadsheetId,properties.title,sheets.properties(sheetId,title,index)`
  );
}

/** @param {string} spreadsheetId */
export async function getSpreadsheetTitle(spreadsheetId) {
  const meta = await getSpreadsheetMeta(spreadsheetId);
  return meta.properties?.title || "Untitled spreadsheet";
}

/** @param {string} spreadsheetId */
export async function listSheetTitles(spreadsheetId) {
  const meta = await getSpreadsheetMeta(spreadsheetId);
  return (meta.sheets || [])
    .map((s) => s.properties?.title)
    .filter(Boolean);
}

/**
 * Pick a real tab name. Localized Sheets often use Arkusz1 / Tabelle1 / etc.
 * instead of Sheet1.
 * @param {string} spreadsheetId
 * @param {string} [preferred]
 */
export async function resolveSheetName(spreadsheetId, preferred) {
  const titles = await listSheetTitles(spreadsheetId);
  if (!titles.length) {
    throw new Error("This spreadsheet has no tabs to write to.");
  }

  const wanted = (preferred || "").trim();
  if (wanted && titles.includes(wanted)) return wanted;

  // Prefer common default names if present, else first tab
  const defaults = [
    "Sheet1",
    "Arkusz1",
    "Tabelle1",
    "Feuille 1",
    "Hoja 1",
    "Foglio1",
  ];
  for (const d of defaults) {
    if (titles.includes(d)) return d;
  }
  return titles[0];
}

/** A1 range with a properly quoted sheet title. */
export function toA1Range(sheetName, a1) {
  if (!sheetName) return a1;
  const quoted = `'${String(sheetName).replace(/'/g, "''")}'`;
  return `${quoted}!${a1}`;
}

/**
 * Ensure the first row has our expected headers.
 * @param {string} spreadsheetId
 * @param {string} sheetName resolved tab title
 */
export async function ensureHeaderRow(spreadsheetId, sheetName) {
  const range = encodeURIComponent(toA1Range(sheetName, "A1:E1"));
  let existing = { values: [] };
  try {
    existing = await sheetsFetch(`/${spreadsheetId}/values/${range}`);
  } catch {
    existing = { values: [] };
  }

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
 * Resolves the real tab name when "Sheet1" (or another preferred name) is missing.
 * @param {string} spreadsheetId
 * @param {{ companyName: string, website: string, email: string, products: string }} row
 * @param {string} [preferredSheetName]
 * @returns {Promise<{ append: object, sheetName: string }>}
 */
export async function appendCompanyRow(
  spreadsheetId,
  row,
  preferredSheetName = ""
) {
  const sheetName = await resolveSheetName(spreadsheetId, preferredSheetName);
  await ensureHeaderRow(spreadsheetId, sheetName);

  const range = encodeURIComponent(toA1Range(sheetName, "A:E"));
  const savedAt = new Date().toISOString();

  const append = await sheetsFetch(
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
  return { append, sheetName };
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
