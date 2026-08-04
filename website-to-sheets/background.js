/**
 * Service worker: message hub for auth + Sheets writes.
 */

import {
  appendCompanyRow,
  getSpreadsheetTitle,
  listRecentSpreadsheets,
  revokeAuthToken,
  getAuthToken,
  setWebClientId,
  setWebClientSecret,
  getWebClientCredentials,
} from "./lib/sheets.js";
import {
  addSpreadsheet,
  getActiveSpreadsheet,
  getSpreadsheets,
  parseSpreadsheetId,
  removeSpreadsheet,
  setActiveSpreadsheetId,
} from "./lib/storage.js";

chrome.runtime.onInstalled.addListener(() => {
  console.log("Website → Sheets installed");
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) =>
      sendResponse({ ok: false, error: error?.message || String(error) })
    );
  return true; // async
});

async function handleMessage(message) {
  switch (message.type) {
    case "AUTH_CHECK": {
      const token = await getAuthToken(false).catch(() => null);
      return { signedIn: Boolean(token) };
    }
    case "AUTH_SIGN_IN": {
      await getAuthToken(true);
      return { signedIn: true };
    }
    case "AUTH_SIGN_OUT": {
      await revokeAuthToken();
      return { signedIn: false };
    }
    case "GET_WEB_CLIENT_ID": {
      return getWebClientCredentials();
    }
    case "SET_WEB_CLIENT_ID": {
      await setWebClientId(message.clientId);
      if (typeof message.clientSecret === "string") {
        await setWebClientSecret(message.clientSecret);
      }
      return getWebClientCredentials();
    }
    case "LIST_SPREADSHEETS": {
      return getSpreadsheets();
    }
    case "GET_ACTIVE": {
      return getActiveSpreadsheet();
    }
    case "SET_ACTIVE": {
      await setActiveSpreadsheetId(message.id);
      return getActiveSpreadsheet();
    }
    case "ADD_SPREADSHEET": {
      const id = parseSpreadsheetId(message.input);
      if (!id) throw new Error("Invalid spreadsheet URL or ID.");
      const name =
        message.name ||
        (await getSpreadsheetTitle(id).catch(() => "Untitled spreadsheet"));
      await addSpreadsheet({
        id,
        name,
        sheetName: message.sheetName || "Sheet1",
      });
      await setActiveSpreadsheetId(id);
      return getSpreadsheets();
    }
    case "REMOVE_SPREADSHEET": {
      return removeSpreadsheet(message.id);
    }
    case "BROWSE_DRIVE_SHEETS": {
      return listRecentSpreadsheets(message.pageSize || 20);
    }
    case "SAVE_ROW": {
      const active = await getActiveSpreadsheet();
      if (!active) {
        throw new Error(
          "No active spreadsheet. Add one from the switcher first."
        );
      }
      await appendCompanyRow(
        active.id,
        {
          companyName: message.row.companyName,
          website: message.row.website,
          email: message.row.email,
          products: message.row.products,
        },
        active.sheetName || "Sheet1"
      );
      return { spreadsheet: active };
    }
    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}
