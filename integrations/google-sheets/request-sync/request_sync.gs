// Clearfeed to Google Sheets Sync Script
// Configuration - Update these values for your setup
const CONFIG = {
  API_KEY: "", // Replace with your Clearfeed API key
  COLLECTION_ID: null, // Replace with your collection ID or set to null/empty to fetch from all collections
  SHEET_NAME: "ClearFeed Requests", // Name of the sheet tab
  SPREADSHEET_ID: "", // Leave empty to use current spreadsheet, or specify ID
  INITIAL_DAYS_BACK: 14 // For initial sync, fetch requests from this many days back
};

const BASE_URL = "https://api.clearfeed.app/v1/rest/requests";
const USERS_URL = "https://api.clearfeed.app/v1/rest/users";
const CUSTOMERS_URL = "https://api.clearfeed.app/v1/rest/customers";
const LAST_SYNC_PROPERTY = "LAST_SYNC_PROPERTY";

// Customer requested columns (simplified readable names)
const HEADERS = [
  'ID',
  'Title',
  'Priority',
  'Created At',
  'Updated At',
  'State',
  'Author',
  'Author Email',
  'Assignee',
  'Contributors',
  'Assigned Team ID',
  'Tickets',
  'CSAT Survey',
  'CSAT Comment',
  'Channel Name',
  'Channel Owner',
  'Collection Name',
  'Customer Name',
  'Request Channel ID',
  'Request Thread TS',
  'Request Team ID',
  'Request Thread URL',
  'Triage Thread URL',
  'First Response Time (mins)',
  'First Response Time Breached',
  'Resolution Time (mins)',
  'Resolution Time Breached',
  'First Resolution Time (mins)',
  'Last Message Time',
  'Messages'
];

// Global cache for user data (id -> name mapping)
let userCache = null;
// Global cache for customer data (id -> name mapping)
let customerCache = null;
// Global cache for channel_id -> customer_name mapping
let channelToCustomerCache = null;


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

    // Initialize caches
    initializeUserCache();
    initializeCustomerCache();

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
 * Initialize user cache from persistent storage
 */
function initializeUserCache() {
  const cache = PropertiesService.getScriptProperties();
  const cachedData = cache.getProperty('user_cache');
  userCache = cachedData ? JSON.parse(cachedData) : {};
  Logger.log(`User cache initialized with ${Object.keys(userCache).length} entries`);
}

/**
 * Save user cache to persistent storage
 */
function saveUserCache() {
  if (userCache) {
    const cache = PropertiesService.getScriptProperties();
    cache.setProperty('user_cache', JSON.stringify(userCache));
  }
}

/**
 * Initialize customer cache from persistent storage
 */
function initializeCustomerCache() {
  const cache = PropertiesService.getScriptProperties();
  const cachedData = cache.getProperty('customer_cache');
  customerCache = cachedData ? JSON.parse(cachedData) : {};
  Logger.log(`Customer cache initialized with ${Object.keys(customerCache).length} entries`);

  // Initialize channel to customer mapping
  const channelCacheData = cache.getProperty('channel_to_customer_cache');
  channelToCustomerCache = channelCacheData ? JSON.parse(channelCacheData) : {};
  Logger.log(`Channel to customer cache initialized with ${Object.keys(channelToCustomerCache).length} entries`);
}

/**
 * Save customer cache to persistent storage
 */
function saveCustomerCache() {
  if (customerCache) {
    const cache = PropertiesService.getScriptProperties();
    cache.setProperty('customer_cache', JSON.stringify(customerCache));
  }
  if (channelToCustomerCache) {
    const cache = PropertiesService.getScriptProperties();
    cache.setProperty('channel_to_customer_cache', JSON.stringify(channelToCustomerCache));
  }
}

/**
 * Fetch users from ClearFeed API by their IDs (batch request)
 * @param {Array<string>} userIds - Array of user IDs to fetch
 * @returns {Object} Map of user ID to user object
 */
function fetchUsersByIds(userIds) {
  if (!userIds || userIds.length === 0) return {};

  // Filter out IDs we already have in cache
  const uncachedIds = userIds.filter(id => !userCache[id]);
  if (uncachedIds.length === 0) return userCache;

  // Split into batches of 50 to avoid URL length limits
  const batchSize = 50;
  const results = {};

  for (let i = 0; i < uncachedIds.length; i += batchSize) {
    const batch = uncachedIds.slice(i, i + batchSize);
    const idsParam = batch.join(',');

    try {
      const url = `${USERS_URL}?ids=${encodeURIComponent(idsParam)}`;
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

        users.forEach(user => {
          results[user.id] = user;
        });

        Logger.log(`Fetched ${users.length} users from ClearFeed API`);
      } else {
        Logger.log(`Users API error: ${response.getResponseCode()} - ${response.getContentText()}`);
      }
    } catch (error) {
      Logger.log(`Error fetching users: ${error.toString()}`);
    }
  }

  // Update cache with new results
  Object.assign(userCache, results);
  return userCache;
}

/**
 * Get user name from user ID using ClearFeed Users API
 * @param {string} userId - User ID
 * @returns {string} User display name or original ID if lookup fails
 */
function getUserName(userId) {
  if (!userId) return '';

  // Return cached value if available
  if (userCache && userCache[userId]) {
    return userCache[userId].name || userId;
  }

  // Fetch this user
  fetchUsersByIds([userId]);

  return (userCache && userCache[userId]) ? userCache[userId].name : userId;
}

/**
 * Get user email from user ID
 * @param {string} userId - User ID
 * @returns {string} User email or empty string
 */
function getUserEmail(userId) {
  if (!userId) return '';

  if (userCache && userCache[userId]) {
    return userCache[userId].email || '';
  }

  fetchUsersByIds([userId]);

  return (userCache && userCache[userId]) ? userCache[userId].email : '';
}

/**
 * Fetch customers from ClearFeed API by their IDs (batch request)
 * @param {Array<number>} customerIds - Array of customer IDs to fetch
 * @returns {Object} Map of customer ID to customer object
 */
function fetchCustomersByIds(customerIds) {
  if (!customerIds || customerIds.length === 0) return {};

  // Filter out IDs we already have in cache
  const uncachedIds = customerIds.filter(id => !customerCache[id]);
  if (uncachedIds.length === 0) return customerCache;

  // Split into batches of 50
  const batchSize = 50;
  const results = {};

  for (let i = 0; i < uncachedIds.length; i += batchSize) {
    const batch = uncachedIds.slice(i, i + batchSize);
    const idsParam = batch.join(',');

    try {
      const url = `${CUSTOMERS_URL}?ids=${encodeURIComponent(idsParam)}`;
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
        const customers = data.customers || [];

        customers.forEach(customer => {
          results[customer.id] = customer;
          // Build channel_id -> customer_name mapping
          if (customer.channel_ids && Array.isArray(customer.channel_ids)) {
            customer.channel_ids.forEach(channelId => {
              channelToCustomerCache[channelId] = customer.name;
            });
          }
        });

        Logger.log(`Fetched ${customers.length} customers from ClearFeed API`);
      } else {
        Logger.log(`Customers API error: ${response.getResponseCode()}`);
      }
    } catch (error) {
      Logger.log(`Error fetching customers: ${error.toString()}`);
    }
  }

  // Update cache with new results
  Object.assign(customerCache, results);
  return customerCache;
}

/**
 * Get customer name from customer ID
 * @param {number} customerId - Customer ID
 * @returns {string} Customer name or empty string
 */
function getCustomerName(customerId) {
  if (!customerId) return '';

  const idStr = String(customerId);

  if (customerCache && customerCache[idStr]) {
    return customerCache[idStr].name || '';
  }

  fetchCustomersByIds([customerId]);

  return (customerCache && customerCache[idStr]) ? customerCache[idStr].name : '';
}

/**
 * Fetch all customers from ClearFeed API with pagination
 * Builds channel_id -> customer_name mapping
 */
function fetchAllCustomers() {
  const allCustomers = [];
  let nextCursor = null;
  const limit = 100;

  while (true) {
    const params = {
      limit: limit
    };

    if (nextCursor) {
      params.next_cursor = nextCursor;
    }

    try {
      const url = `${CUSTOMERS_URL}?${Object.keys(params).map(key =>
        `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`
      ).join('&')}`;

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
        const customers = data.customers || [];

        customers.forEach(customer => {
          // Store in customer cache by ID
          customerCache[customer.id] = customer;
          // Build channel_id -> customer_name mapping
          if (customer.channel_ids && Array.isArray(customer.channel_ids)) {
            customer.channel_ids.forEach(channelId => {
              channelToCustomerCache[channelId] = customer.name;
            });
          }
        });

        allCustomers.push(...customers);

        // Check if there's a next cursor
        const responseMetadata = data.response_metadata || {};
        nextCursor = responseMetadata.next_cursor;

        if (!nextCursor || customers.length === 0) {
          break;
        }
      } else {
        Logger.log(`Customers API error: ${response.getResponseCode()}`);
        break;
      }
    } catch (error) {
      Logger.log(`Error fetching all customers: ${error.toString()}`);
      break;
    }
  }

  Logger.log(`Fetched ${allCustomers.length} customers and built channel-to-customer mapping`);
}

/**
 * Pre-fetch all users and customers found in requests (optimization)
 * @param {Array} requests - Array of request objects
 */
function prefetchAllUsersAndCustomers(requests) {
  const userIds = new Set();

  requests.forEach(request => {
    // Add author
    if (request.author) {
      userIds.add(request.author);
    }

    // Add assignee
    if (request.assignee && request.assignee.id) {
      userIds.add(request.assignee.id);
    }

    // Add channel owner
    if (request.channel && request.channel.owner) {
      userIds.add(request.channel.owner);
    }

    // Add contributors
    if (request.contributors && Array.isArray(request.contributors)) {
      request.contributors.forEach(c => {
        if (typeof c === 'string') {
          userIds.add(c);
        } else if (c.id) {
          userIds.add(c.id);
        }
      });
    }

    // Add message authors
    if (request.messages && Array.isArray(request.messages)) {
      request.messages.forEach(msg => {
        if (msg.author) {
          userIds.add(msg.author);
        }
      });
    }
  });

  if (userIds.size > 0) {
    Logger.log(`Pre-fetching ${userIds.size} unique users...`);
    fetchUsersByIds(Array.from(userIds));
    saveUserCache();
  }

  // Fetch ALL customers to build complete channel_to_customer mapping
  Logger.log(`Fetching all customers to build channel-to-customer mapping...`);
  fetchAllCustomers();
  saveCustomerCache();
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

    // Always include messages in the response
    params.include = "messages";

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

  // Pre-fetch all users and customers for efficiency
  prefetchAllUsersAndCustomers(requests);

  // Clear existing data
  sheet.clear();

  // Set headers
  const headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
  headerRange.setValues([HEADERS]);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#f0f0f0');

  // Add data rows
  const dataRows = requests.map(request => extractRequestData(request));

  if (dataRows.length > 0) {
    const dataRange = sheet.getRange(2, 1, dataRows.length, HEADERS.length);
    dataRange.setValues(dataRows);
  }

  sheet.autoResizeColumns(1, HEADERS.length);
  Logger.log(`Initial sync: Added ${requests.length} requests`);
}

/**
 * Merge incremental data into existing sheet
 */
function mergeIncrementalData(sheet, requests) {
  if (requests.length === 0) return;

  // Pre-fetch all users and customers for efficiency
  prefetchAllUsersAndCustomers(requests);

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
  const idColumnIndex = headers.indexOf('ID');
  if (idColumnIndex === -1) {
    throw new Error("ID column not found in existing sheet");
  }

  const existingRequestsMap = new Map();
  existingData.forEach((row, index) => {
    existingRequestsMap.set(String(row[idColumnIndex]), index + 2); // +2 for header row and 1-based indexing
  });

  let updatedCount = 0;
  let addedCount = 0;

  requests.forEach(request => {
    const requestData = extractRequestData(request);
    const requestId = String(request.id);

    if (existingRequestsMap.has(requestId)) {
      // Update existing row
      const rowIndex = existingRequestsMap.get(requestId);
      const range = sheet.getRange(rowIndex, 1, 1, HEADERS.length);
      range.setValues([requestData]);
      updatedCount++;
    } else {
      // Add new row
      sheet.appendRow(requestData);
      addedCount++;
    }
  });

  sheet.autoResizeColumns(1, HEADERS.length);
  Logger.log(`Incremental sync: Updated ${updatedCount} requests, added ${addedCount} new requests`);
}

/**
 * Extract data from a request object based on headers
 * @param {Object} request - The request object
 */
function extractRequestData(request) {
  return HEADERS.map(header => {
    try {
      // Special handling for specific columns
      switch (header) {
        case 'ID':
          return String(request.id || '');

        case 'Title':
          return request.title || '';

        case 'Priority':
          return request.priority || '';

        case 'Created At':
          return request.created_at || '';

        case 'Updated At':
          return request.updated_at || '';

        case 'State':
          return request.state || '';

        case 'Author':
          return request.author ? getUserName(request.author) : '';

        case 'Author Email':
          return request.author_email || '';

        case 'Assignee':
          if (request.assignee && request.assignee.id) {
            return getUserName(request.assignee.id);
          }
          return '';

        case 'Contributors':
          if (Array.isArray(request.contributors) && request.contributors.length > 0) {
            return request.contributors.map(c => {
              if (typeof c === 'string') {
                return getUserName(c);
              }
              return c.id ? getUserName(c.id) : '';
            }).filter(Boolean).join(', ');
          }
          return '';

        case 'Assigned Team ID':
          if (request.assigned_team && request.assigned_team.id) {
            return String(request.assigned_team.id);
          }
          return '';

        case 'Tickets':
          if (Array.isArray(request.tickets) && request.tickets.length > 0) {
            const nonClearfeedTickets = request.tickets.filter(t => t.type !== 'clearfeed');
            if (nonClearfeedTickets.length > 0) {
              // Build individual HYPERLINK formulas for each ticket
              const hyperlinkFormulas = nonClearfeedTickets.map(t => {
                const url = (t.url || '#').replace(/"/g, '""');
                const key = (t.key || 'No Key').replace(/"/g, '""');
                return 'HYPERLINK("' + url + '", "' + key + '")';
              });
              // Use TEXTJOIN to combine multiple hyperlinks with comma separator
              if (hyperlinkFormulas.length === 1) {
                return '=' + hyperlinkFormulas[0];
              }
              return '=TEXTJOIN(", ", TRUE, ' + hyperlinkFormulas.join(', ') + ')';
            }
          }
          return '';

        case 'CSAT Survey':
          if (request.csat_survey && request.csat_survey.status === 'received' && request.csat_survey.response) {
            const surveyType = request.csat_survey.response.survey_type;
            const ratingValue = request.csat_survey.response.value;
            const maxValue = request.csat_survey.response.max_value || 5;

            if (surveyType === 'two_point_rating') {
              // value 1 = No (negative), value 2 = Yes (positive)
              return ratingValue === 2 ? '👍 Yes' : '👎 No';
            }
            if (surveyType === 'five_point_rating') {
              return ratingValue + ' out of ' + maxValue;
            }
          }
          return '';

        case 'CSAT Comment':
          // comment is directly on csat_survey object, not under response
          if (request.csat_survey) {
            // Log for debugging if comment exists but might be empty string
            if (request.csat_survey.comment !== undefined && request.csat_survey.comment !== null) {
              return request.csat_survey.comment;
            }
          }
          return '';

        case 'Channel Name':
          return request.channel && request.channel.name ? request.channel.name : '';

        case 'Channel Owner':
          return request.channel && request.channel.owner ? getUserName(request.channel.owner) : '';

        case 'Collection Name':
          return request.collection && request.collection.name ? request.collection.name : '';

        case 'Customer Name':
          // Look up customer by request channel ID
          const requestChannelId = request.request_thread && request.request_thread.channel_id ? request.request_thread.channel_id : '';
          if (requestChannelId && channelToCustomerCache && channelToCustomerCache[requestChannelId]) {
            return channelToCustomerCache[requestChannelId];
          }
          return '';

        case 'Request Channel ID':
          return request.request_thread && request.request_thread.channel_id ? request.request_thread.channel_id : '';

        case 'Request Thread TS':
          return request.request_thread && request.request_thread.thread_ts ? request.request_thread.thread_ts : '';

        case 'Request Team ID':
          return request.request_thread && request.request_thread.team_id ? request.request_thread.team_id : '';

        case 'Request Thread URL':
          return request.request_thread && request.request_thread.url ? request.request_thread.url : '';

        case 'Triage Thread URL':
          return request.triage_thread && request.triage_thread.url ? request.triage_thread.url : '';

        case 'First Response Time (mins)':
          if (request.sla_metrics && request.sla_metrics.first_response_time && request.sla_metrics.first_response_time.value !== null && request.sla_metrics.first_response_time.value !== undefined) {
            return String(request.sla_metrics.first_response_time.value);
          }
          return '';

        case 'First Response Time Breached':
          if (request.sla_metrics && request.sla_metrics.first_response_time && typeof request.sla_metrics.first_response_time.is_breached === 'boolean') {
            return request.sla_metrics.first_response_time.is_breached ? 'Yes' : 'No';
          }
          return '';

        case 'Resolution Time (mins)':
          if (request.sla_metrics && request.sla_metrics.resolution_time && request.sla_metrics.resolution_time.value !== null && request.sla_metrics.resolution_time.value !== undefined) {
            return String(request.sla_metrics.resolution_time.value);
          }
          return '';

        case 'Resolution Time Breached':
          if (request.sla_metrics && request.sla_metrics.resolution_time && typeof request.sla_metrics.resolution_time.is_breached === 'boolean') {
            return request.sla_metrics.resolution_time.is_breached ? 'Yes' : 'No';
          }
          return '';

        case 'First Resolution Time (mins)':
          if (request.sla_metrics && request.sla_metrics.first_resolution_time && request.sla_metrics.first_resolution_time.value !== null && request.sla_metrics.first_resolution_time.value !== undefined) {
            return String(request.sla_metrics.first_resolution_time.value);
          }
          return '';

        case 'Last Message Time':
          return request.last_message_time || '';

        case 'Messages':
          if (Array.isArray(request.messages) && request.messages.length > 0) {
            return formatMessages(request.messages);
          }
          return '';

        default:
          return '';
      }
    } catch (error) {
      Logger.log(`Error extracting field '${header}': ${error.toString()}`);
      return '';
    }
  });
}

/**
 * Format messages array for sheet display
 * Format: [Responder] Author Name: Message text
 */
function formatMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return '';
  }

  return messages.map(message => {
    const responderTag = message.is_responder ? '[Responder] ' : '';
    const author = message.author ? getUserName(message.author) : 'Unknown';
    const text = message.text || '';
    return `${responderTag}${author}: ${text}`;
  }).join('\n\n');
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

  Logger.log("Hourly automatic sync enabled");
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
    Logger.log(`Disabled ${deletedCount} hourly trigger(s)`);
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
      Logger.log("API connection successful");
      const data = JSON.parse(response.getContentText());
      Logger.log(`Found ${data.requests ? data.requests.length : 0} requests in test batch`);

      // Log response structure for debugging
      if (data.response_metadata) {
        Logger.log(`Response metadata available: ${JSON.stringify(data.response_metadata)}`);
      }
    } else {
      Logger.log(`API connection failed: ${response.getResponseCode()}`);
      Logger.log(response.getContentText());
    }

  } catch (error) {
    Logger.log(`Connection test failed: ${error.toString()}`);
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
 * Utility function to clear the caches
 */
function clearCache() {
  const cache = PropertiesService.getScriptProperties();
  cache.deleteProperty('user_cache');
  cache.deleteProperty('customer_cache');
  cache.deleteProperty('channel_to_customer_cache');
  userCache = {};
  customerCache = {};
  channelToCustomerCache = {};
  Logger.log("Cleared user and customer name caches");

  const ui = SpreadsheetApp.getUi();
  ui.alert(
    'Cache Cleared',
    'Cleared cached data. Names will be re-fetched on next sync.',
    ui.ButtonSet.OK
  );
}

/**
 * Create custom menu in Google Sheet
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  const menu = ui.createMenu('Clearfeed Sync')
    .addItem('Sync Now', 'syncClearfeedRequests')
    .addItem('Setup Sync', 'setupSync')
    .addItem('Test Connection', 'testClearfeedConnection')
    .addSeparator()
    .addItem('Enable Hourly Sync', 'enableHourlyTrigger')
    .addItem('Disable Hourly Sync', 'disableHourlyTrigger')
    .addSeparator()
    .addItem('Reset Sync', 'resetSync')
    .addItem('Clear Cache', 'clearCache')
    .addItem('View Logs', 'showLogs');

  menu.addToUi();
}

/**
 * Show logs in a dialog
 */
function showLogs() {
  const ui = SpreadsheetApp.getUi();
  ui.alert('Recent Logs', `Check the Apps Script editor (View > Logs) for detailed logs.`, ui.ButtonSet.OK);
}
