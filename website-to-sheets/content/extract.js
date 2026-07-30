/**
 * Best-effort extraction of company details from the current page.
 * Exposed to the extension via chrome.runtime messaging / executeScript.
 */

(function () {
  const EMAIL_RE =
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const NOISE_EMAILS = new Set([
    "example@example.com",
    "email@example.com",
    "you@example.com",
    "name@example.com",
  ]);

  function meta(name) {
    const el =
      document.querySelector(`meta[property="${name}"]`) ||
      document.querySelector(`meta[name="${name}"]`);
    return el?.content?.trim() || "";
  }

  function companyName() {
    const og = meta("og:site_name");
    if (og) return og;

    const app = meta("application-name");
    if (app) return app;

    const ld = document.querySelector(
      'script[type="application/ld+json"]'
    );
    if (ld) {
      try {
        const data = JSON.parse(ld.textContent || "");
        const nodes = Array.isArray(data) ? data : [data];
        for (const node of nodes) {
          const graph = node["@graph"] || [node];
          for (const item of graph) {
            if (
              item &&
              (item["@type"] === "Organization" ||
                item["@type"] === "Corporation" ||
                item["@type"] === "LocalBusiness") &&
              item.name
            ) {
              return String(item.name).trim();
            }
          }
        }
      } catch {
        /* ignore bad JSON-LD */
      }
    }

    const title = (document.title || "").trim();
    if (title) {
      return title
        .split(/\s+[|\-–—:]\s+/)[0]
        .replace(/\s*(home|official site|welcome)\s*$/i, "")
        .trim();
    }

    try {
      const host = location.hostname.replace(/^www\./, "");
      const base = host.split(".")[0];
      return base.charAt(0).toUpperCase() + base.slice(1);
    } catch {
      return "";
    }
  }

  function website() {
    return location.origin || location.href;
  }

  function emails() {
    const found = new Set();

    document.querySelectorAll('a[href^="mailto:"]').forEach((a) => {
      const addr = (a.getAttribute("href") || "")
        .replace(/^mailto:/i, "")
        .split("?")[0]
        .trim()
        .toLowerCase();
      if (addr && !NOISE_EMAILS.has(addr)) found.add(addr);
    });

    const text = document.body?.innerText?.slice(0, 80000) || "";
    const matches = text.match(EMAIL_RE) || [];
    for (const m of matches) {
      const addr = m.toLowerCase();
      if (
        !NOISE_EMAILS.has(addr) &&
        !addr.endsWith(".png") &&
        !addr.endsWith(".jpg")
      ) {
        found.add(addr);
      }
    }

    return [...found].slice(0, 8);
  }

  function products() {
    const desc =
      meta("description") ||
      meta("og:description") ||
      meta("twitter:description");
    if (desc) return desc.slice(0, 280);

    const h1 = document.querySelector("h1");
    if (h1?.textContent) return h1.textContent.trim().slice(0, 160);
    return "";
  }

  function extract() {
    const mailList = emails();
    return {
      companyName: companyName(),
      website: website(),
      email: mailList[0] || "",
      emailSuggestions: mailList,
      products: products(),
      pageTitle: document.title || "",
      pageUrl: location.href,
    };
  }

  // Available to popup via chrome.tabs.sendMessage
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "EXTRACT_PAGE") {
      sendResponse({ ok: true, result: extract() });
      return true;
    }
  });

  // Also expose for executeScript fallbacks
  window.__websiteToSheetsExtract = extract;
})();
