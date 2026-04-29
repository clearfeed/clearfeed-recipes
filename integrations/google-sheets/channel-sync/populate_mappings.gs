// ClearFeed Channel Mappings Populator
// Populates a Google Sheet with current Collection → Customer → Channel mappings from ClearFeed
//
// This script reads the current state from ClearFeed and writes it to a sheet,
// giving you a baseline to work from before using channel_sync.gs

const BASE_URL = "https://api.clearfeed.app/v1/rest";

// =============================================================================
// Configuration
// =============================================================================

const CONFIG = {
  API_KEY: "", // Required: Replace with your ClearFeed API key
  SHEET_NAME: "Channel Mappings", // Name of the sheet tab to write to
  SPREADSHEET_ID: "", // Leave empty to use current spreadsheet
  CLEAR_SHEET_BEFORE_WRITE: true, // Set to false to append instead of replace
  CUSTOMER_FETCH_PAGE_SIZE: 5, // Page size for fetching customers (small to avoid bandwidth)
  CUSTOMER_FETCH_DELAY_MS: 5000, // Delay between customer fetch requests (milliseconds)
};

// =============================================================================
// Menu Setup
// =============================================================================

/**
 * Create custom menu in Google Sheet
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  const menu = ui.createMenu('ClearFeed Populate')
    .addItem('📥 Populate Mappings', 'populateMappings')
    .addItem('🧪 Test Connection', 'testConnection')
    .addSeparator()
    .addItem('📋 View Logs', 'showLogs');

  menu.addToUi();
}

// =============================================================================
// Main Entry Points
// =============================================================================

/**
 * Main function to populate the sheet with current mappings
 */
function populateMappings() {
  const runStartedAt = new Date();

  try {
    Logger.log("Starting to populate channel mappings...");

    // Validate configuration
    if (!CONFIG.API_KEY || CONFIG.API_KEY === "") {
      safeAlert("Configuration Error", "Please update CONFIG.API_KEY with your ClearFeed API key.");
      return;
    }

    // Fetch data from ClearFeed
    Logger.log("Fetching collections...");
    const collections = fetchCollections();

    Logger.log("Fetching customers...");
    const customers = fetchAllCustomers();

    Logger.log(`Fetched ${collections.length} collections and ${customers.length} customers`);

    // Build the mappings structure
    const mappings = buildMappings(collections, customers);
    Logger.log(`Built ${mappings.length} channel mappings`);

    // Write to sheet
    const rowsWritten = writeToSheet(mappings);
    Logger.log(`Wrote ${rowsWritten} rows to sheet`);

    safeAlert("Success", `Successfully populated ${rowsWritten} channel mappings to the sheet.`);
    Logger.log("Channel mappings population completed");

  } catch (error) {
    Logger.log(`Error during population: ${error.toString()}`);
    safeAlert("Error", `An error occurred: ${error.toString()}`);
  }
}

/**
 * Test the ClearFeed API connection
 */
function testConnection() {
  try {
    Logger.log("Testing ClearFeed API connection...");

    if (!CONFIG.API_KEY || CONFIG.API_KEY === "") {
      safeAlert("Configuration Error", "Please update CONFIG.API_KEY with your ClearFeed API key.");
      return;
    }

    const collections = fetchCollections();
    const customers = fetchAllCustomers();

    if (collections && customers) {
      const message = `✅ Connection successful!\n\nFound ${collections.length} collections and ${customers.length} customers in your ClearFeed account.`;
      safeAlert("Connection Test", message);
      Logger.log("Connection test successful");
    } else {
      safeAlert("Connection Failed", "Failed to fetch data. Please check your API key.");
    }

  } catch (error) {
    Logger.log(`Connection test failed: ${error.toString()}`);
    safeAlert("Connection Failed", `Error: ${error.toString()}`);
  }
}

/**
 * Show instructions for viewing logs
 */
function showLogs() {
  const ui = SpreadsheetApp.getUi();
  ui.alert(
    'View Logs',
    'To view detailed logs:\n\n1. Open the Apps Script editor\n2. Click "View" > "Logs"\n\nOr run the function from the editor to see logs in real-time.',
    ui.ButtonSet.OK
  );
}

// =============================================================================
// Data Fetching Functions
// =============================================================================

/**
 * Fetch all collections with their channels from ClearFeed
 */
function fetchCollections() {
  const url = `${BASE_URL}/collections?include=channels`;

  const response = UrlFetchApp.fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${CONFIG.API_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    muteHttpExceptions: true
  });

  const responseCode = response.getResponseCode();

  if (responseCode !== 200) {
    throw new Error(`API request failed with status ${responseCode}: ${response.getContentText()}`);
  }

  const data = JSON.parse(response.getContentText());
  return data.collections || [];
}

/**
 * Fetch all customers with pagination
 * Uses small page size and delays to avoid bandwidth quota errors
 */
function fetchAllCustomers() {
  const allCustomers = [];
  let nextCursor = null;
  const PAGE_SIZE = CONFIG.CUSTOMER_FETCH_PAGE_SIZE || 5;
  const DELAY_MS = CONFIG.CUSTOMER_FETCH_DELAY_MS || 5000;
  let pageCount = 0;

  do {
    let url = `${BASE_URL}/customers?limit=${PAGE_SIZE}`;
    if (nextCursor) {
      url += `&next_cursor=${encodeURIComponent(nextCursor)}`;
    }

    pageCount++;
    Logger.log(`Fetching customers page ${pageCount}...`);

    const response = UrlFetchApp.fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${CONFIG.API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      muteHttpExceptions: true
    });

    const responseCode = response.getResponseCode();
    if (responseCode !== 200) {
      throw new Error(`Failed to fetch customers: ${response.getContentText()}`);
    }

    const data = JSON.parse(response.getContentText());
    const customers = data.customers || [];
    allCustomers.push(...customers);

    Logger.log(`Fetched ${customers.length} customers, total: ${allCustomers.length}`);

    nextCursor = data.response_metadata?.next_cursor || null;

    // Add delay between requests to avoid rate limiting
    if (nextCursor) {
      Logger.log(`Waiting ${DELAY_MS}ms before next request...`);
      Utilities.sleep(DELAY_MS);
    }

  } while (nextCursor);

  Logger.log(`Completed fetching ${allCustomers.length} customers in ${pageCount} pages`);
  return allCustomers;
}

// =============================================================================
// Data Processing Functions
// =============================================================================

/**
 * Build mappings structure from collections and customers
 * Returns array of: {collection_name, customer_name, channel_name, channel_id}
 */
function buildMappings(collections, customers) {
  const mappings = [];

  // Build lookups
  const collectionIdToName = {};
  for (const col of collections) {
    collectionIdToName[col.id] = col.name;
  }

  const channelIdToName = {};
  for (const col of collections) {
    for (const ch of (col.channels || [])) {
      if (ch.name) {
        channelIdToName[ch.id] = ch.name;
      }
    }
  }

  // Build customer to collection mapping
  const customerIdToCollectionId = {};
  for (const cust of customers) {
    if (cust.collection_id) {
      customerIdToCollectionId[cust.id] = cust.collection_id;
    }
  }

  // Build mappings: Collection → Customer → Channels
  for (const cust of customers) {
    const collectionId = cust.collection_id;
    if (!collectionId) {
      Logger.log(`Warning: Customer "${cust.name}" has no collection_id, skipping`);
      continue;
    }

    const collectionName = collectionIdToName[collectionId];
    if (!collectionName) {
      Logger.log(`Warning: Collection ID ${collectionId} not found for customer "${cust.name}", skipping`);
      continue;
    }

    const customerName = cust.name || "Unknown Customer";

    // Add each channel for this customer
    const channelIds = cust.channel_ids || [];
    if (channelIds.length === 0) {
      // Log customers with no channels
      Logger.log(`Info: Customer "${customerName}" in "${collectionName}" has no channels`);
    }

    for (const channelId of channelIds) {
      const channelName = channelIdToName[channelId] || channelId;

      mappings.push({
        collection_name: collectionName,
        customer_name: customerName,
        channel_name: channelName,
        channel_id: channelId
      });
    }
  }

  return mappings;
}

// =============================================================================
// Sheet Writing Functions
// =============================================================================

/**
 * Write mappings to the sheet
 */
function writeToSheet(mappings) {
  const sheet = getSheet();

  // Clear existing data if configured
  if (CONFIG.CLEAR_SHEET_BEFORE_WRITE) {
    const lastRow = sheet.getLastRow();
    if (lastRow > 0) {
      sheet.getRange(1, 1, lastRow, 4).clearContent();
    }
  }

  if (mappings.length === 0) {
    // Write headers only
    sheet.getRange(1, 1, 1, 4).setValues([["Collection", "Customer", "Channel Name", "Channel ID"]]);
    return 0;
  }

  // Prepare data rows with headers
  const rows = [
    ["Collection", "Customer", "Channel Name", "Channel ID"]
  ];

  // Sort by collection, then customer, then channel name
  const sortedMappings = mappings.slice().sort((a, b) => {
    if (a.collection_name !== b.collection_name) {
      return a.collection_name.localeCompare(b.collection_name);
    }
    if (a.customer_name !== b.customer_name) {
      return a.customer_name.localeCompare(b.customer_name);
    }
    return a.channel_name.localeCompare(b.channel_name);
  });

  for (const mapping of sortedMappings) {
    rows.push([
      mapping.collection_name,
      mapping.customer_name,
      mapping.channel_name,
      mapping.channel_id
    ]);
  }

  // Write all data at once
  sheet.getRange(1, 1, rows.length, 4).setValues(rows);

  return mappings.length;
}

/**
 * Get the sheet to write to
 */
function getSheet() {
  let spreadsheet;

  if (CONFIG.SPREADSHEET_ID && CONFIG.SPREADSHEET_ID !== "") {
    spreadsheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  } else {
    spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  }

  // If there's only one sheet, use it regardless of name
  const allSheets = spreadsheet.getSheets();
  if (allSheets.length === 1) {
    Logger.log(`Using the only sheet in the spreadsheet: "${allSheets[0].getName()}"`);
    return allSheets[0];
  }

  // Otherwise, look for the sheet by name
  const sheet = spreadsheet.getSheetByName(CONFIG.SHEET_NAME);

  if (!sheet) {
    throw new Error(`Sheet "${CONFIG.SHEET_NAME}" not found. Please create it or update CONFIG.SHEET_NAME.`);
  }

  return sheet;
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Helper function to safely show alerts
 * UI is not available when running from time-based triggers
 */
function safeAlert(title, message) {
  try {
    SpreadsheetApp.getUi().alert(title, message, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {
    // UI not available (running from trigger), log instead
    Logger.log(`[ALERT] ${title}: ${message}`);
  }
}
