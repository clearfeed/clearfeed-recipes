// ClearFeed Channel Sync to Google Sheets
// Syncs collection-to-channel mappings from a Google Sheet to ClearFeed
//
// Configuration - Update these values for your setup
const CONFIG = {
  API_KEY: "", // Required: Replace with your ClearFeed API key
  SHEET_NAME: "Channel Mappings", // Name of the sheet tab containing the mappings
  INCLUDE_DELETES: false, // Whether to actually delete channels (default: false for safety)
  SPREADSHEET_ID: "", // Leave empty to use current spreadsheet, or specify ID
};

const BASE_URL = "https://api.clearfeed.app/v1/rest";

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
  try {
    Logger.log("Starting channel sync...");

    // Validate configuration
    if (!CONFIG.API_KEY || CONFIG.API_KEY === "") {
      safeAlert("Configuration Error", "Please update CONFIG.API_KEY with your ClearFeed API key.");
      return;
    }

    // Read data from the sheet
    const sheetData = readSheetData();
    if (sheetData.length === 0) {
      safeAlert("No Data", "No channel mappings found in the sheet. Please check the sheet format.");
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
    } else {
      Logger.log("Sync cancelled by user");
    }

  } catch (error) {
    Logger.log(`Error during sync: ${error.toString()}`);
    safeAlert("Sync Error", `An error occurred: ${error.toString()}`);
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
    removeSkipped: 0
  };

  // Group adds by collection for efficiency
  const addsByCollection = {};
  for (const item of plan.toAdd) {
    if (!addsByCollection[item.collection_id]) {
      addsByCollection[item.collection_id] = [];
    }
    addsByCollection[item.collection_id].push({
      id: item.channel_id,
      owner: collectionOwners[item.collection_id] || ''
    });
  }

  // Execute adds (grouped by collection)
  for (const [collectionId, channels] of Object.entries(addsByCollection)) {
    try {
      const result = addChannelsToCollection(collectionId, channels);
      if (result.success) {
        results.addSuccess += channels.length;
        Logger.log(`✅ Added ${channels.length} channels to collection ${collectionId}`);
      } else {
        results.addFailed += channels.length;
        Logger.log(`❌ Failed to add channels to collection ${collectionId}: ${result.error}`);
      }
    } catch (error) {
      results.addFailed += channels.length;
      Logger.log(`❌ Error adding channels to collection ${collectionId}: ${error.toString()}`);
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
      }
    } catch (error) {
      results.moveFailed++;
      Logger.log(`❌ Error moving channel ${item.channel_name} (${item.channel_id}): ${error.toString()}`);
    }
  }

  // Execute removes (individual)
  for (const item of plan.toRemove) {
    if (skipDeletes) {
      results.removeSkipped++;
      Logger.log(`⏭️ Skipped removal of channel ${item.channel_name} (${item.channel_id}) - deletes disabled`);
      continue;
    }

    try {
      const result = deleteChannel(item.channel_id);
      if (result.success) {
        results.removeSuccess++;
        Logger.log(`✅ Removed channel ${item.channel_name} (${item.channel_id})`);
      } else {
        results.removeFailed++;
        Logger.log(`❌ Failed to remove channel ${item.channel_name} (${item.channel_id}): ${result.error}`);
      }
    } catch (error) {
      results.removeFailed++;
      Logger.log(`❌ Error removing channel ${item.channel_name} (${item.channel_id}): ${error.toString()}`);
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
