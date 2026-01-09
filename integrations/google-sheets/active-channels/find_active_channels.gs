// ClearFeed Active Channels to Google Sheets
// Configuration - Update these values for your setup
const CONFIG = {
  API_KEY: "", // Replace with your Clearfeed API key
  LOOKBACK_DAYS: 7, // Number of days to look back for activity (e.g., 7 for weekly, 30 for monthly)
  SHEET_SUMMARY: "Channel Activity Summary", // Name of the summary sheet tab
  SHEET_REQUESTS: "Requests", // Name of the raw requests sheet tab
  COLLECTIONS_TO_SCAN: [], // List of collection names to scan. Empty array = all collections
  SPREADSHEET_ID: "", // Leave empty to use current spreadsheet, or specify ID
  SLACK_WEBHOOK_URL: "", // Slack webhook URL to send inactive channel notifications
  SLACK_WORKSPACE_DOMAIN: "" // Slack workspace domain (e.g., "clearfeed.slack.com") for channel links
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
    const activityColumn = `was_active_last_${CONFIG.LOOKBACK_DAYS}_days`;
    filteredChannels.forEach(ch => {
      ch[activityColumn] = activeChannelIds.has(ch.channel_id) ? 'Yes' : 'No';
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
  const activityColumn = `was_active_last_${CONFIG.LOOKBACK_DAYS}_days`;

  collections.forEach(col => {
    const colChannels = col.channels || [];
    colChannels.forEach(ch => {
      const name = ch.name && String(ch.name).trim() !== '' ? ch.name : 'N/A';

      const channelObj = {
        channel_id: ch.id,
        channel_name: name,
        collection_name: col.name,
        collection_id: col.id,
        request_count: 0 // Will be filled later
      };

      // Build channel URL if workspace domain is configured (stored as hidden property for hyperlink use)
      if (CONFIG.SLACK_WORKSPACE_DOMAIN && CONFIG.SLACK_WORKSPACE_DOMAIN !== '') {
        channelObj._channel_url = `https://${CONFIG.SLACK_WORKSPACE_DOMAIN}/archives/${ch.id}`;
      }

      channelObj[activityColumn] = ''; // Will be filled later
      channels.push(channelObj);
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

  // Get headers, filtering out internal properties (starting with _)
  const headers = Object.keys(data[0]).filter(key => !key.startsWith('_'));
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.getRange(1, 1, 1, headers.length).setBackground('#f0f0f0');

  // Build values array, using HYPERLINK formula for channel_name if _channel_url exists
  const values = data.map(obj => {
    return headers.map(h => {
      const value = obj[h] || '';

      // For channel_name with _channel_url, create a hyperlink formula
      if (h === 'channel_name' && obj._channel_url) {
        return `=HYPERLINK("${obj._channel_url}", "${value}")`;
      }

      return value;
    });
  });

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
 * Send inactive channels list to Slack webhook
 */
function sendInactiveChannelsToSlack() {
  try {
    // Validate webhook URL
    if (!CONFIG.SLACK_WEBHOOK_URL || CONFIG.SLACK_WEBHOOK_URL === "") {
      SpreadsheetApp.getUi().alert(
        'Configuration Required',
        'Please set SLACK_WEBHOOK_URL in the CONFIG section before sending notifications.',
        SpreadsheetApp.getUi().ButtonSet.OK
      );
      return;
    }

    Logger.log("Preparing to send inactive channels to Slack...");

    const spreadsheet = getSpreadsheet();
    const summarySheet = spreadsheet.getSheetByName(CONFIG.SHEET_SUMMARY);

    if (!summarySheet) {
      SpreadsheetApp.getUi().alert(
        'No Data Found',
        'Please run "Fetch ClearFeed Activity" first to generate the channel summary.',
        SpreadsheetApp.getUi().ButtonSet.OK
      );
      return;
    }

    // Read data from summary sheet
    const dataRange = summarySheet.getDataRange();
    const values = dataRange.getValues();

    if (values.length < 2) {
      SpreadsheetApp.getUi().alert(
        'No Data Found',
        'The summary sheet is empty. Please run "Fetch ClearFeed Activity" first.',
        SpreadsheetApp.getUi().ButtonSet.OK
      );
      return;
    }

    const headers = values[0];
    const activityColumn = `was_active_last_${CONFIG.LOOKBACK_DAYS}_days`;
    const activityIndex = headers.indexOf(activityColumn);

    if (activityIndex === -1) {
      SpreadsheetApp.getUi().alert(
        'Data Mismatch',
        `The activity column "${activityColumn}" was not found in the summary sheet. Please fetch fresh data.`,
        SpreadsheetApp.getUi().ButtonSet.OK
      );
      return;
    }

    // Find inactive channels
    const inactiveChannels = [];
    for (let i = 1; i < values.length; i++) {
      const row = values[i];
      const activity = String(row[activityIndex] || '').trim().toLowerCase();

      if (activity === 'no') {
        let channelName = headers.indexOf('channel_name') !== -1 ? row[headers.indexOf('channel_name')] : 'Unknown';
        const collectionName = headers.indexOf('collection_name') !== -1 ? row[headers.indexOf('collection_name')] : 'Unknown';
        const channelId = headers.indexOf('channel_id') !== -1 ? row[headers.indexOf('channel_id')] : '';

        // Extract just the channel name from HYPERLINK formula if present
        if (String(channelName).startsWith('=HYPERLINK(')) {
          const match = channelName.match(/=HYPERLINK\("([^"]+)",\s*"([^"]+)"\)/);
          if (match) {
            channelName = match[2]; // Get the anchor text
          }
        }

        inactiveChannels.push({
          channel_name: String(channelName || ''),
          collection_name: String(collectionName || ''),
          channel_id: String(channelId || '')
        });
      }
    }

    if (inactiveChannels.length === 0) {
      SpreadsheetApp.getUi().alert(
        'No Inactive Channels',
        `Great news! All channels have been active in the last ${CONFIG.LOOKBACK_DAYS} days.`,
        SpreadsheetApp.getUi().ButtonSet.OK
      );
      return;
    }

    // Group by collection
    const groupedByCollection = {};
    inactiveChannels.forEach(ch => {
      const collection = ch.collection_name || 'Unknown';
      if (!groupedByCollection[collection]) {
        groupedByCollection[collection] = [];
      }
      // Push the full channel object, not just the name
      groupedByCollection[collection].push(ch);
    });

    // Build and send Slack messages (handles chunking if too long)
    const messagesSent = buildAndSendSlackMessages(inactiveChannels.length, groupedByCollection);

    if (messagesSent > 0) {
      Logger.log(`Successfully sent ${messagesSent} message(s) with ${inactiveChannels.length} inactive channels to Slack`);
      SpreadsheetApp.getUi().alert(
        'Success',
        `Successfully sent inactive channel list to Slack!\n\n` +
        `Total inactive channels: ${inactiveChannels.length}\n` +
        `Messages sent: ${messagesSent}\n` +
        `Lookback period: Last ${CONFIG.LOOKBACK_DAYS} days`,
        SpreadsheetApp.getUi().ButtonSet.OK
      );
    } else {
      throw new Error('Failed to send to Slack. Check logs for details.');
    }

  } catch (error) {
    Logger.log(`Error sending to Slack: ${error.toString()}`);
    SpreadsheetApp.getUi().alert(
      'Error',
      `Failed to send to Slack: ${error.toString()}`,
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  }
}


/**
 * Build and send Slack messages with chunking support
 * Returns the number of messages sent successfully
 */
function buildAndSendSlackMessages(totalInactive, groupedByCollection) {
  const MAX_MESSAGE_LENGTH = 1200; // Conservative limit - accounting for JSON encoding overhead
  const activityPeriod = CONFIG.LOOKBACK_DAYS === 1 ? '24 hours' : `last ${CONFIG.LOOKBACK_DAYS} days`;

  const collections = Object.keys(groupedByCollection);

  // Build a single collection section
  const buildCollectionSection = (collection, channels) => {
    let section = `*${collection}* (${channels.length} channels):\n`;
    channels.forEach(ch => {
      if (CONFIG.SLACK_WORKSPACE_DOMAIN && CONFIG.SLACK_WORKSPACE_DOMAIN !== '' && ch.channel_id) {
        const channelUrl = `https://${CONFIG.SLACK_WORKSPACE_DOMAIN}/archives/${ch.channel_id}`;
        section += `  • <${channelUrl}|${ch.channel_name}>\n`;
      } else {
        section += `  • ${ch.channel_name}\n`;
      }
    });
    return section + '\n';
  };

  // Calculate actual JSON payload size (accounts for escaping)
  const getPayloadSize = (text) => {
    return JSON.stringify({ text: text }).length;
  };

  // First pass: determine how many chunks we need
  const chunkInfo = [];
  let currentLength = 0;
  let currentChunkCollections = [];

  // Base header length estimate (using actual payload size)
  const baseHeaderLength = getPayloadSize(`📢 *ClearFeed Channel Activity Report* (${Math.ceil(collections.length)} parts)\n\nFound *${totalInactive}* inactive channels in the ${activityPeriod}:\n\n`);

  for (let i = 0; i < collections.length; i++) {
    const collection = collections[i];
    const channels = groupedByCollection[collection];
    const section = buildCollectionSection(collection, channels);
    const sectionPayloadSize = getPayloadSize(section);

    Logger.log(`Collection "${collection}": ${section.length} chars, ${sectionPayloadSize} bytes in JSON`);

    if (currentLength + sectionPayloadSize + baseHeaderLength > MAX_MESSAGE_LENGTH && currentChunkCollections.length > 0) {
      // Start a new chunk
      chunkInfo.push([...currentChunkCollections]);
      currentChunkCollections = [];
      currentLength = 0;
    }

    currentChunkCollections.push({ collection, channels, section });
    currentLength += sectionPayloadSize;
  }

  // Add the last chunk
  if (currentChunkCollections.length > 0) {
    chunkInfo.push(currentChunkCollections);
  }

  const totalChunks = chunkInfo.length;
  Logger.log(`Total chunks to send: ${totalChunks}`);

  // Second pass: build and send the messages
  let messagesSent = 0;

  for (let chunkIndex = 0; chunkIndex < chunkInfo.length; chunkIndex++) {
    const chunkCollections = chunkInfo[chunkIndex];
    let text = '';

    // Build header
    if (totalChunks === 1) {
      text = `📢 *ClearFeed Channel Activity Report*\n\nFound *${totalInactive}* inactive channels in the ${activityPeriod}:\n\n`;
    } else if (chunkIndex === 0) {
      text = `📢 *ClearFeed Channel Activity Report* (${totalChunks} parts)\n\nFound *${totalInactive}* inactive channels in the ${activityPeriod}:\n\n`;
    } else {
      text = `📢 *ClearFeed Channel Activity Report* (part ${chunkIndex + 1}/${totalChunks})\n\n`;
    }

    // Add collections for this chunk
    for (const item of chunkCollections) {
      text += item.section;
    }

    const finalPayload = JSON.stringify({ text: text });
    Logger.log(`Chunk ${chunkIndex + 1}/${totalChunks}: ${text.length} chars text, ${finalPayload.length} bytes payload`);
    Logger.log(`Payload size vs limit: ${finalPayload.length}/${MAX_MESSAGE_LENGTH}`);

    // Safety check - if still too long, truncate
    if (finalPayload.length > MAX_MESSAGE_LENGTH) {
      Logger.log(`WARNING: Chunk ${chunkIndex + 1} is still too long (${finalPayload.length} > ${MAX_MESSAGE_LENGTH}), truncating`);
      // Truncate to safe size
      const safeText = text.substring(0, MAX_MESSAGE_LENGTH - 100);
      text = safeText + '\n\n...(truncated)';
    }

    // Send this chunk
    if (postSlackWebhookRaw(text)) {
      messagesSent++;
    }
  }

  return messagesSent;
}


/**
 * Post raw text to Slack webhook
 */
function postSlackWebhookRaw(text) {
  const message = { text: text };
  const payload = JSON.stringify(message);

  Logger.log(`Sending to Slack webhook:`);
  Logger.log(`Payload length: ${payload.length} characters`);
  Logger.log(`Payload: ${payload}`);

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: payload,
    muteHttpExceptions: true
  };

  const resp = UrlFetchApp.fetch(CONFIG.SLACK_WEBHOOK_URL, options);
  const status = resp.getResponseCode();
  const responseText = resp.getContentText();

  Logger.log(`Slack response status: ${status}`);
  Logger.log(`Slack response body: ${responseText}`);

  if (status < 200 || status >= 300) {
    Logger.log(`Slack webhook failed: ${status} - ${responseText}`);
    return false;
  }

  Logger.log('Slack webhook sent successfully');
  return true;
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
    .addItem('📤 Send Inactive Channel List to Slack', 'sendInactiveChannelsToSlack')
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
