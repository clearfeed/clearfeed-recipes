# ClearFeed Channel Sync for Google Sheets

A Google Apps Script that syncs channel mappings from a Google Sheet to ClearFeed. Bulk manage your channels, customers, and collections directly from a spreadsheet.

## How It Works

The script connects your Google Sheet to ClearFeed via API and syncs changes in both directions:

1. **Sheet → ClearFeed**: When you modify the sheet and run sync, changes are applied to ClearFeed
2. **ClearFeed → Sheet**: Auto-sync runs periodically to reflect changes made via the ClearFeed webapp

Before executing any changes, the script shows you a preview plan of exactly what will happen.

## Features

- **Bulk Management** - Add, move, or remove multiple channels/customers at once
- **Plan Preview** - See exactly what changes will be made before executing
- **Safe by Default** - Channel deletion is disabled by default (must be explicitly enabled)
- **Dual Model Support** - Works with both Customer-Centric and Legacy Collection-Channel models
- **Auto-Sync** - Automatically reflects webapp changes in your sheet (configurable interval)

## Prerequisites

1. **Google Account** with access to Google Sheets and Google Apps Script
2. **ClearFeed API Token** - Get yours from [Developer Settings](https://docs.clearfeed.ai/clearfeed-help-center/account-setup/developer-settings#personal-access-token)

## Quick Start

### Step 1: Create a Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com) and create a new sheet
2. Open **Extensions** > **Apps Script**
3. Paste the `channel_sync.gs` script code
4. **Save** the project

### Step 2: Configure

Update the `CONFIG` object at the top of the script:

```javascript
const CONFIG = {
  API_KEY: "",                          // Required: Your ClearFeed API token
  IS_ON_CUSTOMER_INBOX_MODEL: true,     // true = Customer-Centric, false = Legacy
  INCLUDE_DELETES: false,               // Enable to allow channel deletion
  SHEET_NAME: "Channel Mappings",       // Sheet tab name
  AUTO_SYNC_INTERVAL_MINUTES: 15,       // Auto-sync frequency (default: 15 minutes)
};
```

### Step 3: Choose Your Model

Set `IS_ON_CUSTOMER_INBOX_MODEL` based on your ClearFeed account:

- **`true`** - Customer-Centric Inbox Model (newer accounts, channels organized by customers)
- **`false`** - Legacy Collection-Channel Model (older accounts, channels organized directly by collections)

**Not sure which model to use?** Check your ClearFeed webapp - if you see "Customers" as a main navigation item, you're likely on the Customer-Centric model.

Refresh your Google Sheet after changing this setting to see the appropriate menu.

---

## Customer-Centric Inbox Model

Use this model if your ClearFeed account organizes channels by **Customers**. Each customer has exactly one Slack channel, and moving a customer moves their associated channel.

### When to Use

- Your ClearFeed workspace has "Customers" as a core concept
- Each customer represents a company or organization
- You want to manage which collection a customer belongs to

### Sheet Format

| Collection | Customer | Channel Name | Channel ID |
|------------|----------|--------------|------------|
| Enterprise | Acme Corp | #acme-support | C07AA9J9LJX |
| SMB | Startup Inc | #startup-sales | C06BB9H9HKW |
| Enterprise | BigCorp | #bigcorp-help | C08CC1K1KLZ |

### Getting Started

1. **Test Connection** - Click **Customers Sync** > **🧪 Test Connection**
   - Validates your API token
   - Shows customer statistics (total, with 1 channel, with multiple channels)
2. **Populate Sheet** - Click **📥 Populate Initial Mappings**
   - Fetches all customers from ClearFeed
   - Validates each customer has exactly 1 channel
   - Sets up auto-sync (every 15 minutes by default)
3. **Sync Changes** - Click **🔄 Sync Customer Changes** after making changes to the sheet

### Operations

| Action | How It Works |
|--------|--------------|
| **Move Customer** | Change the **Collection** column for a customer, then sync. The customer (and their channel) moves to the new collection. |
| **Delete Channel** | Delete the entire row, then sync with `INCLUDE_DELETES=true`. The channel is marked as inactive in ClearFeed. |

### Important Notes

- **One channel per customer only** - Script will error if any customer has multiple channels
- **Customer name matching** - Customer names in sheet must match ClearFeed exactly (case-insensitive)
- **Collection name matching** - Collection names in sheet must match ClearFeed exactly (case-insensitive)
- **Auto-sync** - Runs every 15 minutes (configurable) to reflect webapp changes in your sheet
- **Version-based updates** - Move operations use optimistic locking to prevent conflicts

### Menu Options

| Option | Purpose |
|--------|---------|
| 📥 Populate Initial Mappings | First-time setup: fetches customers and populates sheet |
| 🔄 Sync Customer Changes | Syncs your sheet changes to ClearFeed (shows preview first) |
| ⏰ Setup Auto-Sync | Enables automatic sync at configured interval |
| 🛑 Stop Auto-Sync | Disables automatic sync |
| 🧪 Test Connection | Validates API and shows customer statistics |
| 📋 View Logs | Instructions for viewing detailed execution logs |

---

## Legacy Collection-Channel Model

Use this model if your ClearFeed account organizes channels directly by **Collections**, without the customer abstraction.

### When to Use

- Your ClearFeed workspace doesn't have "Customers" as a concept
- Channels are organized directly under collections
- You have an older ClearFeed account

### Sheet Format

| Collection | Channel Name (optional) | Channel ID |
|------------|------------------------|------------|
| Support | #support-tickets | C07AA9J9LJX |
| Engineering | #eng-help | C06BB9H9HKW |
| Sales | #sales-inquiries | C08DD2L2LMZ |

### Getting Started

1. **Test Connection** - Click **ClearFeed Channel Sync** > **🧪 Test Connection**
   - Validates your API token
   - Shows number of collections in your account
2. **Populate Sheet** - Click **📥 Populate Initial Mappings** to fetch existing channels
3. **Sync Changes** - Click **🔄 Sync Channels** and confirm the plan

### Operations

| Action | How It Works |
|--------|--------------|
| **Add Channel** | Add a new row with Collection, Channel Name (optional), and Channel ID, then sync. The channel is added to the specified collection. |
| **Move Channel** | Change the **Collection** column for a channel, then sync. The channel moves to the new collection. |
| **Delete Channel** | Delete the row, then sync with `INCLUDE_DELETES=true`. The channel is removed from ClearFeed. |

### Menu Options

| Option | Purpose |
|--------|---------|
| 📥 Populate Initial Mappings | Fetches all channels from ClearFeed and populates sheet |
| 🔄 Sync Channels | Syncs your sheet changes to ClearFeed (shows preview first) |
| 🧪 Test Connection | Validates API and shows collection count |
| 📋 View Logs | Instructions for viewing detailed execution logs |

---

## Configuration Options

| Setting | Description | Default |
|---------|-------------|---------|
| `API_KEY` | Your ClearFeed API token (required) | *(empty)* |
| `IS_ON_CUSTOMER_INBOX_MODEL` | Model selection: `true` = Customer-Centric, `false` = Legacy | `true` |
| `INCLUDE_DELETES` | Allow channel deletion when rows are removed | `false` |
| `SHEET_NAME` | Sheet tab name | `"Channel Mappings"` |
| `SPREADSHEET_ID` | Use a different spreadsheet (empty = current) | *(empty)* |
| `AUTO_SYNC_INTERVAL_MINUTES` | Auto-sync frequency in minutes (Customer-Centric model only) | `15` |
| `CREATE_EMPTY_CUSTOMER` | Create empty customer object when adding channels (Legacy only) | `false` |
| `SET_OWNER` | Set owner field when adding channels (Legacy only) | `false` |

### Email Notifications (Optional)

Configure email notifications to receive sync completion reports:

```javascript
const EMAIL_CONFIG = {
  TO: "admin@yourcompany.com",     // Recipient email
  FROM: "noreply@example.com",      // Sender email (must be configured as Gmail alias)
  SUBJECT_PREFIX: "ClearFeed Sync - ",
  SENDER_NAME: "ClearFeed Sync"
};
```

---

## Finding Channel IDs

**From Slack:**
1. Right-click on the channel name
2. Select "Copy Link"
3. The channel ID is in the URL (e.g., `/archives/C07AA9J9LJX`)

**From ClearFeed:**
1. Go to [app.clearfeed.ai](https://app.clearfeed.ai)
2. Navigate to **Collections**
3. Channel IDs are displayed next to channel names

---

## Troubleshooting

**"Sheet not found"**
- If you have multiple sheets, update `SHEET_NAME` or rename your sheet tab

**"API request failed with status 401"**
- Your API token is invalid. Update `API_KEY` with a fresh token from [Developer Settings](https://docs.clearfeed.ai/clearfeed-help-center/account-setup/developer-settings#personal-access-token)

**"Validation Error: customers with multiple channels found"**
- Your customers have more than 1 channel. This script only supports 1 channel per customer
- Resolve via ClearFeed webapp before syncing

**"Collections NOT FOUND"**
- Check spelling of collection names (case-insensitive, but must match exactly otherwise)

**"API error (400): version must be an integer number"**
- This should not occur with the latest script version. If you see this, ensure you're using the updated `channel_sync.gs` that includes the version field for customer move operations.

**Sync shows false positives after population**
- This should not occur with the latest script version. Ensure you're using the updated `channel_sync.gs` with the fixed sync logic.

---

## API Reference

This script uses the [ClearFeed REST API](https://docs.clearfeed.ai/api).

### Customer-Centric Model Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/collections?include=channels` | GET | Fetch all collections with their channels |
| `/customers` | GET | Fetch all customers (with pagination) |
| `/customers/{id}` | PATCH | Move customer to different collection |
| `/channels/{id}` | DELETE | Delete channel (marks as inactive) |

### Legacy Model Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/collections?include=channels` | GET | Fetch all collections with their channels |
| `/collections/{id}/channels` | POST | Add channels to a collection |
| `/channels/{id}` | PATCH | Move channel to different collection |
| `/channels/{id}` | DELETE | Remove channel from ClearFeed |

### API Documentation

For detailed API documentation, request schemas, and response formats, visit:
- [ClearFeed REST API Documentation](https://docs.clearfeed.ai/api)
- [Collections API](https://docs.clearfeed.api/reference/v1/rest-api-resources#collections)
- [Customers API](https://docs.clearfeed.api/reference/v1/rest-api-resources#customers)
- [Channels API](https://docs.clearfeed.api/reference/v1/rest-api-resources#channels)

---

## License

This integration is open source under the same license as the clearfeed-recipes repository.
