const DEFAULTS = {
  myDomainHost: "zillowhomeloans.my.salesforce.com",
  apiVersion: "v59.0",
  objects: [
    { sobject: "Lead",    nameField: "Name", phoneFields: ["Phone", "MobilePhone"] },
    { sobject: "Contact", nameField: "Name", phoneFields: ["Phone", "MobilePhone"] },
    { sobject: "Loan__c", nameField: "Name", phoneFields: ["Phone__c", "Mobile__c"] }
  ],
  cacheTtlMs: 300000
};

const $ = (id) => document.getElementById(id);

async function load() {
  const cfg = { ...DEFAULTS, ...(await chrome.storage.sync.get(Object.keys(DEFAULTS))) };
  $("myDomainHost").value = cfg.myDomainHost;
  $("apiVersion").value = cfg.apiVersion;
  $("objects").value = JSON.stringify(cfg.objects, null, 2);
  $("cacheTtlMs").value = cfg.cacheTtlMs;
}

function setStatus(msg, ok = true) {
  const el = $("status");
  el.textContent = msg;
  el.style.color = ok ? "#0a7d2c" : "#b00020";
  setTimeout(() => { el.textContent = ""; }, 3000);
}

$("save").addEventListener("click", async () => {
  let objects;
  try {
    objects = JSON.parse($("objects").value);
    if (!Array.isArray(objects)) throw new Error("Objects must be an array");
  } catch (e) {
    setStatus("Invalid Objects JSON: " + e.message, false);
    return;
  }
  await chrome.storage.sync.set({
    myDomainHost: $("myDomainHost").value.trim(),
    apiVersion: $("apiVersion").value.trim() || "v59.0",
    objects,
    cacheTtlMs: parseInt($("cacheTtlMs").value, 10) || 300000
  });
  chrome.runtime.sendMessage({ type: "CLEAR_CACHE" }, () => {});
  setStatus("Saved.");
});

$("clearCache").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "CLEAR_CACHE" }, () => setStatus("Cache cleared."));
});

load();
