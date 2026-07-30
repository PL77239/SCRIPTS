/**
 * Persist spreadsheet list + active selection in chrome.storage.sync
 */

const STORAGE_KEYS = {
  spreadsheets: "spreadsheets",
  activeId: "activeSpreadsheetId",
};

/**
 * @typedef {{ id: string, name: string, url: string, sheetName?: string }} SpreadsheetEntry
 */

/** @returns {Promise<SpreadsheetEntry[]>} */
export async function getSpreadsheets() {
  const data = await chrome.storage.sync.get(STORAGE_KEYS.spreadsheets);
  return data[STORAGE_KEYS.spreadsheets] || [];
}

/** @returns {Promise<string|null>} */
export async function getActiveSpreadsheetId() {
  const data = await chrome.storage.sync.get(STORAGE_KEYS.activeId);
  return data[STORAGE_KEYS.activeId] || null;
}

/** @returns {Promise<SpreadsheetEntry|null>} */
export async function getActiveSpreadsheet() {
  const [list, activeId] = await Promise.all([
    getSpreadsheets(),
    getActiveSpreadsheetId(),
  ]);
  if (!list.length) return null;
  return list.find((s) => s.id === activeId) || list[0];
}

/** @param {SpreadsheetEntry[]} list */
export async function setSpreadsheets(list) {
  await chrome.storage.sync.set({ [STORAGE_KEYS.spreadsheets]: list });
}

/** @param {string} id */
export async function setActiveSpreadsheetId(id) {
  await chrome.storage.sync.set({ [STORAGE_KEYS.activeId]: id });
}

/**
 * Extract a spreadsheet ID from a full Google Sheets URL or raw ID.
 * @param {string} input
 * @returns {string|null}
 */
export function parseSpreadsheetId(input) {
  const trimmed = (input || "").trim();
  if (!trimmed) return null;

  const fromUrl = trimmed.match(
    /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/
  );
  if (fromUrl) return fromUrl[1];

  if (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed)) return trimmed;
  return null;
}

/**
 * @param {{ id: string, name: string, url?: string, sheetName?: string }} entry
 */
export async function addSpreadsheet(entry) {
  const list = await getSpreadsheets();
  if (list.some((s) => s.id === entry.id)) {
    throw new Error("This spreadsheet is already in your list.");
  }
  const next = [
    ...list,
    {
      id: entry.id,
      name: entry.name,
      url:
        entry.url ||
        `https://docs.google.com/spreadsheets/d/${entry.id}/edit`,
      sheetName: entry.sheetName || "Sheet1",
    },
  ];
  await setSpreadsheets(next);
  if (!(await getActiveSpreadsheetId())) {
    await setActiveSpreadsheetId(entry.id);
  }
  return next;
}

/** @param {string} id */
export async function removeSpreadsheet(id) {
  const list = await getSpreadsheets();
  const next = list.filter((s) => s.id !== id);
  await setSpreadsheets(next);
  const active = await getActiveSpreadsheetId();
  if (active === id) {
    await setActiveSpreadsheetId(next[0]?.id || null);
  }
  return next;
}
