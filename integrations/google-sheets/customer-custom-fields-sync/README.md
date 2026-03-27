# Customer Custom Fields Sync - Google Sheets Integration

This Google Apps Script syncs customer custom field values from a Google Sheet to ClearFeed using the ClearFeed REST API.

## Key Features

- **Channel ID-based mapping**: Customers are identified by their Slack Channel ID
- **Multi-field type support**: Text, Number, Date, Single Select, and Multi Select custom fields
- **Option validation**: Validates select/multi_select values against available options
- **Dry Run Mode**: Preview changes without actually updating ClearFeed
- **Change detection**: Only sends updates when values actually change
- **Error handling**: Validates columns, configuration, and flags issues before sync
- **Duplicate detection**: Warns if multiple customers share the same Channel ID
- **Version conflict handling**: Properly handles optimistic locking conflicts
- **Last synced timestamp**: Tracks when the last sync completed
- **Progress tracking**: Shows progress during sync for large datasets (25, 50, 75%...)
- **Optimized for scale**: Handles 500+ rows efficiently with reduced delays
- **Position-independent**: Works regardless of row/column order or additions/deletions
- **Auto-discovery**: Automatically detects new custom fields - no code changes needed
- **Configurable settings**: Customize column names, delimiters, and behavior
- **Rate limiting**: Implements exponential backoff for API rate limits
- **Automatic scheduling**: Can run hourly via triggers

## Quick Start

1. **Get your ClearFeed PAT Token** from Settings → API → Personal Access Tokens
2. **Prepare your Google Sheet** with a `Channel_ID` column and custom field columns
3. **Add the script** to your sheet (Extensions → Apps Script)
4. **Configure** the `CONFIG` object at the top of the script
5. **Test Connection** from the ClearFeed Mapper menu
6. **Run Dry Run** to preview changes
7. **Sync** your data to ClearFeed

## Google Sheet Structure

### Required Columns

| Column Name | Description | Example |
|-------------|-------------|---------|
| `Channel_ID` | Slack Channel ID for the customer | `C04TCQTRMT3` |

### Custom Field Columns

Add additional columns for each custom field you want to sync. **Column names must exactly match the custom field names in ClearFeed.**

| Column Name | Type | Example |
|-------------|------|---------|
| `Size` | text | `Enterprise` |
| `Country` | text | `USA` |
| `Founded` | number | `2015` |
| `Industry` | text | `SaaS` |
| `Software Type` | select | `Type A` |
| `Technologies` | multi_select | `Type A \| Type B` |
| `MRR` | text | `$12,500` |

### Example Sheet Layout

```
| Channel_ID      | Size      | Country | Founded | Industry  | Software Type | Technologies     |
|-----------------|-----------|---------|---------|-----------|---------------|------------------|
| C04TCQTRMT3     | Enterprise| USA     | 2015    | SaaS      | Type A        | Type A | Type C   |
| C0AH02HPDPG     | SMB       | UK      | 2018    | Fintech   | Type B        | Type B           |
| C0AFDJMHK4Y     | Startup   | Canada  | 2020    | Health    | Type C        | Type A | Type D   |
```

## Multi-Select Format

For multi-select fields, separate values with the pipe character (`|`):

```
Type A | Type B | Type C
```

You can change the delimiter in CONFIG by setting `MULTI_SELECT_DELIM`.

## Configuration

Edit the `CONFIG` object at the top of the script:

```javascript
const CONFIG = {
  // Required: Your ClearFeed Personal Access Token
  CLEARFEED_API_KEY:     "YOUR_PAT_TOKEN_HERE",

  // Required: Name of your Google Sheet tab
  SHEET_NAME:            "Collections & Customers",

  // Optional: Spreadsheet ID (leave empty to use current sheet)
  SPREADSHEET_ID:        "",

  // Optional: Column name that contains Channel IDs (default: "Channel_ID")
  CHANNEL_ID_COLUMN:     "Channel_ID",

  // Optional: Delimiter for multi-select values (default: "|")
  MULTI_SELECT_DELIM:    "|",

  // Optional: Delay between API calls in milliseconds (default: 500)
  BASE_DELAY_MS:         500,

  // Optional: Max retry attempts for failed API calls (default: 5)
  MAX_RETRIES:           5,

  // Optional: Max customers to update per run (default: 100)
  MAX_UPDATES_PER_RUN:   100,

  // Optional: Hours between automatic syncs (default: 1)
  TRIGGER_INTERVAL_HR:   1,

  // Optional: Set to true to preview changes without updating (default: false)
  DRY_RUN_DEFAULT:       false,

  // Validation Settings
  ALLOWED_FIELD_TYPES:   ["text", "select", "multi_select", "number", "date"],  // Allowed custom field types
  STRICT_VALIDATION:     true,                 // Stop sync on validation errors
  CHECK_DUPLICATE_CHANNELS: true,              // Check for duplicate Channel IDs in sheet
};
```

## Menu Options

After adding the script, you'll see a **🔵 ClearFeed Mapper** menu with these options:

| Option | Description |
|--------|-------------|
| **⬆️ Sync Custom Fields → ClearFeed** | Sync all valid changes to ClearFeed |
| **🔍 Dry Run (Preview Changes)** | Preview what would change without updating |
| **🔌 Test Connection** | Verify API credentials and sheet structure |
| **⏰ Enable Hourly Sync** | Set up automatic hourly sync |
| **🛑 Disable Hourly Sync** | Stop automatic sync |
| **⚠️ Force Sync (Skip Validation)** | Sync all changes including validation errors |

## Sync Workflow

1. **Validation**: Checks configuration and sheet structure
2. **Data Fetching**: Fetches customers and custom fields from ClearFeed
3. **Column Matching**: Validates sheet columns against custom fields
4. **Duplicate Detection**: Warns about duplicate Channel IDs
5. **Value Validation**: Validates select/multi_select values
6. **Change Detection**: Builds payload with only changed values
7. **API Updates**: Sends updates with retry logic
8. **Timestamp Update**: Updates "Last Synced" in the sheet

## Custom Field Type Support

### Text Fields
- Single-line and multi-line text
- Empty cells preserve existing values
- Text is trimmed before syncing

### Number Fields
- Handles numeric values
- Automatically strips currency symbols and commas
- Example: `$12,500` → `12500`

### Date Fields
- Accepts Date objects or ISO date strings
- Format: `yyyy-MM-dd`

### Select Fields (Single Select)
- **Cell value**: The display text of the option
- **Synced value**: The option ID
- **Validation**: Checks if the value exists in the field's options
- **Case-insensitive**: Matches "type a" to "Type A"
- Example: If field has options `[{id: "1", value: "Type A"}]`, entering `Type A` syncs as `"1"`

### Multi Select Fields
- **Cell value**: Pipe-separated option display text (e.g., `Type A | Type B`)
- **Synced value**: Array of option IDs
- **Validation**: Checks if all values exist in the field's options
- **Configurable delimiter**: Change `MULTI_SELECT_DELIM` in CONFIG
- Example: `Type A | Type B` → `["1", "2"]`

## Error Handling

### Configuration Errors

The script validates configuration before running:

```
⚠️ Configuration Error
❌ CLEARFEED_API_KEY is not set. Please add your ClearFeed PAT token.
```

### Sheet Structure Errors

Checks for required columns:

```
⚠️ Sheet Structure Error
Required column "Channel_ID" not found.

Please add a column named "Channel_ID" to your sheet.
```

### Unmatched Columns Error

If columns don't match ClearFeed custom fields:

```
⚠️ Unmatched Columns Found

The following sheet columns do not match any ClearFeed customer custom fields:

ColumnName1, ColumnName2

Please either:
- Rename the columns to match exact custom field names in ClearFeed
- Add these as new custom fields in ClearFeed
- Or remove these columns from the sheet
```

## Error Handling

### Pre-Sync Validation

Before processing any data, the script performs comprehensive validation:

| Validation | Description |
|------------|-------------|
| ✅ **Duplicate Channel IDs** | Each Channel ID must appear only once - sync stops if duplicates found |
| ✅ **Text Length Limits** | Text fields validated against max_length from ClearFeed |
| ✅ **Field Type Check** | Only allows: text, select, multi_select, number, date types |
| ✅ **Select Value Validation** | Pre-validates all select/multi_select values match options |
| ✅ **Unmatched Columns** | Columns must match ClearFeed custom field names exactly |

### Duplicate Channel ID Error

```
❌ Sheet Validation Failed
❌ Duplicate Channel IDs found in sheet:
Row 5: C04TCQTRMT3
Row 12: C04TCQTRMT3

Each Channel ID should appear only once. Please remove duplicates.
```

**Solution:** Remove duplicate rows so each Channel ID appears only once.

### Text Length Error

```
❌ Sheet Validation Failed
❌ Text exceeds maximum length:
Row 3, Column "Size": 300 characters (max: 255)
Row 7, Column "Description": 500 characters (max: 255)
```

**Solution:** Shorten the text to fit within the maximum length.

### Unsupported Field Type Error

```
❌ Sheet Validation Failed
❌ Unsupported custom field types found:
"Some Field" (type: checkbox)
"Another Field" (type: file)

Supported types: text, select, multi_select, number, date
```

**Solution:** Remove columns with unsupported types or add them to `SKIP_COLUMNS` in CONFIG.

### Invalid Select Value Error

```
❌ Sheet Validation Failed
❌ Invalid select/multi_select values:
Row 4, Column "Software Type": "Invalid Type" not in options (Type A, Type B, Type C...)
Row 8, Column "Technologies": "Type X" not in options
```

**Solution:** Use exact option display text from ClearFeed.

### Unmatched Columns Error

For invalid select/multi_select values:

```
❌ Validation Error: Column "Software Type" - Value "Invalid Type" not found
in select options. Available options: Type A, Type B, Type C, Type D
```

### Channel ID Not Found

```
⚠️ Row 5: No customer found for Channel ID "INVALID123" — skipping
```

### Duplicate Channel IDs

Now validated before sync - will stop the process if found:

```
❌ Duplicate Channel IDs found in sheet:
Row 5: C04TCQTRMT3
Row 12: C04TCQTRMT3
```

Previously, this was only a warning about ClearFeed data. Now it also checks the sheet itself.

### Version Conflicts

If a customer is modified during sync:

```
⚠️ Version conflict for "Customer Name" (75) - customer was modified by another process
```

The sync will retry, and if it still fails, the conflict is counted in results.

## Finding Channel IDs

To find a Slack Channel ID:

1. In Slack, right-click on the channel name
2. Select "Copy Link"
3. The Channel ID is in the URL (e.g., `/archives/C04TCQTRMT3`)
4. The Channel ID is `C04TCQTRMT3`

## Setup Instructions

### Step 1: Get your ClearFeed API Key

1. Log in to your ClearFeed account
2. Go to **Settings → API → Personal Access Tokens**
3. Create a new PAT token
4. Copy the token

### Step 2: Prepare your Google Sheet

1. Create a new Google Sheet or open an existing one
2. Rename the first sheet tab (e.g., "Collections & Customers")
3. Add headers: `Channel_ID` and your custom field names
4. Fill in the Channel IDs and values

### Step 3: Add the Script

1. Open your Google Sheet
2. Go to **Extensions → Apps Script**
3. Delete any existing code
4. Copy the entire `custom_fields_sync.gs` file content
5. Paste it into the Apps Script editor
6. Save the project (Ctrl+S or Cmd+S)

### Step 4: Configure the Script

In the Apps Script editor, modify the `CONFIG` object:

```javascript
const CONFIG = {
  CLEARFEED_API_KEY: "YOUR_PAT_TOKEN_HERE",  // Paste your token
  SHEET_NAME: "Collections & Customers",     // Your sheet tab name
  // ... other settings
};
```

### Step 5: Test the Connection

1. Reload your Google Sheet
2. Click **🔵 ClearFeed Mapper → 🔌 Test Connection**
3. Verify the results

### Step 6: Run a Dry Run

1. Click **🔍 Dry Run (Preview Changes)**
2. Review what would change
3. Check for any validation errors

### Step 7: Sync Your Data

1. Click **⬆️ Sync Custom Fields → ClearFeed**
2. Review the results summary

### Step 8: Enable Automatic Sync (Optional)

1. Click **⏰ Enable Hourly Sync**
2. The script will run automatically every hour

## Dry Run Mode

Use Dry Run to preview changes without updating ClearFeed:

- Shows what fields would change
- Validates all values
- Reports any errors
- Does NOT modify any data in ClearFeed

After reviewing dry run results, you can:
- Fix validation errors in the sheet
- Run the actual sync
- Use "Force Sync" to skip validation (not recommended)

## API Endpoints Used

- `GET /v1/rest/customers` - Fetch all customers (paginated)
- `GET /v1/rest/custom-fields?entity_type=customer` - Fetch custom fields
- `PATCH /v1/rest/customers/{id}` - Update customer custom fields
- `GET /v1/rest/collections` - Test connection

## Rate Limiting

The script implements:
- **Base delay**: 500ms between API calls
- **Exponential backoff**: Doubles delay on rate limit errors
- **Max retries**: 5 attempts per update
- **Version conflict handling**: Retries with exponential backoff

## Troubleshooting

### Script doesn't appear in menu
- Make sure you saved the script
- Refresh the Google Sheet page
- Check the script has no syntax errors

### "Sheet not found" error
- Check that `SHEET_NAME` in CONFIG matches your sheet tab name exactly
- Sheet names are case-sensitive

### "Configuration Error" on connection test
- Verify `CLEARFEED_API_KEY` is set to your actual PAT token
- Make sure the token doesn't have expired
- Check the token has the required permissions

### "No matching custom fields" error
- Verify column names exactly match custom field names in ClearFeed
- Check spelling and capitalization
- Spaces and special characters must match exactly

### Channel ID not found
- Verify the Channel ID is correct
- Check the customer exists in ClearFeed
- Ensure the customer has that Channel ID in their `channel_ids` array

### Validation errors for select fields
- Ensure the cell value matches the option display text
- Check for extra spaces or typos
- Try the dry run to see all validation errors at once

### Version conflicts during sync
- This means the customer was modified elsewhere during sync
- Run the sync again to fetch the latest version
- If frequent, consider reducing concurrent modifications

### Updates aren't syncing
- Check the Execution log for detailed error messages
- Verify your PAT token is valid and not expired
- Ensure the customer has the Channel ID in ClearFeed
- Try the dry run to see what would be updated

## Best Practices

1. **Always run Dry Run first** before syncing actual data
2. **Use meaningful Channel IDs** from your actual Slack channels
3. **Match column names exactly** to ClearFeed custom field names
4. **Test with a small dataset** first to validate your setup
5. **Monitor the logs** for warnings and errors
6. **Keep your PAT token secure** and don't share it
7. **Schedule syncs during off-peak hours** to avoid conflicts
8. **Use multi-select delimiter (`|`)** that doesn't appear in your option values

## FAQ

### Q: Will new custom fields work automatically?
**A: YES!** The script dynamically discovers ALL custom fields from ClearFeed on every sync. Just add a new column with the exact same name as your custom field, and it will be included automatically.

### Q: What about new Single Select fields with options?
**A: YES!** When you add a new Single Select custom field in ClearFeed and create a matching column in your sheet, the script will:
- Automatically discover the new field and its options
- Validate cell values against the available options
- Convert display text to option IDs when syncing

### Q: What about new Text/Number/Date fields?
**A: YES!** These are the simplest - just add a column with the exact name and the script will sync it. No configuration needed.

### Q: Can I reorder columns or rows in my sheet?
**A: YES!** The script is position-independent. It reads headers dynamically and matches by name, not position. You can:
- Reorder columns in any order
- Reorder rows in any order
- Add new rows anywhere
- Delete rows
- Add new columns anywhere

### Q: How many rows can I sync at once?
**A: Up to 500 rows per run** (configurable via `MAX_UPDATES_PER_RUN`). For 500 rows:
- Estimated time: ~2-3 minutes
- Progress updates every 25 rows
- Average: ~0.3 seconds per row

### Q: What if I have more than 500 customers?
**A: The script will process the first 500 and show a message to re-run. Just run the sync again - it will continue where it left off (rows already processed will be marked as "unchanged").

### Q: Do I need to update the code when adding new fields?
**A: NO!** That's the beauty of this script - it auto-discovers everything. No code changes needed when:
- Adding new custom fields in ClearFeed
- Adding new columns to your sheet
- Changing field options for select fields

### Q: What happens if a cell is empty?
**A: Empty cells preserve existing values in ClearFeed. The script will NOT clear or overwrite existing custom field values if the corresponding cell is empty.

### Q: Can I have multiple Channel IDs for the same customer?
**A: Currently, each row in the sheet maps to ONE Channel ID. If a customer has multiple channels, you can create multiple rows (one per Channel ID) - the script will update the same customer for each row.

### Q: What happens if I rename a column?
**A: The renamed column will be treated as a NEW column. If you want to stop syncing the old field, remove the old column name from your sheet. If you want to continue syncing, make sure the new name matches the custom field name in ClearFeed.

### Q: Does the script work with filters or hidden rows?
**A: YES!** The script reads ALL data rows regardless of filters or hidden rows. Hidden rows will still be synced.

## What's New

### Version 3.0 - Enhanced Features
- ✨ **Dry Run Mode** - Preview changes without updating
- ✨ **Last Synced Timestamp** - Track when sync last ran
- ✨ **Duplicate Channel ID Detection** - Prevents duplicate customers in sheet
- ✨ **Text Length Validation** - Validates text fields against max length
- ✨ **Field Type Validation** - Only allows text, select, multi_select, number, date types
- ✨ **Select Value Validation** - Pre-validates select values before sync
- ✨ **Configurable Column Name** - Customize Channel ID column name
- ✨ **Better Multi-Select** - Use pipe delimiter instead of comma
- ✨ **Sheet Validation** - Comprehensive pre-sync validation
- ✨ **Version Conflict Handling** - Better 409 error handling
- ✨ **Config Validation** - Validate settings on load
- ✨ **Progress Tracking** - Show progress during sync
- ✨ **Force Sync Option** - Skip validation if needed
- ✨ **Improved Error Messages** - More actionable feedback
- ✨ **Performance Optimized** - Handles 500+ rows efficiently

### Version 2.0 - Channel ID Mapping + Select Validation
- Changed from Customer Name to Channel ID mapping
- Added validation for unmapped columns
- Added select/multi_select field support with option validation

### Version 1.0 - Initial Release
- Customer Name-based mapping
- Text, number, and date field support
- Basic sync functionality
