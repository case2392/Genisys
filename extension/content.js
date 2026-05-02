// Runs in the Salesforce page and inside the Genesys widget iframe (all_frames: true).
// Watches for phone-number-bearing DOM nodes, asks the background worker to look them
// up in Salesforce, and annotates the node with the matched record name.

(() => {
  // Diagnostic: confirms the script actually loaded in this frame.
  // Open DevTools → Console (and use the frame selector to pick the Genesys iframe)
  // to see this line. If it never appears, the iframe URL isn't matched in manifest.json.
  console.log("[CallerID] content script loaded in", location.href);

  const PHONE_RE = /(?:tel:)?\+?1?[\s().-]*(\d{3})[\s().-]*(\d{3})[\s().-]*(\d{4})/;
  const ANNOTATED_ATTR = "data-callerid-name";
  const BADGE_CLASS = "callerid-badge";

  function extractTenDigit(text) {
    if (!text) return null;
    const m = String(text).match(PHONE_RE);
    if (!m) return null;
    return m[1] + m[2] + m[3];
  }

  function annotate(el, name) {
    if (!el) return;
    if (el.getAttribute(ANNOTATED_ATTR) === name) return;
    el.setAttribute(ANNOTATED_ATTR, name);
    let badge = el.querySelector(":scope > ." + BADGE_CLASS);
    if (!badge) {
      badge = document.createElement("span");
      badge.className = BADGE_CLASS;
      badge.style.cssText =
        "display:inline-block;margin-left:6px;padding:1px 6px;border-radius:8px;" +
        "background:#0b5cab;color:#fff;font-size:11px;font-weight:600;line-height:14px;" +
        "vertical-align:middle;font-family:Arial,Helvetica,sans-serif;white-space:nowrap;";
      el.appendChild(badge);
    }
    badge.textContent = name;
    badge.title = `Salesforce match: ${name}`;
  }

  const inFlight = new Map(); // phone -> Promise<match|null>

  function lookup(phone) {
    if (inFlight.has(phone)) return inFlight.get(phone);
    const p = new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "LOOKUP_PHONE", phone }, (resp) => {
          if (chrome.runtime.lastError) {
            console.warn("[CallerID] sendMessage error:", chrome.runtime.lastError.message);
            resolve(null);
            return;
          }
          if (!resp || !resp.ok) {
            if (resp && resp.error) console.warn("[CallerID] lookup error:", resp.error);
            resolve(null);
            return;
          }
          resolve(resp.match || null);
        });
      } catch (e) {
        console.warn("[CallerID] sendMessage threw:", e);
        resolve(null);
      }
    });
    inFlight.set(phone, p);
    // Re-allow after 60s so retries can pick up new data.
    setTimeout(() => inFlight.delete(phone), 60000);
    return p;
  }

  // ---- DOM scanning ----------------------------------------------------------

  function scanActiveInteraction(root) {
    const sels = [
      ".interaction-data.call-remotename",
      ".interaction-data.salesforce-displayaddress",
      ".interaction-name"
    ];
    for (const sel of sels) {
      root.querySelectorAll(sel).forEach((el) => {
        const phone = extractTenDigit(el.textContent);
        if (!phone) return;
        lookup(phone).then((m) => {
          if (m && m.name) annotate(el, m.name);
        });
      });
    }
    root.querySelectorAll("[aria-label*='tel:']").forEach((el) => {
      const phone = extractTenDigit(el.getAttribute("aria-label"));
      if (!phone) return;
      lookup(phone).then((m) => {
        if (m && m.name) annotate(el, m.name);
      });
    });
  }

  // For the inbox / call-history list, find every text node containing a phone number
  // and annotate its parent element. We dedupe per parent so we don't paint twice.
  function scanTextNodes(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
        if (!PHONE_RE.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.closest("." + BADGE_CLASS)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const seen = new Set();
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const phone = extractTenDigit(node.nodeValue);
      if (!phone) continue;
      const parent = node.parentElement;
      if (!parent) continue;
      const key = parent;
      if (seen.has(key)) continue;
      seen.add(key);
      lookup(phone).then((m) => {
        if (m && m.name) annotate(parent, m.name);
      });
    }
  }

  let scheduled = false;
  function scheduleScan() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      try {
        scanActiveInteraction(document);
        scanTextNodes(document.body || document.documentElement);
      } catch (e) {
        console.warn("[CallerID] scan failed", e);
      }
    }, 200);
  }

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });

  // Also scan periodically as a safety net for frameworks that mutate via canvas/shadow.
  setInterval(scheduleScan, 3000);
  scheduleScan();
})();
