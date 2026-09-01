# ClearFeed Auto-Reassignment for Unassigned Requests

Automatically pick up ClearFeed requests that are still **Open and unassigned** and run them back through your Collection's assignment rules (rotation / round-robin) so they get assigned to an available agent.

This is useful when requests arrive **outside working hours** or when no one is on shift: instead of sitting unassigned indefinitely, they are retried on a schedule and get assigned as soon as an eligible agent is available.

The script runs from a Google Sheet. You can trigger it manually from a menu, or enable an automatic run every few hours.

## How It Works

The tool does three things in order:

1. **Finds** requests that are Open and have no assignee (within a configurable lookback window).
2. **Reassigns** each one by triggering your ClearFeed reassignment automation — ClearFeed itself decides who the request goes to, using your existing rotation / round-robin rules.
3. **Updates** the sheet to show who each request was assigned to.

> **Important:** The tool does not choose who gets a request. It simply asks ClearFeed to re-run assignment. If no agent is currently available (outside business hours, everyone away, or an empty rotation), nothing will be assigned on that run — the requests stay unassigned and are picked up on the next run when an agent is available. This is expected behaviour.

## Prerequisites

Before you begin, make sure you have:

1. **A Google Account** with access to Google Sheets and Google Apps Script.
2. **A ClearFeed API Token** — see [Personal Access Token](https://docs.clearfeed.ai/clearfeed-help-center/account-settings/developer-settings#personal-access-token).
3. **A Reassignment Automation set up in ClearFeed** with a "Webhook Call Received" trigger and a Reassign action (see Step 1 below). You will need its **Automation ID**.

## Quick Start Guide

### Step 1: Set Up the Reassignment Automation in ClearFeed

1. In the ClearFeed web app, create an **Automation** on the relevant Collection.
2. Set its trigger to **"Webhook Call Received"**.
3. Add a **Reassign** action that uses your Collection's assignment rules (rotation / round-robin).
4. Save it, and note the **Automation ID** — it appears in the automation's webhook URL, which looks like:
   ```
   https://web.clearfeed.app/api/v1/rest/automations/<AUTOMATION_ID>/trigger
   ```
   The number in place of `<AUTOMATION_ID>` is the value you'll need.

### Step 2: Create a New Google Sheet

1. Go to [Google Sheets](https://sheets.google.com).
2. Click **"+ Blank"** to create a new spreadsheet.
3. Give it a meaningful name like "ClearFeed Reassignment".

### Step 3: Open Google Apps Script

1. In your Google Sheet, click **Extensions** in the menu bar.
2. Select **Apps Script**.
3. The Apps Script editor opens in a new tab.

### Step 4: Add the Script

1. In the Apps Script editor, delete any existing code in the default `Code.gs` file.
2. Copy the entire contents of the `reassign_sync.gs` file.
3. Paste it into the editor.
4. Click **Save** (💾) or press `Ctrl+S` / `Cmd+S`.

### Step 5: Configure the Script

At the top of the script is a `REASSIGN_CONFIG` section. Fill in the required values:

```javascript
const REASSIGN_CONFIG = {
  API_KEY: "",                          // Your ClearFeed API token
  AUTOMATION_ID: 97,                    // Your reassignment automation ID (from Step 1)
  SHEET_NAME: "Unassigned Requests",    // Tab where results are written
  LOOKBACK_DAYS: 7,                     // How far back to look for unassigned requests
  COLLECTION_INCLUDE: [],               // Collection names to run for; empty = all
  REASSIGN_DELAY_MS: 1000,              // Delay between calls (ms)
  REFRESH_SETTLE_MS: 3000,              // Wait before reading back who got assigned (ms)
  REFRESH_DELAY_MS: 300,                // Delay between read-back calls (ms)
  SYNC_INTERVAL_HOURS: 4,               // Auto-run frequency (see allowed values below)
  TIMEZONE: "Asia/Kolkata",             // Timezone (used for log timestamps)
  LOG_SHEET_NAME: "Logs",               // Tab used for logging
  LOG_MAX_ROWS: 500                     // Max log rows to keep
};
```

**Required:**

- **API_KEY** — your ClearFeed API token.
- **AUTOMATION_ID** — the reassignment automation ID from Step 1.

Everything else has a sensible default and can be left as-is to start.

### Step 6: Grant Permissions

1. In the editor, select the **onOpen** function and click **Run** once (or just reload the sheet).
2. When Google asks for permissions, click **Review permissions**.
3. Choose your Google account.
4. If you see a warning screen, click **Advanced**, then **Go to [Your Project Name] (unsafe)**.
5. Click **Allow**.

### Step 7: Use It

1. Go back to your Google Sheet and reload the page.
2. You'll see a new **"ClearFeed Reassign"** menu in the menu bar.
3. Click **🔄 Sync Now** to run it once and confirm everything works.

## Using the Menu

Once set up, the **"ClearFeed Reassign"** menu gives you:

- **🔄 Sync Now** — find unassigned requests, reassign them, and update the sheet, all in one click. Best for testing.
- **📥 Fetch Unassigned Requests** — only fetch the current unassigned requests into the sheet (no reassignment).
- **🔁 Reassign Requests** — reassign the requests already listed in the sheet.
- **🔃 Refresh Assignees** — re-read the "assignee" column from ClearFeed (useful if an assignment was still completing when the sheet last updated).
- **⏰ Enable Auto Sync** — turn on automatic runs every few hours.
- **⏹️ Disable Auto Sync** — turn off automatic runs.
- **📋 View Recent Logs** — see the most recent run details and any warnings.
- **🧹 Clear Logs** — clear the log history.
- **♻️ Reset Sync** — clears the stored last-run timestamp.

## Configuration Options Explained

### API_KEY
Your ClearFeed API token. Required, and must be kept secure.

### AUTOMATION_ID
The ID of your ClearFeed reassignment automation (from Step 1). This tells the tool which automation to trigger for each request.

### LOOKBACK_DAYS
How far back the tool looks for unassigned Open requests. Default is **7** days. Increase it to catch older unassigned requests; decrease it for faster runs.

### COLLECTION_INCLUDE
Controls which Collections the tool runs for, **by name** (exactly as they appear in the ClearFeed web app):

- **Empty (`[]`)** — runs for **all** Collections.
- **A list of names** — runs **only** for those Collections. For example:
  ```javascript
  COLLECTION_INCLUDE: ["Enterprise Support", "Premium Customers"]
  ```
  This runs for just those two and ignores the rest.

Names are matched ignoring case and extra spaces. If a name doesn't match any Collection, it's skipped and noted in the logs.

### SYNC_INTERVAL_HOURS
How often the automatic sync runs, in hours. Because of a Google Apps Script limitation, the value **must be one of**: `1`, `2`, `4`, `6`, `8`, or `12`. Default is **4**.

For shift coverage, every **2** or **4** hours works well — frequent enough that a request left unassigned outside working hours gets picked up soon after an agent is back online.

### SHEET_NAME
The tab where results are written. Default is "Unassigned Requests".

### TIMEZONE
Used for timestamps in the Logs tab. Set it to your local timezone (e.g. `"Asia/Kolkata"`, `"America/New_York"`).

### Advanced (usually leave as default)
- **REASSIGN_DELAY_MS** — pause between reassignment calls.
- **REFRESH_SETTLE_MS** — how long to wait after reassigning before reading back who got assigned (assignment happens asynchronously).
- **REFRESH_DELAY_MS** — pause between read-back calls.
- **LOG_SHEET_NAME** / **LOG_MAX_ROWS** — logging tab name and how many rows to keep.

## Understanding the Runs

### Manual runs
Use **🔄 Sync Now** any time to fetch, reassign, and update in one go. Good for testing and one-off cleanups.

### Automatic runs
Once you enable **⏰ Enable Auto Sync**, the tool runs on its own every `SYNC_INTERVAL_HOURS` hours. This is what keeps unassigned requests from piling up outside working hours — each run retries them, and they get assigned as soon as an agent is available.

If you change `SYNC_INTERVAL_HOURS`, click **⏹️ Disable Auto Sync** and then **⏰ Enable Auto Sync** again to apply the new frequency.

## Frequently Asked Questions

### Q: The run shows success but the requests are still unassigned. Why?
**A:** This almost always means no agent was available at that moment — for example, outside business hours, everyone marked away, or an empty rotation. The tool asks ClearFeed to assign, but ClearFeed can only assign to someone who is available. The requests stay unassigned and will be picked up on the next run when an agent is on. When this happens, a note explaining it is written to the **Logs** tab (viewable via **📋 View Recent Logs**).

### Q: Can I run this for only some of my Collections?
**A:** Yes. Put the Collection names in `COLLECTION_INCLUDE` (see above). Leave it empty to run for all.

### Q: How often does it run automatically?
**A:** Every `SYNC_INTERVAL_HOURS` hours once you enable **⏰ Enable Auto Sync**. Allowed values are 1, 2, 4, 6, 8, or 12.

### Q: How do I stop automatic runs?
**A:** Use **⏹️ Disable Auto Sync**. You can still run manually with **🔄 Sync Now**.

### Q: How do I troubleshoot a run?
**A:** Open **📋 View Recent Logs** (or the "Logs" tab) to see what happened, including any warnings. You can also check the Apps Script execution logs in the editor.

## Troubleshooting

**"API request failed" / authorization errors**
- Verify your API token is correct and still valid.
- Confirm your ClearFeed account has API access.

**Nothing gets assigned (runs succeed but assignee stays empty)**
- Check whether an agent is on shift / available at run time (see the FAQ above).
- Confirm the reassignment automation (Step 1) has a working Reassign action.

**A Collection name isn't being picked up**
- Check the spelling against the name shown in the ClearFeed web app.
- Check the Logs tab — unmatched names are listed there.

**Permission errors**
- Re-run the permission grant, using the same Google account for both Sheets and Apps Script.

## Security Notes

- Keep your API token secure and don't share it.
- The script runs in your own Google account; only you have access to it.
- Data is stored in your Google Sheet and follows Google's security policies.

## Support

For help or customization requests, contact ClearFeed support at [support@clearfeed.app](mailto:support@clearfeed.app).
