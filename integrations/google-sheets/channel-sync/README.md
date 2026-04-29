# ClearFeed Channel Sync for Google Sheets

A Google Apps Script that syncs collection-to-customer-to-channel mappings from a Google Sheet to ClearFeed. This allows you to bulk manage which Slack channels belong to which customers in which ClearFeed collections, using the **Customer-Centric Inbox** model.

## Features

- **Bulk channel management** - Add, move, or remove multiple channels at once
- **Customer-centric operations** - Move customers between collections (all their channels move together)
- **Plan preview** - See exactly what changes will be made before executing
- **Safe by default** - Channel deletion is disabled by default (must be explicitly enabled)
- **Non-interactive mode support** - Works with Google Sheets triggers for automation
- **Flexible configuration** - All settings managed in the sheet itself

## Prerequisites

Before you begin, make sure you have:

1. **A Google Account** with access to Google Sheets and Google Apps Script
2. **A ClearFeed API Token** (see [Personal Access Token](https://docs.clearfeed.ai/clearfeed-help-center/account-setup/developer-settings#personal-access-token))
3. **Customer-Centric Inbox enabled** on your ClearFeed account

## Quick Start Guide

### Step 1: Create a Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com) and create a new sheet
2. (Optional) Rename the sheet tab - if you have only one sheet, the script will use it automatically
3. Add the following headers in the first row:

| Collection | Customer | Channel Name | Channel ID |
|------------|----------|--------------|------------|
| *(your data)* | *(your data)* | *(your data)* | *(your data)* |

4. Add your channel mapping data below the headers:
   - **Collection** (required): The name of the ClearFeed collection
   - **Customer** (required): The name of the Customer object in ClearFeed
   - **Channel Name** (optional): The name of the Slack channel - if not provided, it will be fetched from ClearFeed API
   - **Channel ID** (required): The Slack channel ID (e.g., `C07AA9J9LJX`)

Example data:

| Collection | Customer | Channel Name | Channel ID |
|------------|----------|--------------|------------|
| Support | Acme Corp | #support-tickets | C07AA9J9LJX |
| Engineering | Acme Corp | | C06BB9H9HKW |
| Sales | Globex Inc | sales-questions | C05CC8G8GJV |

**Important Notes:**
- The "Customer" column specifies which customer object owns the channel
- Moving a customer to a different collection moves ALL their channels
- The "Channel Name" column is optional - names are fetched from ClearFeed API if not provided

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
  CREATE_EMPTY_CUSTOMER: false, // Whether to create an empty customer when adding channels
  SET_OWNER: false, // Whether to set the owner field when adding channels
  CUSTOMER_FETCH_PAGE_SIZE: 5, // Page size for fetching customers (small to avoid bandwidth)
  CUSTOMER_FETCH_DELAY_MS: 5000, // Delay between customer fetch requests (milliseconds)
};
```

**Required:**
- Set `API_KEY` to your ClearFeed API token

**Optional:**
- Change `SHEET_NAME` if your spreadsheet has multiple sheets
- Set `INCLUDE_DELETES` to `true` to enable channel deletion (use with caution!)
- Set `SPREADSHEET_ID` to use a different spreadsheet
- Adjust `CUSTOMER_FETCH_PAGE_SIZE` and `CUSTOMER_FETCH_DELAY_MS` if you encounter bandwidth issues

### Step 5: Test Connection

1. Go back to your Google Sheet
2. Refresh the page (a new menu should appear)
3. Click **ClearFeed Channel Sync** > **Test Connection**
4. You should see a success message with the number of collections and customers found

### Step 6: Run the Sync

1. Click **ClearFeed Channel Sync** > **Sync Channels**
2. Review the sync plan that shows what will be added, moved, or removed
3. Click **Yes** to confirm and execute the plan

## Configuration Options

### API_KEY (Required)

Your ClearFeed API token (see [Personal Access Token](https://docs.clearfeed.ai/clearfeed-help-center/account-setup/developer-settings#personal-access-token)).

### SHEET_NAME

The name of the sheet tab containing your channel mappings.

- **Default**: `"Channel Mappings"`
- **Example**: `"My Channels"`

**Note:** If your spreadsheet has only one sheet, the script will automatically use it regardless of its name.

### INCLUDE_DELETES

Whether to actually remove channels that are not in your sheet.

- **Default**: `false` (safe mode - channels are only added/moved, never removed)
- **Set to `true`**: Channels not in the sheet will be removed from ClearFeed

**Warning:** Enable this only if you want channels not in the sheet to be deleted from ClearFeed!

### SPREADSHEET_ID

Use this to sync from a different spreadsheet than where the script is installed.

- **Default**: `""` (use the current spreadsheet)
- **Example**: `"1BxiMvs0XRA5nFMdK..."` (found in the spreadsheet URL)

### CUSTOMER_FETCH_PAGE_SIZE

Page size for fetching customers from the API.

- **Default**: `5` (small pages to avoid bandwidth quota issues)
- **Range**: 1-100

If you encounter "Bandwidth quota exceeded" errors, reduce this value.

### CUSTOMER_FETCH_DELAY_MS

Delay in milliseconds between customer fetch requests.

- **Default**: `5000` (5 seconds)
- **Range**: Any positive integer

If you encounter rate limiting, increase this value.

## Sheet Format

Your sheet must have the following columns:

| Column | Description | Required | Example |
|--------|-------------|----------|---------|
| Collection | ClearFeed collection name | Yes | Support |
| Customer | Customer object name in ClearFeed | Yes | Acme Corp |
| Channel Name | Slack channel name (for display only) | No | #support-tickets |
| Channel ID | Slack channel ID | Yes | C07AA9J9LJX |

**Important:**
- The first row must contain headers
- **Collection**, **Customer**, and **Channel ID** are required
- The **Channel Name** column is optional
- Empty rows will be ignored
- Collection and Customer names are case-insensitive

## How It Works

### Customer-Centric Model

This script uses ClearFeed's Customer-Centric Inbox model:

```
Collections → Customers → Channels
```

- **Collections** contain **Customers**
- **Customers** contain **Channels**
- Moving a customer moves ALL their channels

### Operations

1. **Add Channels**: Channels not in ClearFeed are added to the specified collection

2. **Move Customers**: When a customer's channels should be in a different collection, the entire customer object is moved (along with all their channels)

3. **Remove Channels**: Channels in ClearFeed but not in the sheet can be removed (if `INCLUDE_DELETES = true`)

### Sync Plan Example

```
CHANNEL SYNC PLAN
==================

📝 Channels to ADD: 2
   + #support-tickets (C07AA9J9LJX) → Support / Acme Corp
   + #eng-help (C06BB9H9HKW) → Engineering / Acme Corp

🔄 Customers to MOVE: 1
   ~ Customer: Acme Corp
     Support → Sales
     Channels moving: 5 channel(s)

🗑️  Channels to REMOVE: 1
   - #old-channel (C04DD7F7FIU) from Support / Globex Inc

⚠️  WARNING: Deletes are SKIPPED (CONFIG.INCLUDE_DELETES = false)

SUMMARY:
  Add: 2 channel(s)
  Move: 1 customer(s)
  Remove: 1 channel(s) (skipped)
```

## How to Find Channel IDs

### Method 1: From Slack
1. Right-click on the channel name in Slack
2. Select "Copy Link"
3. The URL contains the channel ID (e.g., `/archives/C07AA9J9LJX`)
4. The channel ID is the part after `/archives/`

### Method 2: From ClearFeed
1. Go to [app.clearfeed.ai](https://app.clearfeed.ai)
2. Navigate to **Collections**
3. Click on a collection to see its customers and channels
4. Channel IDs are displayed next to channel names

## Menu Options

The **ClearFeed Channel Sync** menu provides the following options:

| Option | Description |
|--------|-------------|
| 🔄 Sync Channels | Reads the sheet, generates a plan, and syncs changes to ClearFeed |
| 🧪 Test Connection | Validates your API token and shows collection/customer count |
| 📋 View Logs | Instructions for viewing detailed logs |

## Use Cases

### 1. Initial Setup

Adding multiple channels to customers in collections:

| Collection | Customer | Channel Name | Channel ID |
|------------|----------|--------------|------------|
| Support | Acme Corp | #support | C01AA0A0ATU |
| Support | Acme Corp | #billing | C02BB1B1BUV |
| Engineering | Acme Corp | #engineering | C03CC2C2CVW |

### 2. Moving Customers Between Collections

Moving a customer (and all their channels) to a different collection:

| Collection | Customer | Channel Name | Channel ID |
|------------|----------|--------------|------------|
| Enterprise | Globex Inc | #enterprise-support | C04DD3D3DX0 |

Running sync will move the **Globex Inc** customer (and all its channels) to the **Enterprise** collection.

### 3. Removing Channels (with INCLUDE_DELETES=true)

To remove a channel from ClearFeed, delete its row from the sheet. When `INCLUDE_DELETES=true`, the channel will be removed on the next sync.

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

## Troubleshooting

### "Bandwidth quota exceeded"

**Solution:** Reduce `CUSTOMER_FETCH_PAGE_SIZE` or increase `CUSTOMER_FETCH_DELAY_MS` in the CONFIG.

### "Sheet 'Channel Mappings' not found"

**Solution:** If your spreadsheet has only one sheet, this error shouldn't occur. If you have multiple sheets, either:
- Rename one of your sheet tabs to match `CONFIG.SHEET_NAME`
- Update `CONFIG.SHEET_NAME` to match your existing sheet tab name

### "API request failed with status 401"

**Solution:** Your API token is invalid. Check `CONFIG.API_KEY` and get a fresh token from ClearFeed settings.

### "No channel mappings found in the sheet"

**Solution:** Ensure your sheet has at least one data row below the header row, and all four columns are filled (Collection, Customer, Channel Name optional, Channel ID).

### Collections or customers not found warning

**Solution:** Verify the exact spelling of collection and customer names in ClearFeed. The comparison is case-insensitive but must match otherwise.

## API Endpoints Used

The script uses the ClearFeed REST API:

- **GET** `/collections?include=channels` - Fetch all collections with their channels
- **GET** `/customers` - Fetch all customers (with pagination)
- **POST** `/collections/{id}/channels` - Add channels to a collection
- **PATCH** `/customers/{id}` - Move a customer to a different collection
- **DELETE** `/channels/{id}` - Remove a channel

For full API documentation, see [ClearFeed API Docs](https://docs.clearfeed.ai/api).

## Security Notes

1. **API Key Protection**: Your API key is stored in the script code. Anyone with edit access to the spreadsheet can see it.
2. **Permissions**: The script requires permission to access your spreadsheet and make external HTTP requests.
3. **Logs**: API calls and data are logged in the Apps Script logger.

**Best Practices:**
- Don't share your spreadsheet publicly
- Consider creating a service account with limited permissions
- Regularly rotate your API token

## License

This integration is provided as open source under the same license as the clearfeed-recipes repository.
