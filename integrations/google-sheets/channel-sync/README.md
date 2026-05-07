# ClearFeed Channel Sync for Google Sheets

A Google Apps Script that syncs channel mappings from a Google Sheet to ClearFeed. Bulk manage your channels, customers, and collections directly from a spreadsheet.

## Features

- **Bulk Management** - Add, move, or remove multiple channels at once
- **Plan Preview** - See exactly what changes will be made before executing
- **Safe by Default** - Channel deletion is disabled by default (must be explicitly enabled)
- **Dual Model Support** - Works with both Customer-Centric and Legacy Collection-Channel models

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
};
```

### Step 3: Choose Your Model

Set `IS_ON_CUSTOMER_INBOX_MODEL` based on your ClearFeed account:

- **`true`** - Customer-Centric Inbox Model (newer accounts)
- **`false`** - Legacy Collection-Channel Model (older accounts)

Refresh your Google Sheet to see the appropriate menu.

---

## Customer-Centric Inbox Model

Use this model if your ClearFeed account organizes channels by **Customers**. Each customer has exactly one Slack channel.

### Sheet Format

| Collection | Customer | Channel Name | Channel ID |
|------------|----------|--------------|------------|
| Support | Acme Corp | #acme-support | C07AA9J9LJX |
| Sales | Startup Inc | #startup-sales | C06BB9H9HKW |

### Getting Started

1. **Test Connection** - Click **Customers Sync** > **🧪 Test Connection**
2. **Populate Sheet** - Click **📥 Populate Initial Mappings**
   - Fetches all customers from ClearFeed
   - Validates each customer has exactly 1 channel
   - Sets up auto-sync (every 1 hour)
3. **Sync Changes** - Click **🔄 Sync Customer Changes** when you make changes

### What You Can Do

| Action | How |
|--------|-----|
| Move customer to different collection | Change the **Collection** column, then sync |
| Stop monitoring a channel | Delete the row, then sync (with `INCLUDE_DELETES=true`) |

### Important Notes

- **One channel per customer only** - Script will error if any customer has multiple channels
- **No adding new customers** - Create customers via ClearFeed webapp, then populate sheet
- **Auto-sync** - Runs every 1 hour to reflect webapp changes in your sheet

### Menu Options

| Option | Purpose |
|--------|---------|
| 📥 Populate Initial Mappings | First-time setup: fetches customers and populates sheet |
| 🔄 Sync Customer Changes | Syncs your sheet changes to ClearFeed |
| ⏰ Setup Auto-Sync | Enables automatic sync every hour |
| 🛑 Stop Auto-Sync | Disables automatic sync |
| 🧪 Test Connection | Validates API and shows customer statistics |

---

## Legacy Collection-Channel Model

Use this model if your ClearFeed account organizes channels directly by **Collections**.

### Sheet Format

| Collection | Channel Name | Channel ID |
|------------|--------------|------------|
| Support | #support-tickets | C07AA9J9LJX |
| Engineering | #eng-help | C06BB9H9HKW |

### Getting Started

1. **Test Connection** - Click **ClearFeed Channel Sync** > **🧪 Test Connection**
2. **(Optional) Populate Sheet** - Click **📥 Populate Initial Mappings** to fetch existing channels
3. **Sync Changes** - Click **🔄 Sync Channels** and confirm the plan

### What You Can Do

| Action | How |
|--------|-----|
| Add new channel | Add a row with Collection, Channel Name, and Channel ID, then sync |
| Move channel to different collection | Change the **Collection** column, then sync |
| Stop monitoring a channel | Delete the row, then sync (with `INCLUDE_DELETES=true`) |

### Menu Options

| Option | Purpose |
|--------|---------|
| 📥 Populate Initial Mappings | Fetches all channels from ClearFeed and populates sheet |
| 🔄 Sync Channels | Syncs your sheet changes to ClearFeed |
| 🧪 Test Connection | Validates API and shows collection count |

---

## Configuration Options

| Setting | Description | Default |
|---------|-------------|---------|
| `API_KEY` | Your ClearFeed API token (required) | *(empty)* |
| `IS_ON_CUSTOMER_INBOX_MODEL` | Model selection: `true` = Customer-Centric, `false` = Legacy | `true` |
| `INCLUDE_DELETES` | Allow channel deletion/unmonitoring | `false` |
| `SHEET_NAME` | Sheet tab name | `"Channel Mappings"` |
| `SPREADSHEET_ID` | Use a different spreadsheet (empty = current) | *(empty)* |

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
- Your API token is invalid. Update `API_KEY` with a fresh token

**"Validation Error: customers with multiple channels found"**
- Your customers have more than 1 channel. This script only supports 1 channel per customer

**"Collections NOT FOUND"**
- Check spelling of collection names (case-insensitive, but must match exactly)

---

## API Documentation

This script uses the [ClearFeed REST API](https://docs.clearfeed.ai/api).

### Customer-Centric Model Endpoints

- `GET /collections?include=channels` - Fetch collections with channels
- `GET /customers` - Fetch all customers (paginated)
- `PATCH /customers/{id}` - Move customer to different collection
- `DELETE /channels/{id}` - Unmonitor channel

### Legacy Model Endpoints

- `GET /collections?include=channels` - Fetch collections with channels
- `POST /collections/{id}/channels` - Add channels to collection
- `PATCH /channels/{id}` - Move channel to different collection
- `DELETE /channels/{id}` - Remove channel

---

## License

This integration is open source under the same license as the clearfeed-recipes repository.
