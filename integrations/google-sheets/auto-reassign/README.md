# ClearFeed Auto-Reassignment for Unassigned Requests

Automatically pick up ClearFeed requests that are still **Open and unassigned** and run them back through your Collection's assignment rules (rotation / round-robin) so they get assigned to an available agent.

This is useful when requests arrive **outside working hours** or when no one is on shift: instead of sitting unassigned indefinitely, they are retried on a schedule and get assigned as soon as an eligible agent is available.

The script runs from a Google Sheet. You can trigger it manually from a menu, or enable an automatic run every few hours.

## How It Works

Each run (manual or scheduled) does the following, in order:

1. **Finds** requests that are **Open** with **no assignee and no assigned team**, created within the last `LOOKBACK_DAYS` days (optionally limited to specific Collections), and writes them to the results tab.
2. **Reassigns** each one by triggering your ClearFeed reassignment automation — ClearFeed itself decides who the request goes to, using your existing rotation / round-robin rules. Rows that already have an assignee are skipped. If the first few calls all fail (see `ABORT_IF_FIRST_N_FAIL`), the run stops.
3. **Updates** the `assignee` column. The automation runs asynchronously, so the tool waits a few seconds (`REFRESH_SETTLE_MS`) and then re-reads each request from ClearFeed.
4. **Emails you** (if `EMAIL_CONFIG.TO` is set) when any reassignment call failed.

> **Important:** The tool does not choose who gets a request. It simply asks ClearFeed to re-run assignment. If no agent is currently available (outside business hours, everyone away, or an empty rotation), nothing will be assigned on that run — the requests stay unassigned and are picked up on the next run when an agent is available. This is expected behaviour.

> **Note:** Only requests **created** within the last `LOOKBACK_DAYS` days are considered. An Open, unassigned request older than that is not picked up — increase `LOOKBACK_DAYS` if you need to catch older ones.

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

> The script must be opened this way (from inside the sheet it should write to). A standalone Apps Script project that isn't attached to a spreadsheet will not work.

### Step 4: Add the Script

1. In the Apps Script editor, delete any existing code in the default `Code.gs` file.
2. Copy the entire contents of the `auto_reassign.gs` file.
3. Paste it into the editor.
4. Click **Save** (💾) or press `Ctrl+S` / `Cmd+S`.

### Step 5: Configure the Script

At the top of the script is a `CONFIG` section. Fill in the required values:

```javascript
const CONFIG = {
  API_KEY: "",                          // Your ClearFeed API token
  AUTOMATION_ID: null,                  // Your reassignment automation ID (from Step 1)
  SHEET_NAME: "Reassignment Results",   // Tab where the latest run's results are written
  LOOKBACK_DAYS: 7,                     // Only requests created in the last N days are considered
  COLLECTION_INCLUDE: [],               // Collection names to run for; empty = all
  REASSIGN_DELAY_MS: 1000,              // Delay between calls (ms)
  ABORT_IF_FIRST_N_FAIL: 5,             // Stop the run if the first N webhook calls all fail (0 = disabled)
  REFRESH_SETTLE_MS: 3000,              // Wait before reading back who got assigned (ms)
  REFRESH_DELAY_MS: 300,                // Delay between read-back calls (ms)
  SYNC_INTERVAL_HOURS: 4,               // Scheduled-run frequency in hours (see allowed values below)
  TIMEZONE: "Asia/Kolkata",             // Timezone (used for log and email timestamps)
  LOG_SHEET_NAME: "Logs",               // Tab used for logging
  LOG_MAX_ROWS: 500                     // Max log rows to keep
};

const EMAIL_CONFIG = {
  TO: "",                                       // Recipient for failure alerts (empty = no emails)
  FROM: "noreply@example.com",                  // Sender address (must be a Gmail alias of yours)
  SUBJECT_PREFIX: "ClearFeed Auto-Reassign - ", // Prefix for email subject lines
  SENDER_NAME: "ClearFeed Auto-Reassign"        // Display name for the sender
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

If you later set `EMAIL_CONFIG.TO`, Google will ask you to approve an additional email-sending permission the first time a run tries to send an alert.

### Step 7: Use It

1. Go back to your Google Sheet and reload the page.
2. You'll see a new **"ClearFeed Reassign"** menu in the menu bar.
3. Click **▶️ Run Now** to run it once and confirm everything works.

## Using the Menu

Once set up, the **"ClearFeed Reassign"** menu gives you:

- **▶️ Run Now** — the full run: fetches the current unassigned requests (overwriting the results tab), reassigns them, and updates the assignees. Same as a scheduled run. Best for testing.
- **📥 Preview Unassigned Requests** — fetches the current unassigned requests into the results tab (overwriting it) **without reassigning anything**. Use it to see what a run would pick up.
- **🔁 Reassign Unassigned Requests** — reassigns the requests **already listed in the results tab**, without fetching again, and then refreshes the assignees. Rows that already have an assignee are skipped and marked `SKIPPED (already assigned)`, so it is safe to run more than once. It trusts what the tab currently shows, so if the tab is old, run **Preview** or **Refresh Assignees** first. It does not send failure emails.
- **🔃 Refresh Assignees** — re-reads each listed request from ClearFeed and updates the `assignee` column, without reassigning (useful if an assignment was still completing when the tab last updated).
- **⏰ Enable Scheduled Runs** — turns on automatic runs every `SYNC_INTERVAL_HOURS` hours.
- **⏹️ Disable Scheduled Runs** — turns off automatic runs.
- **📋 View Logs** — shows the 20 most recent log entries.
- **🧹 Clear Logs** — clears the log history.

## The Results Tab

The tab named by `SHEET_NAME` (default **Reassignment Results**) is created automatically the first time the tool runs. It shows **the latest run only**:

- It is **cleared and rewritten** by every **Run Now**, every scheduled run, and every **Preview**. Don't keep notes or extra columns there — they will be wiped.
- Each row is one request found by that run: `id`, `title`, `state`, `assignee`, `collection`, `created_at`, `url`, `reassign_result`.
- `assignee` starts as "Unassigned" and is updated after the run to the agent's name (or `Team: <name>`). Requests nobody was available to take still show "Unassigned".
- `reassign_result` shows the outcome for each request:
  - `OK (200)` — the reassign call was accepted (this does not by itself mean someone was assigned — see the `assignee` column).
  - `FAIL (<code>): …` or `ERROR: …` — the call failed.
  - `SKIPPED (already assigned)` — the row already had an assignee when **Reassign Unassigned Requests** was run.
  - `SKIPPED (aborted after repeated failures)` — the run stopped early (see `ABORT_IF_FIRST_N_FAIL`).
- If a run finds nothing, the tab shows only the header and a note saying no unassigned Open requests were found.

The separate **Logs** tab keeps a running history across runs (trimmed to `LOG_MAX_ROWS`) and is only cleared by **Clear Logs**.

## Configuration Options Explained

### API_KEY
Your ClearFeed API token. Required, and must be kept secure.

### AUTOMATION_ID
The ID of your ClearFeed reassignment automation (from Step 1). This tells the tool which automation to trigger for each request.

### LOOKBACK_DAYS
Only requests **created** within this many days are considered (it is based on creation date, not on how long a request has been unassigned). Default is **7** days. Increase it to catch older unassigned requests; decrease it for faster runs.

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
How often scheduled runs happen, in hours. Because of a Google Apps Script limitation, the value **must be one of**: `1`, `2`, `4`, `6`, `8`, or `12`. Default is **4**.

For shift coverage, every **2** or **4** hours works well — frequent enough that a request left unassigned outside working hours gets picked up soon after an agent is back online.

### SHEET_NAME
The tab where the latest run's results are written. Default is "Reassignment Results". It is created if it doesn't exist and **cleared on every run** (see [The Results Tab](#the-results-tab)). The name must match exactly (it is case-sensitive); a differently-named tab is ignored and a new one is created.

### TIMEZONE
Used for timestamps in the Logs tab and in alert emails. Set it to your local timezone (e.g. `"Asia/Kolkata"`, `"America/New_York"`).

### EMAIL_CONFIG (failure alerts)
Set `EMAIL_CONFIG.TO` to an email address to get an alert after any run in which **at least one reassignment call failed**. Runs with no failures send nothing. Leave `TO` empty to disable emails.

- The email lists the number of requests found, succeeded and failed, each failed request with its error, and (if the run was aborted) how many requests were not attempted.
- It is sent for **▶️ Run Now** and scheduled runs, but not for **🔁 Reassign Unassigned Requests**.
- `FROM` must be one of your own Gmail "send as" aliases. If it isn't, the email is still sent, but from your own address.
- The first time an email is sent, Google will ask you to approve email-sending permission.
- A request that was accepted but left unassigned (no agent available) is not a failure and does not trigger an email.

### Advanced (usually leave as default)
- **REASSIGN_DELAY_MS** — pause between reassignment calls. Apps Script stops a run after about 6 minutes, so a very large backlog may not finish in one run; the rest is picked up on the next run.
- **ABORT_IF_FIRST_N_FAIL** — if the first N webhook calls all fail (e.g. wrong API key or automation ID), the run stops, logs an error, and marks the remaining requests `SKIPPED (aborted after repeated failures)`. If any of those first calls succeeds, the run continues normally. Set to `0` to disable.
- **REFRESH_SETTLE_MS** — how long to wait after reassigning before reading back who got assigned (assignment happens asynchronously).
- **REFRESH_DELAY_MS** — pause between read-back calls.
- **LOG_SHEET_NAME** / **LOG_MAX_ROWS** — logging tab name and how many rows to keep.

## Understanding the Runs

### Manual runs
Use **▶️ Run Now** any time to fetch, reassign, and update in one go. Good for testing and one-off cleanups. It overwrites the results tab.

### Scheduled runs
Once you enable **⏰ Enable Scheduled Runs**, the tool runs on its own every `SYNC_INTERVAL_HOURS` hours. This is what keeps unassigned requests from piling up outside working hours — each run retries them, and they get assigned as soon as an agent is available. A scheduled run is identical to **Run Now**, and each one overwrites the results tab.

If you change `SYNC_INTERVAL_HOURS`, click **⏹️ Disable Scheduled Runs** and then **⏰ Enable Scheduled Runs** again to apply the new frequency.

## Frequently Asked Questions

### Q: The run shows success but the requests are still unassigned. Why?
**A:** This almost always means no agent was available at that moment — for example, outside business hours, everyone marked away, or an empty rotation. The tool asks ClearFeed to assign, but ClearFeed can only assign to someone who is available. The requests stay unassigned and will be picked up on the next run when an agent is on. When this happens, a note explaining it is written to the **Logs** tab (viewable via **📋 View Logs**).

### Q: Can I run this for only some of my Collections?
**A:** Yes. Put the Collection names in `COLLECTION_INCLUDE` (see above). Leave it empty to run for all.

### Q: Is it safe to click Reassign Unassigned Requests more than once?
**A:** Yes. It works from the rows in the results tab and skips any that already have an assignee. Just note it does not re-fetch, so it can act on stale rows; run **Preview** or **Refresh Assignees** first if the tab is old.

### Q: Why did my results tab change / lose my edits?
**A:** The results tab is cleared and rewritten on every run and every Preview. It shows only the latest run — use the **Logs** tab for history.

### Q: How do I get notified when something goes wrong?
**A:** Set `EMAIL_CONFIG.TO`. You'll get an email after any run where a reassignment call failed (see [EMAIL_CONFIG](#email_config-failure-alerts)).

### Q: How often does it run automatically?
**A:** Every `SYNC_INTERVAL_HOURS` hours once you enable **⏰ Enable Scheduled Runs**. Allowed values are 1, 2, 4, 6, 8, or 12.

### Q: How do I stop automatic runs?
**A:** Use **⏹️ Disable Scheduled Runs**. You can still run manually with **▶️ Run Now**.

### Q: How do I troubleshoot a run?
**A:** Open **📋 View Logs** (or the "Logs" tab) to see what happened, including any warnings. You can also check the Apps Script execution logs in the editor.

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

**The run stopped early with "first N webhook call(s) all failed"**
- The first calls all failed, so the run stopped instead of trying every request. Check the Logs tab and the `reassign_result` column for the error (e.g. 401/403 = bad `API_KEY`; 404 = wrong `AUTOMATION_ID`). The remaining rows are marked `SKIPPED (aborted after repeated failures)`.

**Rows say "SKIPPED (already assigned)"**
- Those rows already had an assignee when **Reassign Unassigned Requests** ran, so they were left alone. This is expected.

**I'm not getting failure emails**
- Make sure `EMAIL_CONFIG.TO` is set, and that you approved the email permission. Emails are only sent when at least one call failed, and not for **Reassign Unassigned Requests**.
- Check the Logs tab for "Failure email skipped" or "Failed to send failure email".

**Permission errors**
- Re-run the permission grant, using the same Google account for both Sheets and Apps Script.

## Security Notes

- Keep your API token secure and don't share it. It is stored in plain text in the script, so anyone with edit access to the sheet's script can see it.
- The script runs in your own Google account; only you have access to it.
- Data is stored in your Google Sheet and follows Google's security policies.

## Support

For help or customization requests, contact ClearFeed support at [support@clearfeed.app](mailto:support@clearfeed.app).
