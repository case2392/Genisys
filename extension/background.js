// Service worker: handles Salesforce REST API lookups using the user's existing session.
// Auth strategy: read the `sid` cookie from the My Domain (.my.salesforce.com) and use
// it as a Bearer token against the REST API on the same host. No Connected App needed.

const DEFAULTS = {
  myDomainHost: "zillowhomeloans.my.salesforce.com",
  apiVersion: "v59.0",
  // Object name -> array of phone fields to match. Loan__c is custom; adjust if needed.
  objects: [
    { sobject: "Lead",     nameField: "Name",                    phoneFields: ["Phone", "MobilePhone"] },
    { sobject: "Contact",  nameField: "Name",                    phoneFields: ["Phone", "MobilePhone"] },
    { sobject: "Loan__c",  nameField: "Name",                    phoneFields: ["Phone__c", "Mobile__c"] }
  ],
  cacheTtlMs: 5 * 60 * 1000
};

async function getConfig() {
  const stored = await chrome.storage.sync.get(["myDomainHost", "apiVersion", "objects", "cacheTtlMs"]);
  return { ...DEFAULTS, ...stored };
}

async function getSessionId(host) {
  // The `sid` cookie on *.my.salesforce.com is the session token usable as Bearer.
  const cookie = await chrome.cookies.get({ url: `https://${host}`, name: "sid" });
  return cookie ? cookie.value : null;
}

// In-memory cache: phoneDigits -> { value: {name, sobject, id} | null, expires }
const cache = new Map();

function normalize(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D+/g, "");
  if (!digits) return null;
  // Strip leading US country code 1 if 11-digit
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

function escapeSoql(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

// Build LIKE patterns that match common SF phone formats for the same 10-digit number.
function phoneVariants(tenDigit) {
  const a = tenDigit.slice(0, 3);
  const b = tenDigit.slice(3, 6);
  const c = tenDigit.slice(6);
  return [
    tenDigit,                        // 4028533161
    `1${tenDigit}`,                  // 14028533161
    `+1${tenDigit}`,                 // +14028533161
    `+1 ${a} ${b} ${c}`,             // +1 402 853 3161
    `+1 ${a}-${b}-${c}`,             // +1 402-853-3161
    `${a}-${b}-${c}`,                // 402-853-3161
    `(${a}) ${b}-${c}`,              // (402) 853-3161
    `${a}.${b}.${c}`,                // 402.853.3161
    `${a} ${b} ${c}`                 // 402 853 3161
  ];
}

async function querySalesforce(host, apiVersion, sid, soql) {
  const url = `https://${host}/services/data/${apiVersion}/query/?q=${encodeURIComponent(soql)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${sid}`, Accept: "application/json" }
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`SF ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function lookupPhone(tenDigit) {
  const cached = cache.get(tenDigit);
  if (cached && cached.expires > Date.now()) return cached.value;

  const cfg = await getConfig();
  const sid = await getSessionId(cfg.myDomainHost);
  if (!sid) {
    return { error: "No Salesforce session. Log into Salesforce in this browser." };
  }

  const variants = phoneVariants(tenDigit).map(escapeSoql);
  const variantsList = variants.map(v => `'${v}'`).join(", ");

  let best = null;

  for (const obj of cfg.objects) {
    const phoneClauses = obj.phoneFields.map(f => `${f} IN (${variantsList})`).join(" OR ");
    const soql =
      `SELECT Id, ${obj.nameField}, ${obj.phoneFields.join(", ")}, LastModifiedDate ` +
      `FROM ${obj.sobject} WHERE ${phoneClauses} ORDER BY LastModifiedDate DESC LIMIT 1`;
    try {
      const data = await querySalesforce(cfg.myDomainHost, cfg.apiVersion, sid, soql);
      const rec = data.records && data.records[0];
      if (rec) {
        const candidate = {
          name: rec[obj.nameField],
          sobject: obj.sobject,
          id: rec.Id,
          lastModified: rec.LastModifiedDate
        };
        if (!best || (candidate.lastModified || "") > (best.lastModified || "")) {
          best = candidate;
        }
      }
    } catch (e) {
      // Custom object may not exist for some orgs; skip silently.
      if (!String(e.message).includes("400") && !String(e.message).includes("404")) {
        console.warn("[CallerID] SF query failed for", obj.sobject, e.message);
      }
    }
  }

  const value = best || null;
  cache.set(tenDigit, { value, expires: Date.now() + cfg.cacheTtlMs });
  return value;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "LOOKUP_PHONE") {
    const ten = normalize(msg.phone);
    if (!ten || ten.length !== 10) {
      sendResponse({ ok: true, match: null });
      return false;
    }
    lookupPhone(ten).then(
      (match) => sendResponse({ ok: true, match }),
      (err) => sendResponse({ ok: false, error: String(err && err.message || err) })
    );
    return true; // async response
  }
  if (msg && msg.type === "CLEAR_CACHE") {
    cache.clear();
    sendResponse({ ok: true });
    return false;
  }
  return false;
});
