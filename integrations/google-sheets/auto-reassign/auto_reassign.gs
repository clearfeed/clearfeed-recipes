// ============================================================
// ClearFeed — Auto-Reassign Requests
// ------------------------------------------------------------
// Companion to request_sync.gs. Reuses the same ClearFeed API
// auth/endpoint/pagination patterns. Must be container-bound
// (opened via Extensions → Apps Script from the Google Sheet).
//
// What a run does:
//   1. Fetches Open requests created in the last LOOKBACK_DAYS days
//      (only those with no assignee and no assigned team when
//      UNASSIGNED_ONLY is true; ALL Open requests when false),
//      optionally limited to COLLECTION_INCLUDE, and writes them to
//      the results tab.
//   2. Fires the "Reassign" automation webhook for each request ID,
//      so ClearFeed's own assignment engine (rotation / round-robin)
//      re-runs and assigns each request to a currently-eligible agent.
//      With UNASSIGNED_ONLY, rows that already have an assignee are skipped. If the first
//      ABORT_IF_FIRST_N_FAIL calls all fail, the run stops.
//   3. Waits for the (asynchronous) automation, then re-reads each
//      request and updates the "assignee" column.
//   4. Emails EMAIL_CONFIG.TO if any webhook call failed.
//
// The results tab (SHEET_NAME) is cleared and rewritten by every
// Run Now / scheduled run / Preview, so it shows only the latest run.
//
// Menu actions:
//   ▶️ Run Now                       — steps 1–4 in one pass
//   📥 Preview Requests              — step 1 only (populate the tab)
//   🔁 Reassign Listed Requests      — steps 2–3 for the IDs already in the tab
//   🔃 Refresh Assignees             — step 3 only
//   ⏰ Enable Scheduled Runs         — run reassignSyncNow() every SYNC_INTERVAL_HOURS
//   ⏹️ Disable Scheduled Runs        — remove the recurring trigger
//   📋 View Logs / 🧹 Clear Logs      — in-sheet run log
// ============================================================

// ---------------------- CONFIG ------------------------------
const CONFIG = {
  API_KEY: "",                          // ClearFeed API key (same as request_sync)
  AUTOMATION_ID: null,                  // Reassign automation ID (from the webhook trigger URL)
  SHEET_NAME: "Reassignment Results",   // Tab this helper reads/writes
  LOOKBACK_DAYS: 7,                     // How far back to look for Open requests (by creation date)
  // true  = only Open requests with no assignee and no assigned team are reassigned.
  // false = ALL Open requests are reassigned, including ones that already have an assignee
  //         (ClearFeed re-runs assignment, so they may move to a different agent).
  UNASSIGNED_ONLY: true,
  // Collections to run for, BY NAME (as shown in the ClearFeed web app).
  // Empty array = run for ALL collections.
  // e.g. ["Enterprise Support", "Premium Customers"] runs only those two.
  COLLECTION_INCLUDE: [],
  REASSIGN_DELAY_MS: 1000,              // Delay between webhook calls (ms)
  ABORT_IF_FIRST_N_FAIL: 5,             // Stop the run if the first N webhook calls all fail (bad API key / automation ID, outage). 0 = disabled
  REFRESH_SETTLE_MS: 3000,              // Wait after reassigning before reading back assignees (automation is async)
  REFRESH_DELAY_MS: 300,                // Delay between per-request re-fetch calls (ms)
  SYNC_INTERVAL_HOURS: 4,               // Run every X hours. Allowed: 1, 2, 4, 6, 8, 12 (Apps Script limit)
  TIMEZONE: "Asia/Kolkata",             // India Standard Time (UTC+5:30)
  LOG_SHEET_NAME: "Logs",               // Tab used for in-sheet runtime logging
  LOG_MAX_ROWS: 500                     // Trim the log tab to this many recent entries
};

// ---------------------- EMAIL ALERTS ------------------------
// An alert is sent for any run in which at least one reassign POST call failed.
const EMAIL_CONFIG = {
  TO: "",                                       // Recipient for failure alerts (leave empty to disable emails)
  FROM: "noreply@example.com",                  // Sender address (must be configured as an alias in Gmail)
  SUBJECT_PREFIX: "ClearFeed Auto-Reassign - ", // Prefix for email subject lines
  SENDER_NAME: "ClearFeed Auto-Reassign"        // Display name for email sender
};

// Wording helper for logs/alerts: what this run is targeting.
function scopeWord_() {
  return CONFIG.UNASSIGNED_ONLY ? 'unassigned Open' : 'Open';
}

const REQUESTS_URL = "https://api.clearfeed.app/v1/rest/requests";
const USERS_URL = "https://api.clearfeed.app/v1/rest/users";
const COLLECTIONS_URL = "https://api.clearfeed.app/v1/rest/collections";
const TRIGGER_URL_BASE = "https://web.clearfeed.app/api/v1/rest/automations";

// ============================================================
// CORE WORKER
// ============================================================

/**
 * "Run Now" worker — fetches unassigned Open requests and reassigns
 * them in a single pass. UI-FREE so a time-based trigger can call it
 * directly (mirrors syncClearfeedRequests() in request_sync.gs).
 *
 * @returns {{total:number, success:number, failed:number}} summary
 */
function reassignSyncNow() {
  logMsg('INFO', 'Starting reassignment run...');

  try {
    const sheet = getOrCreateReassignSheet();

    // --- Fetch phase ---
    const requests = fetchOpenUnassignedRequests();
    logMsg('INFO', `Found ${requests.length} ${scopeWord_()} request(s)`);

    writeRequestsToSheet(sheet, requests);

    if (requests.length === 0) {
      logMsg('INFO', 'Nothing to reassign.');
      return { total: 0, success: 0, failed: 0 };
    }

    // --- Reassign phase ---
    const summary = triggerReassignForSheet(sheet);

    logMsg('INFO', `Reassignment run complete. Success: ${summary.success}, Failed: ${summary.failed}`);
    if (summary.failed > 0) sendFailureEmail_(requests.length, summary);
    return { total: requests.length, success: summary.success, failed: summary.failed };

  } catch (e) {
    logMsg('ERROR', `reassignSyncNow failed: ${e.message}`);
    throw e;   // re-throw so menu wrapper can alert; trigger runs will still have logged it
  }
}

// ============================================================
// MENU ACTIONS
// ============================================================

/**
 * MENU: "Run Now" — runs the full worker and shows a summary alert.
 */
function reassignSyncNowMenu() {
  try {
    const r = reassignSyncNow();
    SpreadsheetApp.getUi().alert(
      `Reassignment Run Complete\n\n` +
      `Total requests: ${r.total}\n` +
      `Success: ${r.success}\n` +
      `Failed: ${r.failed}`
    );
  } catch (e) {
    Logger.log(`reassignSyncNowMenu error: ${e.toString()}`);
    SpreadsheetApp.getUi().alert('Error: ' + e.message);
  }
}

/**
 * MENU: "Preview Requests" — populates the sheet only.
 */
function fetchUnassignedRequests() {
  try {
    const sheet = getOrCreateReassignSheet();
    const requests = fetchOpenUnassignedRequests();
    Logger.log(`Fetched ${requests.length} ${scopeWord_()} requests`);

    writeRequestsToSheet(sheet, requests);

    if (requests.length === 0) {
      SpreadsheetApp.getUi().alert(`No ${scopeWord_()} requests found.`);
    } else {
      SpreadsheetApp.getUi().alert(`Fetched ${requests.length} ${scopeWord_()} request(s).`);
    }
  } catch (error) {
    Logger.log(`fetchUnassignedRequests error: ${error.toString()}`);
    SpreadsheetApp.getUi().alert('Error: ' + error.message);
  }
}

/**
 * MENU: "Refresh Assignees" — re-reads the assignee for each request in the
 * sheet without reassigning. Useful if the async settle delay wasn't long
 * enough after a reassign and some cells still read "Unassigned".
 */
function refreshAssigneesMenu() {
  const ui = SpreadsheetApp.getUi();
  try {
    const sheet = getOrCreateReassignSheet();
    if (sheet.getLastRow() < 2) {
      ui.alert('No requests in the sheet. Run Preview Requests or Run Now first.');
      return;
    }
    refreshAssignees(sheet);
    ui.alert('Assignee column refreshed from ClearFeed.');
  } catch (e) {
    logMsg('ERROR', `refreshAssigneesMenu error: ${e.message}`);
    ui.alert('Error: ' + e.message);
  }
}

/**
 * MENU: "Reassign Listed Requests" — reassigns request IDs already in the sheet.
 */
function reassignRequests() {
  const ui = SpreadsheetApp.getUi();
  try {
    const sheet = getOrCreateReassignSheet();
    if (sheet.getLastRow() < 2) {
      ui.alert('No requests to reassign. Run "Preview Requests" first.');
      return;
    }
    const summary = triggerReassignForSheet(sheet);
    if (summary.success + summary.failed + summary.alreadyAssigned === 0) {
      ui.alert('No requests to reassign. Run "Preview Requests" first.');
      return;
    }
    ui.alert(`Reassignment done. Success: ${summary.success}, Failed: ${summary.failed}` +
      (summary.alreadyAssigned > 0 ? `, Skipped (already assigned): ${summary.alreadyAssigned}` : ''));
  } catch (e) {
    Logger.log(`reassignRequests error: ${e.toString()}`);
    ui.alert('Error: ' + e.message);
  }
}

// ============================================================
// FETCH
// ============================================================

/**
 * Fetch Open + unassigned requests, optionally restricted to specific
 * collections (by name via CONFIG.COLLECTION_INCLUDE).
 *
 * If COLLECTION_INCLUDE is non-empty, the names are resolved to collection
 * IDs and the requests endpoint is queried once PER collection using its
 * server-side collection_id filter. If empty, a single unfiltered pass
 * returns requests across all collections.
 */
function fetchOpenUnassignedRequests() {
  const includeNames = CONFIG.COLLECTION_INCLUDE || [];

  // No filter configured → fetch across all collections in one pass.
  if (includeNames.length === 0) {
    logMsg('INFO', 'No collection filter set — fetching across ALL collections.');
    return fetchUnassignedForCollection(null);
  }

  // Resolve configured names → IDs.
  const nameToId = getCollectionNameToIdMap();
  const collectionIds = [];
  const notFound = [];

  includeNames.forEach(name => {
    const id = nameToId[name.toLowerCase().trim()];
    if (id != null) collectionIds.push({ id: id, name: name });
    else notFound.push(name);
  });

  if (notFound.length > 0) {
    logMsg('WARN', `Collection name(s) not found and skipped: ${notFound.join(', ')}`);
  }
  if (collectionIds.length === 0) {
    logMsg('ERROR', 'None of the configured collection names matched. Nothing to fetch.');
    return [];
  }

  // Fetch per collection using the server-side collection_id filter.
  let all = [];
  collectionIds.forEach(c => {
    logMsg('INFO', `Fetching ${scopeWord_()} requests for collection "${c.name}" (id ${c.id})`);
    const forThis = fetchUnassignedForCollection(c.id);
    logMsg('INFO', `  → ${forThis.length} request(s) in "${c.name}"`);
    all = all.concat(forThis);
  });

  logMsg('INFO', `Total ${scopeWord_()} requests across ${collectionIds.length} collection(s): ${all.length}`);
  return all;
}

/**
 * Paginated fetch of Open + unassigned requests for a single collection,
 * or all collections if collectionId is null.
 */
function fetchUnassignedForCollection(collectionId) {
  const collected = [];
  let nextCursor = null;
  const limit = 100;
  let batchCount = 0;

  const headers = {
    "Authorization": `Bearer ${CONFIG.API_KEY}`,
    "Content-Type": "application/json"
  };

  const afterDate = new Date();
  afterDate.setDate(afterDate.getDate() - CONFIG.LOOKBACK_DAYS);

  while (true) {
    batchCount++;
    const params = {
      limit: limit,
      state: "open",                 // only Open requests
      filter_by: "created_at",
      after: afterDate.toISOString()
    };
    if (collectionId != null) params.collection_id = collectionId;   // server-side filter
    if (nextCursor) params.next_cursor = nextCursor;

    const url = `${REQUESTS_URL}?${Object.keys(params).map(key =>
      `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`
    ).join('&')}`;

    Logger.log(`Fetch batch ${batchCount} (collection ${collectionId == null ? 'ALL' : collectionId}): ${url}`);

    const response = UrlFetchApp.fetch(url, { method: 'GET', headers: headers, muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) {
      logMsg('ERROR', `Requests API failed (batch ${batchCount}): ${response.getResponseCode()} - ${response.getContentText().slice(0, 200)}`);
      throw new Error(`Requests API failed: ${response.getResponseCode()} - ${response.getContentText()}`);
    }

    const data = JSON.parse(response.getContentText());
    const page = data.requests || [];

    // If UNASSIGNED_ONLY, keep only unassigned requests; otherwise keep all
    // Open requests. A request counts as assigned if it has
    // either an individual assignee OR an assigned team.
    // The API returns assignee/assigned_team as an ID (string) or, in some
    // shapes, as an object with .id — handle both.
    page.forEach(r => {
      const hasAssignee = r.assignee &&
        ((typeof r.assignee === 'object') ? !!r.assignee.id : true);
      const hasTeam = r.assigned_team &&
        ((typeof r.assigned_team === 'object') ? r.assigned_team.id != null : true);
      if (!CONFIG.UNASSIGNED_ONLY || (!hasAssignee && !hasTeam)) collected.push(r);
    });

    const meta = data.response_metadata || {};
    nextCursor = meta.next_cursor;

    if (!nextCursor || page.length === 0) break;
  }

  return collected;
}

/**
 * Fetch the account's collections and build a name→id map.
 * Keys are lowercased/trimmed for case-insensitive matching.
 * IMPORTANT: uses the ID returned by the Collections API (not the web-app ID).
 */
function getCollectionNameToIdMap() {
  const headers = {
    "Authorization": `Bearer ${CONFIG.API_KEY}`,
    "Content-Type": "application/json"
  };

  const response = UrlFetchApp.fetch(COLLECTIONS_URL, { method: 'GET', headers: headers, muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) {
    logMsg('ERROR', `Collections API failed: ${response.getResponseCode()} - ${response.getContentText().slice(0, 200)}`);
    throw new Error(`Collections API failed: ${response.getResponseCode()}`);
  }

  const data = JSON.parse(response.getContentText());
  const collections = data.collections || [];
  const map = {};
  collections.forEach(c => {
    if (c.name != null && c.id != null) {
      map[String(c.name).toLowerCase().trim()] = c.id;
    }
  });

  logMsg('INFO', `Loaded ${collections.length} collection(s) for name→id mapping.`);
  return map;
}

// ============================================================
// REASSIGN
// ============================================================

/**
 * Loop over the request IDs in the sheet and fire the reassignment
 * automation webhook for each, writing a per-row result.
 *
 * @param {Sheet} sheet
 * @returns {{success:number, failed:number}}
 */
function triggerReassignForSheet(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: 0, failed: 0, skipped: 0, alreadyAssigned: 0, failures: [] };

  if (CONFIG.AUTOMATION_ID == null || CONFIG.AUTOMATION_ID === '') {
    throw new Error('AUTOMATION_ID is not set. Add your reassignment automation ID to CONFIG (see README Step 1).');
  }

  const headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const idCol = headerRow.indexOf('id') + 1;
  const assigneeCol = headerRow.indexOf('assignee') + 1;
  let resultCol = headerRow.indexOf('reassign_result') + 1;

  if (idCol === 0) throw new Error('Could not find an "id" column. Re-run the fetch.');
  if (resultCol === 0) {
    resultCol = sheet.getLastColumn() + 1;
    sheet.getRange(1, resultCol).setValue('reassign_result').setFontWeight('bold');
  }

  const ids = sheet.getRange(2, idCol, lastRow - 1, 1).getValues();
  // Assignee cells let us skip rows that already have an assignee (e.g. this
  // is a repeat run, or "Refresh Assignees" showed them as assigned).
  const assignees = assigneeCol > 0
    ? sheet.getRange(2, assigneeCol, lastRow - 1, 1).getValues()
    : null;
  const triggerUrl = `${TRIGGER_URL_BASE}/${CONFIG.AUTOMATION_ID}/trigger`;

  let success = 0, failed = 0, skipped = 0, alreadyAssigned = 0;
  const failures = [];   // {id, result} for each failed call (used in the alert email)
  const abortAfter = CONFIG.ABORT_IF_FIRST_N_FAIL;

  for (let i = 0; i < ids.length; i++) {
    const requestId = ids[i][0];
    if (!requestId) continue;

    // UNASSIGNED_ONLY: don't re-POST requests that already have an assignee —
    // reassigning them could move them to another agent.
    if (CONFIG.UNASSIGNED_ONLY && assignees && assignees[i][0] && assignees[i][0] !== 'Unassigned') {
      sheet.getRange(i + 2, resultCol).setValue('SKIPPED (already assigned)');
      alreadyAssigned++;
      continue;
    }

    // SAFEGUARD: the first N calls all failed → the problem is almost certainly
    // systemic (bad API key, wrong AUTOMATION_ID, outage). Stop instead of
    // hammering the API for every remaining request.
    if (abortAfter > 0 && success === 0 && failed >= abortAfter) {
      logMsg('ERROR',
        `Aborting reassignment: the first ${failed} webhook call(s) all failed. ` +
        `Check API_KEY and AUTOMATION_ID. ${ids.length - i} request(s) were not attempted.`);
      for (let j = i; j < ids.length; j++) {
        if (ids[j][0]) {
          sheet.getRange(j + 2, resultCol).setValue('SKIPPED (aborted after repeated failures)');
          skipped++;
        }
      }
      break;
    }

    const options = {
      method: 'post',
      contentType: 'application/json',
      headers: { "Authorization": `Bearer ${CONFIG.API_KEY}` },
      payload: JSON.stringify({ id: requestId }),
      muteHttpExceptions: true
    };

    let resultText;
    try {
      const response = UrlFetchApp.fetch(triggerUrl, options);
      const code = response.getResponseCode();
      if (code >= 200 && code < 300) {
        resultText = `OK (${code})`; success++;
      } else {
        resultText = `FAIL (${code}): ${response.getContentText().slice(0, 120)}`;
        failed++;
        logMsg('WARN', `Reassign failed for request ${requestId}: HTTP ${code}`);
      }
    } catch (e) {
      resultText = `ERROR: ${e.message}`; failed++;
      logMsg('ERROR', `Reassign threw for request ${requestId}: ${e.message}`);
    }

    if (!resultText.startsWith('OK')) failures.push({ id: requestId, result: resultText });

    sheet.getRange(i + 2, resultCol).setValue(resultText);
    Utilities.sleep(CONFIG.REASSIGN_DELAY_MS);   // delay between calls
  }

  logMsg('INFO', `Reassign loop finished. Success: ${success}, Failed: ${failed}` +
    (alreadyAssigned > 0 ? `, Skipped (already assigned): ${alreadyAssigned}` : ''));

  // The Reassign automation runs asynchronously, so give it a moment to
  // apply before reading assignees back from the API.
  if (success > 0) {
    Utilities.sleep(CONFIG.REFRESH_SETTLE_MS);
    const refresh = refreshAssignees(sheet);

    // GUARD: the automation accepted every call (HTTP 2xx) but nothing
    // actually got an assignee. This is the "no one on shift / no eligible
    // agent" case — the business schedule window is closed, everyone is
    // marked unavailable in Slack, or the rotation is empty. The requests
    // stay held and will be retried on the next run inside an active shift.
    // (Only meaningful when UNASSIGNED_ONLY: otherwise rows may already have had an assignee.)
    if (CONFIG.UNASSIGNED_ONLY && refresh && refresh.total > 0 && refresh.updated === 0) {
      logMsg('WARN',
        `No requests were assigned despite ${success} accepted trigger(s). ` +
        `Likely no agent is currently on-shift/available (business schedule closed, ` +
        `responders unavailable in Slack, or empty rotation). Requests are held and ` +
        `will be retried on the next in-shift run.`);
    }
  }

  return { success: success, failed: failed, skipped: skipped, alreadyAssigned: alreadyAssigned, failures: failures };
}

/**
 * Work out who a request is assigned to. The requests API returns assignee /
 * assigned_team as an ID (string) or, in some shapes, an object with .id —
 * handle both. User IDs are resolved to names via the Users API (cached).
 *
 * @returns {{assigned:boolean, label:string}} label is a name, "Team: …", or "Unassigned"
 */
function describeAssignee_(req) {
  let assigneeId = null;
  if (req.assignee) {
    assigneeId = (typeof req.assignee === 'object') ? req.assignee.id : req.assignee;
  }
  if (assigneeId) return { assigned: true, label: getUserName(assigneeId) };

  if (req.assigned_team) {
    const teamId = (typeof req.assigned_team === 'object') ? req.assigned_team.id : req.assigned_team;
    const teamName = (typeof req.assigned_team === 'object' && req.assigned_team.name) ? req.assigned_team.name : teamId;
    return { assigned: true, label: 'Team: ' + teamName };
  }
  return { assigned: false, label: 'Unassigned' };
}

/**
 * Re-fetch each request in the sheet and update its "assignee" cell with the
 * current value from ClearFeed. Run after reassignment so the sheet reflects
 * who each request was actually assigned to (individual or team), rather than
 * the literal "Unassigned" written at fetch time.
 */
function refreshAssignees(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const idCol = headerRow.indexOf('id') + 1;
  const assigneeCol = headerRow.indexOf('assignee') + 1;
  if (idCol === 0 || assigneeCol === 0) {
    logMsg('WARN', 'refreshAssignees: id or assignee column not found; skipping.');
    return;
  }

  const ids = sheet.getRange(2, idCol, lastRow - 1, 1).getValues();
  const headers = {
    "Authorization": `Bearer ${CONFIG.API_KEY}`,
    "Content-Type": "application/json"
  };

  let updated = 0;

  for (let i = 0; i < ids.length; i++) {
    const requestId = ids[i][0];
    if (!requestId) continue;

    try {
      const url = `${REQUESTS_URL}/${encodeURIComponent(requestId)}`;
      const response = UrlFetchApp.fetch(url, { method: 'GET', headers: headers, muteHttpExceptions: true });

      if (response.getResponseCode() === 200) {
        const data = JSON.parse(response.getContentText());
        // Single-request endpoint shape may wrap in .request; fall back to the object itself.
        const req = data.request || data;

        const d = describeAssignee_(req);
        const assigneeLabel = d.label;
        if (d.assigned) updated++;
        sheet.getRange(i + 2, assigneeCol).setValue(assigneeLabel);
      } else {
        logMsg('WARN', `refreshAssignees: HTTP ${response.getResponseCode()} for request ${requestId}`);
      }
    } catch (e) {
      logMsg('WARN', `refreshAssignees failed for ${requestId}: ${e.message}`);
    }

    Utilities.sleep(CONFIG.REFRESH_DELAY_MS);
  }

  saveUserCache();   // persist resolved names for next run
  logMsg('INFO', `Assignee column refreshed (${updated} now assigned).`);
  return { updated: updated, total: ids.length };
}

// ============================================================
// USER NAME RESOLUTION (ID -> name), mirrors request_sync.gs
// ============================================================

// In-memory cache for this execution; hydrated from Script Properties.
let reassignUserCache = null;

/**
 * Load the user cache from persistent storage (once per execution).
 */
function initUserCache() {
  if (reassignUserCache !== null) return;
  const cache = PropertiesService.getScriptProperties();
  const cached = cache.getProperty('reassign_user_cache');
  reassignUserCache = cached ? JSON.parse(cached) : {};
}

/**
 * Persist the user cache so future runs skip re-fetching known users.
 */
function saveUserCache() {
  if (reassignUserCache) {
    PropertiesService.getScriptProperties()
      .setProperty('reassign_user_cache', JSON.stringify(reassignUserCache));
  }
}

/**
 * Resolve a user ID to a display name via the ClearFeed Users API, caching
 * results. Falls back to the raw ID if the lookup fails.
 */
function getUserName(userId) {
  if (!userId) return '';
  initUserCache();

  if (reassignUserCache[userId] && reassignUserCache[userId].name) {
    return reassignUserCache[userId].name;
  }

  try {
    const url = `${USERS_URL}?ids=${encodeURIComponent(userId)}`;
    const response = UrlFetchApp.fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${CONFIG.API_KEY}`,
        'Content-Type': 'application/json'
      },
      muteHttpExceptions: true
    });

    if (response.getResponseCode() === 200) {
      const data = JSON.parse(response.getContentText());
      const users = data.users || [];
      users.forEach(u => { reassignUserCache[u.id] = u; });
      if (reassignUserCache[userId] && reassignUserCache[userId].name) {
        return reassignUserCache[userId].name;
      }
    } else {
      logMsg('WARN', `Users API ${response.getResponseCode()} for ${userId}`);
    }
  } catch (e) {
    logMsg('WARN', `getUserName failed for ${userId}: ${e.message}`);
  }

  return userId;   // fallback: show the raw ID rather than nothing
}

// ============================================================
// DAILY TRIGGER MANAGEMENT
// ============================================================

/**
 * Enable a recurring trigger that runs reassignSyncNow() every X hours,
 * where X = CONFIG.SYNC_INTERVAL_HOURS.
 * Apps Script's everyHours() only accepts 1, 2, 4, 6, 8, or 12.
 */
function enableIntervalTrigger() {
  const allowed = [1, 2, 4, 6, 8, 12];
  const hours = CONFIG.SYNC_INTERVAL_HOURS;

  if (allowed.indexOf(hours) === -1) {
    const msg = `SYNC_INTERVAL_HOURS is ${hours}, but must be one of: ${allowed.join(', ')}.`;
    logMsg('ERROR', msg);
    SpreadsheetApp.getUi().alert('Invalid interval', msg + '\n\nEdit SYNC_INTERVAL_HOURS in the config and try again.', SpreadsheetApp.getUi().ButtonSet.OK);
    return;
  }

  disableIntervalTrigger();  // clear any existing first

  ScriptApp.newTrigger('reassignSyncNow')
    .timeBased()
    .everyHours(hours)
    .create();

  logMsg('INFO', `Scheduled runs enabled — running every ${hours} hour(s).`);
  SpreadsheetApp.getUi().alert(
    'Success',
    `Scheduled runs enabled. It will run every ${hours} hour(s).`,
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

/**
 * Disable the recurring reassignment trigger(s).
 */
function disableIntervalTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  let deletedCount = 0;

  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'reassignSyncNow') {
      ScriptApp.deleteTrigger(trigger);
      deletedCount++;
    }
  });

  if (deletedCount > 0) {
    logMsg('INFO', `Disabled ${deletedCount} interval trigger(s).`);
    SpreadsheetApp.getUi().alert('Success', 'Scheduled runs have been disabled.', SpreadsheetApp.getUi().ButtonSet.OK);
  } else {
    logMsg('INFO', 'No interval triggers found to disable.');
    SpreadsheetApp.getUi().alert('Info', 'No scheduled runs were enabled.', SpreadsheetApp.getUi().ButtonSet.OK);
  }
}

/**
 * Check whether the recurring reassignment trigger is enabled.
 */
function isIntervalTriggerEnabled() {
  return ScriptApp.getProjectTriggers()
    .some(trigger => trigger.getHandlerFunction() === 'reassignSyncNow');
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Get or create the target sheet.
 */
function getOrCreateReassignSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_NAME);
    Logger.log(`Created sheet: ${CONFIG.SHEET_NAME}`);
  }
  return sheet;
}

/**
 * Write a set of request objects to the sheet with standard headers.
 * Clears the sheet first. Leaves reassign_result blank for later.
 */
function writeRequestsToSheet(sheet, requests) {
  sheet.clear();

  const headers = ['id', 'title', 'state', 'assignee', 'collection', 'created_at', 'url', 'reassign_result'];
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setValues([headers]);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#f0f0f0');

  if (!requests || requests.length === 0) {
    // Put the note in the "title" column, NOT "id": reassign/refresh read the
    // id column and must not mistake the message for a request ID.
    sheet.getRange(2, 2).setValue(`No ${scopeWord_()} requests in the last ${CONFIG.LOOKBACK_DAYS} days.`)
      .setFontStyle('italic').setFontColor('#666666');
    return;
  }

  const rows = requests.map(r => ([
    r.id,
    r.title || r.subject || '',
    r.state || '',
    describeAssignee_(r).label,
    (r.collection && (r.collection.name || r.collection.id)) || '',
    r.created_at || '',
    (r.request_thread && r.request_thread.url) || r.url || ('https://web.clearfeed.app/requests/' + r.id),
    ''  // reassign_result
  ]));

  sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  sheet.autoResizeColumns(1, headers.length);
  saveUserCache();   // persist any assignee names resolved above
}

// ============================================================
// EMAIL ALERTS
// ============================================================

/**
 * Email a summary of failed reassign calls. Skipped if EMAIL_CONFIG.TO is empty.
 * Mirrors sendRunEmail_() in channel_sync.gs. Never throws — an email problem
 * must not fail the run.
 */
function sendFailureEmail_(total, summary) {
  if (!EMAIL_CONFIG.TO) {
    logMsg('INFO', 'Failure email skipped: EMAIL_CONFIG.TO is empty.');
    return;
  }

  const timestamp = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'HH:mm:ss dd MMM yyyy');
  const subject = `${EMAIL_CONFIG.SUBJECT_PREFIX}[${timestamp}] - ${summary.failed} failed reassign call(s)`;

  const bodyLines = [
    'Auto-reassign run completed with failures:',
    '',
    `Requests found: ${total}`,
    `Reassign calls succeeded: ${summary.success}`,
    `Reassign calls failed: ${summary.failed}`
  ];
  if (summary.skipped > 0) {
    bodyLines.push(`Not attempted (run aborted after repeated failures): ${summary.skipped}`);
  }
  bodyLines.push('', 'Failures:');
  summary.failures.forEach(f => bodyLines.push(`- Request ${f.id}: ${f.result}`));
  bodyLines.push('', `See the "${CONFIG.LOG_SHEET_NAME}" tab for details.`);
  const body = bodyLines.join('\n');

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
      logMsg('WARN', `Failed to send failure email: ${e2.message}`);
    }
  }
}

// ============================================================
// RUNTIME LOGGING (in-sheet, survives trigger runs)
// ============================================================

/**
 * Write a timestamped entry to both Logger and a dedicated "Logs" sheet tab.
 * Using a sheet means logs are visible after unattended/trigger runs, where
 * the Apps Script Logger output isn't easily accessible.
 *
 * @param {string} level - INFO | WARN | ERROR
 * @param {string} message
 */
function logMsg(level, message) {
  // Always mirror to the native logger too.
  Logger.log(`[${level}] ${message}`);

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let logSheet = ss.getSheetByName(CONFIG.LOG_SHEET_NAME);
    if (!logSheet) {
      logSheet = ss.insertSheet(CONFIG.LOG_SHEET_NAME);
      logSheet.getRange(1, 1, 1, 3)
        .setValues([[`Timestamp (${CONFIG.TIMEZONE})`, 'Level', 'Message']])
        .setFontWeight('bold')
        .setBackground('#f0f0f0');
      logSheet.setFrozenRows(1);
    }

    const ts = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "yyyy-MM-dd HH:mm:ss");
    logSheet.appendRow([ts, level, message]);

    // Trim old rows so the tab doesn't grow unbounded.
    const rowCount = logSheet.getLastRow();
    const maxRows = CONFIG.LOG_MAX_ROWS;
    if (rowCount > maxRows + 1) {                 // +1 for header
      const excess = rowCount - (maxRows + 1);
      logSheet.deleteRows(2, excess);             // delete oldest (just below header)
    }
  } catch (e) {
    // Never let logging failures break the main flow.
    Logger.log(`logMsg failed to write to sheet: ${e.message}`);
  }
}

/**
 * MENU: "View Logs" — shows the last ~20 log entries in a dialog,
 * so you can diagnose a run without leaving the sheet.
 */
function showLogs() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logSheet = ss.getSheetByName(CONFIG.LOG_SHEET_NAME);

  if (!logSheet || logSheet.getLastRow() < 2) {
    ui.alert('Logs', 'No log entries yet. Run Now first.', ui.ButtonSet.OK);
    return;
  }

  const lastRow = logSheet.getLastRow();
  const showCount = Math.min(20, lastRow - 1);
  const startRow = lastRow - showCount + 1;
  const rows = logSheet.getRange(startRow, 1, showCount, 3).getValues();

  // Show newest first.
  const text = rows.reverse().map(r => `${r[0]}  [${r[1]}]  ${r[2]}`).join('\n');

  ui.alert(
    `Recent Logs (last ${showCount})`,
    text + '\n\nFull history is in the "' + CONFIG.LOG_SHEET_NAME + '" tab.',
    ui.ButtonSet.OK
  );
}

/**
 * MENU: "Clear Logs" — wipes the Logs tab (keeps the header).
 */
function clearLogs() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logSheet = ss.getSheetByName(CONFIG.LOG_SHEET_NAME);

  if (!logSheet || logSheet.getLastRow() < 2) {
    ui.alert('Logs', 'Nothing to clear.', ui.ButtonSet.OK);
    return;
  }

  logSheet.deleteRows(2, logSheet.getLastRow() - 1);
  ui.alert('Logs', 'Log history cleared.', ui.ButtonSet.OK);
}

// ============================================================
// MENU
// ============================================================
// NOTE: If this lives in the SAME Apps Script project as
// request_sync.gs, that file ALSO defines onOpen(). Apps Script
// runs only one onOpen() per project, so merge these items into
// the existing menu there instead of keeping two onOpen()s.
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('ClearFeed Reassign')
    .addItem('▶️ Run Now', 'reassignSyncNowMenu')
    .addSeparator()
    .addItem('📥 Preview Requests', 'fetchUnassignedRequests')
    .addItem('🔁 Reassign Listed Requests', 'reassignRequests')
    .addItem('🔃 Refresh Assignees', 'refreshAssigneesMenu')
    .addSeparator()
    .addItem('⏰ Enable Scheduled Runs', 'enableIntervalTrigger')
    .addItem('⏹️ Disable Scheduled Runs', 'disableIntervalTrigger')
    .addSeparator()
    .addItem('📋 View Logs', 'showLogs')
    .addItem('🧹 Clear Logs', 'clearLogs')
    .addToUi();
}
