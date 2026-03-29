# Customer Custom Fields Sync

A Google Apps Script integration that syncs customer custom field values from a Google Sheet to ClearFeed customers via the ClearFeed REST API.

## Overview

This integration allows you to manage ClearFeed customer custom fields in bulk using Google Sheets. It reads customer data organized by Channel ID and updates the corresponding customer records in ClearFeed with custom field values.

**How it works:**
1. **Download Channel IDs** — Fetch all channels from your ClearFeed collections and populate them in the sheet
2. **Add Custom Field Columns** — Create columns for each ClearFeed customer custom field you want to manage
3. **Fill in Values** — Enter the custom field values for each channel
4. **Sync Custom Fields** — Push the values from the sheet to ClearFeed customers
5. **Repeat** — As new channels are added to ClearFeed, re-download channels and repeat the process

## Key Features

- **Channel Discovery**: Automatically fetches all channels from ClearFeed collections — no need to manually find Channel IDs
- **Bidirectional Mapping**: Maps sheet columns to ClearFeed customer custom fields by name
- **Incremental Updates**: Download Channel IDs updates existing channel names and adds new channels
- **Batch Processing**: Process up to 500 customer updates per run
- **Validation**: Comprehensive validation including duplicate channel checks, field type validation, and value validation
- **Dry Run Mode**: Preview changes before applying them
- **Automatic Scheduling**: Optional hourly sync trigger
- **Progress Tracking**: Real-time progress updates during sync
- **Error Handling**: Retry logic with exponential backoff for API failures

## Prerequisites

Before using this integration:

1. **Custom Fields in ClearFeed**: Define customer custom fields in ClearFeed for each property you want to manage
2. **Column Naming**: Sheet column names must match custom field names exactly (case-sensitive)
3. **Select Field Values**: For `select` and `multi_select` fields, cell values must match the option display text exactly
4. **Multi-Select Delimiter**: Separate multiple values in `multi_select` fields with pipe character `|` (e.g., "Option A | Option B")

## Setup

### 1. Google Sheet Structure

Create a sheet with the following structure:

| Collection_Name | Channel_ID | Channel_Name | Custom Field 1 | Custom Field 2 | ... |
|----------------|------------|--------------|----------------|----------------|-----|
| My Collection  | C04TCQTRMT3 | my-channel   | Value 1        | Value 2        | ... |

- **Channel_ID column**: Required - contains the Slack Channel ID for each customer. Use "Download Channel IDs" from the menu to auto-populate this column.
- **Channel_Name column**: Auto-populated by "Download Channel IDs" — shows the channel name for reference.
- **Collection_Name column**: Auto-populated by "Download Channel IDs" — shows the collection the channel belongs to.
- **Other columns**: Must match your ClearFeed custom field names exactly

### 2. Install the Script

1. Open your Google Sheet
2. Go to **Extensions > Apps Script**
3. Copy the contents of `custom_fields_sync.gs`
4. Paste into the script editor
5. Save the project

### 3. Configure

Edit the `CONFIG` object at the top of the script:

```javascript
const CONFIG = {
  CLEARFEED_API_KEY:     "your-pat-token-here",  // Your ClearFeed PAT token
  SHEET_NAME:            "Sheet1",                // Optional: Name of the sheet tab (only used if spreadsheet has multiple sheets)
  SPREADSHEET_ID:        "",                      // Optional: for standalone script
  CHANNEL_ID_COLUMN:     "Channel_ID",            // Column name for Channel ID
  CHANNEL_NAME_COLUMN:   "Channel_Name",          // Column name for Channel Name (populated by Download Channel IDs)
  COLLECTION_NAME_COLUMN: "Collection_Name",      // Column name for Collection Name (populated by Download Channel IDs)
  SKIP_COLUMNS:          ["Collection_Name", "Channel_ID", "Channel_Name"],
  MULTI_SELECT_DELIM:    "|",                     // Multi-select value delimiter
  // ... other settings
};
```

### 4. Get Your ClearFeed API Key

1. Log in to ClearFeed
2. Navigate to Settings > API
3. Generate a PAT (Personal Access Token)
4. Paste it into `CONFIG.CLEARFEED_API_KEY`

## Usage

### Workflow

The typical workflow for using this integration:

1. **Download Channel IDs** — Fetch all channels from your ClearFeed collections. This automatically creates `Channel_ID`, `Channel_Name`, and `Collection_Name` columns and populates them with your channels.
2. **Add Custom Field Columns** — Add new columns to your sheet for each customer custom field you want to manage. Column names must match your ClearFeed custom field names exactly.
3. **Fill in Values** — Enter the custom field values for each channel row.
4. **Sync Custom Fields** — Run "Sync Custom Fields" to push the values to ClearFeed customers.
5. **Repeat** — As new channels are added to ClearFeed, run "Download Channel IDs" again to add them to the sheet, then fill in their values and sync.

### Menu Options

After installing, a **"ClearFeed Customer Field Sync"** menu will appear with these options:

| Option | Description |
|--------|-------------|
| **Download Channel IDs** | Fetch all channels from ClearFeed collections. Adds new channels to the sheet and updates existing channel names. |
| **Sync Custom Fields** | Perform the sync with validation. Updates customer records in ClearFeed with values from the sheet. |
| **Sync Custom Fields (Dry Run)** | Preview changes without applying them. Shows what would be updated if you ran the sync. |
| **Test Connection** | Verify API credentials and sheet access |
| **Enable Hourly Sync** | Set up automatic hourly sync trigger |
| **Disable Hourly Sync** | Remove automatic sync trigger |

### Download Channel IDs Process

When you run **Download Channel IDs**:

1. **Fetch Collections** — Retrieves all collections from ClearFeed with their channels
2. **Create Columns** — If `Channel_ID`, `Channel_Name`, or `Collection_Name` columns don't exist, they are created automatically
3. **Update Existing** — For channels already in the sheet, updates `Channel_Name` and `Collection_Name` if they've changed
4. **Add New** — Appends any new channels to the bottom of the sheet

### Sync Custom Fields Process

When you run **Sync Custom Fields**:

1. **Configuration Validation** — Verifies API key and sheet settings
2. **Sheet Structure Validation** — Checks required columns exist
3. **Fetch Customers** — Retrieves all customers from ClearFeed (paginated)
4. **Build Channel Map** — Creates Channel ID → Customer mapping
5. **Fetch Custom Fields** — Retrieves all customer custom fields from ClearFeed
6. **Column Matching** — Matches sheet columns to custom fields
7. **Data Validation** — Validates all data before sync
8. **Update Customers** — Patches customer records with new values

## Configuration Options

| Setting | Description | Default |
|---------|-------------|---------|
| `CLEARFEED_API_KEY` | Your ClearFeed PAT token | Required |
| `SHEET_NAME` | Name of the sheet tab (only used if spreadsheet has multiple sheets) | Optional |
| `SPREADSHEET_ID` | For standalone scripts | Optional |
| `CHANNEL_ID_COLUMN` | Name of Channel ID column | "Channel_ID" |
| `CHANNEL_NAME_COLUMN` | Name of Channel Name column (populated by Download Channel IDs) | "Channel_Name" |
| `COLLECTION_NAME_COLUMN` | Name of Collection Name column (populated by Download Channel IDs) | "Collection_Name" |
| `SKIP_COLUMNS` | Columns to ignore during sync | ["Collection_Name", "Channel_ID", "Channel_Name"] |
| `MULTI_SELECT_DELIM` | Multi-select value separator | "\|" |
| `BASE_DELAY_MS` | Delay between API calls | 200 |
| `MAX_RETRIES` | Retry attempts for failed requests | 5 |
| `MAX_UPDATES_PER_RUN` | Maximum customers per sync | 500 |
| `DRY_RUN_DEFAULT` | Default dry run mode | false |
| `ALLOWED_FIELD_TYPES` | Supported custom field types | ["text", "select", "multi_select", "number", "date"] |
| `STRICT_VALIDATION` | Stop sync on validation errors | true |

## Supported Custom Field Types

| Type | Description | Example |
|------|-------------|---------|
| `text` | Plain text values | "Acme Corp" |
| `select` | Single value from predefined options | "Enterprise" |
| `multi_select` | Multiple values from options | "Enterprise \| Premium" |
| `number` | Numeric values | 1000 |
| `date` | Date values (ISO format) | "2024-01-15" |

## Validation

The integration performs comprehensive validation:

- **Duplicate Channel IDs**: Ensures each Channel ID appears only once
- **Column Matching**: Verifies all columns have corresponding custom fields
- **Field Type Support**: Checks field types are supported
- **Text Length**: Validates text fields don't exceed max length
- **Select Options**: Validates select/multi_select values exist in options
- **Channel Mapping**: Warns if Channel IDs aren't found in ClearFeed

## Error Handling

- **Version Conflicts**: Detects when customers are modified concurrently
- **Rate Limiting**: Handles API rate limits with exponential backoff
- **Validation Errors**: Reports specific row/column errors
- **API Failures**: Retries failed requests up to `MAX_RETRIES` times

## Troubleshooting

### "Unmatched Columns Found" Error
- Column names don't match custom field names in ClearFeed
- Check spelling and case sensitivity
- Add the custom field in ClearFeed or add column to `SKIP_COLUMNS`

### "Channel ID not found" Warning
- The Channel ID doesn't exist in any ClearFeed customer
- Verify the Channel ID is correct
- Check the customer has that Channel ID in ClearFeed

### Version Conflict Errors
- Customer was modified by another process during sync
- Re-run the sync to fetch the latest version
- Consider using "Force Sync" if conflicts persist

### Rate Limiting
- Too many API requests in short time
- Increase `BASE_DELAY_MS` in CONFIG
- The script automatically retries with exponential backoff

## API Endpoints Used

- `GET /v1/rest/collections?include=channels` - Fetch all collections with channels (for Download Channel IDs)
- `GET /v1/rest/customers` - Fetch all customers (paginated)
- `GET /v1/rest/custom-fields?entity_type=customer` - Fetch custom field definitions
- `PATCH /v1/rest/customers/{id}` - Update customer custom fields
- `GET /v1/rest/collections` - Test connection

## License

This integration is provided as-is for use with the ClearFeed API.
