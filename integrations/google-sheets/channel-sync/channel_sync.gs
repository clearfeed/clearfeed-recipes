// ClearFeed Channel Sync to Google Sheets
// Syncs collection-to-channel mappings from a Google Sheet to ClearFeed
//
// Configuration - Update these values for your setup
const CONFIG = {
  API_KEY: "", // Required: Replace with your ClearFeed API key
  SHEET_NAME: "Channel Mappings", // Name of the sheet tab containing the mappings
  INCLUDE_DELETES: false, // Whether to actually delete channels (default: false for safety)
  SPREADSHEET_ID: "", // Leave empty to use current spreadsheet, or specify ID
  CREATE_EMPTY_CUSTOMER: false, // Whether to create an empty customer object when adding channels (OLD MODEL ONLY)
  SET_OWNER: false, // Whether to set the owner field when adding channels (OLD MODEL ONLY)
  IS_ON_CUSTOMER_INBOX_MODEL: true, // Set to true for Customer-Centric Inbox Model, false for legacy model
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
 * Shows different menu based on IS_ON_CUSTOMER_INBOX_MODEL flag
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();

  if (CONFIG.IS_ON_CUSTOMER_INBOX_MODEL) {
    // Customer-Centric Inbox Model menu
    const menu = ui.createMenu('Customers Sync')
      .addItem('📥 Populate Initial Mappings', 'populateInitialMappings')
      .addItem('🔄 Sync Customer Changes', 'syncCustomerCentricChanges')
      .addSeparator()
      .addItem('⏰ Setup Auto-Sync', 'setupAutoSyncTrigger')
      .addItem('🛑 Stop Auto-Sync', 'deleteAutoSyncTrigger')
      .addSeparator()
      .addItem('🧪 Test Connection', 'testCustomerConnection')
      .addItem('📋 View Logs', 'showLogs');

    menu.addToUi();
  } else {
    // Legacy Collection-Channel Model menu
    const menu = ui.createMenu('ClearFeed Channel Sync')
      .addItem('📥 Populate Initial Mappings', 'populateCollectionChannels')
      .addItem('🔄 Sync Channels', 'syncChannels')
      .addSeparator()
      .addItem('🧪 Test Connection', 'testClearfeedConnection')
      .addItem('📋 View Logs', 'showLogs');

    menu.addToUi();
  }
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
  const channelIdHeader = String(headers[isCustomerCentric ? 3 : 2] || '').toLowerCase().trim();

  // Validate Collection column (must be first column)
  if (!collectionHeader.includes('collection')) {
    throw new Error("Column 1 header must contain 'Collection'. Found: '" + headers[0] + "'");
  }
  if (collectionHeader.includes('channel') || collectionHeader.includes('customer')) {
    throw new Error("Column 1 header must be 'Collection', not 'Channel' or 'Customer'. Found: '" + headers[0] + "'");
  }

  // Validate Channel ID column (must be last column)
  if (!channelIdHeader.includes('channel')) {
    throw new Error("Column " + (isCustomerCentric ? "4" : "3") + " header must contain 'Channel'. Found: '" + headers[isCustomerCentric ? 3 : 2] + "'");
  }
  if (channelIdHeader.includes('customer') || channelIdHeader.includes('name')) {
    throw new Error("Column " + (isCustomerCentric ? "4" : "3") + " header must be 'Channel ID', not contain 'Customer' or 'Name'. Found: '" + headers[isCustomerCentric ? 3 : 2] + "'");
  }
}

/**
 * Read channel mappings from the sheet
 * Expects format: Collection | Slack channel (optional) | Channel ID
 * Skips the header row (row 1)
 */
function readSheetData() {
  const sheet = getSheet();
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    // No data (header only or empty)
    return [];
  }

  const data = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
  const mappings = [];
  const seenChannelIds = {}; // Track duplicates: channel_id -> row number

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const collectionName = row[0];
    const channelName = row[1];
    const channelId = row[2];

    // Skip rows with missing required data (collection and channel ID)
    if (!collectionName || !channelId) {
      continue;
    }

    // Trim whitespace
    const trimmedCollection = String(collectionName).trim();
    // channelName is now optional - if empty, will be filled from API later
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
      channel_name: trimmedChannelName,
      channel_id: trimmedChannelId,
      _normalized_collection: normalizeCollectionName(trimmedCollection)
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
      'Authorization': `Bearer ${CONFIG.API_KEY}`,
      'Content-Type': 'application/json'
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
 */
function generateActionPlan(sheetData, collections) {
  // Build lookup structures
  const collectionNameToId = {};
  const collectionOwners = {}; // collection_id -> most common owner
  const actualChannelToCollection = {}; // normalized channel_id -> collection_id
  const channelIdToName = {}; // channel_id -> channel_name from API

  for (const col of collections) {
    const normalizedName = normalizeCollectionName(col.name);
    collectionNameToId[normalizedName] = col.id;
    collectionOwners[col.id] = null; // Will be determined from channels

    // Track channel to collection mapping and owners
    const ownerCounts = {};
    for (const ch of (col.channels || [])) {
      actualChannelToCollection[ch.id] = col.id;
      // Store channel name from API for later use
      if (ch.name) {
        channelIdToName[ch.id] = ch.name;
      }
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
          for (const ch of (col.channels || [])) {
            if (ch.id === channelId) {
              channelName = ch.name || channelId;
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
    collectionOwners: collectionOwners
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
// Plan Execution Functions
// =============================================================================

/**
 * Execute the sync plan
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
    // Add empty customer object if enabled
    if (CONFIG.CREATE_EMPTY_CUSTOMER) {
      channelObj.customer = { type: 'new' };
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
            collection: item ? item.collection_name : ''
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

  // Execute moves (individual)
  for (const item of plan.toMove) {
    try {
      const result = moveChannel(item.channel_id, item.to_collection_id);
      if (result.success) {
        results.moveSuccess++;
        Logger.log(`✅ Moved channel ${item.channel_name} (${item.channel_id}) to ${item.to_collection}`);
      } else {
        results.moveFailed++;
        Logger.log(`❌ Failed to move channel ${item.channel_name} (${item.channel_id}): ${result.error}`);

        // Track failure for email
        results.failures.push(`Move failed: ${item.channel_id} - ${item.channel_name}. ${result.error}`);
      }
    } catch (error) {
      results.moveFailed++;
      Logger.log(`❌ Error moving channel ${item.channel_name} (${item.channel_id}): ${error.toString()}`);

      // Track failure for email
      results.failures.push(`Move error: ${item.channel_id} - ${item.channel_name}. ${error.toString()}`);
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
          collection: item.collection_name || ''
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

    const collections = fetchCollections();
    Logger.log(`Fetched ${collections.length} collections from ClearFeed`);

    const sheetData = [];
    let totalChannels = 0;

    for (const collection of collections) {
      const channels = collection.channels || [];

      for (const channel of channels) {
        if (channel.status === 'inactive') {
          continue;
        }

        sheetData.push({
          collection: collection.name,
          channel_name: channel.name || channel.id,
          channel_id: channel.id
        });
        totalChannels++;
      }
    }

    const sheet = getSheet();
    const lastRow = sheet.getLastRow();

    if (lastRow > 1) {
      safeAlert("Existing Data Found", "The sheet already contains data. Please clear the existing data before populating initial mappings.");
      return;
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

    const collections = fetchCollections();
    Logger.log(`Fetched ${collections.length} collections from ClearFeed`);

    const collectionIdToName = {};
    const channelIdToName = {};
    for (const col of collections) {
      collectionIdToName[col.id] = col.name;
      for (const ch of (col.channels || [])) {
        channelIdToName[ch.id] = ch.name || ch.id;
      }
    }

    const customers = fetchAllCustomers();
    Logger.log(`Fetched ${customers.length} customers`);

    const sheetData = [];
    const multiChannelCustomers = [];

    for (const customer of customers) {
      const channelIds = customer.channel_ids || [];

      if (channelIds.length === 0) {
        Logger.log(`Warning: Customer "${customer.name}" has no channels, skipping`);
        continue;
      } else if (channelIds.length > 1) {
        multiChannelCustomers.push({
          name: customer.name,
          channelCount: channelIds.length,
          channels: channelIds.join(', ')
        });
        continue;
      }

      const channelId = channelIds[0];
      const channelName = channelIdToName[channelId] || channelId;
      const collectionName = collectionIdToName[customer.collection_id] || "Unknown";

      sheetData.push({
        collection: collectionName,
        customer: customer.name,
        channel_name: channelName,
        channel_id: channelId
      });
    }

    if (multiChannelCustomers.length > 0) {
      const errorMsg = "VALIDATION ERROR: The following customers have MORE THAN 1 channel associated with them.\n\n" +
        "This script only supports customer objects with exactly 1 channel.\n\n" +
        "Customers with multiple channels:\n" +
        multiChannelCustomers.map(c => `- ${c.name} (${c.channelCount} channels: ${c.channels})`).join('\n') +
        "\n\nPlease resolve this in the ClearFeed webapp before running the sync.";

      safeAlert("Validation Error", errorMsg);
      Logger.log("Validation failed: customers with multiple channels found");
      return;
    }

    const sheet = getSheet();
    const lastRow = sheet.getLastRow();

    if (lastRow > 1) {
      safeAlert("Existing Data Found", "The sheet already contains data. Please clear the existing data before populating initial mappings.");
      return;
    }

    sheet.getRange(1, 1, 1, 4).setValues([["Collection", "Customer", "Channel Name", "Channel ID"]]);
    sheet.getRange(1, 1, 1, 4).setFontWeight("bold");

    if (sheetData.length > 0) {
      const values = sheetData.map(row => [row.collection, row.customer, row.channel_name, row.channel_id]);
      sheet.getRange(2, 1, sheetData.length, 4).setValues(values);

      const successMsg = `✅ Successfully populated sheet with ${sheetData.length} customer-channel mappings.\n\n` +
        `The sheet has been populated with the following format:\n` +
        `Collection | Customer | Channel Name | Channel ID\n\n` +
        `To enable auto-sync, click "Setup Auto-Sync" from the menu. This will sync changes made via the webapp to the sheet every 24 hours.`;

      safeAlert("Population Complete", successMsg);
      Logger.log(`Successfully populated sheet with ${sheetData.length} mappings`);

    } else {
      safeAlert("No Data Found", "No customers with channels found in your ClearFeed account.");
      Logger.log("No customers with channels found");
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
        movedCustomers: [],
        deletedChannels: [],
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
        movedCustomers: [],
        deletedChannels: [],
        failures: ["Invalid Sheet Format: " + error.message]
      });
      return;
    }

    const sheetData = readCustomerCentricSheetData();
    if (sheetData.length === 0) {
      safeAlert("No Data", "No customer-channel mappings found in the sheet.");
      sendCustomerCentricSyncEmail_({
        startedAt: runStartedAt,
        completedAt: new Date(),
        movedCustomers: [],
        deletedChannels: [],
        failures: ["No Data: No customer-channel mappings found in the sheet."]
      });
      return;
    }
    Logger.log(`Read ${sheetData.length} customer-channel mappings from sheet`);

    const collections = fetchCollections();
    const customers = fetchAllCustomers();
    Logger.log(`Fetched ${collections.length} collections and ${customers.length} customers from ClearFeed`);

    const plan = generateCustomerCentricPlan(sheetData, collections, customers);
    Logger.log("Action plan generated");

    const planMessage = formatCustomerCentricPlanMessage(plan);
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
      const results = executeCustomerCentricPlan(plan);
      const resultMessage = formatCustomerCentricResultMessage(results);
      safeAlert("Sync Results", resultMessage);
      Logger.log("Customer-centric sync completed");

      sendCustomerCentricSyncEmail_({
        startedAt: runStartedAt,
        completedAt: new Date(),
        movedCustomers: results.movedCustomers || [],
        deletedChannels: results.deletedChannels || [],
        failures: (results.failures || [])
      });
    } else {
      Logger.log("Sync cancelled by user");
      sendCustomerCentricSyncEmail_({
        startedAt: runStartedAt,
        completedAt: new Date(),
        movedCustomers: [],
        deletedChannels: [],
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
      deletedChannels: [],
      failures: [`Sync Error: ${error.toString()}`]
    });
  }
}

/**
 * Read customer-centric sheet data
 * Expects format: Collection | Customer | Channel Name | Channel ID
 */
function readCustomerCentricSheetData() {
  const sheet = getSheet();
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return [];
  }

  const data = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
  const mappings = [];
  const seenChannelIds = {};

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const collectionName = row[0];
    const customerName = row[1];
    const channelName = row[2];
    const channelId = row[3];

    if (!collectionName || !customerName || !channelId) {
      continue;
    }

    let trimmedChannelId = String(channelId).trim();
    if (trimmedChannelId.startsWith('#')) {
      trimmedChannelId = trimmedChannelId.substring(1);
    }

    if (seenChannelIds[trimmedChannelId]) {
      Logger.log(`Warning: Channel ID "${trimmedChannelId}" appears multiple times in the sheet. Using the latest occurrence.`);
    }
    seenChannelIds[trimmedChannelId] = i + 2;

    mappings.push({
      collection_name: String(collectionName).trim(),
      customer_name: String(customerName).trim(),
      channel_name: channelName ? String(channelName).trim() : '',
      channel_id: trimmedChannelId,
      _normalized_collection: normalizeCollectionName(collectionName),
      _normalized_customer: normalizeCollectionName(customerName)
    });
  }

  return mappings;
}

// =============================================================================
// Customer-Centric Inbox Model - Plan Generation
// =============================================================================

/**
 * Generate customer-centric action plan
 * Compares desired state (sheet) with actual state (API)
 */
function generateCustomerCentricPlan(sheetData, collections, customers) {
  const collectionNameToId = {};
  const collectionIdToName = {};
  const channelIdToName = {};
  const channelIdToStatus = {};

  for (const col of collections) {
    const normalizedName = normalizeCollectionName(col.name);
    collectionNameToId[normalizedName] = col.id;
    collectionIdToName[col.id] = col.name;

    for (const ch of (col.channels || [])) {
      if (ch.name) {
        channelIdToName[ch.id] = ch.name;
      }
      channelIdToStatus[ch.id] = ch.status;
    }
  }

  const customerNameToCustomer = {};
  for (const customer of customers) {
    customerNameToCustomer[normalizeCollectionName(customer.name)] = customer;
  }

  const plan = {
    toMove: [],
    toDelete: [],
    customersNotFound: [],
    collectionsNotFound: []
  };

  const actualChannelToCustomer = {};
  for (const customer of customers) {
    if (customer.channel_ids && customer.channel_ids.length > 0) {
      const channelId = customer.channel_ids[0];
      actualChannelToCustomer[channelId] = {
        customer_id: customer.id,
        customer_name: customer.name,
        collection_id: customer.collection_id,
        channel_id: channelId,
        channel_name: channelIdToName[channelId] || channelId,
        version: customer.version || 0
      };
    }
  }

  const desiredChannelToCustomer = {};

  for (const mapping of sheetData) {
    const normalizedCol = mapping._normalized_collection;
    const normalizedCust = mapping._normalized_customer;

    if (!collectionNameToId[normalizedCol]) {
      plan.collectionsNotFound.push(mapping.collection_name);
      continue;
    }

    const customer = customerNameToCustomer[normalizedCust];
    if (!customer) {
      plan.customersNotFound.push(mapping.customer_name);
      Logger.log(`Customer not found: "${mapping.customer_name}" (normalized: "${normalizedCust}")`);
      continue;
    }

    const desiredCollectionId = collectionNameToId[normalizedCol];
    desiredChannelToCustomer[mapping.channel_id] = {
      customer_id: customer.id,
      customer_name: mapping.customer_name,
      collection_id: desiredCollectionId,
      collection_name: mapping.collection_name,
      channel_id: mapping.channel_id,
      channel_name: mapping.channel_name || mapping.channel_id
    };
  }

  for (const [channelId, desired] of Object.entries(desiredChannelToCustomer)) {
    const actual = actualChannelToCustomer[channelId];

    if (!actual) {
      continue;
    }

    if (actual.collection_id !== desired.collection_id) {
      const fromCollectionName = collectionIdToName[actual.collection_id] || "Unknown";

      plan.toMove.push({
        customer_id: actual.customer_id,
        customer_name: desired.customer_name,
        channel_id: channelId,
        channel_name: desired.channel_name,
        from_collection: fromCollectionName,
        to_collection: desired.collection_name,
        to_collection_id: desired.collection_id,
        version: actual.version
      });
    }
  }

  for (const [channelId, actual] of Object.entries(actualChannelToCustomer)) {
    if (!desiredChannelToCustomer[channelId]) {
      if (!CONFIG.INCLUDE_DELETES) {
        continue;
      }

      const isChannelActive = channelIdToStatus[channelId] && channelIdToStatus[channelId] !== 'inactive';
      if (!isChannelActive) {
        continue;
      }

      const collectionName = collectionIdToName[actual.collection_id] || "Unknown";

      plan.toDelete.push({
        customer_id: actual.customer_id,
        customer_name: actual.customer_name,
        channel_id: channelId,
        channel_name: actual.channel_name,
        collection_name: collectionName
      });
    }
  }

  return plan;
}

/**
 * Format customer-centric plan message
 */
function formatCustomerCentricPlanMessage(plan) {
  const lines = [];

  lines.push("CUSTOMER-CENTRIC SYNC PLAN");
  lines.push("=========================");
  lines.push("");

  if (plan.customersNotFound.length > 0) {
    lines.push(`⚠️  Customers NOT FOUND in ClearFeed:`);
    for (const custName of plan.customersNotFound) {
      lines.push(`   - ${custName}`);
    }
    lines.push("");
  }

  if (plan.collectionsNotFound.length > 0) {
    lines.push(`⚠️  Collections NOT FOUND in ClearFeed:`);
    for (const colName of plan.collectionsNotFound) {
      lines.push(`   - ${colName}`);
    }
    lines.push("");
  }

  if (plan.toMove.length > 0) {
    lines.push(`🔄 Customers to MOVE: ${plan.toMove.length}`);
    for (const item of plan.toMove) {
      lines.push(`   ~ ${item.customer_name} FROM ${item.from_collection} → ${item.to_collection}`);
    }
    lines.push("");
  }

  if (plan.toDelete.length > 0) {
    lines.push(`🗑️  Channels to DELETE: ${plan.toDelete.length}`);
    for (const item of plan.toDelete) {
      lines.push(`   - ${item.channel_name} (${item.channel_id}) from ${item.collection_name}`);
      lines.push(`     Customer: ${item.customer_name}`);
    }
    lines.push("");
  }

  if (!CONFIG.INCLUDE_DELETES && plan.toDelete.length > 0) {
    lines.push("⚠️  WARNING: Delete operations are SKIPPED (CONFIG.INCLUDE_DELETES = false)");
    lines.push("");
  }

  if (plan.toMove.length === 0 && plan.toDelete.length === 0) {
    lines.push("✅ No changes needed - sheet is already in sync!");
  } else {
    lines.push("SUMMARY:");
    lines.push(`  Move: ${plan.toMove.length}`);
    lines.push(`  Delete: ${plan.toDelete.length} ${!CONFIG.INCLUDE_DELETES ? '(skipped)' : ''}`);
  }

  return lines.join("\n");
}

// =============================================================================
// Customer-Centric Inbox Model - Plan Execution
// =============================================================================

/**
 * Execute customer-centric plan
 */
function executeCustomerCentricPlan(plan) {
  const results = {
    moveSuccess: 0,
    moveFailed: 0,
    deleteSuccess: 0,
    deleteFailed: 0,
    deleteSkipped: 0,
    movedCustomers: [],
    deletedChannels: [],
    failures: []
  };

  for (const item of plan.toMove) {
    try {
      const result = moveCustomer(item.customer_id, item.to_collection_id, item.version);
      if (result.success) {
        results.moveSuccess++;
        results.movedCustomers.push({
          customer_name: item.customer_name,
          from_collection: item.from_collection,
          to_collection: item.to_collection
        });
        Logger.log(`✅ Moved customer ${item.customer_name} to ${item.to_collection}`);
      } else {
        results.moveFailed++;
        results.failures.push(`Move failed: ${item.customer_name}. ${result.error}`);
        Logger.log(`❌ Failed to move customer ${item.customer_name}: ${result.error}`);
      }
    } catch (error) {
      results.moveFailed++;
      results.failures.push(`Move error: ${item.customer_name}. ${error.toString()}`);
      Logger.log(`❌ Error moving customer ${item.customer_name}: ${error.toString()}`);
    }
  }

  for (const item of plan.toDelete) {
    if (!CONFIG.INCLUDE_DELETES) {
      results.deleteSkipped++;
      Logger.log(`⏭️ Skipped delete of channel ${item.channel_name} (${item.channel_id}) - deletes disabled`);
      continue;
    }

    try {
      const result = deleteChannel(item.channel_id);
      if (result.success) {
        results.deleteSuccess++;
        results.deletedChannels.push({
          channel_id: item.channel_id,
          channel_name: item.channel_name,
          customer_name: item.customer_name,
          collection_name: item.collection_name
        });
        Logger.log(`✅ Deleted channel ${item.channel_name} (${item.channel_id})`);
      } else {
        results.deleteFailed++;
        results.failures.push(`Delete failed: ${item.channel_id} - ${item.channel_name}. ${result.error}`);
        Logger.log(`❌ Failed to delete channel ${item.channel_name}: ${result.error}`);
      }
    } catch (error) {
      results.deleteFailed++;
      results.failures.push(`Delete error: ${item.channel_id} - ${item.channel_name}. ${error.toString()}`);
      Logger.log(`❌ Error deleting channel ${item.channel_name}: ${error.toString()}`);
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

  if (results.moveSuccess > 0) {
    lines.push(`✅ Moved: ${results.moveSuccess} customer(s)`);
  }
  if (results.moveFailed > 0) {
    lines.push(`❌ Move failed: ${results.moveFailed} customer(s)`);
  }

  if (results.deleteSkipped > 0) {
    lines.push(`⏭️  Delete skipped: ${results.deleteSkipped} channel(s) (deletes disabled)`);
  }
  if (results.deleteSuccess > 0) {
    lines.push(`✅ Deleted: ${results.deleteSuccess} channel(s)`);
  }
  if (results.deleteFailed > 0) {
    lines.push(`❌ Delete failed: ${results.deleteFailed} channel(s)`);
  }

  lines.push("");

  const totalActions = results.moveSuccess + results.deleteSuccess;
  const totalFailed = results.moveFailed + results.deleteFailed;

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
// Customer-Centric Inbox Model - Auto-Sync
// =============================================================================

/**
 * Setup auto-sync trigger
 */
function setupAutoSyncTrigger() {
  setupAutoSyncTrigger_();
  safeAlert("Auto-Sync Enabled", "The sheet will now sync with ClearFeed every 24 hours.\n\nChanges made via the webapp will be automatically reflected in the sheet.");
}

function setupAutoSyncTrigger_() {
  deleteAutoSyncTrigger_();

  ScriptApp.newTrigger('autoSyncCustomerMappings')
    .timeBased()
    .everyHours(24)
    .create();

  Logger.log("Auto-sync trigger created (runs every 24 hours)");
}

/**
 * Delete auto-sync trigger
 */
function deleteAutoSyncTrigger() {
  deleteAutoSyncTrigger_();
  safeAlert("Auto-Sync Disabled", "Auto-sync has been disabled.\n\nYou can re-enable it from the menu.");
}

function deleteAutoSyncTrigger_() {
  const triggers = ScriptApp.getProjectTriggers();

  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'autoSyncCustomerMappings') {
      ScriptApp.deleteTrigger(trigger);
      Logger.log("Deleted existing auto-sync trigger");
    }
  }
}

/**
 * Auto-sync function (triggered every 24 hours)
 * Syncs changes from ClearFeed to the sheet
 */
function autoSyncCustomerMappings() {
  Logger.log("Running auto-sync at " + new Date().toISOString());

  try {
    if (!CONFIG.IS_ON_CUSTOMER_INBOX_MODEL) {
      Logger.log("Auto-sync skipped: Customer-Centric model is not enabled");
      deleteAutoSyncTrigger_();
      return;
    }

    const collections = fetchCollections();
    const customers = fetchAllCustomers();

    const currentMappings = [];
    const collectionIdToName = {};
    const channelIdToName = {};
    const multiChannelCustomers = [];

    for (const col of collections) {
      collectionIdToName[col.id] = col.name;
      for (const ch of (col.channels || [])) {
        channelIdToName[ch.id] = ch.name || ch.id;
      }
    }

    for (const customer of customers) {
      const channelIds = customer.channel_ids || [];

      if (channelIds.length === 0) {
        continue;
      } else if (channelIds.length > 1) {
        multiChannelCustomers.push({
          name: customer.name,
          channelCount: channelIds.length,
          channels: channelIds.join(', ')
        });
        continue;
      }

      const channelId = channelIds[0];
      const channelName = channelIdToName[channelId] || channelId;

      currentMappings.push({
        collection: collectionIdToName[customer.collection_id] || "Unknown",
        customer: customer.name,
        channel_name: channelName,
        channel_id: channelId
      });
    }

    if (multiChannelCustomers.length > 0) {
      const errorMsg = "VALIDATION ERROR: The following customers have MORE THAN 1 channel associated with them.\n\n" +
        "The auto-sync cannot proceed. This script only supports customer objects with exactly 1 channel.\n\n" +
        "Customers with multiple channels:\n" +
        multiChannelCustomers.map(c => `- ${c.name} (${c.channelCount} channels: ${c.channels})`).join('\n') +
        "\n\nPlease resolve this in the ClearFeed webapp and then run 'Populate Initial Mappings' manually from the menu.";

      Logger.log("Auto-sync validation failed: customers with multiple channels found");
      sendAutoSyncValidationEmail_(multiChannelCustomers);
      deleteAutoSyncTrigger_();
      return;
    }

    const sheet = getSheet();
    const lastRow = sheet.getLastRow();

    const existingDataByChannelId = {};
    if (lastRow > 1) {
      const data = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
      for (let i = 0; i < data.length; i++) {
        let channelId = String(data[i][3] || '').trim();
        if (channelId.startsWith('#')) {
          channelId = channelId.substring(1);
        }
        existingDataByChannelId[channelId] = {
          collection: String(data[i][0] || '').trim(),
          customer: String(data[i][1] || '').trim(),
          channel_name: String(data[i][2] || '').trim(),
          rowIndex: i + 2
        };
      }
    }

    if (lastRow > 1) {
      sheet.getRange(2, 1, lastRow - 1, 4).clearContent();
    }

    if (currentMappings.length > 0) {
      const values = currentMappings.map(row => {
        const existing = existingDataByChannelId[row.channel_id];
        if (existing && existing.collection !== row.collection) {
          Logger.log(`Preserving manual Collection edit for ${row.customer}: "${existing.collection}" (keeping manual value instead of API value "${row.collection}")`);
          return [existing.collection, row.customer, row.channel_name, row.channel_id];
        }
        return [row.collection, row.customer, row.channel_name, row.channel_id];
      });
      sheet.getRange(2, 1, currentMappings.length, 4).setValues(values);
      Logger.log(`Auto-sync updated sheet with ${currentMappings.length} mappings`);
    }

  } catch (error) {
    Logger.log(`Auto-sync error: ${error.toString()}`);
  }
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

    let singleChannelCustomers = 0;
    let multiChannelCustomers = 0;
    let emptyCustomers = 0;

    for (const customer of customers) {
      const channelCount = customer.channel_ids ? customer.channel_ids.length : 0;
      if (channelCount === 0) {
        emptyCustomers++;
      } else if (channelCount === 1) {
        singleChannelCustomers++;
      } else {
        multiChannelCustomers++;
      }
    }

    const message = `✅ Connection successful!\n\n` +
      `Collections: ${collections.length}\n` +
      `Total Customers: ${customers.length}\n` +
      `Customers with 1 channel: ${singleChannelCustomers}\n` +
      `Customers with 0 channels: ${emptyCustomers}\n` +
      `Customers with 2+ channels: ${multiChannelCustomers}\n\n` +
      `Note: This script only supports customers with exactly 1 channel.`;

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

  bodyLines.push('Customers Moved:');
  if (runData.movedCustomers && runData.movedCustomers.length > 0) {
    for (const cust of runData.movedCustomers) {
      bodyLines.push(`- ${cust.customer_name} FROM ${cust.from_collection} → ${cust.to_collection}`);
    }
  } else {
    bodyLines.push('None');
  }
  bodyLines.push('');

  bodyLines.push('Channels Deleted:');
  if (runData.deletedChannels && runData.deletedChannels.length > 0) {
    for (const ch of runData.deletedChannels) {
      bodyLines.push(`- ${ch.channel_name} (${ch.channel_id}) from ${ch.collection_name}`);
      bodyLines.push(`  Customer: ${ch.customer_name}`);
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

/**
 * Send auto-sync validation error email
 */
function sendAutoSyncValidationEmail_(multiChannelCustomers) {
  if (!EMAIL_CONFIG.TO || EMAIL_CONFIG.TO === "") {
    Logger.log("Email sending disabled: EMAIL_CONFIG.TO is empty");
    return;
  }

  const timestamp = formatRunTimestamp_();
  const subject = `${EMAIL_CONFIG.SUBJECT_PREFIX}[${timestamp}] - Auto-Sync Validation Error`;

  const bodyLines = [];
  bodyLines.push('AUTO-SYNC HALTED - VALIDATION ERROR');
  bodyLines.push('');
  bodyLines.push('The auto-sync has been disabled due to the following validation error:');
  bodyLines.push('');
  bodyLines.push('The following customers have MORE THAN 1 channel associated with them:');
  bodyLines.push('');
  for (const cust of multiChannelCustomers) {
    bodyLines.push(`- ${cust.name} (${cust.channelCount} channels: ${cust.channels})`);
  }
  bodyLines.push('');
  bodyLines.push('This script only supports customer objects with exactly 1 channel.');
  bodyLines.push('');
  bodyLines.push('ACTION REQUIRED:');
  bodyLines.push('1. Resolve this in the ClearFeed webapp by organizing the structure');
  bodyLines.push('2. Ensure each customer has only 1 channel');
  bodyLines.push('3. Run "Populate Initial Mappings" manually from the menu');
  bodyLines.push('4. Re-enable auto-sync by clicking "Setup Auto-Sync" from the menu');
  bodyLines.push('');
  bodyLines.push('Auto-sync has been automatically disabled to prevent data loss.');

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
      Logger.log(`Failed to send auto-sync validation email: ${e2.toString()}`);
    }
  }
}
