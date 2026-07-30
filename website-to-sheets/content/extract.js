/**
 * Extract company details from the current page, then scan related
 * same-origin pages (Contact, About, Products, Services, …) for emails
 * and product/service copy.
 *
 * Limit: same website origin only, capped number of extra pages.
 * It does NOT crawl an entire site indefinitely.
 */

(function () {
  const EMAIL_RE =
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

  const NOISE_EMAILS = new Set([
    "example@example.com",
    "email@example.com",
    "you@example.com",
    "name@example.com",
    "user@domain.com",
    "s@s.s",
  ]);

  const RELATED_PATHS = [
    "/contact",
    "/contact-us",
    "/contactus",
    "/about",
    "/about-us",
    "/aboutus",
    "/products",
    "/product",
    "/services",
    "/service",
    "/solutions",
    "/offerings",
    "/what-we-do",
    "/impressum",
    "/kontakt",
    "/uber-uns",
    "/ueber-uns",
  ];

  const LINK_HINT =
    /\b(contact|kontakt|about|about[-\s]?us|impressum|products?|services?|solutions?|offerings?|what[-\s]?we[-\s]?do|support|sales)\b/i;

  const PRODUCT_LINK_HINT =
    /\b(products?|services?|solutions?|offerings?|what[-\s]?we[-\s]?do|catalog|shop|portfolio)\b/i;

  const MAX_RELATED = 6;
  const FETCH_TIMEOUT_MS = 4500;

  function metaFrom(doc, name) {
    const el =
      doc.querySelector(`meta[property="${name}"]`) ||
      doc.querySelector(`meta[name="${name}"]`);
    return el?.content?.trim() || "";
  }

  function meta(name) {
    return metaFrom(document, name);
  }

  function isUsefulEmail(addr) {
    if (!addr) return false;
    const a = addr.toLowerCase();
    if (NOISE_EMAILS.has(a)) return false;
    if (a.endsWith(".png") || a.endsWith(".jpg") || a.endsWith(".gif")) {
      return false;
    }
    if (a.includes("sentry.io") || a.includes("wixpress.com")) return false;
    return true;
  }

  function companyName() {
    const og = meta("og:site_name");
    if (og) return og;

    const app = meta("application-name");
    if (app) return app;

    const ldScripts = document.querySelectorAll(
      'script[type="application/ld+json"]'
    );
    for (const ld of ldScripts) {
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

  /** Collect emails from a Document or HTML string context. */
  function emailsFromDoc(doc) {
    const found = new Set();

    doc.querySelectorAll('a[href^="mailto:"]').forEach((a) => {
      const addr = (a.getAttribute("href") || "")
        .replace(/^mailto:/i, "")
        .split("?")[0]
        .trim()
        .toLowerCase();
      if (isUsefulEmail(addr)) found.add(addr);
    });

    const text = doc.body?.innerText?.slice(0, 100000) || "";
    const matches = text.match(EMAIL_RE) || [];
    for (const m of matches) {
      const addr = m.toLowerCase();
      if (isUsefulEmail(addr)) found.add(addr);
    }

    return [...found];
  }

  function productsFromDoc(doc, { preferStronger = false } = {}) {
    const desc =
      metaFrom(doc, "description") ||
      metaFrom(doc, "og:description") ||
      metaFrom(doc, "twitter:description");

    const bits = [];
    if (desc) bits.push(desc.trim());

    const h1 = doc.querySelector("h1");
    if (h1?.textContent) bits.push(h1.textContent.trim());

    if (preferStronger) {
      const headings = [...doc.querySelectorAll("h2, h3")]
        .map((h) => h.textContent.trim())
        .filter((t) => t && t.length < 80)
        .slice(0, 8);
      if (headings.length) bits.push(headings.join(" · "));
    }

    const joined = bits.filter(Boolean).join(" — ").replace(/\s+/g, " ");
    return joined.slice(0, 400);
  }

  function scoreEmail(addr) {
    // Prefer sales/info/contact-style addresses
    const local = addr.split("@")[0] || "";
    if (/^(info|contact|hello|sales|office|enquiry|inquiry|support)$/i.test(local)) {
      return 0;
    }
    if (/info|contact|sales|hello|office/.test(local)) return 1;
    return 2;
  }

  function mergeEmails(lists) {
    const set = new Set();
    for (const list of lists) {
      for (const e of list) set.add(e);
    }
    return [...set].sort((a, b) => scoreEmail(a) - scoreEmail(b)).slice(0, 12);
  }

  function pickBetterProducts(current, next) {
    if (!next) return current;
    if (!current) return next;
    // Prefer longer, more specific product copy from product/service pages
    if (next.length > current.length + 20) return next;
    if (/product|service|solution|offer/i.test(next) && next.length >= current.length) {
      return next;
    }
    return current;
  }

  function sameOrigin(url) {
    try {
      const u = new URL(url, location.href);
      return u.origin === location.origin ? u : null;
    } catch {
      return null;
    }
  }

  function normalizeUrl(u) {
    u.hash = "";
    // Drop tracking query noise lightly
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"].forEach(
      (k) => u.searchParams.delete(k)
    );
    let s = u.toString();
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s;
  }

  /** Discover related same-origin URLs from nav/footer links + common paths. */
  function discoverRelatedUrls() {
    const found = new Map(); // url -> { productish: boolean }

    function consider(href, text) {
      const u = sameOrigin(href);
      if (!u) return;
      if (u.pathname === location.pathname) return;
      if (!/\.html?$|\/$|^[^.]*$/i.test(u.pathname.split("/").pop() || "")) {
        // skip obvious assets
        if (/\.(css|js|png|jpe?g|gif|svg|webp|pdf|zip|xml)$/i.test(u.pathname)) {
          return;
        }
      }
      const label = `${text || ""} ${u.pathname}`;
      if (!LINK_HINT.test(label) && !RELATED_PATHS.some((p) => u.pathname.toLowerCase().includes(p.slice(1)))) {
        return;
      }
      const key = normalizeUrl(u);
      const productish = PRODUCT_LINK_HINT.test(label);
      const prev = found.get(key);
      found.set(key, {
        productish: Boolean(prev?.productish || productish),
      });
    }

    document.querySelectorAll("a[href]").forEach((a) => {
      consider(a.getAttribute("href"), a.textContent || a.getAttribute("aria-label") || "");
    });

    for (const path of RELATED_PATHS) {
      consider(path, path);
    }

    // Prefer contact / product pages first
    return [...found.entries()]
      .sort((a, b) => {
        const rank = (url, meta) => {
          const p = url.toLowerCase();
          if (/contact|kontakt|impressum/.test(p)) return 0;
          if (meta.productish) return 1;
          if (/about|uber|ueber/.test(p)) return 2;
          return 3;
        };
        return rank(a[0], a[1]) - rank(b[0], b[1]);
      })
      .slice(0, MAX_RELATED)
      .map(([url, meta]) => ({ url, ...meta }));
  }

  async function fetchHtml(url) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        credentials: "omit",
        headers: { Accept: "text/html" },
      });
      if (!res.ok) return null;
      const ctype = res.headers.get("content-type") || "";
      if (ctype && !/text\/html|application\/xhtml/i.test(ctype) && !ctype.includes("text/plain")) {
        // Some servers omit content-type; still try if empty
        if (ctype && !ctype.includes("text/")) return null;
      }
      return await res.text();
    } catch {
      return null;
    } finally {
      clearTimeout(t);
    }
  }

  function parseHtml(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return doc;
  }

  function extractLocal() {
    const mailList = emailsFromDoc(document);
    return {
      companyName: companyName(),
      website: website(),
      email: mailList[0] || "",
      emailSuggestions: mailList,
      products: productsFromDoc(document),
      pageTitle: document.title || "",
      pageUrl: location.href,
      scannedPages: [location.href],
      scanNote: "Current page only (related scan pending)",
    };
  }

  /**
   * Full extract: current page + related same-origin pages.
   * @returns {Promise<object>}
   */
  async function extract({ deep = true } = {}) {
    const base = extractLocal();
    if (!deep) {
      base.scanNote = "Current page only";
      return base;
    }

    const related = discoverRelatedUrls();
    if (!related.length) {
      base.scanNote = "Current page (no related Contact/Products links found)";
      return base;
    }

    const emailBuckets = [base.emailSuggestions];
    let products = base.products;
    const scanned = [...base.scannedPages];

    const results = await Promise.all(
      related.map(async (item) => {
        const html = await fetchHtml(item.url);
        if (!html) return null;
        const doc = parseHtml(html);
        return {
          url: item.url,
          emails: emailsFromDoc(doc),
          products: productsFromDoc(doc, { preferStronger: item.productish }),
          productish: item.productish,
        };
      })
    );

    for (const r of results) {
      if (!r) continue;
      scanned.push(r.url);
      emailBuckets.push(r.emails);
      if (r.productish || !products) {
        products = pickBetterProducts(products, r.products);
      } else {
        products = pickBetterProducts(products, r.products);
      }
    }

    const mailList = mergeEmails(emailBuckets);
    const extra = scanned.length - 1;

    return {
      ...base,
      email: mailList[0] || "",
      emailSuggestions: mailList,
      products,
      scannedPages: scanned,
      scanNote:
        extra > 0
          ? `Scanned current page + ${extra} related page${extra === 1 ? "" : "s"} (Contact / About / Products…)`
          : "Current page only (related pages did not load)",
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "PING") {
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type === "EXTRACT_PAGE") {
      extract({ deep: message.deep !== false })
        .then((result) => sendResponse({ ok: true, result }))
        .catch((error) =>
          sendResponse({
            ok: false,
            error: error?.message || String(error),
          })
        );
      return true; // async
    }
  });

  window.__websiteToSheetsExtract = extract;
})();
