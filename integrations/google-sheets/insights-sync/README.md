# ClearFeed Insights to Google Sheets

Import insights data from the ClearFeed API into Google Sheets using this Google Apps Script integration. The script fetches request count and average first response time metrics, grouped by priority, for in-progress requests from the last week.

## Prerequisites

Before you begin, make sure you have:

1. **A Google Account** with access to Google Sheets and Google Apps Script
2. **A ClearFeed API Token** (see [Personal Access Token](https://docs.clearfeed.ai/clearfeed-help-center/account-settings/developer-settings#personal-access-token))

## Quick Start Guide

### Step 1: Create a New Google Sheet

1. Go to [Google Sheets](https://sheets.google.com)
2. Click the **"+ Blank"** button to create a new spreadsheet
3. Give your spreadsheet a meaningful name like "ClearFeed Insights Dashboard"

### Step 2: Open Google Apps Script

1. In your Google Sheet, click on **Extensions** in the menu bar
2. Select **Apps Script** from the dropdown menu
3. This will open the Google Apps Script editor in a new tab

### Step 3: Add the ClearFeed Insights Script

1. In the Apps Script editor, you'll see a default `Code.gs` file
2. Delete all the existing code in the editor
3. Copy the script code from the [`insights-sync.gs`](./insights-sync.gs) file in this folder
4. Paste the entire script into the editor
5. Click the **Save** button (💾) or press `Ctrl+S` (Windows) / `Cmd+S` (Mac)

### Step 4: Configure the Script

At the top of the script, update the API token:

```javascript
const token = 'your-api-token-here';  // Replace with your actual token
```

Replace `'your-api-token-here'` with your actual ClearFeed API token.

### Step 5: Run the Script

1. Save the script
2. Select the **fetchClearfeedInsights** function from the function dropdown
3. Click the **Run** button (▶️)
4. Authorize the script when prompted

### Step 6: Grant Permissions

When you run the script for the first time, Google will ask for permissions:

1. Click **"Review permissions"**
2. Choose your Google account
3. Click **"Advanced"** if you see a warning screen
4. Click **"Go to [Your Project Name] (unsafe)"**
5. Click **"Allow"** to grant the necessary permissions

## Result

After running, your sheet will be populated with insights data:

| Requests.priority | Requests.created_at.day | Requests.count | Requests.first_response_time_avg |
| ----------------- | ------------------------ | -------------- | --------------------------------- |
| normal            | 2025-05-13T00:00:00.000  | 1              | 87.0000000000000000              |
| high              | 2025-05-18T00:00:00.000  | 1              | 240.0000000000000000             |

## Understanding the Script

### What Data Is Fetched

The script fetches the following insights:

- **Request count**: Number of requests
- **Average first response time**: Mean time to first response in minutes
- **Grouped by**: Priority level
- **Filtered by**: Requests in "in_progress" state
- **Time period**: Last 7 days
- **Granularity**: Daily

### How It Works

1. **API Call**: The script sends a POST request to the ClearFeed Insights API
2. **Data Parsing**: It parses the JSON response and extracts the insights data
3. **Sheet Population**: It clears the existing sheet content and writes the new data
4. **Headers**: Column headers are automatically extracted from the first data row

### Script Behavior

- The script clears the sheet each time before writing new data
- If no data is returned, the message "No data found" is placed in cell A1
- The script writes all keys from the API response as column headers
- All data is written to the active sheet in your spreadsheet

## Optional: Automate with a Trigger

To run this script automatically (e.g., daily):

1. Open the Apps Script editor
2. Click the clock icon ("Triggers") in the left sidebar
3. Click the **"+ Add Trigger"** button
4. Configure the trigger:
   - Choose which function to run: `fetchClearfeedInsights`
   - Select event source: "Time-driven"
   - Select type of time-based trigger: "Day timer"
   - Select time of day: Choose your preferred time
5. Click **Save**

## Troubleshooting

### Common Issues

**"No data found" message:**
- Check if there are in-progress requests from the last week
- Verify your API token is valid

**"API request failed" error:**
- Verify your API token is correct
- Check that your ClearFeed account has API access
- Ensure the Insights API is enabled for your account

**Authorization errors:**
- Re-run the permission grant process
- Make sure you're using the same Google account for both Sheets and Apps Script

## Support

For help with API queries, customizations, or integration support, reach out to ClearFeed Support at [support@clearfeed.ai](mailto:support@clearfeed.ai).

## Security Notes

- Keep your API token secure and don't share it
- The script runs in your Google account and only you have access to it
- Data is stored in your Google Sheets and follows Google's security policies
- Consider using a dedicated Google account for automated processes in enterprise environments
