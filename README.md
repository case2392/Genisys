# Genesys Caller ID for Salesforce

A Chrome (Manifest V3) extension that watches the Genesys Cloud softphone widget
embedded in Salesforce, looks up the incoming caller's phone number against your
Salesforce org (Lead, Contact, Loan__c by default), and injects the matched
record's name as a badge next to the number.

No Salesforce admin work required — it reuses your existing Salesforce browser
session (the `sid` cookie on `*.my.salesforce.com`) as a Bearer token against
the REST API.

## Install (unpacked, just for you)

1. Open Chrome and go to `chrome://extensions`.
2. Toggle **Developer mode** on (top-right).
3. Click **Load unpacked** and select the `extension/` folder in this repo.
4. Pin the extension if you want quick access to its options page.

## Updating to a new version

If the version on the extension card in `chrome://extensions` doesn't match
the version inside `extension/manifest.json` after you "update", then the
files Chrome is reading from disk are NOT the ones you edited. Almost always
this is one of two problems:

- **(a) You replaced files in a different folder than the one Chrome is
  loading from.** When you downloaded a new copy from GitHub, it landed in a
  fresh folder (e.g. `Downloads/Genisys-main/extension/`), but Chrome is
  still loading from the original folder you picked the first time.
- **(b) You didn't click the reload icon on the extension card after editing
  the files.**

### Foolproof update procedure

1. Open `chrome://extensions`.
2. Find the **Genesys Caller ID for Salesforce** card. Click **Details**.
3. Look for the field labeled **"ID"** and below it **"Source"** with a path
   like `C:\Users\you\Downloads\Genisys\extension`. **Write that path down.**
   That is the only folder Chrome will read from.
4. Replace the files in **that exact folder** with the new ones. The fastest
   way:
   - Open the new download.
   - Copy `manifest.json`, `background.js`, `content.js`, `options.html`,
     `options.js` over the existing files in the path from step 3.
   - Open the path's `manifest.json` in Notepad / VS Code and confirm the
     `"version"` line says `"0.5.0"`. If it doesn't, you copied to the wrong
     folder.
5. Back in `chrome://extensions`, click the **circular reload icon** (🔄) in
   the lower-right corner of the extension card. The version on the card
   should immediately change to `0.5.0`. If it doesn't, step 4 went to the
   wrong folder.
6. Hard-reload the Salesforce tab (`Ctrl+Shift+R`).
7. Open DevTools on the Genesys widget iframe → Console. You should see:
   `[CallerID v0.5.0] content script loaded in …`. The version printed here
   must match the version on the card and the version in `manifest.json`. If
   any three disagree, the reload didn't pick up your changes — repeat from
   step 3.

### If the version on the card refuses to change

The cleanest reset:

1. On the extension card, click **Remove** to delete it from Chrome.
2. Click **Load unpacked** and select your **new** `extension/` folder
   (the one with `version: 0.5.0`).
3. Re-open Options and re-enter your config.

## First-time setup

1. Log into Salesforce normally in the same Chrome profile
   (`https://zillowhomeloans.lightning.force.com`). Stay logged in.
2. Right-click the extension icon → **Options** (or open it via
   `chrome://extensions` → Details → Extension options).
3. Confirm the **My Domain host** is `zillowhomeloans.my.salesforce.com`.
4. Adjust the **Objects** JSON if your custom Loan object isn't `Loan__c` or
   uses different phone field API names. The format is:
   ```json
   [
     { "sobject": "Lead",    "nameField": "Name", "phoneFields": ["Phone", "MobilePhone"] },
     { "sobject": "Contact", "nameField": "Name", "phoneFields": ["Phone", "MobilePhone"] },
     { "sobject": "Loan__c", "nameField": "Name", "phoneFields": ["Phone__c", "Mobile__c"] }
   ]
   ```
5. Save.

## How to test

1. With Salesforce open in the same browser, make or receive a test call
   through the Genesys widget.
2. While the interaction shows `tel:+1XXXXXXXXXX`, the extension should append
   a small blue badge with the matched record name (e.g. `Manoucheka Pierre`).
3. The same badge will appear next to numbers in the Genesys "User Inbox"
   call-history list.
4. If you don't see badges:
   - Open DevTools on the Salesforce page → Console. Look for `[CallerID]`
     messages.
   - Confirm `chrome://extensions` shows the extension as enabled with no
     errors. Click the **service worker** link there to inspect background logs.
   - Make sure you're logged into Salesforce in the same browser profile.
   - Hit the **Clear cache** button on the options page after changing config.

## Behavior

- Matches are cached in memory for 5 minutes.
- If multiple records match the same number across the configured objects, the
  one with the most recent `LastModifiedDate` wins.
- If no record matches, nothing is shown (no "Unknown caller" placeholder).
- Phone numbers are normalized to a 10-digit US form for matching, and the
  query tries common formats (`+14028533161`, `(402) 853-3161`, `402-853-3161`,
  etc.) so it works regardless of how numbers are stored in your org.

## Files

- `extension/manifest.json` — MV3 manifest, permissions, content-script matches.
- `extension/background.js` — Service worker; reads `sid` cookie, runs SOQL.
- `extension/content.js` — Runs on Salesforce + Genesys frames; scrapes DOM,
  injects badges.
- `extension/options.html` / `options.js` — Settings UI.

## Troubleshooting

After loading, **always** click "Reload" on the extension card in
`chrome://extensions` after pulling new code, then hard-reload the Salesforce
tab.

### Step 1 — confirm the content script is running in the widget

1. With Salesforce open, right-click directly on the green Genesys "Available"
   bar → **Inspect**.
2. In DevTools, switch to the **Console** tab.
3. Use the frame selector (the dropdown at the top-left of the Console, often
   showing "top") and pick the iframe whose URL includes either
   `visualforce.com`, `vf.force.com`, or `mypurecloud.com`.
4. You should see a line like `[CallerID] content script loaded in https://...`.
   - If you don't, the iframe URL isn't covered by `manifest.json` matches.
     Note the iframe's URL and add its host to `host_permissions` and
     `content_scripts.matches`.

### Step 2 — confirm the lookup is firing

In the same iframe console, you should see no errors when a call rings. In the
service-worker console (`chrome://extensions` → the extension → "service
worker" link), you should see lines like:

```
[CallerID:bg] LOOKUP_PHONE tel:+14028533161 -> 4028533161 from https://...
[CallerID:bg] result 4028533161 {name: "Manoucheka Pierre", sobject: "Lead", ...}
```

If you see `LOOKUP_PHONE` but no `result`, look for a "No sid cookie found"
warning — you need to be logged into the My Domain configured in Options.

### Common errors

- **"No Salesforce session"** — Log into
  `https://zillowhomeloans.my.salesforce.com` in the same Chrome profile.
- **`SF 401`** — Session expired. Refresh Salesforce.
- **`SF 400` for `Loan__c`** — Object/field name is wrong. Edit the Objects
  JSON in Options (e.g. change to `Mortgage_Loan__c`, `Borrower_Phone__c`).
- **Service worker has no log lines at all** — The content script isn't
  reaching the background, which almost always means the content script isn't
  running in the widget iframe. Do Step 1.
