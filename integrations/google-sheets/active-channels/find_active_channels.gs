// ClearFeed Active Channels to Google Sheets
// Configuration - Update these values for your setup
const CONFIG = {
  API_KEY: "", // Replace with your Clearfeed API key
  LOOKBACK_DAYS: 7, // Number of days to look back for activity (e.g., 7 for weekly, 30 for monthly)
  SHEET_SUMMARY: "Channel Activity Summary", // Name of the summary sheet tab
  SHEET_REQUESTS: "Requests", // Name of the raw requests sheet tab
  COLLECTIONS_TO_SCAN: [], // List of collection names to scan. Empty array = all collections
  SPREADSHEET_ID: "" // Leave empty to use current spreadsheet, or specify ID
};

const BASE_URL = "https://api.clearfeed.app/v1/rest";


/**
 * Main function to fetch and analyze channel activity
 * Fetches channels and requests from ClearFeed, then creates a summary
 */
function fetchClearfeedActivity() {
  try {
    Logger.log("Starting ClearFeed activity analysis...");

    const spreadsheet = getSpreadsheet();
    const summarySheet = getOrCreateSummarySheet(spreadsheet);
    const requestsSheet = getOrCreateRequestsSheet(spreadsheet);

    /********* 1) FETCH CHANNELS *********/
    Logger.log("Fetching collections and channels...");
    const channels = fetchAllChannels();
    Logger.log(`Found ${channels.length} total channels`);

    // Filter channels by collections_to_scan if specified
    const filteredChannels = filterChannelsByCollections(channels, CONFIG.COLLECTIONS_TO_SCAN);
    Logger.log(`After filtering: ${filteredChannels.length} channels`);

    /********* 2) FETCH REQUESTS in last N days *********/
    const now = new Date();
    const afterDate = new Date(now.getTime() - CONFIG.LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const afterIso = afterDate.toISOString();

    Logger.log(`Fetching requests since ${afterIso} (last ${CONFIG.LOOKBACK_DAYS} days)`);
    const requests = fetchAllRequestsSince(afterIso);
    Logger.log(`Found ${requests.length} requests in the lookback period`);

    // Build a set of channel IDs that have at least one request
    const activeChannelIds = new Set();
    requests.forEach(req => {
      if (req.channel && req.channel.id) {
        activeChannelIds.add(req.channel.id);
      }
    });

    // Mark activity status on channels
    filteredChannels.forEach(ch => {
      ch.was_active_last_n_days = activeChannelIds.has(ch.channel_id) ? 'Yes' : 'No';
      ch.request_count = countRequestsForChannel(requests, ch.channel_id);
    });

    /********* 3) WRITE TO SHEETS *********/
    writeToSheet(summarySheet, filteredChannels, "Channel Activity Summary");
    writeToSheet(requestsSheet, requests, "Requests");

    Logger.log("Activity analysis completed successfully");
    SpreadsheetApp.getUi().alert(
      'Success',
      `Channel activity analysis complete!\n\n` +
      `Total channels analyzed: ${filteredChannels.length}\n` +
      `Active channels (last ${CONFIG.LOOKBACK_DAYS} days): ${activeChannelIds.size}\n` +
      `Inactive channels: ${filteredChannels.length - activeChannelIds.size}`,
      SpreadsheetApp.getUi().ButtonSet.OK
    );

  } catch (error) {
    Logger.log(`Error during activity analysis: ${error.toString()}`);
    SpreadsheetApp.getUi().alert('Error', `Failed to fetch activity: ${error.toString()}`, SpreadsheetApp.getUi().ButtonSet.OK);
    throw error;
  }
}


/**
 * Fetch all channels from ClearFeed API
 */
function fetchAllChannels() {
  const collectionsUrl = `${BASE_URL}/collections?include=channels`;

  const response = UrlFetchApp.fetch(collectionsUrl, {
    method: 'get',
    headers: { Authorization: 'Bearer ' + CONFIG.API_KEY }
  });

  if (response.getResponseCode() !== 200) {
    throw new Error(`Failed to fetch collections: ${response.getResponseCode()} - ${response.getContentText()}`);
  }

  const data = JSON.parse(response.getContentText());
  const collections = data.collections || [];

  const channels = [];
  collections.forEach(col => {
    const colChannels = col.channels || [];
    colChannels.forEach(ch => {
      const name = ch.name && String(ch.name).trim() !== '' ? ch.name : 'N/A';
      const owner = ch.owner && String(ch.owner).trim() !== '' ? ch.owner : 'N/A';
      channels.push({
        channel_id: ch.id,
        channel_name: name,
        channel_owner: owner,
        collection_name: col.name,
        collection_id: col.id,
        was_active_last_n_days: '', // Will be filled later
        request_count: 0 // Will be filled later
      });
    });
  });

  return channels;
}


/**
 * Fetch all requests since a given date
 */
function fetchAllRequestsSince(afterIso) {
  let url = `${BASE_URL}/requests`
    + `?filter_by=created_at`
    + `&sort_order=asc`
    + `&limit=100`
    + `&after=${encodeURIComponent(afterIso)}`;

  const allRequests = [];

  while (url) {
    const resp = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { Authorization: 'Bearer ' + CONFIG.API_KEY }
    });

    if (resp.getResponseCode() !== 200) {
      throw new Error(`Failed to fetch requests: ${resp.getResponseCode()} - ${resp.getContentText()}`);
    }

    const data = JSON.parse(resp.getContentText());
    const requests = data.requests || [];
    allRequests.push.apply(allRequests, requests);

    const meta = data.response_metadata || {};
    const nextCursor = meta.next_cursor;

    if (nextCursor) {
      url = `${BASE_URL}/requests`
        + `?filter_by=created_at`
        + `&sort_order=asc`
        + `&limit=100`
        + `&after=${encodeURIComponent(afterIso)}`
        + `&next_cursor=${encodeURIComponent(nextCursor)}`;
    } else {
      url = null;
    }
  }

  return allRequests;
}


/**
 * Filter channels by collection names
 * If collectionsToScan is empty, return all channels
 */
function filterChannelsByCollections(channels, collectionsToScan) {
  if (!collectionsToScan || collectionsToScan.length === 0) {
    return channels;
  }

  // Normalize to lower case for case-insensitive comparison
  const collectionsLower = collectionsToScan.map(c => c.toLowerCase());

  return channels.filter(ch =>
    collectionsLower.includes(ch.collection_name.toLowerCase())
  );
}


/**
 * Count requests for a specific channel
 */
function countRequestsForChannel(requests, channelId) {
  return requests.filter(req => req.channel && req.channel.id === channelId).length;
}


/**
 * Write data to a sheet with headers
 */
function writeToSheet(sheet, data, sheetType) {
  sheet.clear();

  if (!data || data.length === 0) {
    sheet.getRange(1, 1).setValue(`No ${sheetType} data found`);
    return;
  }

  const headers = Object.keys(data[0]);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.getRange(1, 1, 1, headers.length).setBackground('#f0f0f0');

  const values = data.map(obj => headers.map(h => obj[h] || ''));
  sheet.getRange(2, 1, values.length, headers.length).setValues(values);

  // Auto-resize columns
  sheet.autoResizeColumns(1, headers.length);
}


/**
 * Get the spreadsheet object
 */
function getSpreadsheet() {
  if (CONFIG.SPREADSHEET_ID) {
    return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  } else {
    return SpreadsheetApp.getActiveSpreadsheet();
  }
}


/**
 * Get or create the summary sheet
 */
function getOrCreateSummarySheet(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(CONFIG.SHEET_SUMMARY);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(CONFIG.SHEET_SUMMARY);
    Logger.log(`Created new sheet: ${CONFIG.SHEET_SUMMARY}`);
  }

  return sheet;
}


/**
 * Get or create the requests sheet
 */
function getOrCreateRequestsSheet(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(CONFIG.SHEET_REQUESTS);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(CONFIG.SHEET_REQUESTS);
    Logger.log(`Created new sheet: ${CONFIG.SHEET_REQUESTS}`);
  }

  return sheet;
}


/**
 * Utility function to test API connection
 */
function testClearfeedConnection() {
  try {
    Logger.log("Testing ClearFeed API connection...");

    const collectionsUrl = `${BASE_URL}/collections?include=channels`;
    const response = UrlFetchApp.fetch(collectionsUrl, {
      method: 'get',
      headers: { Authorization: 'Bearer ' + CONFIG.API_KEY }
    });

    if (response.getResponseCode() === 200) {
      const data = JSON.parse(response.getContentText());
      const collectionCount = data.collections ? data.collections.length : 0;

      let totalChannels = 0;
      if (data.collections) {
        data.collections.forEach(col => {
          totalChannels += col.channels ? col.channels.length : 0;
        });
      }

      Logger.log("✅ API connection successful");
      Logger.log(`Found ${collectionCount} collections with ${totalChannels} channels`);

      SpreadsheetApp.getUi().alert(
        'Connection Test Successful',
        `Successfully connected to ClearFeed API!\n\n` +
        `Collections: ${collectionCount}\n` +
        `Total Channels: ${totalChannels}`,
        SpreadsheetApp.getUi().ButtonSet.OK
      );
    } else {
      Logger.log(`❌ API connection failed: ${response.getResponseCode()}`);
      SpreadsheetApp.getUi().alert(
        'Connection Test Failed',
        `Failed to connect: ${response.getResponseCode()}\n${response.getContentText()}`,
        SpreadsheetApp.getUi().ButtonSet.OK
      );
    }

  } catch (error) {
    Logger.log(`❌ Connection test failed: ${error.toString()}`);
    SpreadsheetApp.getUi().alert(
      'Connection Test Failed',
      `Error: ${error.toString()}`,
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  }
}


/**
 * Clear the activity summary and requests sheets
 */
function clearActivityData() {
  const spreadsheet = getSpreadsheet();

  const summarySheet = spreadsheet.getSheetByName(CONFIG.SHEET_SUMMARY);
  if (summarySheet) {
    summarySheet.clear();
    Logger.log(`Cleared ${CONFIG.SHEET_SUMMARY} sheet`);
  }

  const requestsSheet = spreadsheet.getSheetByName(CONFIG.SHEET_REQUESTS);
  if (requestsSheet) {
    requestsSheet.clear();
    Logger.log(`Cleared ${CONFIG.SHEET_REQUESTS} sheet`);
  }

  SpreadsheetApp.getUi().alert(
    'Success',
    'Activity data has been cleared.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}


/**
 * Create custom menu in Google Sheet
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  const menu = ui.createMenu('ClearFeed Activity')
    .addItem('📊 Fetch ClearFeed Activity', 'fetchClearfeedActivity')
    .addItem('🧪 Test Connection', 'testClearfeedConnection')
    .addSeparator()
    .addItem('🗑️ Clear Data', 'clearActivityData')
    .addItem('📋 View Logs', 'showLogs');

  menu.addToUi();
}


/**
 * Show logs in a dialog
 */
function showLogs() {
  const ui = SpreadsheetApp.getUi();
  ui.alert(
    'View Logs',
    'To view detailed logs:\n\n1. Go to Extensions > Apps Script\n2. In the editor, go to View > Logs\n3. Run a function and check the logs',
    ui.ButtonSet.OK
  );
}
