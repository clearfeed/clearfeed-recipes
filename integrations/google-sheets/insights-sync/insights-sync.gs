function fetchClearfeedInsights() {
  const token = 'your-api-token-here';  // Replace with your actual token
  const url = 'https://api.clearfeed.app/v1/rest/insights/query';

  const payload = {
    query: {
      measures: [
        "Requests.count",
        "Requests.first_response_time_avg"
      ],
      time_dimensions: [
        {
          dimension: "Requests.created_at",
          date_range: "Last week",
          granularity: "day"
        }
      ],
      dimensions: [
        "Requests.priority"
      ],
      filters: [
        {
          member: "Requests.state",
          operator: "equals",
          values: ["in_progress"]
        }
      ]
    }
  };

  const options = {
    method: "post",
    contentType: "application/json",
    headers: {
      Authorization: "Bearer " + token
    },
    payload: JSON.stringify(payload)
  };

  const response = UrlFetchApp.fetch(url, options);
  const result = JSON.parse(response.getContentText());

  const data = result.insights || [];

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  sheet.clear(); // Clear previous content

  if (data.length === 0) {
    sheet.getRange(1, 1).setValue("No data found");
    return;
  }

  // Extract headers
  const headers = Object.keys(data[0]);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  // Write data rows
  const rows = data.map(rowObj => headers.map(h => rowObj[h]));
  sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
}
