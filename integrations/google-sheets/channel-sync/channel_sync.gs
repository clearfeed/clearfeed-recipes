// ClearFeed Channel Sync to Google Sheets
// Syncs collection-to-customer-to-channel mappings from a Google Sheet to ClearFeed
//
// Configuration - Update these values for your setup
const CONFIG = {
  API_KEY: "", // Required: Replace with your ClearFeed API key
  SHEET_NAME: "Channel Mappings", // Name of the sheet tab containing the mappings
  INCLUDE_DELETES: false, // Whether to actually delete channels (default: false for safety)
  SPREADSHEET_ID: "", // Leave empty to use current spreadsheet, or specify ID
  CREATE_EMPTY_CUSTOMER: false, // Whether to create an empty customer object when adding channels
  SET_OWNER: false, // Whether to set the owner field when adding channels
  CUSTOMER_FETCH_PAGE_SIZE: 5, // Page size for fetching customers (small to avoid bandwidth issues)
  CUSTOMER_FETCH_DELAY_MS: 5000, // Delay between customer fetch requests (milliseconds)
};

const BASE_URL = "https://api.clearfeed.app/v1/rest";

// =============================================================================
// Email Configuration
// =============================================================================
const EMAIL_CONFIG = {
  TO: "", // Recipient email address for sync notifications (leave empty to disable emails)
         // Example: "admin@company.com"
  FROM: "noreply@example.com", // Sender email address (must be configured as alias in Gmail)
  SUBJECT_PREFIX: "ClearFeed Channel Sync - ", // Prefix for email subject lines
  SENDER_NAME: "ClearFeed Sync" // Display name for email sender
};

// =============================================================================
// Menu Setup
// =============================================================================

/**
 * Create custom menu in Google Sheet
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  const menu = ui.createMenu('ClearFeed Channel Sync')
    .addItem('🔄 Sync Channels', 'syncChannels')
    .addItem('🧪 Test Connection', 'testClearfeedConnection')
    .addSeparator()
    .addItem('📋 View Logs', 'showLogs');

  menu.addToUi();
}

// =============================================================================
// Main Entry Points
// =============================================================================

/**
 * Main function to sync channels from the sheet to ClearFeed
 */
function syncChannels() {
  const runStartedAt = new Date();

  try {
    Logger.log("Starting channel sync...");

    // Validate configuration
    if (!CONFIG.API_KEY || CONFIG.API_KEY === "") {
      safeAlert("Configuration Error", "Please update CONFIG.API_KEY with your ClearFeed API key.");
      sendRunEmail_({
        startedAt: runStartedAt,
        completedAt: new Date(),
        addedChannels: [],
        removedChannels: [],
        failures: ["Configuration Error: CONFIG.API_KEY is missing or empty."]
      });
      return;
    }

    // Read data from the sheet
    const sheetData = readSheetData();
    if (sheetData.length === 0) {
      safeAlert("No Data", "No channel mappings found in the sheet. Please check the sheet format.");
      sendRunEmail_({
        startedAt: runStartedAt,
        completedAt: new Date(),
        addedChannels: [],
        removedChannels: [],
        failures: ["No Data: No channel mappings found in the sheet."]
      });
      return;
    }
    Logger.log(`Read ${sheetData.length} channel mappings from sheet`);

    // Fetch current state from ClearFeed
    const collections = fetchCollections();
    Logger.log(`Fetched ${collections.length} collections from ClearFeed`);

    // Fetch all customers
    const customers = fetchAllCustomers();
    Logger.log(`Fetched ${customers.length} customers from ClearFeed`);

    // Generate action plan
    const planData = generateActionPlan(sheetData, collections, customers);
    Logger.log("Action plan generated");

    // Display the plan
    const planMessage = formatPlanMessage(planData.plan);
    safeAlert("Sync Plan", planMessage);

    // Check if we should execute (skip confirmation in non-interactive mode)
    const isInteractive = isInteractiveMode();
    let shouldExecute = false;

    if (isInteractive) {
      const ui = SpreadsheetApp.getUi();
      const response = ui.alert(
        "Confirm Sync",
        "Do you want to execute this plan?",
        ui.ButtonSet.YES_NO
      );
      shouldExecute = (response === ui.Button.YES);
    } else {
      // Non-interactive mode: execute automatically
      shouldExecute = true;
      Logger.log("Non-interactive mode: executing plan automatically");
    }

    if (shouldExecute) {
      // Execute the plan
      const results = executePlan(planData.plan, !CONFIG.INCLUDE_DELETES, planData.collectionOwners);
      const resultMessage = formatResultMessage(results);
      safeAlert("Sync Results", resultMessage);
      Logger.log("Channel sync completed");

      // Send completion email
      sendRunEmail_({
        startedAt: runStartedAt,
        completedAt: new Date(),
        addedChannels: (results.addedChannels || []),
        removedChannels: (results.removedChannels || []),
        failures: (results.failures || [])
      });
    } else {
      Logger.log("Sync cancelled by user");
      // Send cancellation email
      sendRunEmail_({
        startedAt: runStartedAt,
        completedAt: new Date(),
        addedChannels: [],
        removedChannels: [],
        failures: ["Sync cancelled by user."]
      });
    }

  } catch (error) {
    Logger.log(`Error during sync: ${error.toString()}`);
    safeAlert("Sync Error", `An error occurred: ${error.toString()}`);

    // Send failure email
    sendRunEmail_({
      startedAt: runStartedAt,
      completedAt: new Date(),
      addedChannels: [],
      removedChannels: [],
      failures: [`Sync Error: ${error.toString()}`]
    });
  }
}

/**
 * Test the ClearFeed API connection
 */
function testClearfeedConnection() {
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
// Data Reading Functions
// =============================================================================

/**
 * Read channel mappings from the sheet
 * Expects format: Collection | Customer | Channel Name | Channel ID
 * Skips the header row (row 1)
 */
function readSheetData() {
  const sheet = getSheet();
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    // No data (header only or empty)
    return [];
  }

  const data = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
  const mappings = [];
  const seenChannelIds = {}; // Track duplicates: channel_id -> row number

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const collectionName = row[0];
    const customerName = row[1];
    const channelName = row[2];
    const channelId = row[3];

    // Skip rows with missing required data (collection, customer, and channel ID)
    if (!collectionName || !customerName || !channelId) {
      continue;
    }

    // Trim whitespace
    const trimmedCollection = String(collectionName).trim();
    const trimmedCustomer = String(customerName).trim();
    // channelName is optional - if empty, will be filled from API later
    const trimmedChannelName = channelName ? String(channelName).trim() : '';
    let trimmedChannelId = String(channelId).trim();
    // Remove leading # from channel ID if present
    if (trimmedChannelId.startsWith('#')) {
      trimmedChannelId = trimmedChannelId.substring(1);
    }

    // Basic validation for channel ID format
    if (!trimmedChannelId || trimmedChannelId.length < 2) {
      Logger.log(`Warning: Invalid channel ID "${trimmedChannelId}" in row ${i + 2}, skipping`);
      continue;
    }

    // Check for duplicate channel IDs
    if (seenChannelIds[trimmedChannelId]) {
      Logger.log(`Warning: Channel ID "${trimmedChannelId}" appears multiple times in the sheet. Row ${seenChannelIds[trimmedChannelId]} and row ${i + 2}. Using the latest occurrence (row ${i + 2}).`);
    }
    seenChannelIds[trimmedChannelId] = i + 2; // Store row number (1-based)

    mappings.push({
      collection_name: trimmedCollection,
      customer_name: trimmedCustomer,
      channel_name: trimmedChannelName,
      channel_id: trimmedChannelId,
      _normalized_collection: normalizeCollectionName(trimmedCollection),
      _normalized_customer: normalizeCustomerName(trimmedCustomer)
    });
  }

  return mappings;
}

/**
 * Get the sheet containing the channel mappings
 * If the spreadsheet has only one sheet, use that regardless of name
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

/**
 * Normalize collection name for comparison
 * Converts to lowercase, trims whitespace, and removes surrounding quotes
 */
function normalizeCollectionName(name) {
  if (!name) return "";
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/^["']|["']$/g, ''); // Remove surrounding quotes only
}

/**
 * Normalize customer name for comparison
 * Converts to lowercase, trims whitespace, and removes surrounding quotes
 */
function normalizeCustomerName(name) {
  if (!name) return "";
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/^["']|["']$/g, ''); // Remove surrounding quotes only
}

// =============================================================================
// API Functions
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
 * Fetch all customers with pagination from ClearFeed API
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

/**
 * Fetch a single customer by ID
 * Returns customer object or null
 */
function fetchCustomerById(customerId) {
  const url = `${BASE_URL}/customers/${customerId}`;

  const response = UrlFetchApp.fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${CONFIG.API_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  if (code === 200) {
    const data = JSON.parse(response.getContentText());
    return data.customer;
  }
  return null;
}

/**
 * Add channels to a collection
 * Returns {success: boolean, error: string}
 */
function addChannelsToCollection(collectionId, channelsToAdd) {
  const url = `${BASE_URL}/collections/${collectionId}/channels`;

  const payload = {
    channels: channelsToAdd
  };

  const response = UrlFetchApp.fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CONFIG.API_KEY}`,
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  if (code >= 200 && code < 300) {
    return { success: true };
  } else {
    return {
      success: false,
      error: `API error (${code}): ${response.getContentText()}`
    };
  }
}

/**
 * Move a channel to a different collection
 * Returns {success: boolean, error: string}
 */
function moveChannel(channelId, collectionId) {
  const url = `${BASE_URL}/channels/${channelId}`;

  const payload = {
    collection_id: collectionId
  };

  const response = UrlFetchApp.fetch(url, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${CONFIG.API_KEY}`,
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  if (code >= 200 && code < 300) {
    return { success: true };
  } else {
    return {
      success: false,
      error: `API error (${code}): ${response.getContentText()}`
    };
  }
}

/**
 * Move a customer to a different collection
 * Fetches fresh customer data first to get current version
 * Returns {success: boolean, error: string}
 */
function moveCustomer(customerId, collectionId, version) {
  // Fetch fresh customer data to get current version
  const freshCustomer = fetchCustomerById(customerId);
  if (!freshCustomer) {
    return {
      success: false,
      error: `Failed to fetch customer data for ID ${customerId}`
    };
  }

  const url = `${BASE_URL}/customers/${customerId}`;

  const payload = {
    version: freshCustomer.version,  // Use current version from API
    collection_id: collectionId
  };

  const response = UrlFetchApp.fetch(url, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${CONFIG.API_KEY}`,
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  if (code >= 200 && code < 300) {
    return { success: true };
  } else if (code === 409) {
    return {
      success: false,
      error: `Version conflict: Customer was modified by another process. Please retry.`
    };
  } else {
    return {
      success: false,
      error: `API error (${code}): ${response.getContentText()}`
    };
  }
}

/**
 * Delete a channel from ClearFeed
 * Returns {success: boolean, error: string}
 */
function deleteChannel(channelId) {
  const url = `${BASE_URL}/channels/${channelId}`;

  const response = UrlFetchApp.fetch(url, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${CONFIG.API_KEY}`
    },
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  if (code >= 200 && code < 300) {
    return { success: true };
  } else {
    return {
      success: false,
      error: `API error (${code}): ${response.getContentText()}`
    };
  }
}

// =============================================================================
// Plan Generation Functions
// =============================================================================

/**
 * Generate an action plan by comparing desired state (sheet) with actual state (ClearFeed)
 * Uses Collections → Customers → Channels model
 */
function generateActionPlan(sheetData, collections, customers) {
  // Build lookup structures
  const collectionNameToId = {};
  const collectionOwners = {}; // collection_id -> most common owner
  const actualChannelToCustomer = {}; // channel_id -> {customer_id, customer_name, collection_id, collection_name}
  const customerIdToCustomer = {}; // customer_id -> {id, name, collection_id, version, channel_ids}
  const channelIdToName = {}; // channel_id -> channel_name from API

  // Map collections
  for (const col of collections) {
    const normalizedName = normalizeCollectionName(col.name);
    collectionNameToId[normalizedName] = col.id;
    collectionOwners[col.id] = null;

    // Track most common owner for this collection
    const ownerCounts = {};
    for (const ch of (col.channels || [])) {
      if (ch.owner) {
        ownerCounts[ch.owner] = (ownerCounts[ch.owner] || 0) + 1;
      }
    }

    if (Object.keys(ownerCounts).length > 0) {
      let maxCount = 0;
      for (const [owner, count] of Object.entries(ownerCounts)) {
        if (count > maxCount) {
          maxCount = count;
          collectionOwners[col.id] = owner;
        }
      }
    }
  }

  // Map customers and their channels
  for (const cust of customers) {
    customerIdToCustomer[cust.id] = {
      id: cust.id,
      name: cust.name,
      collection_id: cust.collection_id,
      version: cust.version,
      channel_ids: cust.channel_ids || []
    };

    // Map each channel to its customer
    for (const channelId of (cust.channel_ids || [])) {
      // Find channel name from collections
      let channelName = channelId;
      for (const col of collections) {
        for (const ch of (col.channels || [])) {
          if (ch.id === channelId && ch.name) {
            channelName = ch.name;
            channelIdToName[channelId] = ch.name;
            break;
          }
        }
      }

      actualChannelToCustomer[channelId] = {
        customer_id: cust.id,
        customer_name: cust.name,
        collection_id: cust.collection_id,
        collection_name: getCollectionName(cust.collection_id, collections)
      };
    }
  }

  // Build desired state from sheet
  const desiredChannelToCollectionCustomer = {}; // channel_id -> {collection_id, customer_name, _normalized_customer}
  const collectionsNotFound = new Set();
  const channelInfo = {}; // channel_id -> {name, collection_name, customer_name}

  for (const mapping of sheetData) {
    const normalizedCol = mapping._normalized_collection;

    if (!collectionNameToId[normalizedCol]) {
      collectionsNotFound.add(mapping.collection_name);
      continue;
    }

    const collectionId = collectionNameToId[normalizedCol];
    desiredChannelToCollectionCustomer[mapping.channel_id] = {
      collection_id: collectionId,
      customer_name: mapping.customer_name,
      _normalized_customer: mapping._normalized_customer
    };

    // Use fallback chain: sheet name → API name → channel ID
    channelInfo[mapping.channel_id] = {
      name: mapping.channel_name || channelIdToName[mapping.channel_id] || mapping.channel_id,
      collection_name: mapping.collection_name,
      customer_name: mapping.customer_name,
      collection_id: collectionId
    };
  }

  // Generate plan
  const plan = {
    toAdd: [],
    toMove: [],           // Individual channel moves (partial customer movements)
    toMoveCustomers: [],  // Full customer movements
    toRemove: [],
    collectionsNotFound: Array.from(collectionsNotFound)
  };

  // Channels to add: in desired but not in actual
  for (const [channelId, desiredInfo] of Object.entries(desiredChannelToCollectionCustomer)) {
    if (!(channelId in actualChannelToCustomer)) {
      plan.toAdd.push({
        channel_id: channelId,
        channel_name: channelInfo[channelId].name,
        collection_name: channelInfo[channelId].collection_name,
        customer_name: channelInfo[channelId].customer_name,
        collection_id: desiredInfo.collection_id
      });
    }
  }

  // Build customer movement plan: track which customers need to move to which collections
  // Key: customer_id, Value: {from_collection_id, to_collection_id, customer_name, channel_ids, channels_moving}
  const customerMovements = {};

  for (const [channelId, desiredInfo] of Object.entries(desiredChannelToCollectionCustomer)) {
    if (channelId in actualChannelToCustomer) {
      const actualInfo = actualChannelToCustomer[channelId];
      const desiredCollectionId = desiredInfo.collection_id;
      const actualCollectionId = actualInfo.collection_id;

      // Find the customer for this channel (by matching customer name)
      let targetCustomerId = null;
      for (const [custId, cust] of Object.entries(customerIdToCustomer)) {
        if (normalizeCustomerName(cust.name) === desiredInfo._normalized_customer &&
            cust.channel_ids.includes(channelId)) {
          targetCustomerId = custId;
          break;
        }
      }

      // If customer found and needs to move to different collection
      if (targetCustomerId && actualCollectionId !== desiredCollectionId) {
        if (!customerMovements[targetCustomerId]) {
          const customer = customerIdToCustomer[targetCustomerId];
          customerMovements[targetCustomerId] = {
            customer_id: targetCustomerId,
            customer_name: customer.name,
            version: customer.version,
            from_collection_id: actualCollectionId,
            from_collection_name: actualInfo.collection_name,
            to_collection_id: desiredCollectionId,
            to_collection_name: channelInfo[channelId].collection_name,
            all_channels_count: customer.channel_ids.length,
            channels_moving: []
          };
        }
        customerMovements[targetCustomerId].channels_moving.push(channelId);
      }
    }
  }

  // Determine if full customer move or individual channel moves
  for (const [custId, movement] of Object.entries(customerMovements)) {
    if (movement.channels_moving.length === movement.all_channels_count) {
      // ALL channels moving - move the customer
      plan.toMoveCustomers.push(movement);
    } else {
      // PARTIAL move - move individual channels
      for (const channelId of movement.channels_moving) {
        plan.toMove.push({
          channel_id: channelId,
          channel_name: channelInfo[channelId].name,
          from_collection: movement.from_collection_name,
          to_collection: movement.to_collection_name,
          to_collection_id: movement.to_collection_id
        });
      }
    }
  }

  // Channels to remove: in actual but not in desired
  for (const [channelId, actualInfo] of Object.entries(actualChannelToCustomer)) {
    if (!(channelId in desiredChannelToCollectionCustomer)) {
      plan.toRemove.push({
        channel_id: channelId,
        channel_name: channelIdToName[channelId] || channelId,
        collection_name: actualInfo.collection_name,
        customer_name: actualInfo.customer_name
      });
    }
  }

  return {
    plan: plan,
    collectionOwners: collectionOwners
  };
}

/**
 * Helper function to get collection name by ID
 */
function getCollectionName(collectionId, collections) {
  for (const col of collections) {
    if (col.id === collectionId) {
      return col.name;
    }
  }
  return "Unknown";
}

/**
 * Format the plan as a readable message
 */
function formatPlanMessage(plan) {
  const lines = [];

  lines.push("CHANNEL SYNC PLAN");
  lines.push("==================");
  lines.push("");

  // Collections not found
  if (plan.collectionsNotFound.length > 0) {
    lines.push(`⚠️  Collections NOT FOUND in ClearFeed:`);
    for (const colName of plan.collectionsNotFound) {
      lines.push(`   - ${colName}`);
    }
    lines.push("");
    lines.push("Channels in these collections will be SKIPPED.");
    lines.push("");
  }

  // Channels to add
  if (plan.toAdd.length > 0) {
    lines.push(`📝 Channels to ADD: ${plan.toAdd.length}`);
    for (const item of plan.toAdd) {
      lines.push(`   + ${item.channel_name} (${item.channel_id}) → ${item.collection_name} / ${item.customer_name}`);
    }
    lines.push("");
  }

  // Customers to move (with their channels)
  if (plan.toMoveCustomers.length > 0) {
    lines.push(`🔄 Customers to MOVE: ${plan.toMoveCustomers.length}`);
    for (const item of plan.toMoveCustomers) {
      lines.push(`   ~ Customer: ${item.customer_name}`);
      lines.push(`     ${item.from_collection_name} → ${item.to_collection_name}`);
      lines.push(`     Channels moving: ${item.all_channels_count} channel(s)`);
    }
    lines.push("");
  }

  // Individual channels to move (partial customer movements)
  if (plan.toMove.length > 0) {
    lines.push(`🔄 Channels to MOVE: ${plan.toMove.length}`);
    for (const item of plan.toMove) {
      lines.push(`   ~ ${item.channel_name} (${item.channel_id})`);
      lines.push(`     ${item.from_collection} → ${item.to_collection}`);
    }
    lines.push("");
  }

  // Channels to remove
  if (plan.toRemove.length > 0) {
    lines.push(`🗑️  Channels to REMOVE: ${plan.toRemove.length}`);
    for (const item of plan.toRemove) {
      lines.push(`   - ${item.channel_name} (${item.channel_id}) from ${item.collection_name} / ${item.customer_name}`);
    }
    lines.push("");
  }

  // Delete warning
  if (plan.toRemove.length > 0 && !CONFIG.INCLUDE_DELETES) {
    lines.push("⚠️  WARNING: Deletes are SKIPPED (CONFIG.INCLUDE_DELETES = false)");
    lines.push("   To enable deletes, set CONFIG.INCLUDE_DELETES = true");
    lines.push("");
  }

  // Summary
  if (plan.toAdd.length === 0 && plan.toMoveCustomers.length === 0 && plan.toMove.length === 0 && plan.toRemove.length === 0) {
    lines.push("✅ No changes needed - sheet is already in sync!");
  } else {
    lines.push("SUMMARY:");
    lines.push(`  Add: ${plan.toAdd.length} channel(s)`);
    lines.push(`  Move Customers: ${plan.toMoveCustomers.length} customer(s)`);
    lines.push(`  Move Channels: ${plan.toMove.length} channel(s)`);
    lines.push(`  Remove: ${plan.toRemove.length} channel(s) ${!CONFIG.INCLUDE_DELETES ? '(skipped)' : ''}`);
  }

  return lines.join("\n");
}

// =============================================================================
// Plan Execution Functions
// =============================================================================

/**
 * Execute the sync plan
 */
function executePlan(plan, skipDeletes, collectionOwners) {
  const results = {
    addSuccess: 0,
    addFailed: 0,
    moveCustomerSuccess: 0,
    moveCustomerFailed: 0,
    moveSuccess: 0,
    moveFailed: 0,
    removeSuccess: 0,
    removeFailed: 0,
    removeSkipped: 0,
    // Email tracking
    addedChannels: [],
    movedCustomers: [],
    movedChannels: [],
    removedChannels: [],
    failures: []
  };

  // Build lookup maps for email details
  const addItemById = {};
  for (const item of plan.toAdd) {
    addItemById[item.channel_id] = item;
  }
  const removeItemById = {};
  for (const item of plan.toRemove) {
    removeItemById[item.channel_id] = item;
  }

  // Group adds by collection for efficiency
  const addsByCollection = {};
  for (const item of plan.toAdd) {
    if (!addsByCollection[item.collection_id]) {
      addsByCollection[item.collection_id] = [];
    }
    const channelObj = {
      id: item.channel_id
    };
    // Add owner if enabled
    if (CONFIG.SET_OWNER) {
      channelObj.owner = collectionOwners[item.collection_id] || '';
    }
    addsByCollection[item.collection_id].push(channelObj);
  }

  // Execute adds (grouped by collection)
  for (const [collectionId, channels] of Object.entries(addsByCollection)) {
    try {
      const result = addChannelsToCollection(collectionId, channels);
      if (result.success) {
        results.addSuccess += channels.length;
        Logger.log(`✅ Added ${channels.length} channels to collection ${collectionId}`);

        // Track for email
        for (const ch of channels) {
          const item = addItemById[ch.id];
          results.addedChannels.push({
            id: ch.id,
            name: (item && item.channel_name) ? item.channel_name : ch.id,
            collection: item ? item.collection_name : '',
            customer: item ? item.customer_name : ''
          });
        }
      } else {
        results.addFailed += channels.length;
        Logger.log(`❌ Failed to add channels to collection ${collectionId}: ${result.error}`);

        // Track failure for email
        const failedList = channels.map(function(ch) {
          const item = addItemById[ch.id];
          const nm = (item && item.channel_name) ? item.channel_name : ch.id;
          return `${ch.id} - ${nm}`;
        }).join(', ');
        results.failures.push(`Add failed (collection ${collectionId}): ${result.error}. Channels: ${failedList}`);
      }
    } catch (error) {
      results.addFailed += channels.length;
      Logger.log(`❌ Error adding channels to collection ${collectionId}: ${error.toString()}`);

      // Track failure for email
      const failedList = channels.map(function(ch) {
        const item = addItemById[ch.id];
        const nm = (item && item.channel_name) ? item.channel_name : ch.id;
        return `${ch.id} - ${nm}`;
      }).join(', ');
      results.failures.push(`Add error (collection ${collectionId}): ${error.toString()}. Channels: ${failedList}`);
    }
  }

  // Execute customer moves (individual)
  for (const item of plan.toMoveCustomers) {
    try {
      const result = moveCustomer(item.customer_id, item.to_collection_id, item.version);
      if (result.success) {
        results.moveCustomerSuccess++;
        Logger.log(`✅ Moved customer ${item.customer_name} (ID: ${item.customer_id}) from ${item.from_collection_name} to ${item.to_collection_name}`);
        Logger.log(`   ${item.all_channels_count} channel(s) moved with this customer`);

        // Track for email
        results.movedCustomers.push({
          id: item.customer_id,
          name: item.customer_name,
          from_collection: item.from_collection_name,
          to_collection: item.to_collection_name,
          channel_count: item.all_channels_count
        });
      } else {
        results.moveCustomerFailed++;
        Logger.log(`❌ Failed to move customer ${item.customer_name} (ID: ${item.customer_id}): ${result.error}`);

        // Track failure for email
        results.failures.push(`Move customer failed: ${item.customer_id} - ${item.customer_name}. ${result.error}`);
      }
    } catch (error) {
      results.moveCustomerFailed++;
      Logger.log(`❌ Error moving customer ${item.customer_name} (ID: ${item.customer_id}): ${error.toString()}`);

      // Track failure for email
      results.failures.push(`Move customer error: ${item.customer_id} - ${item.customer_name}. ${error.toString()}`);
    }
  }

  // Execute individual channel moves (for partial customer movements)
  for (const item of plan.toMove) {
    try {
      const result = moveChannel(item.channel_id, item.to_collection_id);
      if (result.success) {
        results.moveSuccess++;
        Logger.log(`✅ Moved channel ${item.channel_name} (${item.channel_id}) to ${item.to_collection}`);

        // Track for email
        results.movedChannels.push({
          id: item.channel_id,
          name: item.channel_name,
          from_collection: item.from_collection,
          to_collection: item.to_collection
        });
      } else {
        results.moveFailed++;
        Logger.log(`❌ Failed to move channel ${item.channel_name} (${item.channel_id}): ${result.error}`);

        // Track failure for email
        results.failures.push(`Move channel failed: ${item.channel_id} - ${item.channel_name}. ${result.error}`);
      }
    } catch (error) {
      results.moveFailed++;
      Logger.log(`❌ Error moving channel ${item.channel_name} (${item.channel_id}): ${error.toString()}`);

      // Track failure for email
      results.failures.push(`Move channel error: ${item.channel_id} - ${item.channel_name}. ${error.toString()}`);
    }
  }

  // Execute removes (individual)
  for (const item of plan.toRemove) {
    if (skipDeletes) {
      results.removeSkipped++;
      Logger.log(`⏭️ Skipped removal of channel ${item.channel_name} (${item.channel_id}) - deletes disabled`);

      // Track skipped as informational for email
      results.failures.push(`Remove skipped (deletes disabled): ${item.channel_id} - ${item.channel_name}`);
      continue;
    }

    try {
      const result = deleteChannel(item.channel_id);
      if (result.success) {
        results.removeSuccess++;
        Logger.log(`✅ Removed channel ${item.channel_name} (${item.channel_id})`);

        // Track for email
        results.removedChannels.push({
          id: item.channel_id,
          name: item.channel_name || item.channel_id,
          collection: item.collection_name || '',
          customer: item.customer_name || ''
        });
      } else {
        results.removeFailed++;
        Logger.log(`❌ Failed to remove channel ${item.channel_name} (${item.channel_id}): ${result.error}`);

        // Track failure for email
        results.failures.push(`Remove failed: ${item.channel_id} - ${item.channel_name}. ${result.error}`);
      }
    } catch (error) {
      results.removeFailed++;
      Logger.log(`❌ Error removing channel ${item.channel_name} (${item.channel_id}): ${error.toString()}`);

      // Track failure for email
      results.failures.push(`Remove error: ${item.channel_id} - ${item.channel_name}. ${error.toString()}`);
    }
  }

  return results;
}

/**
 * Format execution results as a readable message
 */
function formatResultMessage(results) {
  const lines = [];

  lines.push("SYNC RESULTS");
  lines.push("=============");
  lines.push("");

  if (results.addSuccess > 0) {
    lines.push(`✅ Added: ${results.addSuccess} channel(s)`);
  }
  if (results.addFailed > 0) {
    lines.push(`❌ Add failed: ${results.addFailed} channel(s)`);
  }

  if (results.moveCustomerSuccess > 0) {
    lines.push(`✅ Moved Customers: ${results.moveCustomerSuccess} customer(s)`);
  }
  if (results.moveCustomerFailed > 0) {
    lines.push(`❌ Move Customer failed: ${results.moveCustomerFailed} customer(s)`);
  }

  if (results.moveSuccess > 0) {
    lines.push(`✅ Moved Channels: ${results.moveSuccess} channel(s)`);
  }
  if (results.moveFailed > 0) {
    lines.push(`❌ Move Channel failed: ${results.moveFailed} channel(s)`);
  }

  if (results.removeSkipped > 0) {
    lines.push(`⏭️  Remove skipped: ${results.removeSkipped} channel(s) (deletes disabled)`);
  }
  if (results.removeSuccess > 0) {
    lines.push(`✅ Removed: ${results.removeSuccess} channel(s)`);
  }
  if (results.removeFailed > 0) {
    lines.push(`❌ Remove failed: ${results.removeFailed} channel(s)`);
  }

  lines.push("");

  const totalActions = results.addSuccess + results.moveCustomerSuccess + results.moveSuccess + results.removeSuccess;
  const totalFailed = results.addFailed + results.moveCustomerFailed + results.moveFailed + results.removeFailed;

  if (totalFailed === 0 && totalActions > 0) {
    lines.push("✅ All actions completed successfully!");
  } else if (totalFailed > 0) {
    lines.push(`⚠️  Some actions failed. Check logs for details.`);
  } else {
    lines.push("No changes were made.");
  }

  return lines.join("\n");
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

/**
 * Check if running in interactive mode (UI available)
 */
function isInteractiveMode() {
  try {
    SpreadsheetApp.getUi();
    return true;
  } catch (e) {
    return false;
  }
}

// =============================================================================
// Email Helper Functions
// =============================================================================

/**
 * Format run timestamp for email subject
 */
function formatRunTimestamp_() {
  const tz = Session.getScriptTimeZone ? Session.getScriptTimeZone() : 'GMT';
  // HH:MM:SS DD MMM YYYY
  return Utilities.formatDate(new Date(), tz, 'HH:mm:ss dd MMM yyyy');
}

/**
 * Format channel list for email body
 */
function formatChannelLines_(channels) {
  if (!channels || channels.length === 0) return 'None';
  return channels.map(function(ch) {
    const id = ch.id || '';
    const name = ch.name || '';
    const collection = ch.collection ? ` (${ch.collection})` : '';
    const customer = ch.customer ? ` / Customer: ${ch.customer}` : '';
    return `${id} - ${name}${collection}${customer}`;
  }).join('\n');
}

/**
 * Format moved customers list for email body
 */
function formatMovedCustomersLines_(customers) {
  if (!customers || customers.length === 0) return 'None';
  return customers.map(function(c) {
    const id = c.id || '';
    const name = c.name || '';
    const from = c.from_collection ? ` from ${c.from_collection}` : '';
    const to = c.to_collection ? ` to ${c.to_collection}` : '';
    const channels = c.channel_count !== undefined ? ` (${c.channel_count} channels)` : '';
    return `${id} - ${name}${from}${to}${channels}`;
  }).join('\n');
}

/**
 * Format failures list for email body
 */
function formatFailures_(failures) {
  if (!failures || failures.length === 0) return 'None';
  return failures.map(function(f) {
    return `- ${f}`;
  }).join('\n');
}

/**
 * Send run completion email
 */
function sendRunEmail_(runData) {
  // Skip sending email if TO is not configured
  if (!EMAIL_CONFIG.TO || EMAIL_CONFIG.TO === "") {
    Logger.log("Email sending disabled: EMAIL_CONFIG.TO is empty");
    return;
  }

  const timestamp = formatRunTimestamp_();
  const subject = `${EMAIL_CONFIG.SUBJECT_PREFIX}[${timestamp}]`;

  const bodyLines = [];
  bodyLines.push('Script completed the run:');
  bodyLines.push('');
  bodyLines.push('Channels Added:');
  bodyLines.push(formatChannelLines_(runData.addedChannels));
  bodyLines.push('');
  bodyLines.push('Customers Moved:');
  bodyLines.push(formatMovedCustomersLines_(runData.movedCustomers));
  bodyLines.push('');
  bodyLines.push('Channels Removed:');
  bodyLines.push(formatChannelLines_(runData.removedChannels));
  bodyLines.push('');
  bodyLines.push('Failures:');
  bodyLines.push(formatFailures_(runData.failures));

  const body = bodyLines.join('\n');

  // Attempt to send with explicit FROM first (works if alias is configured)
  try {
    GmailApp.sendEmail(EMAIL_CONFIG.TO, subject, body, {
      from: EMAIL_CONFIG.FROM,
      name: EMAIL_CONFIG.SENDER_NAME,
      replyTo: EMAIL_CONFIG.FROM
    });
  } catch (e) {
    // Fallback if alias/from is not permitted in this environment
    try {
      MailApp.sendEmail(EMAIL_CONFIG.TO, subject, body, {
        name: EMAIL_CONFIG.SENDER_NAME,
        replyTo: EMAIL_CONFIG.FROM
      });
    } catch (e2) {
      Logger.log(`Failed to send run email: ${e2.toString()}`);
    }
  }
}
