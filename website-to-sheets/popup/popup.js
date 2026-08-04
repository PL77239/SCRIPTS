/**
 * Popup: spreadsheet switcher + save form.
 */

const $ = (sel) => document.querySelector(sel);

const els = {
  authStatus: $("#authStatus"),
  openOptions: $("#openOptions"),
  switcherTrigger: $("#switcherTrigger"),
  switcherPanel: $("#switcherPanel"),
  switcherSearch: $("#switcherSearch"),
  switcherList: $("#switcherList"),
  activeSheetName: $("#activeSheetName"),
  addSheetBtn: $("#addSheetBtn"),
  browseDriveBtn: $("#browseDriveBtn"),
  addSheetForm: $("#addSheetForm"),
  sheetUrlInput: $("#sheetUrlInput"),
  sheetTabInput: $("#sheetTabInput"),
  cancelAddSheet: $("#cancelAddSheet"),
  confirmAddSheet: $("#confirmAddSheet"),
  driveList: $("#driveList"),
  saveForm: $("#saveForm"),
  companyName: $("#companyName"),
  website: $("#website"),
  email: $("#email"),
  emailSuggestions: $("#emailSuggestions"),
  products: $("#products"),
  refreshExtract: $("#refreshExtract"),
  saveBtn: $("#saveBtn"),
  toast: $("#toast"),
};

let spreadsheets = [];
let active = null;

function send(type, payload = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, ...payload }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response?.ok) {
        reject(new Error(response?.error || "Request failed"));
        return;
      }
      resolve(response.result);
    });
  });
}

function showToast(message, isError = false) {
  els.toast.textContent = message;
  els.toast.classList.toggle("error", isError);
  els.toast.classList.remove("hidden");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => els.toast.classList.add("hidden"), 4000);
}

function setAuthUi(signedIn) {
  els.authStatus.textContent = signedIn
    ? "Connected to Google"
    : "Not signed in — click Save to connect";
}

async function refreshSwitcher() {
  spreadsheets = await send("LIST_SPREADSHEETS");
  active = await send("GET_ACTIVE");
  els.activeSheetName.textContent = active?.name || "None selected";
  renderSwitcherList(els.switcherSearch.value || "");
}

function renderSwitcherList(filter = "") {
  const q = filter.trim().toLowerCase();
  const items = spreadsheets.filter((s) =>
    !q ? true : s.name.toLowerCase().includes(q) || s.id.includes(q)
  );

  els.switcherList.innerHTML = "";
  if (!items.length) {
    const empty = document.createElement("li");
    empty.style.cssText =
      "padding:10px;color:var(--muted);font-size:12px;";
    empty.textContent = spreadsheets.length
      ? "No matches"
      : "No spreadsheets yet — add one below";
    els.switcherList.appendChild(empty);
    return;
  }

  for (const sheet of items) {
    const li = document.createElement("li");
    const pick = document.createElement("button");
    pick.type = "button";
    pick.className =
      "pick" + (active?.id === sheet.id ? " active" : "");
    pick.textContent = sheet.name;
    pick.title = sheet.url || sheet.id;
    pick.addEventListener("click", async () => {
      active = await send("SET_ACTIVE", { id: sheet.id });
      els.activeSheetName.textContent = active?.name || sheet.name;
      els.switcherPanel.classList.add("hidden");
      await refreshSwitcher();
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove";
    remove.title = "Remove from list";
    remove.textContent = "×";
    remove.addEventListener("click", async (e) => {
      e.stopPropagation();
      spreadsheets = await send("REMOVE_SPREADSHEET", { id: sheet.id });
      await refreshSwitcher();
    });

    li.append(pick, remove);
    els.switcherList.appendChild(li);
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  return tab;
}

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "PING" });
    return true;
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content/extract.js"],
      });
      return true;
    } catch {
      return false;
    }
  }
}

async function extractFromPage() {
  const tab = await getActiveTab();
  if (!tab?.id) return null;

  els.refreshExtract.disabled = true;
  const prevLabel = els.refreshExtract.textContent;
  els.refreshExtract.textContent = "Scanning…";

  try {
    await ensureContentScript(tab.id);

    // Deep scan: current page + related Contact/About/Products pages
    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: "EXTRACT_PAGE",
        deep: true,
      });
      if (response?.ok) return response.result;
      if (response?.error) throw new Error(response.error);
    } catch (err) {
      /* fall through to inline fallback */
    }

    // Fallback: inject a minimal same-page extractor
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async () => {
        if (typeof window.__websiteToSheetsExtract === "function") {
          return await window.__websiteToSheetsExtract({ deep: true });
        }
        const title = document.title || "";
        const company = title.split(/\s+[|\-–—:]\s+/)[0] || title;
        const mails = [
          ...document.querySelectorAll('a[href^="mailto:"]'),
        ]
          .map((a) =>
            (a.getAttribute("href") || "")
              .replace(/^mailto:/i, "")
              .split("?")[0]
          )
          .filter(Boolean);
        const desc =
          document
            .querySelector('meta[name="description"]')
            ?.getAttribute("content") || "";
        return {
          companyName: company.trim(),
          website: location.origin,
          email: mails[0] || "",
          emailSuggestions: mails,
          products: desc.slice(0, 280),
          pageTitle: title,
          pageUrl: location.href,
          scanNote: "Current page only",
        };
      },
    });
    return result;
  } catch (err) {
    showToast(
      "Could not read this page (try a normal http/https tab).",
      true
    );
    return {
      companyName: "",
      website: tab.url || "",
      email: "",
      emailSuggestions: [],
      products: "",
      scanNote: "",
    };
  } finally {
    els.refreshExtract.disabled = false;
    els.refreshExtract.textContent = prevLabel;
  }
}

function fillForm(data) {
  if (!data) return;
  els.companyName.value = data.companyName || "";
  els.website.value = data.website || "";
  els.email.value = data.email || "";
  els.products.value = data.products || "";

  els.emailSuggestions.innerHTML = "";
  for (const addr of data.emailSuggestions || []) {
    const opt = document.createElement("option");
    opt.value = addr;
    els.emailSuggestions.appendChild(opt);
  }
}

/* —— Events —— */

els.openOptions.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

els.switcherTrigger.addEventListener("click", () => {
  els.switcherPanel.classList.toggle("hidden");
  els.addSheetForm.classList.add("hidden");
  els.driveList.classList.add("hidden");
  if (!els.switcherPanel.classList.contains("hidden")) {
    els.switcherSearch.focus();
  }
});

els.switcherSearch.addEventListener("input", () => {
  renderSwitcherList(els.switcherSearch.value);
});

els.addSheetBtn.addEventListener("click", () => {
  els.driveList.classList.add("hidden");
  els.addSheetForm.classList.toggle("hidden");
  if (!els.addSheetForm.classList.contains("hidden")) {
    els.sheetUrlInput.focus();
  }
});

els.cancelAddSheet.addEventListener("click", () => {
  els.addSheetForm.classList.add("hidden");
});

els.confirmAddSheet.addEventListener("click", async () => {
  try {
    await send("ADD_SPREADSHEET", {
      input: els.sheetUrlInput.value,
      sheetName: els.sheetTabInput.value.trim() || "Sheet1",
    });
    els.sheetUrlInput.value = "";
    els.sheetTabInput.value = "";
    els.addSheetForm.classList.add("hidden");
    await refreshSwitcher();
    showToast("Spreadsheet added and selected.");
  } catch (err) {
    showToast(err.message, true);
  }
});

els.browseDriveBtn.addEventListener("click", async () => {
  els.addSheetForm.classList.add("hidden");
  els.driveList.classList.remove("hidden");
  els.driveList.textContent = "Loading…";
  try {
    const files = await send("BROWSE_DRIVE_SHEETS");
    els.driveList.innerHTML = "";
    if (!files.length) {
      els.driveList.textContent = "No spreadsheets found in Drive.";
      return;
    }
    for (const file of files) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "drive-item";
      btn.textContent = file.name;
      btn.addEventListener("click", async () => {
        try {
          await send("ADD_SPREADSHEET", {
            input: file.id,
            name: file.name,
          });
          els.driveList.classList.add("hidden");
          els.switcherPanel.classList.add("hidden");
          await refreshSwitcher();
          showToast(`Selected “${file.name}”.`);
        } catch (err) {
          showToast(err.message, true);
        }
      });
      els.driveList.appendChild(btn);
    }
  } catch (err) {
    els.driveList.textContent = "";
    showToast(err.message, true);
  }
});

els.refreshExtract.addEventListener("click", async () => {
  const data = await extractFromPage();
  fillForm(data);
  showToast(data?.scanNote || "Page re-scanned.");
});

els.saveForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  els.saveBtn.disabled = true;
  try {
    const result = await send("SAVE_ROW", {
      row: {
        companyName: els.companyName.value.trim(),
        website: els.website.value.trim(),
        email: els.email.value.trim(),
        products: els.products.value.trim(),
      },
    });
    setAuthUi(true);
    const tab = result.sheetName ? ` (tab: ${result.sheetName})` : "";
    showToast(`Saved to “${result.spreadsheet.name}”${tab}.`);
  } catch (err) {
    const msg = err.message || String(err);
    showToast(msg, true);
    if (/unsupported|web application|options page|oauth|sign-in/i.test(msg)) {
      els.authStatus.textContent = "Setup needed — open ⚙ Options";
    }
  } finally {
    els.saveBtn.disabled = false;
  }
});

document.addEventListener("click", (e) => {
  const panel = els.switcherPanel;
  const trigger = els.switcherTrigger;
  if (
    !panel.classList.contains("hidden") &&
    !panel.contains(e.target) &&
    !trigger.contains(e.target)
  ) {
    panel.classList.add("hidden");
  }
});

/* —— Boot —— */
(async function init() {
  try {
    const { signedIn } = await send("AUTH_CHECK");
    setAuthUi(signedIn);
  } catch {
    setAuthUi(false);
  }

  try {
    await refreshSwitcher();
  } catch (err) {
    showToast(err.message, true);
  }

  const data = await extractFromPage();
  fillForm(data);
  if (data?.scanNote) showToast(data.scanNote);
})();
