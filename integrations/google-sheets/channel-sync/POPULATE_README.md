# ClearFeed Channel Mappings Populator

A companion script to `channel_sync.gs` that **populates a Google Sheet with your current Collection → Customer → Channel mappings** from ClearFeed.

Use this script to:
- **Initial setup**: Get your current configuration into a sheet before using channel_sync.gs
- **Audit**: See what's currently configured in your ClearFeed account
- **Backup**: Create a snapshot of your current mappings

## Prerequisites

- A Google Account with access to Google Sheets and Google Apps Script
- A ClearFeed API Token (see [Personal Access Token](https://docs.clearfeed.ai/clearfeed-help-center/account-setup/developer-settings#personal-access-token))
- Customer-Centric Inbox enabled on your ClearFeed account

## Quick Start

### Step 1: Create or Open a Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com) and create a new sheet
2. (Optional) Rename the sheet tab to "Channel Mappings" (or customize `SHEET_NAME` in config)

### Step 2: Open Apps Script Editor

1. In your Google Sheet, go to **Extensions** > **Apps Script**
2. A new tab will open with the Apps Script editor

### Step 3: Add the Script Code

1. Create a new script file (e.g., `populate_mappings.gs`)
2. Copy the contents of `populate_mappings.gs`
3. Paste it into the Apps Script editor
4. **Save** the project (Ctrl+S or Cmd+S)

### Step 4: Configure the Script

At the top of the script, update the `CONFIG` object:

```javascript
const CONFIG = {
  API_KEY: "", // Required: Your ClearFeed API key
  SHEET_NAME: "Channel Mappings", // Sheet tab name
  SPREADSHEET_ID: "", // Leave empty for current spreadsheet
  CLEAR_SHEET_BEFORE_WRITE: true, // Set to false to append data
  CUSTOMER_FETCH_PAGE_SIZE: 5, // Page size for fetching customers
  CUSTOMER_FETCH_DELAY_MS: 5000, // Delay between requests (ms)
};
```

### Step 5: Run the Populate Function

1. Go back to your Google Sheet
2. Refresh the page (a new menu should appear: **ClearFeed Populate**)
3. Click **ClearFeed Populate** > **📥 Populate Mappings**
4. Wait for the script to complete (check logs for progress)

## Result

Your sheet will be populated with the following format:

| Collection | Customer | Channel Name | Channel ID |
|------------|----------|--------------|------------|
| Support | Acme Corp | #support-tickets | C07AA9J9LJX |
| Support | Acme Corp | #billing-questions | C06BB9H9HKW |
| Sales | Globex Inc | #sales-lead | C05CC8G8GJV |

## Configuration Options

### API_KEY (Required)
Your ClearFeed API token.

### SHEET_NAME
The name of the sheet tab to write to.
- **Default**: `"Channel Mappings"`

### SPREADSHEET_ID
Use a different spreadsheet than where the script is installed.
- **Default**: `""` (current spreadsheet)

### CLEAR_SHEET_BEFORE_WRITE
Whether to clear the sheet before writing new data.
- **Default**: `true`
- Set to `false` to append data instead of replacing

### CUSTOMER_FETCH_PAGE_SIZE
Page size for fetching customers (to avoid bandwidth issues).
- **Default**: `5`

### CUSTOMER_FETCH_DELAY_MS
Delay between customer fetch requests in milliseconds.
- **Default**: `5000` (5 seconds)

## How It Works

1. **Fetches collections** with their channels from ClearFeed
2. **Fetches all customers** with pagination (small pages to avoid bandwidth errors)
3. **Builds mappings** by matching customer channels to collections
4. **Writes to sheet** in sorted order (Collection → Customer → Channel)

## Important Notes

- **Sorting**: Output is sorted by Collection, then Customer, then Channel name
- **Empty customers**: Customers with no channels are logged but not written to the sheet
- **Orphaned customers**: Customers without a collection_id are logged and skipped
- **Bandwidth**: Uses small page sizes (5) and delays (5000ms) to avoid quota errors

## Troubleshooting

### "Bandwidth quota exceeded"
Reduce `CUSTOMER_FETCH_PAGE_SIZE` or increase `CUSTOMER_FETCH_DELAY_MS`.

### "Sheet not found"
Either:
- Create a sheet with the name specified in `SHEET_NAME`
- Update `SHEET_NAME` to match an existing sheet
- If you have only one sheet, it will be used automatically

### "No mappings written"
This could mean:
- No customers exist in your ClearFeed account
- All customers have no channels
- All customers are missing collection_id

## Menu Options

| Option | Description |
|--------|-------------|
| 📥 Populate Mappings | Fetch current state from ClearFeed and write to sheet |
| 🧪 Test Connection | Validate API token and show collection/customer count |
| 📋 View Logs | Instructions for viewing detailed logs |

## Using with channel_sync.gs

1. First, run **Populate Mappings** to get your current configuration
2. Review the data and make any desired changes
3. Use **channel_sync.gs** to sync your changes back to ClearFeed

## License

This script is provided as open source under the same license as the clearfeed-recipes repository.
