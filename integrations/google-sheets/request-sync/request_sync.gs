// Clearfeed to Google Sheets Sync Script
// Configuration - Update these values for your setup
const CONFIG = {
  API_KEY: "", // Replace with your Clearfeed API key
  COLLECTION_ID: null, // Replace with your collection ID or set to null/empty to fetch from all collections
  SHEET_NAME: "ClearFeed Requests", // Name of the sheet tab
  SPREADSHEET_ID: "", // Leave empty to use current spreadsheet, or specify ID
  INITIAL_DAYS_BACK: 14, // For initial sync, fetch requests from this many days back
  INCLUDE_MESSAGES: false // Set to true to include messages in the sync (disabled by default)
};

const BASE_URL="https://api.clearfeed.app/v1/rest/requests";
const LAST_SYNC_PROPERTY = "LAST_SYNC_PROPERTY";
const CUSTOM_FIELDS_URL = 'https://api.clearfeed.app/v1/rest/custom-fields';


/**
 * Main function to sync Clearfeed requests
 * Can be called manually or via trigger
 */
function syncClearfeedRequests() {
  try {
    Logger.log("Starting Clearfeed sync...");

    const sheet = getOrCreateSheet();
    const lastSyncTime = getLastSyncTime();
    const isInitialSync = !lastSyncTime;

    Logger.log(`Sync Type: ${isInitialSync ? 'INITIAL' : 'INCREMENTAL'}`);
    Logger.log(`Last sync time: ${lastSyncTime || 'Never'}`);

    if (isInitialSync) {
      Logger.log(`Initial sync will fetch requests created in last ${CONFIG.INITIAL_DAYS_BACK} days`);
    }

    // Fetch requests from Clearfeed
    const requests = fetchClearfeedRequests(isInitialSync, lastSyncTime);
    Logger.log(`Fetched ${requests.length} requests`);

    if (requests.length === 0) {
      Logger.log("No new or updated requests found");
      return;
    }

    // Update the sheet
    if (isInitialSync) {
      populateInitialData(sheet, requests);
    } else {
      mergeIncrementalData(sheet, requests);
    }

    // Update last sync time
    setLastSyncTime(new Date().toISOString());

    Logger.log("Sync completed successfully");

  } catch (error) {
    Logger.log(`Error during sync: ${error.toString()}`);
    throw error;
  }
}

/**
 * Fetch all requests from Clearfeed API with cursor-based pagination
 */
function fetchClearfeedRequests(isInitialSync, lastSyncTime = null) {
  const allRequests = [];
  let nextCursor = null;
  const limit = 100;
  let batchCount = 0;

  const headers = {
    "Authorization": `Bearer ${CONFIG.API_KEY}`,
    "Content-Type": "application/json"
  };

  const initialDate = new Date();
  initialDate.setDate(initialDate.getDate() - CONFIG.INITIAL_DAYS_BACK);


  while (true) {
    batchCount++;
    const params = {
      limit: limit
    };

    // Only add collection_id if it's set
    if (CONFIG.COLLECTION_ID) {
      params.collection_id = CONFIG.COLLECTION_ID;
    }

    // Add cursor for pagination (skip on first request)
    if (nextCursor) {
      params.next_cursor = nextCursor;
    }

    // Include messages if configured
    if (CONFIG.INCLUDE_MESSAGES) {
      params.include = "messages";
    }

    // Set up time filtering based on sync type
    if (isInitialSync) {
      // Initial sync: use created_at filter for last INITIAL_DAYS_BACK days
      params.filter_by = "created_at";
      params.after = initialDate.toISOString();
      Logger.log(`Initial sync batch ${batchCount}: fetching requests created after ${params.after}`);
    } else if (lastSyncTime) {
      // Incremental sync: use updated_at filter from last sync time
      params.filter_by = "updated_at";
      params.after = lastSyncTime;
      Logger.log(`Incremental sync batch ${batchCount}: fetching requests updated after ${params.after}`);
    } else {
      // Fallback: use created_at without after filter
      params.filter_by = "created_at";
      Logger.log(`Fallback batch ${batchCount}: fetching all requests`);
    }

    // Build URL with parameters
    const url = `${BASE_URL}?${Object.keys(params).map(key =>
      `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`
    ).join('&')}`;

    Logger.log(`Making API request: ${url}`);

    const response = UrlFetchApp.fetch(url, {
      method: 'GET',
      headers: headers
    });

    if (response.getResponseCode() !== 200) {
      throw new Error(`API request failed: ${response.getResponseCode()} - ${response.getContentText()}`);
    }

    const data = JSON.parse(response.getContentText());
    const requestsPage = data.requests || [];

    allRequests.push(...requestsPage);
    Logger.log(`Batch ${batchCount}: Retrieved ${requestsPage.length} requests`);

    // Check if there's a next cursor in response_metadata
    const responseMetadata = data.response_metadata || {};
    nextCursor = responseMetadata.next_cursor;

    Logger.log(`Next cursor: ${nextCursor || 'None'}`);

    // Stop if no next_cursor or no more data
    if (!nextCursor || requestsPage.length === 0) {
      break;
    }
  }

  Logger.log(`Total requests fetched: ${allRequests.length}`);
  return allRequests;
}

/**
 * Get all Custom Fields added in an Account
 */

function getCustomFieldData() {
  const headers = {'Authorization': 'Bearer ' + CONFIG.API_KEY};
  const response = UrlFetchApp.fetch(CUSTOM_FIELDS_URL, {method: 'GET', headers});

  if (response.getResponseCode() !== 200) {
    Logger.log('Custom Fields API error: ' + response.getResponseCode());
    return [];
  }

  const apiData = JSON.parse(response.getContentText());
  const fields = apiData.custom_fields || [];
  Logger.log('Fetched ' + fields.length + ' custom fields');
  return fields;
}

/**
 * Resolving Values of Custom fields based on their types
 */

function resolveCustomFieldValue(rawValue, cf) {
  const type = cf.type;

  if (type === 'text' || type === 'date' || type === 'number') {
    return rawValue || '';
  }

  if (type === 'select') {
    const options = cf.config.options || [];
    const opt = options.find(o => String(o.id) === String(rawValue));
    return opt ? opt.value : rawValue;
  }

  if (type === 'multi_select') {
    if (!Array.isArray(rawValue)) return '';
    const options = cf.config.options || [];
    const values = rawValue.map(id => {
      const opt = options.find(o => String(o.id) === String(id));
      return opt ? opt.value : id;
    }).filter(Boolean);
    return values.join(', ');
  }

  return String(rawValue);
}

/**
 * Get or create the target sheet
 */

function getOrCreateSheet() {
  let spreadsheet;

  if (CONFIG.SPREADSHEET_ID) {
    spreadsheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  } else {
    spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  }

  let sheet = spreadsheet.getSheetByName(CONFIG.SHEET_NAME);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(CONFIG.SHEET_NAME);
    Logger.log(`Created new sheet: ${CONFIG.SHEET_NAME}`);
  }

  return sheet;
}

/**
 * Get the timestamp of the last sync
 */

function getLastSyncTime() {
  return PropertiesService.getScriptProperties().getProperty(LAST_SYNC_PROPERTY);
}

/**
 * Set the timestamp of the last sync
 */

function setLastSyncTime(timestamp) {
  PropertiesService.getScriptProperties().setProperty(LAST_SYNC_PROPERTY, timestamp);
}

/**
 * Populate sheet with initial data (first run)
 */

function populateInitialData(sheet, requests) {
  if (requests.length === 0) return;

  // Clear existing data
  sheet.clear();

  // Create headers based on the first request structure
  const headers = getRequestHeaders();

  // Set headers
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setValues([headers]);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#f0f0f0');

  // Add data rows
  const dataRows = requests.map(request => extractRequestData(request, headers));

  if (dataRows.length > 0) {
    const dataRange = sheet.getRange(2, 1, dataRows.length, headers.length);
    dataRange.setValues(dataRows);
  }

  sheet.autoResizeColumns(1, headers.length);
  Logger.log(`Initial sync: Added ${requests.length} requests`);
}

/**
 * Merge incremental data into existing sheet
 */

function mergeIncrementalData(sheet, requests) {
  if (requests.length === 0) return;

  // Get existing data
  const lastRow = sheet.getLastRow();
  if (lastRow < 1) {
    // No existing data, treat as initial sync
    populateInitialData(sheet, requests);
    return;
  }

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const existingData = lastRow > 1 ?
    sheet.getRange(2, 1, lastRow - 1, headers.length).getValues() : [];

  // Create a map of existing requests by ID for quick lookup
  const idColumnIndex = headers.indexOf('id');
  if (idColumnIndex === -1) {
    throw new Error("ID column not found in existing sheet");
  }

  const existingRequestsMap = new Map();
  existingData.forEach((row, index) => {
    existingRequestsMap.set(row[idColumnIndex], index + 2); // +2 for header row and 1-based indexing
  });

  let updatedCount = 0;
  let addedCount = 0;

  requests.forEach(request => {
    const requestData = extractRequestData(request, headers);
    const requestId = request.id;

    if (existingRequestsMap.has(requestId)) {
      // Update existing row
      const rowIndex = existingRequestsMap.get(requestId);
      const range = sheet.getRange(rowIndex, 1, 1, headers.length);
      range.setValues([requestData]);
      updatedCount++;
    } else {
      // Add new row
      sheet.appendRow(requestData);
      addedCount++;
    }
  });

  sheet.autoResizeColumns(1, headers.length);
  Logger.log(`Incremental sync: Updated ${updatedCount} requests, added ${addedCount} new requests`);
}

/**
 * Extract headers from a request object
 */

function getRequestHeaders() {
  const headers = [
    'id',
    'title',
    'priority',
    'created_at',     // Displays as "created_at" in sheet
    'updated_at',     // Displays as "updated_at" in sheet
    'assignee',      // request.assignee.id
    'state',
    'author',        // request.author.id
    'author_email',   // request.authoremail
    'assigned_team',  // request.assignedteam.id
    'tickets',        // JSON stringified array
    'CSAT_Survey',
    'Channel',
    'Collection',
    'Request_Channel_URL',
    'Triage_Channel_URL',
    'First_Response_Time',
    'Resolution_Time'
  ];

  // Fetching Custom_Fields and appending their "names" as columns
  const cfData = getCustomFieldData();
  const cfNames = cfData.map(cf => cf.name);

  return headers.concat(cfNames);
}

/**
 * Fetching the Values of Other Standard Fields as specified in the Payload
 */

function getExtraColumnValue(request, index, header) {
  const csat = request.csat_survey;

  switch (index) {
    case 0: // CSAT_Survey
      if (!csat || csat.status !== 'received' || !csat.response) return '';

      const surveyType = csat.response.survey_type;
      const value = csat.response.value;

      if (surveyType === 'two_point_rating') {
        return value === 2 ? '👍' : '👎';
      }
      if (surveyType === 'five_point_rating') {
        const max = csat.response.max_value || 5;
        return value + ' out of ' + max;
      }
      return '';

    case 1: // Channel
      return request.channel ? request.channel.name || '' : '';

    case 2: // Collection
      return request.collection ? request.collection.name || '' : '';

    case 3: // Request_Channel_URL
      return request.request_thread ? request.request_thread.url || '' : '';

    case 4: // Triage_Channel_URL
      return request.triage_thread ? request.triage_thread.url || '' : '';

    case 5: // First_Response_Time
      const frt = request.sla_metrics?.first_response_time;
      if (!frt?.value) return '';
      return frt.is_breached ?
        frt.value + ' mins [Breached]' :
        frt.value + ' mins';

    case 6: // Resolution_Time
      const rt = request.sla_metrics?.resolution_time;
      if (!rt?.value) return '';
      return rt.is_breached ?
        rt.value + ' mins [Breached]' :
        rt.value + ' mins';
  }
  return '';
}


/**
 * Extract data from a request object based on headers
 */
function extractRequestData(request, headers) {
  const flatRequest = flattenObject(request);
  const cfData = getCustomFieldData();
  const baseCount = 11;  // id,title,...tickets

  return headers.map(function(header, colIndex) {
    // Tickets hyperlinks (col 10)
    if (header === 'tickets') {
  const tickets = request.tickets || [];
  if (!tickets.length) return '';

  // Filter out clearfeed tickets
  const nonClearfeedTickets = tickets.filter(t => t.type !== 'clearfeed');
  if (!nonClearfeedTickets.length) return '';

  const links = nonClearfeedTickets.map(t =>
    '=HYPERLINK("' + (t.url || '#') + '","' + (t.key || 'No Key') + '")'
  );
  return links.join(', ');
}

    // NEW COLUMNS (cols 11-17)
    const extraIndex = colIndex - baseCount;
    if (extraIndex >= 0 && extraIndex < 7) {
      return getExtraColumnValue(request, extraIndex, header);
    }

    // Custom fields (col 18+)
    const cfIndex = colIndex - (baseCount + 7);
    if (cfIndex >= 0 && cfIndex < cfData.length) {
      const cf = cfData[cfIndex];
      const cfValues = request.custom_field_values || {};
      const rawValue = cfValues[String(cf.id)];
      if (!rawValue) return '';
      return resolveCustomFieldValue(rawValue, cf);
    }

    // Base columns
    const value = flatRequest[header];
    if (value == null) return '';
    if (header === 'messages' && Array.isArray(request.messages)) {
      return formatMessages(request.messages);
    }
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  });
}

/**
 * Format messages array for sheet display
 */
function formatMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return [];
  }

  return messages.map(message => {
    const prefix = message.is_responder ? "r" : "nr";
    return [prefix, message.text || ""];
  });
}

/**
 * Flatten nested objects for easier sheet representation
 */
function flattenObject(obj, prefix = '') {
  const flattened = {};

  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      const value = obj[key];
      const newKey = prefix ? `${prefix}.${key}` : key;

      // Special handling for messages array - don't flatten it
      if (key === 'messages' && Array.isArray(value)) {
        flattened[newKey] = value;
      } else if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
        // Recursively flatten nested objects
        Object.assign(flattened, flattenObject(value, newKey));
      } else {
        flattened[newKey] = value;
      }
    }
  }

  return flattened;
}

/**
 * Set up hourly trigger for automatic sync
 */
function enableHourlyTrigger() {
  // Delete existing triggers for this function first
  disableHourlyTrigger();

  // Create new hourly trigger
  ScriptApp.newTrigger('syncClearfeedRequests')
    .timeBased()
    .everyHours(1)
    .inTimezone('America/Los_Angeles') // Pacific timezone
    .create();

  Logger.log("✅ Hourly automatic sync enabled");
  SpreadsheetApp.getUi().alert('Success', 'Hourly automatic sync has been enabled. The script will now run every hour.', SpreadsheetApp.getUi().ButtonSet.OK);
}

/**
 * Disable hourly trigger for automatic sync
 */
function disableHourlyTrigger() {
  // Delete existing triggers for this function
  const triggers = ScriptApp.getProjectTriggers();
  let deletedCount = 0;

  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'syncClearfeedRequests') {
      ScriptApp.deleteTrigger(trigger);
      deletedCount++;
    }
  });

  if (deletedCount > 0) {
    Logger.log(`❌ Disabled ${deletedCount} hourly trigger(s)`);
    SpreadsheetApp.getUi().alert('Success', 'Hourly automatic sync has been disabled.', SpreadsheetApp.getUi().ButtonSet.OK);
  } else {
    Logger.log("No hourly triggers found to disable");
    SpreadsheetApp.getUi().alert('Info', 'No hourly triggers were found. Automatic sync was already disabled.', SpreadsheetApp.getUi().ButtonSet.OK);
  }
}

/**
 * Check if hourly trigger is currently enabled
 */
function isHourlyTriggerEnabled() {
  const triggers = ScriptApp.getProjectTriggers();
  return triggers.some(trigger => trigger.getHandlerFunction() === 'syncClearfeedRequests');
}

/**
 * Manual setup function - run this once to configure everything
 */
function setupSync() {
  try {
    // Validate configuration
    if (!CONFIG.API_KEY || CONFIG.API_KEY === "YOUR_API_KEY") {
      throw new Error("Please update CONFIG.API_KEY with your actual Clearfeed API key");
    }

    // Collection ID is now optional - no validation needed

    // Run initial sync
    syncClearfeedRequests();

    Logger.log("Setup completed successfully!");
    Logger.log("Use the 'Clearfeed Sync' menu to enable hourly automatic syncing if desired.");

    // Create the custom menu immediately
    onOpen();

  } catch (error) {
    Logger.log(`Setup failed: ${error.toString()}`);
    throw error;
  }
}

/**
 * Utility function to test API connection
 */
function testClearfeedConnection() {
  try {
    const headers = {
      "Authorization": `Bearer ${CONFIG.API_KEY}`,
      "Content-Type": "application/json"
    };

    const params = {
      limit: 1,
      filter_by: "created_at"
    };

    // Only add collection_id if it's set
    if (CONFIG.COLLECTION_ID) {
      params.collection_id = CONFIG.COLLECTION_ID;
    }

    const url = `${BASE_URL}?${Object.keys(params).map(key =>
      `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`
    ).join('&')}`;

    const response = UrlFetchApp.fetch(url, {
      method: 'GET',
      headers: headers
    });

    if (response.getResponseCode() === 200) {
      Logger.log("✅ API connection successful");
      const data = JSON.parse(response.getContentText());
      Logger.log(`Found ${data.data ? data.data.length : 0} requests in test batch`);

      // Log response structure for debugging
      if (data.response_metadata) {
        Logger.log(`Response metadata available: ${JSON.stringify(data.response_metadata)}`);
      }
    } else {
      Logger.log(`❌ API connection failed: ${response.getResponseCode()}`);
      Logger.log(response.getContentText());
    }

  } catch (error) {
    Logger.log(`❌ Connection test failed: ${error.toString()}`);
  }
}

/**
 * Utility function to reset sync (clears last sync time)
 */
function resetSync() {
  PropertiesService.getScriptProperties().deleteProperty(LAST_SYNC_PROPERTY);
  Logger.log("Sync reset - next run will be a full sync");
}

/**
 * Create custom menu in Google Sheet
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  const menu = ui.createMenu('Clearfeed Sync')
    .addItem('🔄 Sync Now', 'syncClearfeedRequests')
    .addItem('⚙️ Setup Sync', 'setupSync')
    .addItem('🧪 Test Connection', 'testClearfeedConnection')
    .addSeparator()
    .addItem('⏰ Enable Hourly Sync', 'enableHourlyTrigger')
    .addItem('⏹️ Disable Hourly Sync', 'disableHourlyTrigger')
    .addSeparator()
    .addItem('🔄 Reset Sync', 'resetSync')
    .addItem('📋 View Logs', 'showLogs');

  menu.addToUi();
}

/**
 * Show logs in a dialog
 */
function showLogs() {
  const ui = SpreadsheetApp.getUi();
  ui.alert('Recent Logs', `Check the Apps Script editor (View > Logs) for detailed logs.`, ui.ButtonSet.OK);
}
