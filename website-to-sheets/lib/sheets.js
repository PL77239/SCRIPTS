/**
 * Google Sheets API helpers (uses chrome.identity OAuth token).
 */

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const DRIVE_API = "https://www.googleapis.com/drive/v3/files";

const HEADER_ROW = [
  "Company name",
  "Website address",
  "E-mail address",
  "Products / services",
  "Saved at",
];

/**
 * @param {boolean} [interactive=true]
 * @returns {Promise<string>}
 */
export async function getAuthToken(interactive = true) {
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

/** Clear cached token so the next call can re-auth. */
export async function revokeAuthToken() {
  const token = await getAuthToken(false).catch(() => null);
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
    await new Promise((r) =>
      chrome.identity.removeCachedAuthToken({ token }, r)
    );
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
  return sheetsFetch(`/${spreadsheetId}?fields=spreadsheetId,properties.title,sheets.properties.title`);
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
