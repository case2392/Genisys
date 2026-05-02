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

**"No Salesforce session" error in service-worker console**
You're not logged into the My Domain that's configured in options. Open
`https://<your-host>.my.salesforce.com` in a tab to refresh the cookie.

**Salesforce returns 401**
The session expired. Log in again; the cookie refreshes automatically.

**Custom Loan object name is different**
Edit the Objects JSON in options to use the correct API name (e.g.
`Mortgage_Loan__c`) and field names.
