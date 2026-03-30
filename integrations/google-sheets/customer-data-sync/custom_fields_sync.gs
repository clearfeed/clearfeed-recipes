/* PREREQUISITES :-

   1) A Column that is added to the sheet with values should have a corresponding Custom Field (customer type) added to every
      customer object.
   2) Every Column Name should match the name of the Custom Field
   3) The sheet must have a "Channel_ID" column containing the Slack Channel ID (e.g., "C04TCQTRMT3")
   4) For select/multi_select fields, cell values should match the option display text exactly
   5) For multi_select fields, separate multiple values with pipe character (|) e.g., "Option A | Option B"

*/

// Global cache for skip columns (computed once to avoid CONFIG mutation)
let globalSkipColumns = null;

const CONFIG = {
  CLEARFEED_API_KEY:     "PAT_USER_TOKEN",
  SHEET_NAME:            "Collections & Customers", // Name of the sheet tab (only used if spreadsheet has multiple sheets)
  SPREADSHEET_ID:        "",                       // Leave empty to use current spreadsheet
  CHANNEL_ID_COLUMN:     "Channel_ID",            // Configurable column name for Channel ID
  CHANNEL_NAME_COLUMN:   "Channel_Name",          // Column name for Channel Name (populated by Download Channel IDs)
  CHANNEL_ACTIVE_COLUMN: "Channel_Active",        // Column name for Channel Active status (populated by Download Channel IDs)
  COLLECTION_NAME_COLUMN: "Collection_Name",      // Column name for Collection Name
  SKIP_COLUMNS:          ["Collection_Name", "Channel_ID", "Channel_Name", "Channel_Active"],       // Auto-synced with CHANNEL_ID_COLUMN
  MULTI_SELECT_DELIM:    "|",                  // Delimiter for separating multi-select values (default: pipe character)
  BASE_DELAY_MS:         200,                  // Delay between API calls
  MAX_RETRIES:           5,                     // Retry attempts for failed requests
  MAX_UPDATES_PER_RUN:   500,                  // Maximum customers per sync
  TRIGGER_FUNCTION:      "syncCustomFieldsFromSheet",
  TRIGGER_INTERVAL_HR:   1,                     // Sync trigger interval (hours)
  PROGRESS_UPDATE_INTERVAL: 25,                // Show progress every N rows (for large datasets)

  // Validation Settings
  ALLOWED_FIELD_TYPES:   ["text", "select", "multi_select", "number", "date"],  // Allowed custom field types
  STRICT_VALIDATION:     true,                 // If true, sync stops on validation errors
  CHECK_DUPLICATE_CHANNELS: true,              // Check for duplicate Channel IDs in sheet
};

// ══════════════════════════════════════════════
// CONFIG VALIDATION
// ══════════════════════════════════════════════

function validateConfig() {
  const errors = [];

  if (!CONFIG.CLEARFEED_API_KEY || CONFIG.CLEARFEED_API_KEY === "PAT_USER_TOKEN") {
    errors.push("❌ CLEARFEED_API_KEY is not set. Please add your ClearFeed PAT token.");
  }

  if (!CONFIG.SHEET_NAME) {
    errors.push("❌ SHEET_NAME is not set. Please specify your sheet name.");
  }

  // Auto-sync SKIP_COLUMNS with configurable column names (use global const to avoid mutating CONFIG)
  if (!globalSkipColumns) {
    globalSkipColumns = [...CONFIG.SKIP_COLUMNS];
    [CONFIG.CHANNEL_ID_COLUMN, CONFIG.CHANNEL_NAME_COLUMN, CONFIG.CHANNEL_ACTIVE_COLUMN, CONFIG.COLLECTION_NAME_COLUMN].forEach(col => {
      if (col && !globalSkipColumns.includes(col)) {
        globalSkipColumns.push(col);
      }
    });
  }

  return errors;
}

// ══════════════════════════════════════════════
// MAIN: SYNC CUSTOM FIELDS → CLEARFEED
// ══════════════════════════════════════════════

function syncCustomFieldsFromSheet(dryRun = null) {
  const startTime = new Date();
  dryRun = dryRun !== null ? dryRun : false;

  try {
    // Validate configuration
    const configErrors = validateConfig();
    if (configErrors.length > 0) {
      SpreadsheetApp.getUi().alert('⚠️ Configuration Error', configErrors.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK);
      return;
    }

    const modePrefix = dryRun ? "🔍 [DRY RUN] " : "🚀 ";
    Logger.log(`${modePrefix}Starting Custom Fields sync...`);

    const sheet = getSheet();

    // Validate required columns
    const sheetValidation = validateSheetStructure(sheet);
    if (!sheetValidation.valid) {
      SpreadsheetApp.getUi().alert('⚠️ Sheet Structure Error', sheetValidation.error, SpreadsheetApp.getUi().ButtonSet.OK);
      return;
    }

    const { headers, rows } = readSheet(sheet);
    Logger.log(`📋 ${rows.length} data rows | Columns: ${JSON.stringify(headers)}`);

    // Step 1: Channel ID → { id, version, custom_field_values, customerName }
    const mapResult = buildChannelIdCustomerMap();
    const channelIdToCustomer = mapResult.channelMap;
    let warnings = mapResult.warnings || [];

    const channelCount = Object.keys(channelIdToCustomer).length;
    Logger.log(`✅ Step 1: ${channelCount} channel IDs mapped`);

    if (warnings.length > 0) {
      warnings.forEach(w => Logger.log(`⚠️ ${w}`));
    }

    // Step 2: custom field name → { id, type, options }
    const customFieldNameToInfo = buildCustomFieldNameInfoMap();
    Logger.log(`✅ Step 2: ${Object.keys(customFieldNameToInfo).length} custom fields available`);

    // Step 3: Match sheet columns to custom fields and validate
    const { matchedColumns, unmatchedColumns } = identifyAndValidateColumns(headers, customFieldNameToInfo);
    Logger.log(`✅ Step 3: ${Object.keys(matchedColumns).length} columns matched`);

    // Flag error for unmapped columns (excluding skipped columns)
    if (unmatchedColumns.length > 0) {
      const errorMsg = `The following sheet columns do not match any ClearFeed customer custom fields:\n\n${unmatchedColumns.join(', ')}\n\nPlease either:\n- Rename the columns to match exact custom field names in ClearFeed\n- Add these as new custom fields in ClearFeed\n- Or remove these columns from the sheet`;

      SpreadsheetApp.getUi().alert(
        '⚠️ Unmatched Columns Found',
        errorMsg,
        SpreadsheetApp.getUi().ButtonSet.OK
      );
      Logger.log(`⚠️ Unmatched columns: ${JSON.stringify(unmatchedColumns)}`);
      return;
    }

    // Step 3.5: Comprehensive data validation (duplicates, types, lengths, values)
    const validationResult = validateSheetData(headers, rows, channelIdToCustomer, customFieldNameToInfo);

    if (validationResult.warnings.length > 0) {
      validationResult.warnings.forEach(w => Logger.log(`⚠️ ${w}`));
    }

    if (CONFIG.STRICT_VALIDATION && !validationResult.valid) {
      const errorTitle = '❌ Sheet Validation Failed';
      const errorMessage = validationResult.errors.join('\n\n');
      SpreadsheetApp.getUi().alert(errorTitle, errorMessage, SpreadsheetApp.getUi().ButtonSet.OK);
      Logger.log(`❌ Validation failed:\n${errorMessage}`);
      return;
    }

    if (Object.keys(matchedColumns).length === 0) {
      SpreadsheetApp.getUi().alert(
        '⚠️ No Matching Custom Fields',
        'No sheet columns matched any ClearFeed customer custom fields.\n\nMake sure column names exactly match your custom field names in ClearFeed.',
        SpreadsheetApp.getUi().ButtonSet.OK
      );
      return;
    }

    // Step 4: Update each customer row
    const results = { success: 0, skipped: 0, failed: 0, unchanged: 0, processed: 0, validationErrors: 0, versionConflicts: 0 };
    const validationErrors = [];
    const changes = []; // Track changes for dry run

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      if (results.processed >= CONFIG.MAX_UPDATES_PER_RUN) {
        Logger.log(`⏹️ Hit max ${CONFIG.MAX_UPDATES_PER_RUN} updates/run. Re-run to continue.`);
        break;
      }

      // Show progress based on configured interval (more frequent for large datasets)
      const progressInterval = CONFIG.PROGRESS_UPDATE_INTERVAL || 25;
      if ((i + 1) % progressInterval === 0 || i === 0) {
        const percent = Math.round(((i + 1) / rows.length) * 100);
        Logger.log(`📊 Progress: ${i + 1}/${rows.length} (${percent}%) - ✅${results.success} ⏭️${results.unchanged} ⚠️${results.skipped} ❌${results.failed}`);
      }

      const channelId = String(row[CONFIG.CHANNEL_ID_COLUMN] || '').trim();
      if (!channelId) { results.skipped++; continue; }

      const customerEntry = channelIdToCustomer[channelId];
      if (!customerEntry) {
        Logger.log(`⚠️ Row ${i + 2}: No customer found for Channel ID "${channelId}" — skipping`);
        results.skipped++;
        continue;
      }

      const { id: customerId, version: customerVersion, custom_field_values: existingCFValues, customerName } = customerEntry;

      // Build payload — only include fields that are new or have changed
      const customFieldValues = {};
      const rowChanges = [];

      Object.entries(matchedColumns).forEach(([colHeader, cfInfo]) => {
        const sanitized = sanitizeByType(row[colHeader], cfInfo, colHeader);

        // Check if validation error occurred
        if (sanitized === '__VALIDATION_ERROR__') {
          results.validationErrors++;
          validationErrors.push(`Row ${i + 2}, Column "${colHeader}": Invalid value "${row[colHeader]}"`);
          return;
        }

        const existingValue = existingCFValues[cfInfo.id];

        // Empty cell — skip if ClearFeed also has no value, otherwise clear it
        if (sanitized === null) {
          if (existingValue !== undefined && existingValue !== null) {
            rowChanges.push(`"${colHeader}": "${existingValue}" → (empty)`);
          }
          return;
        }

        // Value unchanged — still include it to prevent ClearFeed from clearing it
        if (
          existingValue !== undefined &&
          existingValue !== null &&
          String(existingValue) === String(sanitized)
        ) {
          customFieldValues[cfInfo.id] = existingValue;
          return;
        }

        // Track the change
        customFieldValues[cfInfo.id] = sanitized;
        const changeDesc = `"${colHeader}": "${existingValue || '(empty)'}" → "${sanitized}"`;
        rowChanges.push(changeDesc);
      });

      // Nothing changed for this customer — skip PATCH entirely
      if (rowChanges.length === 0) {
        results.unchanged++;
        continue;
      }

      // For dry run, just track the changes
      if (dryRun) {
        results.success++;
        changes.push({
          row: i + 2,
          channel: channelId,
          customer: customerName || 'Unknown',
          changes: rowChanges
        });
        Logger.log(`🔍 [DRY RUN] Row ${i + 2}: "${customerName}" (${channelId}) → ${rowChanges.join(', ')}`);
        continue;
      }

      // Perform actual update
      const updateResult = updateCustomerWithRetry(customerId, customerVersion, customFieldValues);

      if (updateResult.success) {
        Logger.log(`✅ "${customerName}" (${channelId} v${customerVersion}) → ${rowChanges.join(', ')}`);
        results.success++;
        // Track changes for summary
        changes.push({
          row: i + 2,
          channel: channelId,
          customer: customerName || 'Unknown',
          changes: rowChanges
        });
      } else if (updateResult.versionConflict) {
        Logger.log(`⚠️ Version conflict for "${customerName}" (${customerId}) - customer was modified by another process`);
        results.versionConflicts++;
        results.failed++;
      } else {
        Logger.log(`❌ Failed "${customerName}" (${channelId})`);
        results.failed++;
      }

      results.processed++;
      Utilities.sleep(CONFIG.BASE_DELAY_MS);
    }

    const endTime = new Date();
    const duration = Math.round((endTime - startTime) / 1000);

    // Build summary (include warnings if any)
    const summary = buildSummary(results, rows.length, dryRun, duration, validationErrors, changes, warnings);

    Logger.log(summary.logMessage);

    // Show alert
    let alertMessage = summary.alertMessage;
    if (dryRun && changes.length > 0) {
      alertMessage += '\n\n🔍 This was a DRY RUN. No changes were made to ClearFeed.';
      alertMessage += '\n\nTo apply changes, run "Sync Custom Fields" from the menu.';
    }

    SpreadsheetApp.getUi().alert(summary.alertTitle, alertMessage, SpreadsheetApp.getUi().ButtonSet.OK);

  } catch (error) {
    Logger.log(`❌ Error: ${error}\n${error.stack}`);
    SpreadsheetApp.getUi().alert('Error', `${error}\n\nCheck the execution logs for more details.`, SpreadsheetApp.getUi().ButtonSet.OK);
  }
}

// ══════════════════════════════════════════════
// DRY RUN MODE
// ══════════════════════════════════════════════

function syncDryRun() {
  syncCustomFieldsFromSheet(true);
}

// ══════════════════════════════════════════════
// FORCE SYNC (Skip validation, apply changes)
// ══════════════════════════════════════════════

function forceSync() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    '⚠️ Force Sync',
    'This will sync ALL changes to ClearFeed, including:\n• Rows with validation errors\n• All modified values\n\nAre you sure you want to continue?',
    ui.ButtonSet.YES_NO
  );

  if (response === ui.Button.YES) {
    syncCustomFieldsFromSheet(false);
  }
}

// ══════════════════════════════════════════════
// BUILD SUMMARY MESSAGE
// ══════════════════════════════════════════════

function buildSummary(results, totalRows, dryRun, duration, validationErrors, changes, warnings = []) {
  const totalProcessed = results.processed + results.unchanged + results.skipped;
  const successRate = totalProcessed > 0 ? Math.round((results.success / totalProcessed) * 100) : 0;

  const summaryParts = [
    `✅ ${results.success} updated`,
    `⏭️ ${results.unchanged} unchanged`,
    `⚠️ ${results.skipped} skipped`
  ];

  if (results.failed > 0) {
    summaryParts.push(`❌ ${results.failed} failed`);
  }

  if (results.versionConflicts > 0) {
    summaryParts.push(`⚠️ ${results.versionConflicts} version conflicts`);
  }

  if (results.validationErrors > 0) {
    summaryParts.push(`🚫 ${results.validationErrors} validation errors`);
  }

  if (warnings.length > 0) {
    summaryParts.push(`⚠️ ${warnings.length} warnings`);
  }

  summaryParts.push(`${totalProcessed}/${totalRows} rows (${successRate}% success rate)`);
  summaryParts.push(`⏱️ ${duration}s (${Math.round(duration / 60)}min)`);

  const logMessage = summaryParts.join(' | ');

  let alertTitle = dryRun ? '🔍 Dry Run Results' : 'Sync Complete';
  let alertMessage = summaryParts.join(' | ');

  // Add performance note for large datasets
  if (totalRows > 100) {
    const avgTimePerRow = (duration / totalProcessed).toFixed(2);
    alertMessage += `\n\n📊 Performance: ${avgTimePerRow}s per row average`;
  }

  // Add warnings to alert
  if (warnings.length > 0) {
    alertMessage += '\n\n⚠️ Warnings:\n' + warnings.slice(0, 5).join('\n');
    if (warnings.length > 5) {
      alertMessage += `\n... and ${warnings.length - 5} more (check logs)`;
    }
  }

  // Add validation errors to alert
  if (validationErrors.length > 0) {
    alertMessage += '\n\nValidation Errors:\n' + validationErrors.slice(0, 10).join('\n');
    if (validationErrors.length > 10) {
      alertMessage += `\n... and ${validationErrors.length - 10} more errors (check logs)`;
    }
  }

  // Show sample changes for both dry run and regular sync
  if (changes.length > 0) {
    const sectionTitle = dryRun ? 'Sample Changes (first 5):' : 'Changes Applied (first 5):';
    alertMessage += '\n\n' + sectionTitle + '\n';
    changes.slice(0, 5).forEach(c => {
      alertMessage += `\nRow ${c.row} (${c.customer}):\n  ${c.changes.join('\n  ')}`;
    });
    if (changes.length > 5) {
      alertMessage += `\n... and ${changes.length - 5} more changes`;
    }
  }

  return { logMessage, alertTitle, alertMessage };
}

// ══════════════════════════════════════════════
// VALIDATE SHEET STRUCTURE
// ══════════════════════════════════════════════

function validateSheetStructure(sheet) {
  try {
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) {
      return { valid: false, error: 'Sheet is empty or missing data. Please add a header row and at least one data row.' };
    }

    const headers = data[0].map(h => String(h || '').trim());

    if (!headers.includes(CONFIG.CHANNEL_ID_COLUMN)) {
      return {
        valid: false,
        error: `Required column "${CONFIG.CHANNEL_ID_COLUMN}" not found.\n\nPlease add a column named "${CONFIG.CHANNEL_ID_COLUMN}" to your sheet.`
      };
    }

    return { valid: true };
  } catch (e) {
    return { valid: false, error: `Error reading sheet: ${e.message}` };
  }
}

// ══════════════════════════════════════════════
// COMPREHENSIVE SHEET VALIDATION
// Checks: duplicate channels, invalid field types, text length limits
// ══════════════════════════════════════════════

function validateSheetData(headers, rows, channelIdToCustomer, customFieldNameToInfo) {
  const errors = [];
  const warnings = [];

  // 1. Check for duplicate Channel IDs in sheet
  if (CONFIG.CHECK_DUPLICATE_CHANNELS) {
    const channelIds = new Set();
    const duplicateChannels = [];

    rows.forEach((row, i) => {
      const channelId = String(row[CONFIG.CHANNEL_ID_COLUMN] || '').trim();
      if (channelId) {
        if (channelIds.has(channelId)) {
          duplicateChannels.push({ row: i + 2, channelId: channelId });
        } else {
          channelIds.add(channelId);
        }
      }
    });

    if (duplicateChannels.length > 0) {
      const dupList = duplicateChannels.map(d => `Row ${d.row}: ${d.channelId}`).join('\n');
      errors.push(`❌ Duplicate Channel IDs found in sheet:\n${dupList}\n\nEach Channel ID should appear only once. Please remove duplicates.`);
    }
  }

  // 2. Check for unsupported field types
  const unsupportedTypes = [];
  Object.entries(customFieldNameToInfo).forEach(([colName, cfInfo]) => {
    if (!CONFIG.ALLOWED_FIELD_TYPES.includes(cfInfo.type)) {
      unsupportedTypes.push(`"${colName}" (type: ${cfInfo.type})`);
    }
  });

  if (unsupportedTypes.length > 0) {
    errors.push(`❌ Unsupported custom field types found:\n${unsupportedTypes.join('\n')}\n\nSupported types: ${CONFIG.ALLOWED_FIELD_TYPES.join(', ')}\n\nPlease remove these columns or add them to SKIP_COLUMNS in CONFIG.`);
  }

  // 3. Pre-validate text field lengths
  const textLengthErrors = [];
  Object.entries(customFieldNameToInfo).forEach(([colName, cfInfo]) => {
    if (cfInfo.type === 'text' && cfInfo.maxLength) {
      rows.forEach((row, i) => {
        const value = String(row[colName] || '').trim();
        if (value.length > cfInfo.maxLength) {
          textLengthErrors.push(`Row ${i + 2}, Column "${colName}": ${value.length} characters (max: ${cfInfo.maxLength})`);
        }
      });
    }
  });

  if (textLengthErrors.length > 0) {
    const showErrors = textLengthErrors.slice(0, 10);
    errors.push(`❌ Text exceeds maximum length:\n${showErrors.join('\n')}${textLengthErrors.length > 10 ? `\n... and ${textLengthErrors.length - 10} more` : ''}`);
  }

  // 4. Pre-validate select field values
  const selectValueErrors = [];
  Object.entries(customFieldNameToInfo).forEach(([colName, cfInfo]) => {
    if ((cfInfo.type === 'select' || cfInfo.type === 'multi_select') && cfInfo.options) {
      const availableOptions = Object.keys(cfInfo.options);

      rows.forEach((row, i) => {
        const rawValue = row[colName];
        if (!rawValue && rawValue !== '') return;

        if (cfInfo.type === 'select') {
          const strValue = String(rawValue).trim();
          if (strValue && !cfInfo.options[strValue]) {
            // Try case-insensitive check
            const found = availableOptions.some(opt => opt.toLowerCase() === strValue.toLowerCase());
            if (!found) {
              selectValueErrors.push(`Row ${i + 2}, Column "${colName}": "${strValue}" not in options (${availableOptions.slice(0, 3).join(', ')}...)`);
            }
          }
        } else if (cfInfo.type === 'multi_select') {
          const delimiter = CONFIG.MULTI_SELECT_DELIM || '|';
          const values = String(rawValue).split(delimiter).map(v => v.trim()).filter(v => v);

          values.forEach(val => {
            if (!cfInfo.options[val]) {
              const found = availableOptions.some(opt => opt.toLowerCase() === val.toLowerCase());
              if (!found) {
                selectValueErrors.push(`Row ${i + 2}, Column "${colName}": "${val}" not in options`);
              }
            }
          });
        }
      });
    }
  });

  if (selectValueErrors.length > 0) {
    const showErrors = selectValueErrors.slice(0, 10);
    errors.push(`❌ Invalid select/multi_select values:\n${showErrors.join('\n')}${selectValueErrors.length > 10 ? `\n... and ${selectValueErrors.length - 10} more` : ''}`);
  }

  // 5. Check for Channel IDs not found in ClearFeed
  const notFoundChannels = [];
  rows.forEach((row, i) => {
    const channelId = String(row[CONFIG.CHANNEL_ID_COLUMN] || '').trim();
    if (channelId && !channelIdToCustomer[channelId]) {
      notFoundChannels.push(`Row ${i + 2}: ${channelId}`);
    }
  });

  if (notFoundChannels.length > 0) {
    warnings.push(`⚠️ ${notFoundChannels.length} Channel ID(s) not found in ClearFeed:\n${notFoundChannels.slice(0, 5).join('\n')}${notFoundChannels.length > 5 ? `\n... and ${notFoundChannels.length - 5} more` : ''}`);
  }

  return {
    valid: errors.length === 0,
    errors: errors,
    warnings: warnings
  };
}

// ══════════════════════════════════════════════
// TEST CONNECTION
// ══════════════════════════════════════════════

function testConnection() {
  const results = [];

  // Validate config first
  const configErrors = validateConfig();
  if (configErrors.length > 0) {
    results.push('⚠️ Configuration Issues:');
    results.push(...configErrors);
  } else {
    results.push('✅ Configuration is valid');
  }

  try {
    const cfResp = UrlFetchApp.fetch('https://api.clearfeed.app/v1/rest/collections', {
      headers: { 'Authorization': `Bearer ${CONFIG.CLEARFEED_API_KEY}` },
      muteHttpExceptions: true
    });
    const cfCode = cfResp.getResponseCode();
    if (cfCode === 200) {
      const count = JSON.parse(cfResp.getContentText()).collections?.length || 0;
      results.push(`✅ ClearFeed API — Connected (${count} collections found)`);
    } else if (cfCode === 401) {
      results.push(`❌ ClearFeed API — Authentication failed. Please check your PAT token.`);
    } else {
      results.push(`❌ ClearFeed API — Failed (HTTP ${cfCode}): ${cfResp.getContentText()}`);
    }
  } catch (e) {
    results.push(`❌ ClearFeed API — Exception: ${e}`);
  }

  try {
    const sheet   = getSheet();
    const lastRow = sheet.getLastRow();
    const validation = validateSheetStructure(sheet);

    if (validation.valid) {
      results.push(`✅ Google Sheet — Found "${CONFIG.SHEET_NAME}" (${Math.max(lastRow - 1, 0)} data rows)`);
    } else {
      results.push(`⚠️ Google Sheet — ${validation.error}`);
    }
  } catch (e) {
    results.push(`❌ Google Sheet — ${e}`);
  }

  SpreadsheetApp.getUi().alert('🔌 Connection Test Results', results.join('\n\n'), SpreadsheetApp.getUi().ButtonSet.OK);
}

// ══════════════════════════════════════════════
// ENABLE PERIODIC SYNC TRIGGER
// ══════════════════════════════════════════════

function enableHourlySync() {
  deleteExistingTriggers();

  ScriptApp.newTrigger(CONFIG.TRIGGER_FUNCTION)
    .timeBased()
    .everyHours(CONFIG.TRIGGER_INTERVAL_HR)
    .create();

  Logger.log(`✅ Periodic sync enabled (every ${CONFIG.TRIGGER_INTERVAL_HR} hour(s))`);
  SpreadsheetApp.getUi().alert(
    '✅ Periodic Sync Enabled',
    `Sync will run automatically every ${CONFIG.TRIGGER_INTERVAL_HR} hour(s).\n\nUse "Disable Periodic Sync" to stop it.`,
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

// ══════════════════════════════════════════════
// DISABLE PERIODIC SYNC TRIGGER
// ══════════════════════════════════════════════

function disableHourlySync() {
  const deleted = deleteExistingTriggers();

  Logger.log(`🛑 Periodic sync disabled. ${deleted} trigger(s) removed.`);
  SpreadsheetApp.getUi().alert(
    '🛑 Periodic Sync Disabled',
    deleted > 0
      ? `${deleted} trigger(s) removed. Sync will no longer run automatically.`
      : 'No active triggers found — nothing to disable.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

function deleteExistingTriggers() {
  let deleted = 0;
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === CONFIG.TRIGGER_FUNCTION) {
      ScriptApp.deleteTrigger(trigger);
      deleted++;
    }
  });
  return deleted;
}

// ══════════════════════════════════════════════
// SYNC CHANNEL IDS FROM CLEARFEED COLLECTIONS
// ══════════════════════════════════════════════

function syncChannelIds() {
  try {
    const configErrors = validateConfig();
    if (configErrors.length > 0) {
      SpreadsheetApp.getUi().alert('Configuration Error', configErrors.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK);
      return;
    }

    const sheet = getSheet();

    // Ensure Channel_ID, Channel_Name, Channel_Active and Collection_Name columns exist in the sheet
    const data = sheet.getDataRange().getValues();
    let headers = data.length > 0 ? data[0].map(h => String(h || '').trim()) : [];

    let channelIdColIndex = headers.indexOf(CONFIG.CHANNEL_ID_COLUMN);
    let channelNameColIndex = headers.indexOf(CONFIG.CHANNEL_NAME_COLUMN);
    let channelActiveColIndex = headers.indexOf(CONFIG.CHANNEL_ACTIVE_COLUMN);
    let collectionNameColIndex = headers.indexOf(CONFIG.COLLECTION_NAME_COLUMN);

    // Add missing columns
    const newHeaders = [];
    if (channelIdColIndex === -1) {
      newHeaders.push(CONFIG.CHANNEL_ID_COLUMN);
    }
    if (channelNameColIndex === -1) {
      newHeaders.push(CONFIG.CHANNEL_NAME_COLUMN);
    }
    if (channelActiveColIndex === -1) {
      newHeaders.push(CONFIG.CHANNEL_ACTIVE_COLUMN);
    }
    if (collectionNameColIndex === -1) {
      newHeaders.push(CONFIG.COLLECTION_NAME_COLUMN);
    }

    if (newHeaders.length > 0) {
      if (headers.length === 0) {
        // Sheet is empty, set headers in row 1
        sheet.getRange(1, 1, 1, newHeaders.length).setValues([newHeaders]);
        headers = newHeaders;
      } else {
        // Append new columns after existing headers
        const lastCol = headers.length;
        sheet.getRange(1, lastCol + 1, 1, newHeaders.length).setValues([newHeaders]);
        headers = headers.concat(newHeaders);
      }

      // Refresh column indices
      channelIdColIndex = headers.indexOf(CONFIG.CHANNEL_ID_COLUMN);
      channelNameColIndex = headers.indexOf(CONFIG.CHANNEL_NAME_COLUMN);
      channelActiveColIndex = headers.indexOf(CONFIG.CHANNEL_ACTIVE_COLUMN);
      collectionNameColIndex = headers.indexOf(CONFIG.COLLECTION_NAME_COLUMN);
    }

    // Read existing channel IDs from sheet and build a map of row index → channel ID
    const existingChannelIds = new Set();
    const channelRowMap = {}; // channelId → row index in data array
    for (let i = 1; i < data.length; i++) {
      const channelId = String(data[i][channelIdColIndex] || '').trim();
      if (channelId) {
        existingChannelIds.add(channelId);
        channelRowMap[channelId] = i;
      }
    }

    Logger.log(`Found ${existingChannelIds.size} existing channel IDs in sheet`);

    // Fetch all customers to get channel IDs associated with customers
    const customerChannelIds = fetchCustomerChannelIds();
    Logger.log(`Found ${customerChannelIds.size} channels associated with customers`);

    // Fetch all collections with channels
    const collectionChannels = fetchAllChannelsFromCollections();

    // Filter to only channels that are associated with customers
    const allChannels = collectionChannels.filter(ch => customerChannelIds.has(ch.id));
    Logger.log(`Matched ${allChannels.length} collection channels to customer channels`);

    // Find missing channels and channels that need name updates
    const missingChannels = [];
    const updatedChannels = [];

    allChannels.forEach(ch => {
      if (!existingChannelIds.has(ch.id)) {
        missingChannels.push(ch);
      } else {
        // Check if Channel_Name, Channel_Active, or Collection_Name needs updating
        const rowIndex = channelRowMap[ch.id];
        const currentName = String(data[rowIndex][channelNameColIndex] || '').trim();
        const currentActive = String(data[rowIndex][channelActiveColIndex] || '').trim();
        const currentCollection = String(data[rowIndex][collectionNameColIndex] || '').trim();
        const newName = ch.name || '';
        const newActive = ch.active || '';
        const newCollection = ch.collectionName || '';

        if (currentName !== newName || currentActive !== newActive || currentCollection !== newCollection) {
          updatedChannels.push({ ...ch, rowIndex, oldName: currentName, oldActive: currentActive, oldCollection: currentCollection });
        }
      }
    });

    // Update existing rows with new names/active status/collections
    if (updatedChannels.length > 0) {
      updatedChannels.forEach(ch => {
        const row = ch.rowIndex + 1; // +1 to convert 0-based data array index to 1-based sheet row
        if (channelNameColIndex >= 0) {
          sheet.getRange(row, channelNameColIndex + 1).setValue(ch.name || '');
        }
        if (channelActiveColIndex >= 0) {
          sheet.getRange(row, channelActiveColIndex + 1).setValue(ch.active || '');
        }
        if (collectionNameColIndex >= 0) {
          sheet.getRange(row, collectionNameColIndex + 1).setValue(ch.collectionName || '');
        }
      });
      Logger.log(`Updated details for ${updatedChannels.length} existing channel(s)`);
    }

    // Append missing channels to the bottom of the sheet
    if (missingChannels.length > 0) {
      const lastRow = Math.max(sheet.getLastRow(), 1);
      const newRows = missingChannels.map(ch => {
        const row = new Array(headers.length).fill('');
        row[channelIdColIndex] = ch.id;
        row[channelNameColIndex] = ch.name;
        row[channelActiveColIndex] = ch.active || '';
        row[collectionNameColIndex] = ch.collectionName || '';
        return row;
      });

      sheet.getRange(lastRow + 1, 1, newRows.length, headers.length).setValues(newRows);
      Logger.log(`Added ${missingChannels.length} new channel(s) to the sheet`);
    }

    if (missingChannels.length === 0 && updatedChannels.length === 0) {
      SpreadsheetApp.getUi().alert('Download Channel IDs', 'All channels are already in the sheet and up to date.', SpreadsheetApp.getUi().ButtonSet.OK);
      return;
    }

    const parts = [];
    if (missingChannels.length > 0) {
      parts.push(`Added ${missingChannels.length} new channel(s)`);
    }
    if (updatedChannels.length > 0) {
      parts.push(`Updated names for ${updatedChannels.length} existing channel(s)`);
    }

    let message = parts.join(' and ') + '.';
    if (missingChannels.length > 0) {
      message += `\n\nNew channels:\n${missingChannels.slice(0, 10).map(ch => `${ch.name} (${ch.id})`).join('\n')}${missingChannels.length > 10 ? `\n... and ${missingChannels.length - 10} more` : ''}`;
    }

    SpreadsheetApp.getUi().alert('Download Channel IDs', message, SpreadsheetApp.getUi().ButtonSet.OK);

  } catch (error) {
    Logger.log(`Error syncing channel IDs: ${error}\n${error.stack}`);
    SpreadsheetApp.getUi().alert('Error', `${error}`, SpreadsheetApp.getUi().ButtonSet.OK);
  }
}

/**
 * Fetch all channel IDs that are associated with customers
 * Returns: Set of channel ID strings
 */
function fetchCustomerChannelIds() {
  const channelIds = new Set();
  let nextCursor = null;

  while (true) {
    const url = `https://api.clearfeed.app/v1/rest/customers?limit=100${nextCursor ? '&next_cursor=' + nextCursor : ''}`;

    const response = UrlFetchApp.fetch(url, {
      headers: { 'Authorization': `Bearer ${CONFIG.CLEARFEED_API_KEY}` },
      muteHttpExceptions: true
    });

    if (response.getResponseCode() !== 200) {
      Logger.log(`Customers API error (${response.getResponseCode()}): ${response.getContentText()}`);
      break;
    }

    const data = JSON.parse(response.getContentText());
    (data.customers || []).forEach(customer => {
      (customer.channel_ids || []).forEach(chId => {
        channelIds.add(String(chId).trim());
      });
    });

    nextCursor = data.response_metadata?.next_cursor;
    if (!nextCursor) break;
  }

  return channelIds;
}

/**
 * Fetch all channels from all collections via the ClearFeed API
 * Returns: Array of { id, name, collectionName }
 */
function fetchAllChannelsFromCollections() {
  const allChannels = [];
  let nextCursor = null;

  while (true) {
    let url = 'https://api.clearfeed.app/v1/rest/collections?include=channels';
    if (nextCursor) {
      url += '&next_cursor=' + nextCursor;
    }

    const response = UrlFetchApp.fetch(url, {
      headers: { 'Authorization': `Bearer ${CONFIG.CLEARFEED_API_KEY}` },
      muteHttpExceptions: true
    });

    if (response.getResponseCode() !== 200) {
      throw new Error(`Collections API failed (${response.getResponseCode()}): ${response.getContentText()}`);
    }

    const data = JSON.parse(response.getContentText());
    const collections = data.collections || [];

    collections.forEach(collection => {
      const collectionName = collection.name || '';
      (collection.channels || []).forEach(ch => {
        allChannels.push({
          id: ch.id,
          name: ch.name || '',
          active: ch.status || '',
          collectionName: collectionName
        });
      });
    });

    nextCursor = data.response_metadata?.next_cursor;
    if (!nextCursor) break;
  }

  Logger.log(`Fetched ${allChannels.length} channels from ${allChannels.length > 0 ? 'collections' : 'collection'}`);
  return allChannels;
}

// ══════════════════════════════════════════════
// CLEARFEED API: CUSTOMERS (PAGINATED)
// ══════════════════════════════════════════════

function fetchAllCustomers() {
  let allCustomers = [];
  let nextCursor   = null;

  while (true) {
    const url = `https://api.clearfeed.app/v1/rest/customers?limit=100${nextCursor ? '&next_cursor=' + nextCursor : ''}`;

    const response = UrlFetchApp.fetch(url, {
      headers: { 'Authorization': `Bearer ${CONFIG.CLEARFEED_API_KEY}` },
      muteHttpExceptions: true
    });

    if (response.getResponseCode() !== 200) {
      Logger.log(`⚠️ Customers fetch error (${response.getResponseCode()}): ${response.getContentText()}`);
      break;
    }

    const data = JSON.parse(response.getContentText());
    allCustomers.push(...(data.customers || []));

    nextCursor = data.response_metadata?.next_cursor;
    if (!nextCursor) break;
  }

  return allCustomers;
}

// ══════════════════════════════════════════════
// CLEARFEED API: CUSTOM FIELDS → { id, type, options, maxLength }
// ══════════════════════════════════════════════

function buildCustomFieldNameInfoMap() {
  const response = UrlFetchApp.fetch(
    'https://api.clearfeed.app/v1/rest/custom-fields?entity_type=customer',
    {
      headers: { 'Authorization': `Bearer ${CONFIG.CLEARFEED_API_KEY}` },
      muteHttpExceptions: true
    }
  );

  if (response.getResponseCode() !== 200) {
    throw new Error(`Custom Fields API failed (${response.getResponseCode()}): ${response.getContentText()}`);
  }

  const nameToInfo = {};
  (JSON.parse(response.getContentText()).custom_fields || []).forEach(cf => {
    if (cf.name) {
      const info = {
        id: String(cf.id),
        type: cf.type
      };

      // Store maxLength for text fields
      if (cf.type === 'text' && cf.config?.max_length) {
        info.maxLength = cf.config.max_length;
      }

      // For select and multi_select types, include options mapping
      if (cf.type === 'select' || cf.type === 'multi_select') {
        info.options = {};
        info.optionsLower = {}; // Pre-processed lowercase map for O(1) case-insensitive lookup
        (cf.config?.options || []).forEach(opt => {
          const displayValue = String(opt.value).trim();
          info.options[displayValue] = String(opt.id);
          info.optionsLower[displayValue.toLowerCase()] = String(opt.id);
        });
      }

      nameToInfo[cf.name.trim()] = info;
    }
  });

  return nameToInfo;
}

// ══════════════════════════════════════════════
// CLEARFEED: CHANNEL ID → { id, version, custom_field_values, customerName }
// Returns: { channelMap, warnings }
// ══════════════════════════════════════════════

function buildChannelIdCustomerMap() {
  const channelIdToCustomer = {};
  const warnings = [];
  const seenChannelIds = new Set();
  let nextCursor = null;
  let customersWithoutChannels = 0;

  while (true) {
    const url = `https://api.clearfeed.app/v1/rest/customers?limit=100${nextCursor ? '&next_cursor=' + nextCursor : ''}`;

    let response;
    let delayMs = CONFIG.BASE_DELAY_MS;

    for (let attempt = 1; attempt <= CONFIG.MAX_RETRIES; attempt++) {
      try {
        response = UrlFetchApp.fetch(url, {
          headers: { 'Authorization': `Bearer ${CONFIG.CLEARFEED_API_KEY}` },
          muteHttpExceptions: true
        });
        break; // Success, exit retry loop
      } catch (e) {
        if (String(e).indexOf('Bandwidth quota') !== -1 || String(e).indexOf('quota exceeded') !== -1) {
          Logger.log(`⏳ Bandwidth quota exceeded fetching customers (attempt ${attempt}/${CONFIG.MAX_RETRIES}), waiting ${delayMs}ms...`);
          Utilities.sleep(delayMs);
          delayMs *= 2;
          if (attempt === CONFIG.MAX_RETRIES) throw e;
        } else {
          throw e;
        }
      }
    }

    if (response.getResponseCode() !== 200) break;

    const data = JSON.parse(response.getContentText());
    (data.customers || []).forEach(c => {
      const customerName = c.name || 'Unknown';

      // Check for customers without channel IDs
      if (!c.channel_ids || c.channel_ids.length === 0) {
        customersWithoutChannels++;
        return;
      }

      // Map each channel_id to the customer
      (c.channel_ids || []).forEach(channelId => {
        const trimmedChannelId = String(channelId).trim();

        // Check for duplicate channel IDs (data integrity issue in ClearFeed)
        if (seenChannelIds.has(trimmedChannelId)) {
          const existingCustomer = channelIdToCustomer[trimmedChannelId].customerName;
          warnings.push(`⚠️ DATA INTEGRITY ISSUE: Duplicate Channel ID "${trimmedChannelId}" found for customers "${existingCustomer}" and "${customerName}". Using latest: "${customerName}".`);
        }

        seenChannelIds.add(trimmedChannelId);
        channelIdToCustomer[trimmedChannelId] = {
          id: c.id,
          version: c.version ?? 0,
          custom_field_values: c.custom_field_values || {},
          customerName: customerName
        };
      });
    });

    nextCursor = data.response_metadata?.next_cursor;
    if (!nextCursor) break;
    Utilities.sleep(CONFIG.BASE_DELAY_MS);
  }

  if (customersWithoutChannels > 0) {
    warnings.push(`${customersWithoutChannels} customers have no Channel IDs and will not be synced.`);
  }

  return { channelMap: channelIdToCustomer, warnings };
}

// ══════════════════════════════════════════════
// CLEARFEED API: UPDATE CUSTOMER WITH RETRY
// Returns: { success, versionConflict }
// ══════════════════════════════════════════════

function updateCustomerWithRetry(customerId, version, customFieldValues) {
  const url     = `https://api.clearfeed.app/v1/rest/customers/${customerId}`;
  const payload = JSON.stringify({ custom_field_values: customFieldValues, version });

  let delayMs = CONFIG.BASE_DELAY_MS;

  for (let attempt = 1; attempt <= CONFIG.MAX_RETRIES; attempt++) {
    try {
      const response = UrlFetchApp.fetch(url, {
        method: 'patch',
        headers: {
          'Authorization': `Bearer ${CONFIG.CLEARFEED_API_KEY}`,
          'Content-Type':  'application/json'
        },
        payload,
        muteHttpExceptions: true
      });

      const code = response.getResponseCode();
      const body = response.getContentText();

      if (code === 200 || code === 204) {
        return { success: true, versionConflict: false };
      }

      // Handle version conflict (409)
      if (code === 409 || body.indexOf('version') !== -1) {
        Logger.log(`⚠️ Version conflict on ${customerId} (attempt ${attempt}/${CONFIG.MAX_RETRIES})`);
        if (attempt === CONFIG.MAX_RETRIES) {
          return { success: false, versionConflict: true };
        }
        Utilities.sleep(delayMs);
        delayMs *= 2;
        continue;
      }

      // Handle rate limiting
      if (code === 429 || body.indexOf('quota exceeded') !== -1 || body.indexOf('Bandwidth quota') !== -1 || body.indexOf('rate limit') !== -1) {
        Logger.log(`⏳ Rate limited on ${customerId} (attempt ${attempt}/${CONFIG.MAX_RETRIES}), waiting ${delayMs}ms...`);
        Utilities.sleep(delayMs);
        delayMs *= 2;
        continue;
      }

      Logger.log(`❌ API Error (${code}) for ${customerId}: ${body}`);
      return { success: false, versionConflict: false };

    } catch (e) {
      Logger.log(`❌ Exception on ${customerId} (attempt ${attempt}): ${e}`);
      Utilities.sleep(delayMs);
      delayMs *= 2;
    }
  }

  Logger.log(`❌ Max retries (${CONFIG.MAX_RETRIES}) exceeded for ${customerId}`);
  return { success: false, versionConflict: false };
}

// ══════════════════════════════════════════════
// SHEET HELPERS
// ══════════════════════════════════════════════

/**
 * Identifies and validates sheet columns against custom fields
 * Returns both matched columns and unmatched columns (for error reporting)
 */
function identifyAndValidateColumns(headers, customFieldNameToInfo) {
  const matched = {};
  const unmatched = [];

  headers.forEach(header => {
    if (!header || globalSkipColumns.includes(header)) return;

    if (customFieldNameToInfo[header]) {
      matched[header] = customFieldNameToInfo[header];
    } else {
      unmatched.push(header);
    }
  });

  return { matchedColumns: matched, unmatchedColumns: unmatched };
}

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
    throw new Error(`Sheet "${CONFIG.SHEET_NAME}" not found. Please create it with at least "${CONFIG.CHANNEL_ID_COLUMN}" column.`);
  }

  return sheet;
}

function readSheet(sheet) {
  const data    = sheet.getDataRange().getValues();
  const headers = data[0].map(h => String(h || '').trim());
  const rows    = [];

  for (let i = 1; i < data.length; i++) {
    const row = {};
    headers.forEach((header, j) => {
      if (!header) return; // Skip columns with empty headers
      row[header] = data[i][j] ?? '';
    });
    if (Object.values(row).every(v => v === '' || v === null)) continue;
    rows.push(row);
  }

  return { headers, rows };
}

/**
 * Sanitizes values based on field type
 * For select/multi_select: validates against options and returns option ID
 * Returns '__VALIDATION_ERROR__' if value validation fails for select fields
 * @param {any} value - The raw value from the sheet
 * @param {object} cfInfo - Custom field info containing { type, options, optionsLower }
 * @param {string} columnName - Column name for error messages
 */
function sanitizeByType(value, cfInfo, columnName = '') {
  const fieldType = cfInfo?.type;
  const options = cfInfo?.options;
  const optionsLower = cfInfo?.optionsLower;
  const raw = (value === null || value === undefined) ? '' : value;

  switch (fieldType) {
    case 'number': {
      const cleaned = String(raw).replace(/[$,\s]/g, '').trim();
      const num     = Number(cleaned);
      if (cleaned === '' || isNaN(num)) return null;
      return num;
    }
    case 'text': {
      const str = String(raw).trim();
      return str.length === 0 ? null : str;
    }
    case 'date': {
      if (raw instanceof Date) {
        return Utilities.formatDate(raw, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      }
      const str = String(raw).trim();
      return str.length === 0 ? null : str;
    }
    case 'select': {
      const str = String(raw).trim();
      if (str.length === 0) return null;

      // For select fields, validate the value exists in options
      if (options && typeof options === 'object') {
        // Try exact match first
        if (options[str] !== undefined) {
          return options[str]; // Return the option ID
        }

        // Try case-insensitive match using pre-processed lowercase map (O(1) lookup)
        const lowerStr = str.toLowerCase();
        if (optionsLower && optionsLower[lowerStr] !== undefined) {
          return optionsLower[lowerStr];
        }

        // Value not found in options - log error and return marker
        Logger.log(`❌ Validation Error: Column "${columnName}" - Value "${str}" not found in select options. Available options: ${Object.keys(options).join(', ')}`);
        return '__VALIDATION_ERROR__';
      }

      return str;
    }
    case 'multi_select': {
      if (Array.isArray(raw)) {
        if (raw.length === 0) return null;

        // For multi_select, validate each value against options
        if (options && typeof options === 'object') {
          const validatedIds = [];
          for (const val of raw) {
            const str = String(val).trim();
            if (options[str] !== undefined) {
              validatedIds.push(options[str]);
            } else {
              // Try case-insensitive match using pre-processed lowercase map (O(1) lookup)
              const lowerStr = str.toLowerCase();
              if (optionsLower && optionsLower[lowerStr] !== undefined) {
                validatedIds.push(optionsLower[lowerStr]);
              } else {
                Logger.log(`❌ Validation Error: Column "${columnName}" - Value "${str}" not found in multi_select options`);
                return '__VALIDATION_ERROR__';
              }
            }
          }
          return validatedIds;
        }

        return raw;
      }

      const str = String(raw).trim();
      if (str.length === 0) return null;

      // Split by configured delimiter and validate each value
      const delimiter = CONFIG.MULTI_SELECT_DELIM || '|';
      const values = str.split(delimiter).map(s => s.trim()).filter(s => s.length > 0);
      if (values.length === 0) return null;

      if (options && typeof options === 'object') {
        const validatedIds = [];
        for (const val of values) {
          if (options[val] !== undefined) {
            validatedIds.push(options[val]);
          } else {
            // Try case-insensitive match using pre-processed lowercase map (O(1) lookup)
            const lowerVal = val.toLowerCase();
            if (optionsLower && optionsLower[lowerVal] !== undefined) {
              validatedIds.push(optionsLower[lowerVal]);
            } else {
              Logger.log(`❌ Validation Error: Column "${columnName}" - Value "${val}" not found in multi_select options`);
              return '__VALIDATION_ERROR__';
            }
          }
        }
        return validatedIds;
      }

      return values;
    }
    default: {
      const str = String(raw).trim();
      return str.length === 0 ? null : str;
    }
  }
}

// ══════════════════════════════════════════════
// MENU
// ══════════════════════════════════════════════

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('ClearFeed Data Sync')
    .addItem('Download Channel IDs', 'syncChannelIds')
    .addItem('Sync Custom Fields', 'syncCustomFieldsFromSheet')
    .addItem('Sync Custom Fields (Dry Run)', 'syncDryRun')
    .addSeparator()
    .addItem('Test Connection', 'testConnection')
    .addSeparator()
    .addItem('⏰ Enable Periodic Sync', 'enableHourlySync')
    .addItem('🛑 Disable Periodic Sync', 'disableHourlySync')
    .addToUi();
}
