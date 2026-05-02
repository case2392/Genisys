// Runs in the Salesforce page and inside the Genesys widget iframe (all_frames: true).
// Watches for phone-number-bearing DOM nodes, asks the background worker to look them
// up in Salesforce, and annotates the node with the matched record name.

(() => {
  const PHONE_RE = /(?:tel:)?\+?1?[\s().-]*\d{3}[\s().-]*\d{3}[\s().-]*\d{4}/;
  const ANNOTATED = "data-callerid-annotated";
  const TARGET_SELECTORS = [
    ".interaction-data.call-remotename",      // active interaction
    ".interaction-data.salesforce-displayaddress",
    ".interaction-name",
    // Inbox / call-history rows in the Genesys widget. These rows are <li> or <div>
    // containing the number as the first text line. We narrow to anything with a
    // tel: link or a visible E.164 number.
    "[class*='conversation']",
    "[class*='interaction-list']",
    "[class*='history']"
  ];

  function extractTenDigit(text) {
    if (!text) return null;
    const m = String(text).match(PHONE_RE);
    if (!m) return null;
    const digits = m[0].replace(/\D+/g, "");
    if (digits.length === 10) return digits;
    if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
    return null;
  }

  function looksLikeJustAPhoneNumber(text) {
    // Avoid annotating rows that already show a name (e.g. "Asheville NC").
    // We only annotate when the visible text is essentially the number alone.
    const t = String(text || "").trim();
    if (!t) return false;
    const stripped = t.replace(/^tel:/i, "").replace(/[\s+().\-]/g, "");
    return /^\d{10,11}$/.test(stripped);
  }

  function annotate(el, name) {
    if (!el || el.getAttribute(ANNOTATED) === name) return;
    el.setAttribute(ANNOTATED, name);
    // Find or create a small badge appended to the element.
    let badge = el.querySelector(":scope > .callerid-badge");
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "callerid-badge";
      badge.style.cssText =
        "display:inline-block;margin-left:6px;padding:1px 6px;border-radius:8px;" +
        "background:#0b5cab;color:#fff;font-size:11px;font-weight:600;line-height:14px;" +
        "vertical-align:middle;font-family:Arial,Helvetica,sans-serif;";
      el.appendChild(badge);
    }
    badge.textContent = name;
    badge.title = `Salesforce match: ${name}`;
  }

  const inFlight = new Set();

  function lookupAndAnnotate(el, phone) {
    const key = `${phone}|${el.getAttribute && el.getAttribute("id") || ""}`;
    if (inFlight.has(key)) return;
    inFlight.add(key);
    try {
      chrome.runtime.sendMessage({ type: "LOOKUP_PHONE", phone }, (resp) => {
        inFlight.delete(key);
        if (chrome.runtime.lastError) return;
        if (!resp || !resp.ok) return;
        if (resp.match && resp.match.name) annotate(el, resp.match.name);
      });
    } catch (_) {
      inFlight.delete(key);
    }
  }

  function scanInteractionTargets(root) {
    // Active interaction: replace tel:+... with the matched name when found.
    const sels = [
      ".interaction-data.call-remotename",
      ".interaction-data.salesforce-displayaddress",
      ".interaction-name"
    ];
    for (const sel of sels) {
      const nodes = root.querySelectorAll ? root.querySelectorAll(sel) : [];
      nodes.forEach((el) => {
        const phone = extractTenDigit(el.textContent);
        if (phone) lookupAndAnnotate(el, phone);
      });
    }
    // aria-label on the parent .interactions sometimes carries the number when the
    // inner text is hidden. Use it as a fallback.
    const ariaNodes = root.querySelectorAll ? root.querySelectorAll("[aria-label*='tel:']") : [];
    ariaNodes.forEach((el) => {
      const phone = extractTenDigit(el.getAttribute("aria-label"));
      if (phone) lookupAndAnnotate(el, phone);
    });
  }

  function scanHistoryRows(root) {
    // Walk leaf-ish elements whose visible text is essentially a phone number.
    const all = root.querySelectorAll ? root.querySelectorAll("span, div, a, li") : [];
    for (const el of all) {
      // Skip nodes that contain other element children we'd descend into.
      if (el.children && el.children.length > 1) continue;
      const txt = el.textContent;
      if (!looksLikeJustAPhoneNumber(txt)) continue;
      const phone = extractTenDigit(txt);
      if (!phone) continue;
      lookupAndAnnotate(el, phone);
    }
  }

  let scheduled = false;
  function scheduleScan() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      try {
        scanInteractionTargets(document);
        scanHistoryRows(document);
      } catch (e) {
        console.warn("[CallerID] scan failed", e);
      }
    }, 150);
  }

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });
  scheduleScan();
})();
