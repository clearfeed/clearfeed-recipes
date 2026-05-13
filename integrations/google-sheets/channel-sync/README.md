# ClearFeed Channel Sync for Google Sheets

A Google Apps Script that syncs collection-to-channel mappings from a Google Sheet to ClearFeed. This allows you to bulk manage which Slack channels belong to which ClearFeed collections.

The script supports two operational modes:
- **Legacy mode** (`IS_ON_CUSTOMER_INBOX_MODEL: false`) - Manages Collection-to-Channel mappings directly
- **Customer-Centric Inbox mode** (`IS_ON_CUSTOMER_INBOX_MODEL: true`) - Manages Customer-to-Channel-to-Collection mappings

## Features

- **Bulk channel management** - Add, move, or remove multiple channels at once
- **Plan preview** - See exactly what changes will be made before executing
- **Safe by default** - Channel deletion is disabled by default (must be explicitly enabled)
- **Non-interactive mode support** - Works with Google Sheets triggers for automation
- **Flexible configuration** - All settings managed in the sheet itself
- **Populate initial mappings** - Fetch existing mappings from ClearFeed to seed the sheet
- **Email notifications** - Optional email alerts on sync completion

## Prerequisites

Before you begin, make sure you have:

1. **A Google Account** with access to Google Sheets and Google Apps Script
2. **A ClearFeed API Token** (see [Personal Access Token](https://docs.clearfeed.ai/clearfeed-help-center/account-setup/developer-settings#personal-access-token))

## Quick Start Guide

### Step 1: Create a Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com) and create a new sheet
2. (Optional) Rename the sheet tab - if you have only one sheet, the script will use it automatically

### Step 2: Open Apps Script Editor

1. In your Google Sheet, go to **Extensions** > **Apps Script**
2. A new tab will open with the Apps Script editor

### Step 3: Add the Script Code

1. Delete any default code in the editor
2. Copy the entire contents of `channel_sync.gs`
3. Paste it into the Apps Script editor
4. **Save** the project (Ctrl+S or Cmd+S)

### Step 4: Configure the Script

At the top of the script, update the `CONFIG` object:

```javascript
const CONFIG = {
  API_KEY: "",                          // Required: Replace with your ClearFeed API key
  SHEET_NAME: "Channel Mappings",       // Name of the sheet tab
  INCLUDE_DELETES: false,               // Whether to actually delete channels (default: false)
  SPREADSHEET_ID: "",                   // Leave empty to use current spreadsheet
  SET_OWNER: null,                      // Auto-derived: true for legacy, false for customer-centric
  IS_ON_CUSTOMER_INBOX_MODEL: true,     // true for Customer-Centric Inbox, false for legacy
};
```

**Required:**
- Set `API_KEY` to your ClearFeed API token
- Set `IS_ON_CUSTOMER_INBOX_MODEL` to match your ClearFeed account setup

**Optional:**
- Change `SHEET_NAME` if your spreadsheet has multiple sheets (if there's only one sheet, it's used automatically)
- Set `INCLUDE_DELETES` to `true` to enable channel deletion (use with caution!)
- Set `SPREADSHEET_ID` to use a different spreadsheet
- Set `SET_OWNER` explicitly to override the auto-derived default

### Step 5: Populate Initial Mappings

1. Go back to your Google Sheet
2. Refresh the page (a new menu should appear)
3. Click **ClearFeed Channel Sync** > **Populate Initial Mappings**
4. The sheet will be populated with existing mappings from ClearFeed

### Step 6: Test Connection

1. Click **ClearFeed Channel Sync** > **Test Connection**
2. You should see a success message with the number of collections found

### Step 7: Run the Sync

1. Click **ClearFeed Channel Sync** > **Sync Channels**
2. Review the sync plan that shows what will be added, moved, or removed
3. Click **Yes** to confirm and execute the plan

## Configuration Options

### API_KEY (Required)

Your ClearFeed API token (see [Personal Access Token](https://docs.clearfeed.ai/clearfeed-help-center/account-setup/developer-settings#personal-access-token)).

### IS_ON_CUSTOMER_INBOX_MODEL (Required)

Determines which mode the script operates in.

- **`true`** - Customer-Centric Inbox mode. Sheet format: Collection | Customer | Channel Name | Channel ID
- **`false`** - Legacy mode. Sheet format: Collection | Channel Name | Channel ID

### SHEET_NAME

The name of the sheet tab containing your channel mappings.

- **Default**: `"Channel Mappings"`
- **Example**: `"My Channels"`

**Note:** If your spreadsheet has only one sheet, the script will automatically use it regardless of its name. This setting is only needed when your spreadsheet contains multiple sheets.

### INCLUDE_DELETES

Whether to actually remove channels that are not in your sheet.

- **Default**: `false` (safe mode - channels are only added/moved, never removed)
- **Set to `true`**: Channels not in the sheet will be removed from ClearFeed

**Warning:** Enable this only if you want channels not in the sheet to be deleted from ClearFeed!

### SPREADSHEET_ID

Use this to sync from a different spreadsheet than where the script is installed.

- **Default**: `""` (use the current spreadsheet)
- **Example**: `"1BxiMvs0XRA5nFMdK..."` (found in the spreadsheet URL)

### SET_OWNER

Whether to set the owner field when adding channels.

- **Default**: `null` (auto-derived: `true` for legacy mode, `false` for customer-centric mode)
- In **legacy mode**: Owner is required and set on the channel object. Setting `false` explicitly will cause an error.
- In **customer-centric mode**: If enabled, owner is set inside the customer object during creation.

## Sheet Format

The sheet format depends on the operational mode.

### Legacy Mode (IS_ON_CUSTOMER_INBOX_MODEL: false)

| Column | Description | Required | Example |
|--------|-------------|----------|---------|
| Collection | ClearFeed collection name | Yes | Support |
| Channel Name | Slack channel name (for display only) | No | #support-tickets |
| Channel ID | Slack channel ID | Yes | C07AA9J9LJX |

### Customer-Centric Inbox Mode (IS_ON_CUSTOMER_INBOX_MODEL: true)

| Column | Description | Required | Example |
|--------|-------------|----------|---------|
| Collection | ClearFeed collection name | Yes | Support |
| Customer | Customer name | No | Acme Corp |
| Channel Name | Slack channel name (for display only) | No | #support-tickets |
| Channel ID | Slack channel ID | Yes | C07AA9J9LJX |

**Important:**
- The first row must contain headers
- Only **Collection** and **Channel ID** are required
- **Channel Name** and **Customer** are optional - used only for display
- Empty rows will be ignored
- Collection names are case-insensitive

## How to Find Channel IDs

### Method 1: From Slack
1. Right-click on the channel name in Slack
2. Select "Copy Link"
3. The URL contains the channel ID (e.g., `/archives/C07AA9J9LJX`)
4. The channel ID is the part after `/archives/`

### Method 2: From ClearFeed
1. Go to [app.clearfeed.ai](https://app.clearfeed.ai)
2. Navigate to **Collections**
3. Click on a collection to see its channels
4. Channel IDs are displayed next to channel names

## Menu Options

The **ClearFeed Channel Sync** menu provides the following options:

| Option | Description |
|--------|-------------|
| Populate Initial Mappings | Fetches existing mappings from ClearFeed and populates the sheet |
| Sync Channels | Reads the sheet, generates a plan, and syncs changes to ClearFeed |
| Test Connection | Validates your API token and shows collection count |
| View Logs | Instructions for viewing detailed logs |

## Understanding the Sync Plan

When you run "Sync Channels", you'll see a plan like this:

```
CHANNEL SYNC PLAN
==================

Channels to ADD: 2
   + #support-tickets (C07AA9J9LJX) → Support
   + #eng-help (C06BB9H9HKW) → Engineering

Channels to MOVE: 1
   ~ #sales-questions (C05CC8G8GJV)
     Support → Sales

Channels to REMOVE: 1
   - #old-channel (C04DD7F7FIU) from Support

WARNING: Deletes are SKIPPED (CONFIG.INCLUDE_DELETES = false)

SUMMARY:
  Add: 2
  Move: 1
  Remove: 1 (skipped)
```

### What Each Action Means

- **Add**: The channel doesn't exist in ClearFeed and will be added
- **Move**: The channel exists but is in a different collection; it will be moved
  - Legacy mode: moves the channel directly
  - Customer-centric mode: moves the customer (which owns the channel) to the new collection. If a customer has multiple channels, all of them must be moved to the same target collection — partial moves are not supported.
- **Remove**: The channel exists in ClearFeed but not in your sheet (see warning below)

### Collection Not Found Warning

If a collection name in your sheet doesn't exist in ClearFeed:

```
Collections NOT FOUND in ClearFeed:
   - Unknown Collection

Channels in these collections will be SKIPPED.
```

Fix this by correcting the collection name in your sheet.

## Use Cases

### 1. Initial Setup

First use the **Populate Initial Mappings** menu option to fetch existing mappings from ClearFeed. Then add new channels:

| Collection | Channel Name | Channel ID |
|------------|-------------|------------|
| Support | #support | C01AA0A0ATU |
| Support | #billing | C02BB1B1BUV |
| Engineering | #engineering | C03CC2C2CVW |

### 2. Reorganizing Collections

Moving channels between collections by updating the Collection column:

| Collection | Channel Name | Channel ID |
|------------|-------------|------------|
| Support | #general-help | C04DD3D3DX0 |

Running sync will move `#general-help` from its current collection to **Support**.

### 3. Removing Channels (with INCLUDE_DELETES=true)

To remove a channel from ClearFeed, simply delete its row from the sheet. When `INCLUDE_DELETES=true`, the channel will be removed from ClearFeed on the next sync.

## Setting Up Automatic Sync

You can set up a time-based trigger to run the sync automatically:

1. Open the Apps Script editor
2. Click the clock icon (Triggers) in the left sidebar
3. Click **+ Add Trigger**
4. Configure:
   - Function to run: `syncChannels` (legacy) or `syncCustomerCentricChanges` (customer-centric)
   - Event source: **Time-driven**
   - Type of time based trigger: **Hour timer** (or your preference)
   - Interval: **Every hour** (or your preference)
5. Click **Save**

**Note:** When running from a trigger, the confirmation dialog is skipped and the sync executes automatically.

## FAQ

### Q: What happens if I have the same channel in multiple rows?

A: The last occurrence in the sheet will determine which collection the channel belongs to.

### Q: Can I sync to multiple ClearFeed accounts?

A: No, the API key connects to a single ClearFeed account. For multiple accounts, create separate spreadsheets with different API keys.

### Q: My sync says "Collections NOT FOUND". What do I do?

A: Check that the collection names in your sheet exactly match the collection names in ClearFeed (case-insensitive, but spelling must match).

### Q: Can I undo a sync?

A: No, there's no automatic undo. However, you can manually reverse changes by updating the sheet and syncing again.

### Q: What happens if a channel ID is invalid?

A: Invalid channel IDs are logged and skipped. Check the logs for details.

### Q: Can I use this with Microsoft Teams instead of Slack?

A: This script is designed for Slack channel IDs. For Teams, you'd need to modify the channel ID format and API calls.

### Q: What if my sheet already has data when I try to Populate Initial Mappings?

A: The populate function will refuse to overwrite existing data. Clear the sheet data first, then run populate.

## Troubleshooting

### "Sheet 'Channel Mappings' not found"

**Solution:** If your spreadsheet has only one sheet, this error shouldn't occur. If you have multiple sheets, either:
- Rename one of your sheet tabs to match `CONFIG.SHEET_NAME`
- Update `CONFIG.SHEET_NAME` to match your existing sheet tab name

### "API request failed with status 401"

**Solution:** Your API token is invalid. Check `CONFIG.API_KEY` and get a fresh token from ClearFeed settings.

### "No channel mappings found in the sheet"

**Solution:** Ensure your sheet has at least one data row below the header row, and all required columns are filled.

### Sync doesn't execute when run from a trigger

**Solution:** This is expected behavior - triggers run non-interactively and skip the confirmation dialog. Check the logs to see execution results.

### Collections not found warning

**Solution:** Verify the exact spelling of collection names in ClearFeed. The comparison is case-insensitive but must match otherwise.

### "CONFIG.SET_OWNER must be true in legacy mode"

**Solution:** In legacy mode, the owner field is required when adding channels. Either leave `SET_OWNER` as `null` (default) or set it explicitly to `true`.

## Data Structure

The script uses the ClearFeed REST API:

- **GET** `/collections?include=channels` - Fetch all collections with their channels
- **POST** `/collections/{id}/channels` - Add channels to a collection
- **PATCH** `/channels/{id}` - Move a channel to a different collection (legacy mode)
- **DELETE** `/channels/{id}` - Remove a channel

Customer-Centric Inbox mode additionally uses:

- **GET** `/customers` - Fetch all customers (with pagination)
- **PATCH** `/customers/{id}` - Move a customer to a different collection

For full API documentation, see [ClearFeed API Docs](https://docs.clearfeed.ai/api).

## Security Notes

1. **API Key Protection**: Your API key is stored in the script code. Anyone with edit access to the spreadsheet can see it.
2. **Permissions**: The script requires permission to access your spreadsheet and make external HTTP requests.
3. **Logs**: API calls and data are logged in the Apps Script logger, which can be viewed by anyone with edit access.

**Best Practices:**
- Don't share your spreadsheet publicly
- Consider creating a service account with limited permissions
- Regularly rotate your API token

## Support and Customization

For issues, questions, or customization requests:
- Check the [ClearFeed documentation](https://docs.clearfeed.ai)
- Review the script comments for detailed implementation notes
- Check the Apps Script logs for detailed error messages

## License

This integration is provided as open source under the same license as the clearfeed-recipes repository.
