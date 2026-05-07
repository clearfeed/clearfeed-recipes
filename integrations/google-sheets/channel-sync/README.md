# ClearFeed Channel Sync for Google Sheets

A Google Apps Script that syncs channel mappings from a Google Sheet to ClearFeed. This allows you to bulk manage channels in your ClearFeed account.

**Supports Two Models:**
1. **Customer-Centric Inbox Model** (New, default) - Syncs Customer → Channel mappings with auto-sync capabilities
2. **Legacy Model** - Syncs Collection → Channel mappings

## Features

- **Dual model support** - Works with both new Customer-Centric and legacy Collection-based models
- **Bulk channel management** - Add, move, or remove multiple channels at once
- **Plan preview** - See exactly what changes will be made before executing
- **Safe by default** - Channel deletion is disabled by default (must be explicitly enabled)
- **Auto-sync** - Automatic sync every 1 hour for Customer-Centric model
- **Non-interactive mode support** - Works with Google Sheets triggers for automation
- **Flexible configuration** - All settings managed in the script itself

## Prerequisites

Before you begin, make sure you have:

1. **A Google Account** with access to Google Sheets and Google Apps Script
2. **A ClearFeed API Token** (see [Personal Access Token](https://docs.clearfeed.ai/clearfeed-help-center/account-setup/developer-settings#personal-access-token))

## Choosing Your Model

### Customer-Centric Inbox Model (IS_ON_CUSTOMER_INBOX_MODEL = true)

Use this if your ClearFeed account uses the new Customer-Centric Inbox model where:
- Each customer object has exactly one Slack channel
- Customers can be moved between collections

**Features:**
- Initial sheet population from ClearFeed
- Auto-sync every 1 hour to reflect webapp changes
- Move entire customers to different collections
- Unmonitor channels (delete operation)

**Limitation:** Only supports customers with exactly 1 channel per customer.

### Legacy Model (IS_ON_CUSTOMER_INBOX_MODEL = false)

Use this if your ClearFeed account uses the traditional Collection → Channel model.

**Features:**
- Add channels to collections
- Move channels between collections
- Remove channels from collections

## Quick Start Guide

### Step 1: Create a Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com) and create a new sheet
2. (Optional) Rename the sheet tab - if you have only one sheet, the script will use it automatically
3. Add the following headers in the first row:

| Collection | Slack channel (optional) | Channel ID |
|------------|-------------------------|------------|
| *(your data)* | *(your data)* | *(your data)* |

4. Add your channel mapping data below the headers:
   - **Collection** (required): The name of the ClearFeed collection
   - **Slack channel** (optional): The name of the Slack channel - if not provided, it will be fetched from ClearFeed API
   - **Channel ID** (required): The Slack channel ID (e.g., `C07AA9J9LJX`)

Example data:

| Collection | Slack channel (optional) | Channel ID |
|------------|-------------------------|------------|
| Support | #support-tickets | C07AA9J9LJX |
| Engineering | | C06BB9H9HKW |
| Sales | sales-questions | C05CC8G8GJV |

**Note:** The "Slack channel" column is optional. Channel names are only used for display purposes in logs and messages. If not provided, the script will fetch channel names from ClearFeed API when available, or fall back to showing the channel ID.

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
  API_KEY: "", // Required: Replace with your ClearFeed API key
  SHEET_NAME: "Channel Mappings", // Name of the sheet tab
  INCLUDE_DELETES: false, // Whether to actually delete channels (default: false)
  SPREADSHEET_ID: "", // Leave empty to use current spreadsheet
  CREATE_EMPTY_CUSTOMER: false, // Legacy model only
  SET_OWNER: false, // Legacy model only
  IS_ON_CUSTOMER_INBOX_MODEL: true, // Set to true for Customer-Centric Model, false for Legacy
};
```

**Required:**
- Set `API_KEY` to your ClearFeed API token

**Model Selection:**
- Set `IS_ON_CUSTOMER_INBOX_MODEL` to `true` for Customer-Centric Inbox Model (default)
- Set `IS_ON_CUSTOMER_INBOX_MODEL` to `false` for Legacy Collection-Channel Model

**Optional:**
- Change `SHEET_NAME` if your spreadsheet has multiple sheets
- Set `INCLUDE_DELETES` to `true` to enable channel deletion/unmonitoring (use with caution!)
- Set `SPREADSHEET_ID` to use a different spreadsheet
- `CREATE_EMPTY_CUSTOMER` and `SET_OWNER` are legacy model options only

### Step 5: Test Connection

1. Go back to your Google Sheet
2. Refresh the page (a new menu should appear)
3. Click **Test Connection** from the appropriate menu:
   - For Customer-Centric Model: **👤 Customer Inbox Sync** > **🧪 Test Customer Connection**
   - For Legacy Model: **ClearFeed Channel Sync** > **🧪 Test Connection**
4. You should see a success message with your account details

### Step 6: Run the Sync

**For Customer-Centric Model:**

1. First-time setup: Click **👤 Customer Inbox Sync** > **📥 Populate Initial Mappings**
   - This validates that each customer has exactly 1 channel
   - Populates the sheet with current Customer → Channel mappings
   - Auto-sync trigger is enabled (runs every 1 hour)

2. To sync changes: Click **👤 Customer Inbox Sync** > **🔄 Sync Customer Changes**
   - Move customers to different collections
   - Unmonitor channels (if INCLUDE_DELETES=true)

**For Legacy Model:**

1. Click **ClearFeed Channel Sync** > **🔄 Sync Channels**
2. Review the sync plan that shows what will be added, moved, or removed
3. Click **Yes** to confirm and execute the plan

## Customer-Centric Inbox Model

### Sheet Format

| Collection | Customer | Channel Name | Channel ID |
|------------|----------|--------------|------------|
| Support | Acme Corp | #acme-support | C07AA9J9LJX |
| Sales | Startup Inc | #startup-sales | C06BB9H9HKW |

### Initial Population

When you run **📥 Populate Initial Mappings**, the script:

1. Fetches all customers from ClearFeed
2. Validates each customer has exactly 1 channel
3. Populates the sheet with current mappings
4. Sets up auto-sync (runs every 1 hour)

**Validation Rule:** If any customer has more than 1 channel, the script will error and terminate. Only customers with exactly 1 channel are supported.

### Sync Operations

**Move Customer:** Changes the collection for a customer (and its single channel)
- Update the **Collection** column in the sheet
- Run **🔄 Sync Customer Changes**
- The entire customer object moves to the new collection

**Unmonitor Channel:** Removes a channel from monitoring
- Delete the row from the sheet
- Run **🔄 Sync Customer Changes** (with INCLUDE_DELETES=true)
- The channel is marked as inactive in ClearFeed

**Auto-Sync:** Keeps the sheet updated with webapp changes
- Runs automatically every 1 hour
- Fetches latest customers and channels from ClearFeed
- Updates the sheet with current state

### Menu Options

| Option | Description |
|--------|-------------|
| 📥 Populate Initial Mappings | First-time setup: fetches customers and populates sheet |
| 🔄 Sync Customer Changes | Syncs your sheet changes to ClearFeed |
| ⏰ Setup Auto-Sync (1 hour) | Enables automatic sync every hour |
| 🛑 Stop Auto-Sync | Disables automatic sync |
| 🧪 Test Customer Connection | Validates API and shows customer statistics |

### Auto-Sync Behavior

After initial population, auto-sync runs every 1 hour to:
- Reflect new customers added via webapp
- Update collection changes made via webapp
- Show channels unmonitored via webapp

Changes made in the sheet are synced to ClearFeed when you run **🔄 Sync Customer Changes**.

## Configuration Options

### API_KEY (Required)

Your ClearFeed API token (see [Personal Access Token](https://docs.clearfeed.ai/clearfeed-help-center/account-setup/developer-settings#personal-access-token)).

### IS_ON_CUSTOMER_INBOX_MODEL (Model Selection)

Determines which sync model to use.

- **Default**: `true` (Customer-Centric Inbox Model)
- **Set to `false`**: Use Legacy Collection-Channel Model

**Note:** This is the most important configuration option. Set it based on your ClearFeed account type.

### SHEET_NAME

The name of the sheet tab containing your channel mappings.

- **Default**: `"Channel Mappings"`
- **Example**: `"My Channels"`

**Note:** If your spreadsheet has only one sheet, the script will automatically use it regardless of its name.

### INCLUDE_DELETES

Whether to actually remove channels that are not in your sheet.

- **Default**: `false` (safe mode - channels are only added/moved, never removed)
- **Set to `true`**: Channels not in the sheet will be removed/unmonitored in ClearFeed

**Warning:** Enable this only if you want channels not in the sheet to be deleted from ClearFeed!

### SPREADSHEET_ID

Use this to sync from a different spreadsheet than where the script is installed.

- **Default**: `""` (use the current spreadsheet)
- **Example**: `"1BxiMvs0XRA5nFMdK..."` (found in the spreadsheet URL)

### CREATE_EMPTY_CUSTOMER (Legacy Model Only)

Whether to create empty customer objects when adding channels.

- **Default**: `false`
- **Legacy Model Only**: This option has no effect in Customer-Centric mode

### SET_OWNER (Legacy Model Only)

Whether to set the owner field when adding channels.

- **Default**: `false`
- **Legacy Model Only**: This option has no effect in Customer-Centric mode

## Sheet Format

Your sheet must have the following columns:

| Column | Description | Required | Example |
|--------|-------------|----------|---------|
| Collection | ClearFeed collection name | Yes | Support |
| Slack channel | Slack channel name (for display only) | No | #support-tickets |
| Channel ID | Slack channel ID | Yes | C07AA9J9LJX |

**Important:**
- The first row must contain headers
- Only **Collection** and **Channel ID** are required
- The **Slack channel** column is optional - if not provided, channel names will be fetched from ClearFeed API automatically
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

### ClearFeed Channel Sync Menu (Always Available)

| Option | Description |
|--------|-------------|
| 🔄 Sync Channels | Main sync function (routes to appropriate model) |
| 🧪 Test Connection | Validates API token and shows account info |
| 📋 View Logs | Instructions for viewing detailed logs |

### 👤 Customer Inbox Sync Menu (Customer-Centric Model Only)

This menu appears only when `IS_ON_CUSTOMER_INBOX_MODEL = true`.

| Option | Description |
|--------|-------------|
| 📥 Populate Initial Mappings | First-time setup: fetches customers and populates sheet |
| 🔄 Sync Customer Changes | Syncs your sheet changes to ClearFeed |
| ⏰ Setup Auto-Sync (1 hour) | Enables automatic sync every hour |
| 🛑 Stop Auto-Sync | Disables automatic sync |
| 🧪 Test Customer Connection | Validates API and shows customer statistics |

## Understanding the Sync Plan

When you run "Sync Channels", you'll see a plan like this:

```
CHANNEL SYNC PLAN
==================

📝 Channels to ADD: 2
   + #support-tickets (C07AA9J9LJX) → Support
   + #eng-help (C06BB9H9HKW) → Engineering

🔄 Channels to MOVE: 1
   ~ #sales-questions (C05CC8G8GJV)
     Support → Sales

🗑️  Channels to REMOVE: 1
   - #old-channel (C04DD7F7FIU) from Support

⚠️  WARNING: Deletes are SKIPPED (CONFIG.INCLUDE_DELETES = false)

SUMMARY:
  Add: 2
  Move: 1
  Remove: 1 (skipped)
```

### What Each Action Means

- **Add**: The channel doesn't exist in ClearFeed and will be added
- **Move**: The channel exists but is in a different collection; it will be moved
- **Remove**: The channel exists in ClearFeed but not in your sheet (see warning below)

### Collection Not Found Warning

If a collection name in your sheet doesn't exist in ClearFeed:

```
⚠️  Collections NOT FOUND in ClearFeed:
   - Unknown Collection

Channels in these collections will be SKIPPED.
```

Fix this by correcting the collection name in your sheet.

## Use Cases

### 1. Initial Setup

Adding multiple channels to ClearFeed collections for the first time:

| Collection | Slack channel | Channel ID |
|------------|---------------|------------|
| Support | #support | C01AA0A0ATU |
| Support | #billing | C02BB1B1BUV |
| Engineering | #engineering | C03CC2C2CVW |

### 2. Reorganizing Collections

Moving channels between collections by updating the Collection column:

| Collection | Slack channel | Channel ID |
|------------|---------------|------------|
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
   - Function to run: `syncChannels`
   - Event source: **Time-driven**
   - Type of time based trigger: **Hour timer** (or your preference)
   - Interval: **Every hour** (or your preference)
5. Click **Save**

**Note:** When running from a trigger, the confirmation dialog is skipped and the sync executes automatically.

## FAQ

### Q: What happens if I have the same channel in multiple rows?

A: **Customer-Centric Model:** This shouldn't happen as each customer has exactly 1 channel. **Legacy Model:** The last occurrence in the sheet will determine which collection the channel belongs to.

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

### Q: What if my customer has more than 1 channel?

A: **Customer-Centric Model:** The script will throw a validation error and terminate. Only customers with exactly 1 channel are supported. You'll need to resolve this in the ClearFeed webapp first.

### Q: How do I switch between Customer-Centric and Legacy models?

A: Update the `IS_ON_CUSTOMER_INBOX_MODEL` flag in the CONFIG object. Set to `true` for Customer-Centric, `false` for Legacy. Refresh your Google Sheet to see the appropriate menu options.

### Q: What does auto-sync do?

A: In Customer-Centric mode, auto-sync runs every 1 hour to update the sheet with changes made via the ClearFeed webapp (new customers, collection changes, etc.). It does NOT sync changes from your sheet to ClearFeed - use **🔄 Sync Customer Changes** for that.

### Q: Can I add new customers via the sheet?

A: **Customer-Centric Model:** No. The ADD operation is not supported. New customers must be created via the ClearFeed webapp. The sheet can only move existing customers and unmonitor channels. **Legacy Model:** Yes, you can add new channels.

## Troubleshooting

### "Sheet 'Channel Mappings' not found"

**Solution:** If your spreadsheet has only one sheet, this error shouldn't occur. If you have multiple sheets, either:
- Rename one of your sheet tabs to match `CONFIG.SHEET_NAME`
- Update `CONFIG.SHEET_NAME` to match your existing sheet tab name

### "API request failed with status 401"

**Solution:** Your API token is invalid. Check `CONFIG.API_KEY` and get a fresh token from ClearFeed settings.

### "No channel mappings found in the sheet"

**Solution:** Ensure your sheet has at least one data row below the header row, and all required columns are filled.

### "Validation Error: customers with multiple channels found"

**Solution (Customer-Centric Model):** Some customers in your account have more than 1 channel. This script only supports customers with exactly 1 channel. Resolve this in the ClearFeed webapp by:
- Moving extra channels to different customers
- Or using the Legacy model instead

### Sync doesn't execute when run from a trigger

**Solution:** This is expected behavior - triggers run non-interactively and skip the confirmation dialog. Check the logs to see execution results.

### Collections not found warning

**Solution:** Verify the exact spelling of collection names in ClearFeed. The comparison is case-insensitive but must match otherwise.

### "Customer-Centric Inbox Model is not enabled"

**Solution:** You're trying to use Customer-Centric features but `IS_ON_CUSTOMER_INBOX_MODEL` is set to `false`. Update the CONFIG object and refresh the sheet.

### Auto-sync not running

**Solution:** Check that the trigger is properly set up:
1. Open Apps Script editor
2. Click the clock icon (Triggers)
3. Verify `autoSyncCustomerMappings` trigger exists
4. If not, run **⏰ Setup Auto-Sync (1 hour)** from the menu

## Data Structure

The script uses the ClearFeed REST API:

### Legacy Model Endpoints

- **GET** `/collections?include=channels` - Fetch all collections with their channels
- **POST** `/collections/{id}/channels` - Add channels to a collection
- **PATCH** `/channels/{id}` - Move a channel to a different collection
- **DELETE** `/channels/{id}` - Remove a channel

### Customer-Centric Model Endpoints

- **GET** `/collections?include=channels` - Fetch all collections with their channels
- **GET** `/customers` - Fetch all customers (with pagination)
- **PATCH** `/customers/{id}` - Move a customer to a different collection
- **DELETE** `/channels/{id}` - Unmonitor a channel (marks inactive)

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
