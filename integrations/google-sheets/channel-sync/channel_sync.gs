// ClearFeed Channel Sync to Google Sheets
// Syncs collection-to-channel mappings from a Google Sheet to ClearFeed
//
// Configuration - Update these values for your setup
const CONFIG = {
  API_KEY: "", // Required: Replace with your ClearFeed API key
  SHEET_NAME: "Channel Mappings", // Name of the sheet tab containing the mappings
  INCLUDE_DELETES: false, // Whether to actually delete channels (default: false for safety)
  SPREADSHEET_ID: "", // Leave empty to use current spreadsheet, or specify ID
  SET_OWNER: null, // Whether to set the owner field when adding channels. Default: auto (true for legacy, false for customer-centric)
  IS_ON_CUSTOMER_INBOX_MODEL: true, // Set to true for Customer-Centric Inbox Model, false for legacy model
};

const BASE_URL = "https://api.clearfeed.app/v1/rest";

/**
 * Resolve effective SET_OWNER value.
 * - If null/undefined: auto-derive (true for legacy, false for customer-centric)
 * - If explicitly false in legacy mode: throw error (owner is required)
 */
function resolveSetOwner_() {
  if (CONFIG.SET_OWNER === null || CONFIG.SET_OWNER === undefined || CONFIG.SET_OWNER === '') {
    return !CONFIG.IS_ON_CUSTOMER_INBOX_MODEL;
  }
  if (!CONFIG.IS_ON_CUSTOMER_INBOX_MODEL && !CONFIG.SET_OWNER) {
    throw new Error("CONFIG.SET_OWNER must be true in legacy mode (IS_ON_CUSTOMER_INBOX_MODEL = false). Owner is required when adding channels.");
  }
  return CONFIG.SET_OWNER;
}

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
 * Shows different menu based on IS_ON_CUSTOMER_INBOX_MODEL flag
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  const populateFn = CONFIG.IS_ON_CUSTOMER_INBOX_MODEL ? 'populateInitialMappings' : 'populateCollectionChannels';
  const syncFn = CONFIG.IS_ON_CUSTOMER_INBOX_MODEL ? 'syncCustomerCentricChanges' : 'syncChannels';
  const testFn = CONFIG.IS_ON_CUSTOMER_INBOX_MODEL ? 'testCustomerConnection' : 'testClearfeedConnection';

  ui.createMenu('ClearFeed Channel Sync')
    .addItem('📥 Download Channel Mapping', populateFn)
    .addItem('🔄 Upload/Sync Channel Mapping', syncFn)
    .addSeparator()
    .addItem('🌐 Portal Update', 'syncPortalSettings')
    .addSeparator()
    .addItem('🧪 Test Connection', testFn)
    .addItem('📋 View Logs', 'showLogs')
    .addToUi();
}

// =============================================================================
// Main Entry Points
// =============================================================================

/**
 * Main function to sync channels from the sheet to ClearFeed
 * Only callable when IS_ON_CUSTOMER_INBOX_MODEL is false
 */
function syncChannels() {
  const runStartedAt = new Date();

  try {
    Logger.log("Starting channel sync...");

    if (CONFIG.IS_ON_CUSTOMER_INBOX_MODEL) {
      throw new Error("syncChannels() cannot be used with IS_ON_CUSTOMER_INBOX_MODEL = true. Use syncCustomerCentricChanges() instead.");
    }

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

    // Validate sheet headers before reading data
    const sheet = getSheet();
    const headers = sheet.getRange(1, 1, 1, 3).getValues()[0];
    try {
      validateSheetHeaders(headers, false);
    } catch (error) {
      safeAlert("Invalid Sheet Format", "Sheet headers are incorrect:\n\n" + error.message);
      sendRunEmail_({
        startedAt: runStartedAt,
        completedAt: new Date(),
        addedChannels: [],
        removedChannels: [],
        failures: ["Invalid Sheet Format: " + error.message]
      });
      return;
    }

    // Read data from the sheet
    const sheetData = readSheetData_();
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

    // Generate action plan
    const planData = generateActionPlan(sheetData, collections);
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
 * Only callable when IS_ON_CUSTOMER_INBOX_MODEL is false
 */
function testClearfeedConnection() {
  try {
    Logger.log("Testing ClearFeed API connection...");

    if (!CONFIG.API_KEY || CONFIG.API_KEY === "") {
      safeAlert("Configuration Error", "Please update CONFIG.API_KEY with your ClearFeed API key.");
      return;
    }

    if (CONFIG.IS_ON_CUSTOMER_INBOX_MODEL) {
      throw new Error("testClearfeedConnection() cannot be used with IS_ON_CUSTOMER_INBOX_MODEL = true. Use testCustomerConnection() instead.");
    }

    const collections = fetchCollections();

    if (collections) {
      const message = `✅ Connection successful!\n\nFound ${collections.length} collections in your ClearFeed account.`;
      safeAlert("Connection Test", message);
      Logger.log("Connection test successful");
    } else {
      safeAlert("Connection Failed", "Failed to fetch collections. Please check your API key.");
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
 * Validate sheet headers to ensure columns are in correct positions
 * @param {string[]} headers - Array of header values from row 1
 * @param {boolean} isCustomerCentric - Whether this is customer-centric model (4 columns) or legacy (3 columns)
 * @throws {Error} If headers don't match expected format
 */
function validateSheetHeaders(headers, isCustomerCentric) {
  const collectionHeader = String(headers[0] || '').toLowerCase().trim();

  // Validate Collection column (column 1)
  if (!collectionHeader.includes('collection')) {
    throw new Error("Column 1 header must contain 'Collection'. Found: '" + headers[0] + "'");
  }
  if (collectionHeader.includes('channel') || collectionHeader.includes('customer')) {
    throw new Error("Column 1 header must be 'Collection', not 'Channel' or 'Customer'. Found: '" + headers[0] + "'");
  }

  if (isCustomerCentric) {
    // Customer column (column 2)
    const customerHeader = String(headers[1] || '').toLowerCase().trim();
    if (!customerHeader.includes('customer')) {
      throw new Error("Column 2 header must contain 'Customer'. Found: '" + headers[1] + "'");
    }
    if (customerHeader.includes('channel') || customerHeader.includes('id') || customerHeader.includes('collection')) {
      throw new Error("Column 2 header must contain 'Customer', not 'Channel', 'ID', or 'Collection'. Found: '" + headers[1] + "'");
    }
  }

  // Channel Name column (column 2 in legacy, column 3 in customer-centric)
  const channelNameCol = isCustomerCentric ? 2 : 1;
  const channelNameHeader = String(headers[channelNameCol] || '').toLowerCase().trim();
  if (channelNameHeader.includes('id') || channelNameHeader.includes('customer') || channelNameHeader.includes('collection')) {
    throw new Error("Column " + (channelNameCol + 1) + " header must not contain 'ID', 'Customer', or 'Collection'. Found: '" + headers[channelNameCol] + "'");
  }

  // Channel ID column (last column)
  const channelIdCol = isCustomerCentric ? 3 : 2;
  const channelIdHeader = String(headers[channelIdCol] || '').toLowerCase().trim();
  if (!channelIdHeader.includes('channel')) {
    throw new Error("Column " + (channelIdCol + 1) + " header must contain 'Channel'. Found: '" + headers[channelIdCol] + "'");
  }
  if (channelIdHeader.includes('customer') || channelIdHeader.includes('name')) {
    throw new Error("Column " + (channelIdCol + 1) + " header must be 'Channel ID', not contain 'Customer' or 'Name'. Found: '" + headers[channelIdCol] + "'");
  }
}

/**
 * Read channel mappings from the sheet
 * Expects format: Collection | Slack channel (optional) | Channel ID
 * Skips the header row (row 1)
 */
function readSheetData_() {
  const isCustomerCentric = CONFIG.IS_ON_CUSTOMER_INBOX_MODEL;
  const numCols = isCustomerCentric ? 4 : 3;
  const sheet = getSheet();
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return [];
  }

  const data = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();
  const mappings = [];
  const seenChannelIds = {};

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const collectionName = row[0];
    // Customer-centric: [Collection, Customer, Channel Name, Channel ID]
    // Legacy: [Collection, Channel Name, Channel ID]
    const customerName = isCustomerCentric ? row[1] : null;
    const channelName = isCustomerCentric ? row[2] : row[1];
    const channelId = isCustomerCentric ? row[3] : row[2];

    // Skip rows with missing required data
    if (!collectionName || !channelId) continue;

    let trimmedChannelId = String(channelId).trim();
    if (trimmedChannelId.startsWith('#')) {
      trimmedChannelId = trimmedChannelId.substring(1);
    }

    if (!trimmedChannelId || trimmedChannelId.length < 2) {
      Logger.log(`Warning: Invalid channel ID "${trimmedChannelId}" in row ${i + 2}, skipping`);
      continue;
    }

    if (seenChannelIds[trimmedChannelId]) {
      Logger.log(`Warning: Channel ID "${trimmedChannelId}" appears multiple times in the sheet. Row ${seenChannelIds[trimmedChannelId]} and row ${i + 2}. Using the latest occurrence (row ${i + 2}).`);
    }
    seenChannelIds[trimmedChannelId] = i + 2;

    const mapping = {
      collection_name: String(collectionName).trim(),
      channel_name: channelName ? String(channelName).trim() : '',
      channel_id: trimmedChannelId,
      _normalized_collection: normalizeCollectionName(String(collectionName).trim())
    };

    if (isCustomerCentric) {
      mapping.customer_name = customerName ? String(customerName).trim() : '';
    }

    mappings.push(mapping);
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
 * Filter channels to only include those with non-empty names
 */
function getNamedChannels_(collection) {
  return (collection.channels || []).filter(ch => ch.name && ch.name.trim() !== '');
}

/**
 * Generate an action plan by comparing desired state (sheet) with actual state (ClearFeed)
 */
function generateActionPlan(sheetData, collections) {
  // Build lookup structures
  const collectionNameToId = {};
  const collectionIdToName = {};
  const collectionOwners = {}; // collection_id -> most common owner
  const actualChannelToCollection = {}; // normalized channel_id -> collection_id
  const channelIdToName = {}; // channel_id -> channel_name from API
  const channelIdToStatus = {}; // channel_id -> status (active/inactive)

  for (const col of collections) {
    const normalizedName = normalizeCollectionName(col.name);
    collectionNameToId[normalizedName] = col.id;
    collectionIdToName[col.id] = col.name;
    collectionOwners[col.id] = null; // Will be determined from channels

    // Track channel to collection mapping and owners
    const ownerCounts = {};
    for (const ch of getNamedChannels_(col)) {
      channelIdToStatus[ch.id] = ch.status;
      // Only include active channels in actual state (inactive channels can be re-added)
      if (ch.status === 'inactive') continue;
      actualChannelToCollection[ch.id] = col.id;
      channelIdToName[ch.id] = ch.name;
      // Track most common owner for this collection
      if (ch.owner) {
        ownerCounts[ch.owner] = (ownerCounts[ch.owner] || 0) + 1;
      }
    }

    // Find most common owner
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

  // Build desired state from sheet
  const desiredChannelToCollection = {}; // channel_id -> collection_id
  const collectionsNotFound = new Set();
  const channelInfo = {}; // channel_id -> {name, collection_name}

  for (const mapping of sheetData) {
    const normalizedCol = mapping._normalized_collection;

    if (!collectionNameToId[normalizedCol]) {
      collectionsNotFound.add(mapping.collection_name);
      continue;
    }

    const collectionId = collectionNameToId[normalizedCol];
    desiredChannelToCollection[mapping.channel_id] = collectionId;
    // Use fallback chain: sheet name → API name → channel ID
    channelInfo[mapping.channel_id] = {
      name: mapping.channel_name || channelIdToName[mapping.channel_id] || mapping.channel_id,
      collection_name: mapping.collection_name,
      collection_id: collectionId
    };
  }

  // Generate plan
  const plan = {
    toAdd: [],
    toMove: [],
    toRemove: [],
    collectionsNotFound: Array.from(collectionsNotFound)
  };

  // Channels to add: in desired but not in actual
  for (const [channelId, collectionId] of Object.entries(desiredChannelToCollection)) {
    if (!(channelId in actualChannelToCollection)) {
      plan.toAdd.push({
        channel_id: channelId,
        channel_name: channelInfo[channelId].name,
        collection_name: channelInfo[channelId].collection_name,
        collection_id: collectionId
      });
    }
  }

  // Channels to move: in both, but different collection
  for (const [channelId, desiredColId] of Object.entries(desiredChannelToCollection)) {
    if (channelId in actualChannelToCollection) {
      const actualColId = actualChannelToCollection[channelId];
      if (desiredColId !== actualColId) {
        // Find collection names
        let fromCollectionName = "Unknown";
        let toCollectionName = channelInfo[channelId].collection_name;

        for (const col of collections) {
          if (col.id === actualColId) fromCollectionName = col.name;
        }

        plan.toMove.push({
          channel_id: channelId,
          channel_name: channelInfo[channelId].name,
          from_collection: fromCollectionName,
          to_collection: toCollectionName,
          to_collection_id: desiredColId
        });
      }
    }
  }

  // Channels to remove: in actual but not in desired
  for (const [channelId, collectionId] of Object.entries(actualChannelToCollection)) {
    if (!(channelId in desiredChannelToCollection)) {
      // Find collection and channel names
      let collectionName = "Unknown";
      let channelName = channelId;

      for (const col of collections) {
        if (col.id === collectionId) {
          collectionName = col.name;
          for (const ch of getNamedChannels_(col)) {
            if (ch.id === channelId) {
              channelName = ch.name;
              break;
            }
          }
          break;
        }
      }

      plan.toRemove.push({
        channel_id: channelId,
        channel_name: channelName,
        collection_name: collectionName
      });
    }
  }

  return {
    plan: plan,
    collectionOwners: collectionOwners,
    collectionIdToName: collectionIdToName,
    channelIdToStatus: channelIdToStatus
  };
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
      lines.push(`   + ${item.channel_name} (${item.channel_id}) → ${item.collection_name}`);
    }
    lines.push("");
  }

  // Channels to move
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
      lines.push(`   - ${item.channel_name} (${item.channel_id}) from ${item.collection_name}`);
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
  if (plan.toAdd.length === 0 && plan.toMove.length === 0 && plan.toRemove.length === 0) {
    lines.push("✅ No changes needed - sheet is already in sync!");
  } else {
    lines.push("SUMMARY:");
    lines.push(`  Add: ${plan.toAdd.length}`);
    lines.push(`  Move: ${plan.toMove.length}`);
    lines.push(`  Remove: ${plan.toRemove.length} ${!CONFIG.INCLUDE_DELETES ? '(skipped)' : ''}`);
  }

  return lines.join("\n");
}

// =============================================================================
// Shared Plan Execution Helpers (used by both legacy and customer-centric modes)
// =============================================================================

/**
 * Execute add operations (grouped by collection for efficiency)
 * @param {Array} toAdd - plan.toAdd from generateActionPlan()
 * @param {Object} results - results object to mutate
 * @param {Object} collectionOwners - collection_id -> owner (for SET_OWNER flag)
 */
function executeAdds_(toAdd, results, collectionOwners) {
  const setOwner = resolveSetOwner_();
  const addItemById = {};
  for (const item of toAdd) {
    addItemById[item.channel_id] = item;
  }

  // Group adds by collection for efficiency
  const addsByCollection = {};
  for (const item of toAdd) {
    if (!addsByCollection[item.collection_id]) {
      addsByCollection[item.collection_id] = [];
    }
    const channelObj = { id: item.channel_id };
    if (CONFIG.IS_ON_CUSTOMER_INBOX_MODEL) {
      const customerObj = { type: 'new' };
      if (setOwner) {
        customerObj.owner = collectionOwners[item.collection_id] || null;
      }
      channelObj.customer = customerObj;
    } else if (setOwner) {
      channelObj.owner = collectionOwners[item.collection_id] || '';
    }
    addsByCollection[item.collection_id].push(channelObj);
  }

  for (const [collectionId, channels] of Object.entries(addsByCollection)) {
    try {
      const result = addChannelsToCollection(collectionId, channels);
      if (result.success) {
        results.addSuccess += channels.length;
        Logger.log(`✅ Added ${channels.length} channels to collection ${collectionId}`);
        for (const ch of channels) {
          const item = addItemById[ch.id];
          results.addedChannels.push({
            id: ch.id,
            name: (item && item.channel_name) ? item.channel_name : ch.id,
            collection: item ? item.collection_name : ''
          });
        }
      } else {
        results.addFailed += channels.length;
        Logger.log(`❌ Failed to add channels to collection ${collectionId}: ${result.error}`);
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
      const failedList = channels.map(function(ch) {
        const item = addItemById[ch.id];
        const nm = (item && item.channel_name) ? item.channel_name : ch.id;
        return `${ch.id} - ${nm}`;
      }).join(', ');
      results.failures.push(`Add error (collection ${collectionId}): ${error.toString()}. Channels: ${failedList}`);
    }
  }
}

/**
 * Execute remove operations
 * @param {Array} toRemove - plan.toRemove from generateActionPlan()
 * @param {Object} results - results object to mutate
 * @param {boolean} skipDeletes - if true, skip all delete operations
 */
function executeRemoves_(toRemove, results, skipDeletes) {
  for (const item of toRemove) {
    if (skipDeletes) {
      results.removeSkipped++;
      Logger.log(`⏭️ Skipped removal of channel ${item.channel_name} (${item.channel_id}) - deletes disabled`);
      results.failures.push(`Remove skipped (deletes disabled): ${item.channel_id} - ${item.channel_name}`);
      continue;
    }

    try {
      const result = deleteChannel(item.channel_id);
      if (result.success) {
        results.removeSuccess++;
        results.removedChannels.push({
          id: item.channel_id,
          name: item.channel_name || item.channel_id,
          collection: item.collection_name || ''
        });
        Logger.log(`✅ Removed channel ${item.channel_name} (${item.channel_id})`);
      } else {
        results.removeFailed++;
        Logger.log(`❌ Failed to remove channel ${item.channel_name} (${item.channel_id}): ${result.error}`);
        results.failures.push(`Remove failed: ${item.channel_id} - ${item.channel_name}. ${result.error}`);
      }
    } catch (error) {
      results.removeFailed++;
      Logger.log(`❌ Error removing channel ${item.channel_name} (${item.channel_id}): ${error.toString()}`);
      results.failures.push(`Remove error: ${item.channel_id} - ${item.channel_name}. ${error.toString()}`);
    }
  }
}

// =============================================================================
// Plan Execution Functions
// =============================================================================

/**
 * Execute legacy moves (individual moveChannel calls)
 */
function executeLegacyMoves_(toMove, results) {
  for (const item of toMove) {
    try {
      const result = moveChannel(item.channel_id, item.to_collection_id);
      if (result.success) {
        results.moveSuccess++;
        Logger.log(`✅ Moved channel ${item.channel_name} (${item.channel_id}) to ${item.to_collection}`);
      } else {
        results.moveFailed++;
        Logger.log(`❌ Failed to move channel ${item.channel_name} (${item.channel_id}): ${result.error}`);
        results.failures.push(`Move failed: ${item.channel_id} - ${item.channel_name}. ${result.error}`);
      }
    } catch (error) {
      results.moveFailed++;
      Logger.log(`❌ Error moving channel ${item.channel_name} (${item.channel_id}): ${error.toString()}`);
      results.failures.push(`Move error: ${item.channel_id} - ${item.channel_name}. ${error.toString()}`);
    }
  }
}

/**
 * Execute the sync plan (legacy mode)
 */
function executePlan(plan, skipDeletes, collectionOwners) {
  const results = {
    addSuccess: 0,
    addFailed: 0,
    moveSuccess: 0,
    moveFailed: 0,
    removeSuccess: 0,
    removeFailed: 0,
    removeSkipped: 0,
    // Email tracking
    addedChannels: [],
    removedChannels: [],
    failures: []
  };

  executeAdds_(plan.toAdd, results, collectionOwners);
  executeLegacyMoves_(plan.toMove, results);
  executeRemoves_(plan.toRemove, results, skipDeletes);

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

  if (results.moveSuccess > 0) {
    lines.push(`✅ Moved: ${results.moveSuccess} channel(s)`);
  }
  if (results.moveFailed > 0) {
    lines.push(`❌ Move failed: ${results.moveFailed} channel(s)`);
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

  const totalActions = results.addSuccess + results.moveSuccess + results.removeSuccess;
  const totalFailed = results.addFailed + results.moveFailed + results.removeFailed;

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
    return `${id} - ${name}${collection}`;
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

// =============================================================================
// Legacy Model - Populate Initial Mappings
// =============================================================================

/**
 * Populate the sheet with initial Collection -> Channel mappings (Legacy Model)
 * Fetches all collections and their channels from ClearFeed
 */
function populateCollectionChannels() {
  try {
    Logger.log("Starting collection-channel population...");

    if (CONFIG.IS_ON_CUSTOMER_INBOX_MODEL) {
      throw new Error("populateCollectionChannels() cannot be used with IS_ON_CUSTOMER_INBOX_MODEL = true.");
    }

    if (!CONFIG.API_KEY || CONFIG.API_KEY === "") {
      safeAlert("Configuration Error", "Please update CONFIG.API_KEY with your ClearFeed API key.");
      return;
    }

    const sheet = getSheet();
    const lastRow = sheet.getLastRow();

    if (lastRow > 1) {
      safeAlert("Existing Data Found", "The sheet already contains data. Please clear the existing data before populating initial mappings.");
      return;
    }

    const collections = fetchCollections();
    Logger.log(`Fetched ${collections.length} collections from ClearFeed`);

    const sheetData = [];
    let totalChannels = 0;

    for (const collection of collections) {
      for (const channel of getNamedChannels_(collection)) {
        if (channel.status === 'inactive') {
          continue;
        }

        sheetData.push({
          collection: collection.name,
          channel_name: channel.name,
          channel_id: channel.id
        });
        totalChannels++;
      }
    }

    sheet.getRange(1, 1, 1, 3).setValues([["Collection", "Channel Name", "Channel ID"]]);
    sheet.getRange(1, 1, 1, 3).setFontWeight("bold");

    if (sheetData.length > 0) {
      const values = sheetData.map(row => [row.collection, row.channel_name, row.channel_id]);
      sheet.getRange(2, 1, sheetData.length, 3).setValues(values);

      const successMsg = `✅ Successfully populated sheet with ${totalChannels} active channels across ${collections.length} collections.\n\n` +
        `The sheet has been populated with the following format:\n` +
        `Collection | Channel Name | Channel ID`;

      safeAlert("Population Complete", successMsg);
      Logger.log(`Successfully populated sheet with ${sheetData.length} channel mappings`);

    } else {
      safeAlert("No Data Found", "No active channels found in your ClearFeed account.");
      Logger.log("No active channels found");
    }

  } catch (error) {
    Logger.log(`Error during population: ${error.toString()}`);
    safeAlert("Population Error", `An error occurred: ${error.toString()}`);
  }
}

// =============================================================================
// Customer-Centric Inbox Model
// =============================================================================

/**
 * Populate the sheet with initial Customer -> Channel mappings
 * Validates that each customer has only 1 channel
 */
function populateInitialMappings() {
  try {
    Logger.log("Starting initial mapping population...");

    if (!CONFIG.IS_ON_CUSTOMER_INBOX_MODEL) {
      throw new Error("populateInitialMappings() requires IS_ON_CUSTOMER_INBOX_MODEL = true.");
    }

    if (!CONFIG.API_KEY || CONFIG.API_KEY === "") {
      safeAlert("Configuration Error", "Please update CONFIG.API_KEY with your ClearFeed API key.");
      return;
    }

    const sheet = getSheet();
    const lastRow = sheet.getLastRow();

    if (lastRow > 1) {
      safeAlert("Existing Data Found", "The sheet already contains data. Please clear the existing data before populating initial mappings.");
      return;
    }

    const collections = fetchCollections();
    Logger.log(`Fetched ${collections.length} collections from ClearFeed`);

    const collectionIdToName = {};
    const channelIdToName = {};
    for (const col of collections) {
      collectionIdToName[col.id] = col.name;
      for (const ch of getNamedChannels_(col)) {
        channelIdToName[ch.id] = ch.name;
      }
    }

    // Build channel status lookup to filter inactive channels
    const channelIdToStatus = {};
    for (const col of collections) {
      for (const ch of getNamedChannels_(col)) {
        channelIdToStatus[ch.id] = ch.status;
      }
    }

    const customers = fetchAllCustomers();
    Logger.log(`Fetched ${customers.length} customers`);

    const sheetData = [];
    const multiChannelCustomers = [];

    for (const customer of customers) {
      const activeChannelIds = (customer.channel_ids || []).filter(id => channelIdToStatus[id] !== 'inactive');

      if (activeChannelIds.length === 0) {
        Logger.log(`Skipping customer "${customer.name}" - no active channels`);
        continue;
      }

      if (activeChannelIds.length > 1) {
        multiChannelCustomers.push({
          name: customer.name,
          channelCount: activeChannelIds.length,
          channels: activeChannelIds.map(id => channelIdToName[id] || id).join(', ')
        });
      }

      const collectionName = collectionIdToName[customer.collection_id] || "Unknown";
      for (const channelId of activeChannelIds) {
        sheetData.push({
          collection: collectionName,
          customer: customer.name,
          channel_name: channelIdToName[channelId] || channelId,
          channel_id: channelId
        });
      }
    }

    sheet.getRange(1, 1, 1, 4).setValues([["Collection", "Customer", "Channel Name", "Channel ID"]]);
    sheet.getRange(1, 1, 1, 4).setFontWeight("bold");

    if (sheetData.length > 0) {
      const values = sheetData.map(row => [row.collection, row.customer, row.channel_name, row.channel_id]);
      sheet.getRange(2, 1, sheetData.length, 4).setValues(values);

      let successMsg = `Successfully populated sheet with ${sheetData.length} customer-channel mappings.\n\n` +
        `Collection | Customer | Channel Name | Channel ID`;

      if (multiChannelCustomers.length > 0) {
        successMsg += `\n\nWARNING: The following customers have multiple active channels (shown as separate rows):\n` +
          multiChannelCustomers.map(c => `- ${c.name} (${c.channelCount} channels: ${c.channels})`).join('\n') +
          `\n\nWhen syncing back, ALL channels of a multi-channel customer must be moved to the same collection.`;
      }

      safeAlert("Population Complete", successMsg);
      Logger.log(`Successfully populated sheet with ${sheetData.length} mappings`);

    } else {
      safeAlert("No Data Found", "No customers with active channels found in your ClearFeed account.");
      Logger.log("No customers with active channels found");
    }

  } catch (error) {
    Logger.log(`Error during population: ${error.toString()}`);
    safeAlert("Population Error", `An error occurred: ${error.toString()}`);
  }
}

/**
 * Sync customer-centric changes from sheet to ClearFeed
 * - MOVE: Moves entire customer to different collection
 * - DELETE: Deletes channel (marks inactive)
 */
function syncCustomerCentricChanges() {
  const runStartedAt = new Date();

  try {
    Logger.log("Starting customer-centric sync...");

    if (!CONFIG.API_KEY || CONFIG.API_KEY === "") {
      safeAlert("Configuration Error", "Please update CONFIG.API_KEY with your ClearFeed API key.");
      sendCustomerCentricSyncEmail_({
        startedAt: runStartedAt,
        completedAt: new Date(),
        addedChannels: [],
        movedCustomers: [],
        removedChannels: [],
        failures: ["Configuration Error: CONFIG.API_KEY is missing or empty."]
      });
      return;
    }

    // Validate sheet headers before reading data
    const sheet = getSheet();
    const headers = sheet.getRange(1, 1, 1, 4).getValues()[0];
    try {
      validateSheetHeaders(headers, true);
    } catch (error) {
      safeAlert("Invalid Sheet Format", "Sheet headers are incorrect:\n\n" + error.message);
      sendCustomerCentricSyncEmail_({
        startedAt: runStartedAt,
        completedAt: new Date(),
        addedChannels: [],
        movedCustomers: [],
        removedChannels: [],
        failures: ["Invalid Sheet Format: " + error.message]
      });
      return;
    }

    const sheetData = readSheetData_();
    if (sheetData.length === 0) {
      safeAlert("No Data", "No customer-channel mappings found in the sheet.");
      sendCustomerCentricSyncEmail_({
        startedAt: runStartedAt,
        completedAt: new Date(),
        addedChannels: [],
        movedCustomers: [],
        removedChannels: [],
        failures: ["No Data: No customer-channel mappings found in the sheet."]
      });
      return;
    }
    Logger.log(`Read ${sheetData.length} customer-channel mappings from sheet`);

    const collections = fetchCollections();
    const customers = fetchAllCustomers();
    Logger.log(`Fetched ${collections.length} collections and ${customers.length} customers from ClearFeed`);

    const planData = generateActionPlan(sheetData, collections);
    Logger.log("Action plan generated");

    const planMessage = formatPlanMessage(planData.plan);
    safeAlert("Sync Plan", planMessage);

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
      shouldExecute = true;
      Logger.log("Non-interactive mode: executing plan automatically");
    }

    if (shouldExecute) {
      const results = executeCustomerCentricPlan(planData.plan, customers, planData.collectionOwners, planData.channelIdToStatus);
      const resultMessage = formatCustomerCentricResultMessage(results);
      safeAlert("Sync Results", resultMessage);
      Logger.log("Customer-centric sync completed");

      sendCustomerCentricSyncEmail_({
        startedAt: runStartedAt,
        completedAt: new Date(),
        addedChannels: results.addedChannels || [],
        movedCustomers: results.movedCustomers || [],
        removedChannels: results.removedChannels || [],
        failures: (results.failures || [])
      });
    } else {
      Logger.log("Sync cancelled by user");
      sendCustomerCentricSyncEmail_({
        startedAt: runStartedAt,
        completedAt: new Date(),
        addedChannels: [],
        movedCustomers: [],
        removedChannels: [],
        failures: ["Sync cancelled by user."]
      });
    }

  } catch (error) {
    Logger.log(`Error during sync: ${error.toString()}`);
    safeAlert("Sync Error", `An error occurred: ${error.toString()}`);

    sendCustomerCentricSyncEmail_({
      startedAt: runStartedAt,
      completedAt: new Date(),
      movedCustomers: [],
      removedChannels: [],
      failures: [`Sync Error: ${error.toString()}`]
    });
  }
}

/**
// =============================================================================
// Customer-Centric Inbox Model - Plan Generation
// =============================================================================

// =============================================================================
// Customer-Centric Inbox Model - Plan Execution
// =============================================================================

/**
 * Execute customer-centric plan using shared plan format from generateActionPlan()
 * @param {Object} plan - Plan from generateActionPlan()
 * @param {Array} customers - Customers from fetchAllCustomers(), used to look up customer_id/version for moves
 */
function executeCustomerCentricPlan(plan, customers, collectionOwners, channelIdToStatus) {
  const results = {
    addSuccess: 0,
    addFailed: 0,
    moveSuccess: 0,
    moveFailed: 0,
    removeSuccess: 0,
    removeFailed: 0,
    removeSkipped: 0,
    addedChannels: [],
    movedCustomers: [],
    removedChannels: [],
    failures: []
  };

  // Execute adds and removes using shared helpers
  executeAdds_(plan.toAdd, results, collectionOwners);
  executeRemoves_(plan.toRemove, results, !CONFIG.INCLUDE_DELETES);

  // Build channel_id → customer and customer_id → active channel_ids lookups
  const channelToCustomer = {};
  const customerActiveChannels = {};
  for (const customer of customers) {
    if (customer.channel_ids) {
      const activeIds = customer.channel_ids.filter(id => id && channelIdToStatus[id] !== 'inactive');
      customerActiveChannels[customer.id] = activeIds;
      for (const channelId of activeIds) {
        channelToCustomer[channelId] = customer;
      }
    }
  }

  // Group moves by customer_id → { to_collection_id, items[] }
  const movesByCustomer = {};
  for (const item of plan.toMove) {
    const customer = channelToCustomer[item.channel_id];
    if (!customer) {
      results.moveFailed++;
      results.failures.push(`Move failed: ${item.channel_id} - no customer found for channel`);
      Logger.log(`No customer found for channel ${item.channel_id}, cannot move`);
      continue;
    }

    if (!movesByCustomer[customer.id]) {
      movesByCustomer[customer.id] = { customer: customer, items: [] };
    }
    movesByCustomer[customer.id].items.push(item);
  }

  // Execute moves (one moveCustomer per customer)
  for (const [customerId, moveGroup] of Object.entries(movesByCustomer)) {
    const customer = moveGroup.customer;
    const items = moveGroup.items;

    // For multi-channel customers, verify ALL active channels are moving to the same collection
    const activeChannelIds = customerActiveChannels[customer.id] || [];
    if (activeChannelIds.length > 1) {
      const targetCollection = items[0].to_collection_id;

      // Check all items go to the same collection
      const allSameTarget = items.every(item => item.to_collection_id === targetCollection);
      if (!allSameTarget) {
        results.moveFailed += items.length;
        const channelList = items.map(i => `${i.channel_name} (${i.channel_id}) → ${i.to_collection}`).join(', ');
        results.failures.push(`Move failed: ${customer.name} has multiple channels targeting different collections. All channels must move to the same collection. Got: ${channelList}`);
        Logger.log(`Move failed for ${customer.name}: channels target different collections`);
        continue;
      }

      // Check all active channels are included in the move
      const movingChannelIds = new Set(items.map(i => i.channel_id));
      const missingChannels = activeChannelIds.filter(id => !movingChannelIds.has(id));
      if (missingChannels.length > 0) {
        results.moveFailed += items.length;
        results.failures.push(`Move failed: ${customer.name} has ${activeChannelIds.length} active channels but only ${items.length} are being moved. All channels must move together.`);
        Logger.log(`Move failed for ${customer.name}: not all channels included in move`);
        continue;
      }
    }

    // Execute the move
    const targetCollection = items[0].to_collection_id;
    try {
      const result = moveCustomer(customer.id, targetCollection, customer.version || 0);
      if (result.success) {
        results.moveSuccess += items.length;
        results.movedCustomers.push({
          customer_name: customer.name,
          from_collection: items[0].from_collection,
          to_collection: items[0].to_collection
        });
        Logger.log(`Moved customer ${customer.name} to ${items[0].to_collection}`);
      } else {
        results.moveFailed += items.length;
        results.failures.push(`Move failed: ${customer.name}. ${result.error}`);
        Logger.log(`Failed to move customer ${customer.name}: ${result.error}`);
      }
    } catch (error) {
      results.moveFailed += items.length;
      results.failures.push(`Move error: ${customer.name}. ${error.toString()}`);
      Logger.log(`Error moving customer ${customer.name}: ${error.toString()}`);
    }
  }

  return results;
}

/**
 * Format customer-centric result message
 */
function formatCustomerCentricResultMessage(results) {
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

  if (results.moveSuccess > 0) {
    lines.push(`✅ Moved: ${results.moveSuccess} customer(s)`);
  }
  if (results.moveFailed > 0) {
    lines.push(`❌ Move failed: ${results.moveFailed} customer(s)`);
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

  const totalActions = results.addSuccess + results.moveSuccess + results.removeSuccess;
  const totalFailed = results.addFailed + results.moveFailed + results.removeFailed;

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
// Customer-Centric Inbox Model - Connection Test
// =============================================================================

/**
 * Test customer connection for customer-centric model
 */
function testCustomerConnection() {
  try {
    Logger.log("Testing Customer-Centric API connection...");

    if (!CONFIG.API_KEY || CONFIG.API_KEY === "") {
      safeAlert("Configuration Error", "Please update CONFIG.API_KEY with your ClearFeed API key.");
      return;
    }

    const collections = fetchCollections();
    const customers = fetchAllCustomers();

    // Build channel status lookup from collections
    const channelIdToStatus = {};
    const channelIdToName = {};
    for (const col of collections) {
      for (const ch of getNamedChannels_(col)) {
        channelIdToStatus[ch.id] = ch.status;
        channelIdToName[ch.id] = ch.name;
      }
    }

    let singleChannelCustomers = 0;
    let multiChannelCustomers = [];
    let emptyCustomers = 0;

    for (const customer of customers) {
      // Filter out inactive channels
      const activeChannelIds = (customer.channel_ids || []).filter(id => channelIdToStatus[id] !== 'inactive');
      if (activeChannelIds.length === 0) {
        emptyCustomers++;
      } else if (activeChannelIds.length === 1) {
        singleChannelCustomers++;
      } else {
        multiChannelCustomers.push({
          name: customer.name,
          channelCount: activeChannelIds.length,
          channels: activeChannelIds.map(id => channelIdToName[id] || id).join(', ')
        });
      }
    }

    let message = `Connection successful!\n\n` +
      `Collections: ${collections.length}\n` +
      `Total Customers: ${customers.length}\n` +
      `Customers with 1 active channel: ${singleChannelCustomers}\n` +
      `Customers with 0 active channels: ${emptyCustomers}`;

    if (multiChannelCustomers.length > 0) {
      message += `\n\nCustomers with 2+ active channels: ${multiChannelCustomers.length}\n` +
        `(All channels of a multi-channel customer must move to the same collection during sync)\n\n` +
        multiChannelCustomers.map(c => `  - ${c.name} (${c.channelCount} channels: ${c.channels})`).join('\n');
    }

    safeAlert("Connection Test", message);
    Logger.log("Connection test successful");

  } catch (error) {
    Logger.log(`Connection test failed: ${error.toString()}`);
    safeAlert("Connection Failed", `Error: ${error.toString()}`);
  }
}

// =============================================================================
// Customer-Centric Inbox Model - API Functions
// =============================================================================

/**
 * Fetch all customers with pagination
 */
function fetchAllCustomers() {
  const PAGE_SIZE = 100;
  const DELAY_MS = 500;
  let allCustomers = [];
  let nextCursor = null;
  let pageCount = 0;

  do {
    const url = `${BASE_URL}/customers?limit=${PAGE_SIZE}${nextCursor ? '&next_cursor=' + encodeURIComponent(nextCursor) : ''}`;

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
    allCustomers = allCustomers.concat(data.customers || []);

    nextCursor = data.response_metadata?.next_cursor || null;
    pageCount++;

    if (nextCursor) {
      Utilities.sleep(DELAY_MS);
    }

  } while (nextCursor);

  Logger.log(`Fetched ${allCustomers.length} customers across ${pageCount} pages`);
  return allCustomers;
}

/**
 * Move a customer to a different collection
 */
function moveCustomer(customerId, collectionId, version) {
  const url = `${BASE_URL}/customers/${customerId}`;

  const payload = {
    collection_id: collectionId,
    version: version
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

// =============================================================================
// Customer-Centric Inbox Model - Email Functions
// =============================================================================

/**
 * Send Customer-Centric sync email
 */
function sendCustomerCentricSyncEmail_(runData) {
  if (!EMAIL_CONFIG.TO || EMAIL_CONFIG.TO === "") {
    Logger.log("Email sending disabled: EMAIL_CONFIG.TO is empty");
    return;
  }

  const timestamp = formatRunTimestamp_();
  const subject = `${EMAIL_CONFIG.SUBJECT_PREFIX}[${timestamp}] - Customer Sync`;

  const bodyLines = [];
  bodyLines.push('Customer-Centric Sync completed:');
  bodyLines.push('');

  bodyLines.push('Channels Added:');
  if (runData.addedChannels && runData.addedChannels.length > 0) {
    for (const ch of runData.addedChannels) {
      bodyLines.push(`- ${ch.name} (${ch.id}) in ${ch.collection}`);
    }
  } else {
    bodyLines.push('None');
  }
  bodyLines.push('');

  bodyLines.push('Customers Moved:');
  if (runData.movedCustomers && runData.movedCustomers.length > 0) {
    for (const cust of runData.movedCustomers) {
      bodyLines.push(`- ${cust.customer_name} FROM ${cust.from_collection} → ${cust.to_collection}`);
    }
  } else {
    bodyLines.push('None');
  }
  bodyLines.push('');

  bodyLines.push('Channels Removed:');
  if (runData.removedChannels && runData.removedChannels.length > 0) {
    for (const ch of runData.removedChannels) {
      bodyLines.push(`- ${ch.name} (${ch.id}) from ${ch.collection}`);
    }
  } else {
    bodyLines.push('None');
  }
  bodyLines.push('');

  bodyLines.push('Failures:');
  bodyLines.push(formatFailures_(runData.failures));

  const body = bodyLines.join('\n');

  try {
    GmailApp.sendEmail(EMAIL_CONFIG.TO, subject, body, {
      from: EMAIL_CONFIG.FROM,
      name: EMAIL_CONFIG.SENDER_NAME,
      replyTo: EMAIL_CONFIG.FROM
    });
  } catch (e) {
    try {
      MailApp.sendEmail(EMAIL_CONFIG.TO, subject, body, {
        name: EMAIL_CONFIG.SENDER_NAME,
        replyTo: EMAIL_CONFIG.FROM
      });
    } catch (e2) {
      Logger.log(`Failed to send Customer-Centric sync email: ${e2.toString()}`);
    }
  }
}

// =============================================================================
// Portal Update - NEW FEATURE
// =============================================================================

/**
 * Read portal settings from the sheet (Customer-Centric mode only)
 * Reads columns 1-5: [Collection, Customer, Channel Name, Channel ID, Enable Portal]
 * Returns array of objects with customer_name, channel_id, enable_portal (boolean)
 * Only includes rows where column 5 value is "yes" or "no" (case-insensitive)
 */
function readPortalSheetData_() {
  const sheet = getSheet();
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return [];
  }

  // Read all 5 columns
  const data = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  const portalData = [];

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const collectionName = row[0];
    const customerName = row[1];
    const channelName = row[2];
    const channelId = row[3];
    const enablePortalValue = row[4];

    // Skip rows missing Collection or Channel ID
    if (!collectionName || !channelId) continue;

    // Check column 5 for "yes" or "no" values (case-insensitive)
    const trimmedValue = String(enablePortalValue || '').trim().toLowerCase();
    if (trimmedValue !== 'yes' && trimmedValue !== 'no') {
      continue; // Skip rows that don't have "yes" or "no"
    }

    portalData.push({
      customer_name: customerName ? String(customerName).trim() : '',
      channel_id: String(channelId).trim(),
      enable_portal: trimmedValue === 'yes'
    });
  }

  return portalData;
}

/**
 * Update customer portal configuration via API
 * Makes PATCH request to /customers/:id
 * @param {string} customerId - The customer ID
 * @param {boolean} enabled - Whether to enable or disable portal
 * @param {number} version - The current customer version for optimistic locking
 * @returns {Object} - { success: true } on success, { success: false, error: string } on failure
 */
function updateCustomerPortal_(customerId, enabled, version) {
  const url = `${BASE_URL}/customers/${customerId}`;

  const payload = {
    portal_config: { enabled: enabled },
    version: version
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
 * Main entry point for Portal Update feature
 * Syncs portal enable/disable settings from column 5 of the sheet to ClearFeed customers
 * Only works in Customer-Centric mode (IS_ON_CUSTOMER_INBOX_MODEL = true)
 */
function syncPortalSettings() {
  try {
    Logger.log("Starting portal settings sync...");

    // Guard: Check if in Customer-Centric mode
    if (!CONFIG.IS_ON_CUSTOMER_INBOX_MODEL) {
      safeAlert("Feature Not Available", "Portal Update is only available in Customer-Centric Inbox Model.\n\nPlease set CONFIG.IS_ON_CUSTOMER_INBOX_MODEL = true to use this feature.");
      Logger.log("Portal Update skipped - not in Customer-Centric mode");
      return;
    }

    // Guard: Check API key is configured
    if (!CONFIG.API_KEY || CONFIG.API_KEY === "") {
      safeAlert("Configuration Error", "Please update CONFIG.API_KEY with your ClearFeed API key.");
      Logger.log("Portal Update failed - API key not configured");
      return;
    }

    // Validate column 5 header contains "portal"
    const sheet = getSheet();

    // Check if sheet has at least 5 columns
    if (sheet.getLastColumn() < 5) {
      safeAlert("Invalid Sheet Format", `Column 5 header must contain "Portal".\n\nPlease add a header "Enable Portal" to column E (column 5) and fill in values (Yes/No).`);
      Logger.log("Portal Update failed - sheet has fewer than 5 columns");
      return;
    }

    const headers = sheet.getRange(1, 1, 1, 5).getValues()[0];

    // Validate first 4 column headers (shared validation with customer-centric sync)
    try {
      validateSheetHeaders([headers[0], headers[1], headers[2], headers[3]], true);
    } catch (error) {
      safeAlert("Invalid Sheet Format", "Sheet headers are incorrect for columns 1-4:\n\n" + error.message + "\n\nPlease ensure columns 1-4 follow the Customer-Centric format: Collection | Customer | Channel Name | Channel ID");
      Logger.log("Portal Update failed - column headers 1-4 validation failed: " + error.message);
      return;
    }

    // Validate column 5 header
    const column5Header = String(headers[4] || '').toLowerCase().trim();
    if (!column5Header.includes('portal')) {
      safeAlert("Invalid Sheet Format", `Column 5 header must contain "Portal".\n\nFound: "${headers[4] || ''}"\n\nPlease add a header "Enable Portal" to column E (column 5) and fill in values (Yes/No).`);
      Logger.log("Portal Update failed - column 5 header does not contain 'portal'");
      return;
    }

    // Read portal settings from sheet
    const portalData = readPortalSheetData_();
    if (portalData.length === 0) {
      safeAlert("No Portal Data", "No rows found with 'Yes' or 'No' in column 5 (Enable Portal).\n\nPlease fill in column E with 'Yes' to enable portal or 'No' to disable portal for customers.");
      Logger.log("Portal Update skipped - no data found in column 5");
      return;
    }
    Logger.log(`Read ${portalData.length} portal settings from sheet`);

    // Fetch all customers from ClearFeed
    const customers = fetchAllCustomers();
    Logger.log(`Fetched ${customers.length} customers from ClearFeed`);

    // Build customer name -> customer map (case-insensitive lookup)
    // AND channel_id -> customer map for fallback lookup
    const customerMap = {};
    const channelToCustomerMap = {};
    for (const customer of customers) {
      const normalizedName = String(customer.name || '').toLowerCase().trim();
      customerMap[normalizedName] = customer;

      // Build channel_id -> customer map for fallback lookup
      if (customer.channel_ids) {
        for (const cid of customer.channel_ids) {
          if (cid) {
            channelToCustomerMap[String(cid).trim()] = customer;
          }
        }
      }
    }

    // Deduplicate by customer ID (last occurrence wins)
    // Track customers not found in ClearFeed
    const customerPortalMap = {}; // customer_id -> { customer, enabled, channel_id, lookup_method }
    const customersNotFound = new Set();

    for (const row of portalData) {
      let customer = null;
      let lookupMethod = '';

      // Try customer name lookup first
      if (row.customer_name) {
        const normalizedName = row.customer_name.toLowerCase().trim();
        customer = customerMap[normalizedName];
        if (customer) {
          lookupMethod = 'name';
        }
      }

      // Fallback to channel_id lookup if name lookup failed
      if (!customer && row.channel_id) {
        customer = channelToCustomerMap[row.channel_id];
        if (customer) {
          lookupMethod = 'channel_id';
        }
      }

      if (!customer) {
        // Track what we couldn't find
        const identifier = row.customer_name || "Channel ID: " + row.channel_id;
        customersNotFound.add(identifier);
        continue;
      }

      // Check for conflicting portal values for the same customer
      const existingData = customerPortalMap[customer.id];
      if (existingData && existingData.enabled !== row.enable_portal) {
        Logger.log(`⚠️  Warning: Customer "${customer.name}" has conflicting portal values in the sheet. Previous: "${existingData.enabled ? 'Yes' : 'No'}", Current: "${row.enable_portal ? 'Yes' : 'No'}". Using current value (last occurrence wins).`);
      }

      // Last occurrence wins for each customer
      customerPortalMap[customer.id] = {
        customer: customer,
        enabled: row.enable_portal,
        channel_id: row.channel_id,
        lookup_method: lookupMethod
      };
    }

    // Build toEnable and toDisable lists
    // Check current portal state and only include customers that need changes
    const toEnable = [];
    const toDisable = [];
    const alreadyCorrect = []; // Customers already in desired state

    for (const [customerId, data] of Object.entries(customerPortalMap)) {
      const customer = data.customer;
      const currentState = customer.portal_config?.enabled || false;
      const desiredState = data.enabled;

      // Only add to list if current state differs from desired state
      if (desiredState && !currentState) {
        // Portal should be enabled but is currently disabled
        toEnable.push(data);
      } else if (!desiredState && currentState) {
        // Portal should be disabled but is currently enabled
        toDisable.push(data);
      } else {
        // Already in desired state - no change needed
        alreadyCorrect.push({
          customer_name: customer.name,
          current_state: currentState ? 'enabled' : 'disabled',
          desired_state: desiredState ? 'enabled' : 'disabled'
        });
      }
    }

    // Show plan
    const planLines = [];
    planLines.push("PORTAL UPDATE PLAN");
    planLines.push("===================");
    planLines.push("");

    if (toEnable.length > 0) {
      planLines.push(`✅ Portal will be ENABLED for ${toEnable.length} customer(s):`);
      for (const item of toEnable) {
        planLines.push(`   + ${item.customer.name} (ID: ${item.customer.id})`);
      }
      planLines.push("");
    }

    if (toDisable.length > 0) {
      planLines.push(`🚫 Portal will be DISABLED for ${toDisable.length} customer(s):`);
      for (const item of toDisable) {
        planLines.push(`   - ${item.customer.name} (ID: ${item.customer.id})`);
      }
      planLines.push("");
    }

    if (alreadyCorrect.length > 0) {
      planLines.push(`⏭️  No change needed for ${alreadyCorrect.length} customer(s) (already in desired state):`);
      for (const item of alreadyCorrect) {
        planLines.push(`   ✓ ${item.customer_name}`);
      }
      planLines.push("");
    }

    if (customersNotFound.size > 0) {
      planLines.push(`⚠️  Customers NOT FOUND in ClearFeed (skipped):`);
      for (const name of customersNotFound) {
        planLines.push(`   - ${name}`);
      }
      planLines.push("");
    }

    if (toEnable.length === 0 && toDisable.length === 0) {
      // All customers are already in desired state or not found
      if (alreadyCorrect.length > 0) {
        planLines.push("");
        planLines.push("✅ All customers are already in their desired portal state.");
        planLines.push("");
        planLines.push("No changes required - portal settings are already correct!");
      } else if (customersNotFound.size > 0) {
        planLines.push("");
        planLines.push("⚠️  No valid customers found to update.");
        planLines.push("");
        planLines.push("All specified customers were not found in ClearFeed.");
      } else {
        planLines.push("");
        planLines.push("⏭️  No portal changes needed.");
      }
      safeAlert("Portal Update Plan", planLines.join("\n"));
      Logger.log("Portal Update skipped - no changes needed");
      return;
    }

    planLines.push("SUMMARY:");
    planLines.push(`  Enable: ${toEnable.length}`);
    planLines.push(`  Disable: ${toDisable.length}`);
    if (alreadyCorrect.length > 0) {
      planLines.push(`  No change: ${alreadyCorrect.length} (already in desired state)`);
    }
    if (customersNotFound.size > 0) {
      planLines.push(`  Skipped: ${customersNotFound.size} (not found in ClearFeed)`);
    }

    safeAlert("Portal Update Plan", planLines.join("\n"));

    // Confirm before executing (skip in non-interactive mode)
    const isInteractive = isInteractiveMode();
    let shouldExecute = false;

    if (isInteractive) {
      const ui = SpreadsheetApp.getUi();
      const response = ui.alert(
        "Confirm Portal Update",
        "Do you want to execute this plan?",
        ui.ButtonSet.YES_NO
      );
      shouldExecute = (response === ui.Button.YES);
    } else {
      shouldExecute = true;
      Logger.log("Non-interactive mode: executing portal update automatically");
    }

    if (!shouldExecute) {
      Logger.log("Portal Update cancelled by user");
      return;
    }

    // Execute portal updates
    const results = {
      enableSuccess: 0,
      enableFailed: 0,
      disableSuccess: 0,
      disableFailed: 0
    };

    // Process enables
    for (const item of toEnable) {
      try {
        const result = updateCustomerPortal_(item.customer.id, true, item.customer.version || 0);
        if (result.success) {
          results.enableSuccess++;
          Logger.log(`✅ Enabled portal for customer ${item.customer.name} (ID: ${item.customer.id})`);
        } else {
          results.enableFailed++;
          Logger.log(`❌ Failed to enable portal for customer ${item.customer.name}: ${result.error}`);
        }
      } catch (error) {
        results.enableFailed++;
        Logger.log(`❌ Error enabling portal for customer ${item.customer.name}: ${error.toString()}`);
      }
    }

    // Process disables
    for (const item of toDisable) {
      try {
        const result = updateCustomerPortal_(item.customer.id, false, item.customer.version || 0);
        if (result.success) {
          results.disableSuccess++;
          Logger.log(`✅ Disabled portal for customer ${item.customer.name} (ID: ${item.customer.id})`);
        } else {
          results.disableFailed++;
          Logger.log(`❌ Failed to disable portal for customer ${item.customer.name}: ${result.error}`);
        }
      } catch (error) {
        results.disableFailed++;
        Logger.log(`❌ Error disabling portal for customer ${item.customer.name}: ${error.toString()}`);
      }
    }

    // Show results
    const resultLines = [];
    resultLines.push("PORTAL UPDATE RESULTS");
    resultLines.push("=====================");
    resultLines.push("");

    if (results.enableSuccess > 0) {
      resultLines.push(`✅ Portal enabled: ${results.enableSuccess} customer(s)`);
    }
    if (results.enableFailed > 0) {
      resultLines.push(`❌ Enable failed: ${results.enableFailed} customer(s)`);
    }

    if (results.disableSuccess > 0) {
      resultLines.push(`✅ Portal disabled: ${results.disableSuccess} customer(s)`);
    }
    if (results.disableFailed > 0) {
      resultLines.push(`❌ Disable failed: ${results.disableFailed} customer(s)`);
    }

    resultLines.push("");

    const totalSuccess = results.enableSuccess + results.disableSuccess;
    const totalFailed = results.enableFailed + results.disableFailed;

    if (totalFailed === 0 && totalSuccess > 0) {
      resultLines.push("✅ All portal updates completed successfully!");
    } else if (totalFailed > 0) {
      resultLines.push("⚠️  Some updates failed. Check logs for details.");
    }

    safeAlert("Portal Update Results", resultLines.join("\n"));
    Logger.log("Portal settings sync completed");

  } catch (error) {
    Logger.log(`Error during portal update: ${error.toString()}`);
    safeAlert("Portal Update Error", `An error occurred: ${error.toString()}`);
  }
}
