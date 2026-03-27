# Customer Custom Fields Sync

A Google Apps Script integration that syncs customer custom field values from a Google Sheet to ClearFeed customers via the ClearFeed REST API.

## Overview

This integration allows you to manage ClearFeed customer custom fields in bulk using Google Sheets. It reads customer data organized by Channel ID and updates the corresponding customer records in ClearFeed with custom field values.

## Key Features

- **Bidirectional Mapping**: Maps sheet columns to ClearFeed customer custom fields by name
- **Batch Processing**: Process up to 500 customer updates per run
- **Validation**: Comprehensive validation including duplicate channel checks, field type validation, and value validation
- **Dry Run Mode**: Preview changes before applying them
- **Automatic Scheduling**: Optional hourly sync trigger
- **Progress Tracking**: Real-time progress updates during sync
- **Error Handling**: Retry logic with exponential backoff for API failures

## Prerequisites

Before using this integration:

1. **Custom Fields in ClearFeed**: Each column in your sheet must have a corresponding custom field defined in ClearFeed for the `customer` entity type
2. **Column Naming**: Sheet column names must match custom field names exactly (case-sensitive)
3. **Channel ID Column**: Your sheet must have a `Channel_ID` column containing Slack Channel IDs (e.g., "C04TCQTRMT3")
4. **Select Field Values**: For `select` and `multi_select` fields, cell values must match the option display text exactly
5. **Multi-Select Delimiter**: Separate multiple values in `multi_select` fields with pipe character `|` (e.g., "Option A | Option B")

## Setup

### 1. Google Sheet Structure

Create a sheet with the following structure:

| Collection Name | Channel_ID | Custom Field 1 | Custom Field 2 | ... |
|----------------|------------|----------------|----------------|-----|
| My Collection  | C04TCQTRMT3 | Value 1        | Value 2        | ... |

- **Channel_ID column**: Required - contains the Slack Channel ID for each customer
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
  SHEET_NAME:            "Sheet1",                // Your sheet name
  SPREADSHEET_ID:        "",                      // Optional: for standalone script
  CHANNEL_ID_COLUMN:     "Channel_ID",            // Column name for Channel ID
  SKIP_COLUMNS:          ["Collection Name", "Channel_ID"],
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

### Menu Options

After installing, a **"🔵 ClearFeed Mapper"** menu will appear with these options:

| Option | Description |
|--------|-------------|
| **Sync Custom Fields → ClearFeed** | Perform the sync with validation |
| **Dry Run (Preview Changes)** | Preview changes without applying them |
| **Test Connection** | Verify API credentials and sheet access |
| **Enable Hourly Sync** | Set up automatic hourly sync trigger |
| **Disable Hourly Sync** | Remove automatic sync trigger |
| **Force Sync (Skip Validation)** | Sync without validation checks |

### Sync Process

The sync follows these steps:

1. **Configuration Validation**: Verifies API key and sheet settings
2. **Sheet Structure Validation**: Checks required columns exist
3. **Fetch Customers**: Retrieves all customers from ClearFeed (paginated)
4. **Build Channel Map**: Creates Channel ID → Customer mapping
5. **Fetch Custom Fields**: Retrieves all customer custom fields from ClearFeed
6. **Column Matching**: Matches sheet columns to custom fields
7. **Data Validation**: Validates all data before sync
8. **Update Customers**: Patches customer records with new values

## Configuration Options

| Setting | Description | Default |
|---------|-------------|---------|
| `CLEARFEED_API_KEY` | Your ClearFeed PAT token | Required |
| `SHEET_NAME` | Target sheet name | Required |
| `SPREADSHEET_ID` | For standalone scripts | Optional |
| `CHANNEL_ID_COLUMN` | Name of Channel ID column | "Channel_ID" |
| `SKIP_COLUMNS` | Columns to ignore during sync | ["Collection Name", "Channel_ID"] |
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

- `GET /v1/rest/customers` - Fetch all customers (paginated)
- `GET /v1/rest/custom-fields?entity_type=customer` - Fetch custom field definitions
- `PATCH /v1/rest/customers/{id}` - Update customer custom fields
- `GET /v1/rest/collections` - Test connection

## License

This integration is provided as-is for use with the ClearFeed API.
