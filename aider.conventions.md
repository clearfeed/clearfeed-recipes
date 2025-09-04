## Introduction to the Repository

This repository contains a collection of **open source integrations** and **apps** built on the [ClearFeed API](https://docs.clearfeed.ai/api)).  
Each subproject is self-contained and may use different languages, frameworks, and deployment models.

The goal is to provide **recipes** that developers can adapt for their own workflows.

## General Guidelines

- Each integration or app lives in its own subfolder under `integrations/` or `apps/`.
- Each subproject must have:
  - Its own `README.md` with usage/setup instructions.
  - Dependencies isolated (e.g., local `package.json`, `requirements.txt`, or equivalent).
  - Clear separation of language/runtime files (don’t mix Node and Python in the same project unless intentional).
- Keep contributions minimal, self-contained, and runnable.

## Language & Frameworks
- Multiple languages are supported across the repo (Python, Node.js, Google App Script, etc.).
- Choose the language best suited for the integration/app being implemented.

## Integrations Folder

### `integrations/google-sheets`
- This folder contains **Google App Script** code for syncing data from ClearFeed REST APIs to Google Sheets and apps inside Google Sheets
- Language: **Google App Script** only.
- Use idiomatic App Script patterns (custom menus, triggers, etc. where appropriate).
- Include a `README.md` with setup steps for deploying Scripts to Sheets.


# Basic Information about the ClearFeed APIs and Objects

## Request Object

Requests are represented as JSON objects with the following properties

<table data-full-width="true"><thead><tr><th width="200">Name</th><th width="96.33333333333331">Type</th><th>Description</th></tr></thead><tbody><tr><td>id</td><td>integer</td><td>The ID of the request</td></tr><tr><td>title</td><td>string</td><td>The title of the request</td></tr><tr><td>state</td><td>string</td><td><p>The state of the request. Allowed values :</p><p><code>open</code>, <code>in_progress</code>, <code>pending</code>, <code>on_hold</code>, <code>solved</code>, <code>closed</code></p></td></tr><tr><td>priority</td><td>string</td><td><p>The priority of the request.</p><p>Allowed values : <code>low</code>, <code>normal</code>, <code>high</code>, <code>urgent</code></p></td></tr><tr><td>author</td><td>object</td><td>An object containing details of the request author.</td></tr><tr><td>assignee</td><td>object</td><td>The id of the request assignee. Details about the object can be found <a href="#assignee-object">here</a>.</td></tr><tr><td>assigned_team</td><td>object</td><td>The assigned team for this request, if any. This field will be <code>null</code> if no team is assigned. For more details, see <a href="#assigned-team-object">here</a>.</td></tr><tr><td>tickets</td><td>array</td><td>An array of ticket objects linked to the request. Details about the object can be found <a href="#ticket-object">here</a>.</td></tr><tr><td>csat_survey</td><td>object</td><td>An object containing information related to the csat_survey response of the request. Details about the object can be found <a href="#csat-survey-response-object">here</a>.</td></tr><tr><td>channel</td><td>object</td><td>An object containing channel information where the request was sent.<br>Details about the object can be found <a href="#channel-object">here</a>.</td></tr><tr><td>collection</td><td>object</td><td>An object containing collection information to which the above channel belongs where the request was sent.<br>Details about the object can be found <a href="collections">here</a>.</td></tr><tr><td>custom_field_values</td><td>object</td><td>An object containing custom field values<br>The object will have custom field ids as keys and the values of the custom fields as values of the object.<br>Note: Values will be ids in case of <code>select</code> and <code>multi_select</code> type custom fields.</td></tr><tr><td>request_thread</td><td>object</td><td><p>An object containing information related to the thread corresponding to the request.</p><p>Details about the object can be found <a href="#thread-object">here</a>.</p></td></tr><tr><td>triage_thread</td><td>object</td><td>An object containing information related to the triage thread corresponding to the request.<br>Details about the object can be found <a href="#thread-object">here</a>.</td></tr><tr><td>sla_metrics</td><td>object</td><td><p>An object containing SLA metrics information</p><p>Details about the object can be found <a href="#sla-metrics-object">here</a>.</p></td></tr><tr><td>created_at</td><td>string</td><td>The creation timestamp of the request</td></tr><tr><td>updated_at</td><td>string</td><td>The update timestamp of the request</td></tr></tbody></table>

## Assignee Object

Assignee of the request is represented as a JSON object with the following property

<table data-full-width="true"><thead><tr><th width="130">Name</th><th width="85">Type</th><th>Description</th></tr></thead><tbody><tr><td>id</td><td>string</td><td>Slack/MS Teams User ID of the assignee for the request</td></tr></tbody></table>

## Assigned Team Object

The assigned team for a request is represented as a JSON object with the following property:

<table data-full-width="true"><thead><tr><th width="130">Name</th><th width="85">Type</th><th>Description</th></tr></thead><tbody><tr><td>id</td><td>number</td><td>The numeric ID of the assigned team for the request</td></tr></tbody></table>

## Ticket Object

Tickets are represented as JSON objects with the following properties

<table data-full-width="true"><thead><tr><th width="130">Name</th><th width="85">Type</th><th>Description</th></tr></thead><tbody><tr><td>id</td><td>integer</td><td>The ID of the ticket</td></tr><tr><td>type</td><td>string</td><td><p>Type of the ticket</p><p>Allowed values : <code>zendesk</code>, <code>jira</code>, <code>jsm</code>, <code>salesforce</code>, <code>freshdesk</code>, <code>hubspot</code>, <code>clearfeed</code>, <code>github</code>, <code>intercom</code>, <code>linear</code></p></td></tr><tr><td>key</td><td>string</td><td>The key used for the ticket id.</td></tr><tr><td>url</td><td>string</td><td>The url of the ticket.</td></tr><tr><td>created_at</td><td>string</td><td>The creation timestamp of the ticket</td></tr></tbody></table>

## CSAT Survey Response Object

CSAT survey responses are represented as JSON objects with the following properties

<table data-full-width="true"><thead><tr><th width="119">Name</th><th width="100">Type</th><th>Description</th></tr></thead><tbody><tr><td>status</td><td>string</td><td><p>Status of the csat_survey.</p><p>Allowed values:</p><p><code>pending</code>, <code>received</code></p></td></tr><tr><td>response</td><td>object</td><td><p>This object will only be present if the status of the csat survey is <code>received</code></p><table data-full-width="true"><thead><tr><th width="100">Name</th><th width="100">Type</th><th>Description</th></tr></thead><tbody><tr><td>survey_type</td><td>string</td><td><p>Type of the the cast survey.</p><p>Allowed Values: <code>five_point_rating</code></p></td></tr><tr><td>value</td><td>number</td><td>Points given in the CSAT survey response.</td></tr><tr><td>max_value</td><td>number</td><td>Maximum possible value of the response.</td></tr></tbody></table></td></tr><tr><td>Name</td><td>Type</td><td>Description</td></tr><tr><td>survey_type</td><td>string</td><td><p>Type of the the cast survey.</p><p>Allowed Values: <code>five_point_rating</code></p></td></tr><tr><td>value</td><td>number</td><td>Points given in the CSAT survey response.</td></tr><tr><td>max_value</td><td>number</td><td>Maximum possible value of the response.</td></tr><tr><td>Name</td><td>Type</td><td>Description</td></tr><tr><td>survey_type</td><td>string</td><td><p>Type of the the cast survey.</p><p>Allowed Values: <code>five_point_rating</code></p></td></tr><tr><td>value</td><td>number</td><td>Points given in the CSAT survey response.</td></tr><tr><td>max_value</td><td>number</td><td>Maximum possible value of the response.</td></tr><tr><td>Name</td><td>Type</td><td>Description</td></tr><tr><td>survey_type</td><td>string</td><td><p>Type of the the cast survey.</p><p>Allowed Values: <code>five_point_rating</code></p></td></tr><tr><td>value</td><td>number</td><td>Points given in the CSAT survey response.</td></tr><tr><td>max_value</td><td>number</td><td>Maximum possible value of the response.</td></tr><tr><td>Name</td><td>Type</td><td>Description</td></tr><tr><td>survey_type</td><td>string</td><td><p>Type of the the cast survey.</p><p>Allowed Values: <code>five_point_rating</code></p></td></tr><tr><td>value</td><td>number</td><td>Points given in the CSAT survey response.</td></tr><tr><td>max_value</td><td>number</td><td>Maximum possible value of the response.</td></tr></tbody></table>

## Thread Object

Thread are represented as JSON objects with the following properties

<table data-full-width="true"><thead><tr><th width="141">Name</th><th width="100">Type</th><th>Description</th></tr></thead><tbody><tr><td>channel_id</td><td>string</td><td>id of the channel where the thread exists.</td></tr><tr><td>thread_ts</td><td>string</td><td>id of the thread</td></tr><tr><td>team_id</td><td>string</td><td>team_id of the workspace where channel containing this thread exists.</td></tr><tr><td>url</td><td>string</td><td>URL of the thread</td></tr></tbody></table>

## SLA Metrics Object

SLA Metrics are represented as JSON objects with the following properties

<table data-full-width="true"><thead><tr><th width="198">Name</th><th width="85">Type</th><th>Description</th></tr></thead><tbody><tr><td>resolution_time</td><td>object</td><td><p>This field will hold <code>null</code> if the request is currently not in <code>solved</code> or <code>closed</code> state.</p><table data-full-width="true"><thead><tr><th width="100">Name</th><th width="100">Type</th><th>Description</th></tr></thead><tbody><tr><td>value</td><td>number</td><td>The time difference (in minutes) between when a request message was sent, and when it was resolved for the final time.</td></tr><tr><td>is_breached</td><td>boolean</td><td>If SLA Config is set up for the account, this field will indicate whether the request has breached Resolution Time SLA. This field will be absent in case Resolution Time SLA Config is not setup.</td></tr></tbody></table></td></tr><tr><td>Name</td><td>Type</td><td>Description</td></tr><tr><td>value</td><td>number</td><td>The time difference (in minutes) between when a request message was sent, and when it was resolved for the final time.</td></tr><tr><td>is_breached</td><td>boolean</td><td>If SLA Config is set up for the account, this field will indicate whether the request has breached Resolution Time SLA. This field will be absent in case Resolution Time SLA Config is not setup.</td></tr><tr><td>Name</td><td>Type</td><td>Description</td></tr><tr><td>value</td><td>number</td><td>The time difference (in minutes) between when a request message was sent, and when it was resolved for the final time.</td></tr><tr><td>is_breached</td><td>boolean</td><td>If SLA Config is set up for the account, this field will indicate whether the request has breached Resolution Time SLA. This field will be absent in case Resolution Time SLA Config is not setup.</td></tr><tr><td>Name</td><td>Type</td><td>Description</td></tr><tr><td>value</td><td>number</td><td>The time difference (in minutes) between when a request message was sent, and when it was resolved for the final time.</td></tr><tr><td>is_breached</td><td>boolean</td><td>If SLA Config is set up for the account, this field will indicate whether the request has breached Resolution Time SLA. This field will be absent in case Resolution Time SLA Config is not setup.</td></tr><tr><td>Name</td><td>Type</td><td>Description</td></tr><tr><td>value</td><td>number</td><td>The time difference (in minutes) between when a request message was sent, and when it was resolved for the final time.</td></tr><tr><td>is_breached</td><td>boolean</td><td>If SLA Config is set up for the account, this field will indicate whether the request has breached Resolution Time SLA. This field will be absent in case Resolution Time SLA Config is not setup.</td></tr><tr><td>first_response_time</td><td>object</td><td><p>This field will hold <code>null</code> if currently, the request hasn't had a first response in some way or the other.</p><table data-full-width="true"><thead><tr><th width="100">Name</th><th width="100">Type</th><th>Description</th></tr></thead><tbody><tr><td>value</td><td>number</td><td>The time difference (in minutes) between when the request message was sent, and when it received a first response.</td></tr><tr><td>is_breached</td><td>boolean</td><td>If SLA Config is set up for the account, this field will indicate whether the request has breached the First Response Time SLA. This field will be absent in case First Response Time SLA config is not setup.</td></tr></tbody></table></td></tr><tr><td>Name</td><td>Type</td><td>Description</td></tr><tr><td>value</td><td>number</td><td>The time difference (in minutes) between when the request message was sent, and when it received a first response.</td></tr><tr><td>is_breached</td><td>boolean</td><td>If SLA Config is set up for the account, this field will indicate whether the request has breached the First Response Time SLA. This field will be absent in case First Response Time SLA config is not setup.</td></tr><tr><td>Name</td><td>Type</td><td>Description</td></tr><tr><td>value</td><td>number</td><td>The time difference (in minutes) between when the request message was sent, and when it received a first response.</td></tr><tr><td>is_breached</td><td>boolean</td><td>If SLA Config is set up for the account, this field will indicate whether the request has breached the First Response Time SLA. This field will be absent in case First Response Time SLA config is not setup.</td></tr><tr><td>Name</td><td>Type</td><td>Description</td></tr><tr><td>value</td><td>number</td><td>The time difference (in minutes) between when the request message was sent, and when it received a first response.</td></tr><tr><td>is_breached</td><td>boolean</td><td>If SLA Config is set up for the account, this field will indicate whether the request has breached the First Response Time SLA. This field will be absent in case First Response Time SLA config is not setup.</td></tr><tr><td>Name</td><td>Type</td><td>Description</td></tr><tr><td>value</td><td>number</td><td>The time difference (in minutes) between when the request message was sent, and when it received a first response.</td></tr><tr><td>is_breached</td><td>boolean</td><td>If SLA Config is set up for the account, this field will indicate whether the request has breached the First Response Time SLA. This field will be absent in case First Response Time SLA config is not setup.</td></tr><tr><td>first_resolution_time</td><td>object</td><td><p>This field will hold <code>null</code> if the request has not been marked as <code>solved</code> at least once.</p><table data-full-width="true"><thead><tr><th width="100">Name</th><th width="100">Type</th><th>Description</th></tr></thead><tbody><tr><td>value</td><td>number</td><td>The time difference (in minutes) between when a request message was sent, and when it was resolved for the first time.</td></tr></tbody></table></td></tr><tr><td>Name</td><td>Type</td><td>Description</td></tr><tr><td>value</td><td>number</td><td>The time difference (in minutes) between when a request message was sent, and when it was resolved for the first time.</td></tr><tr><td>Name</td><td>Type</td><td>Description</td></tr><tr><td>value</td><td>number</td><td>The time difference (in minutes) between when a request message was sent, and when it was resolved for the first time.</td></tr><tr><td>Name</td><td>Type</td><td>Description</td></tr><tr><td>value</td><td>number</td><td>The time difference (in minutes) between when a request message was sent, and when it was resolved for the first time.</td></tr><tr><td>Name</td><td>Type</td><td>Description</td></tr><tr><td>value</td><td>number</td><td>The time difference (in minutes) between when a request message was sent, and when it was resolved for the first time.</td></tr></tbody></table>

## Collection Object

The collection of a request is represented as a JSON object with the following properties:

<table data-full-width="true"><thead><tr><th width="100">Name</th><th width="100">Type</th><th>Description</th></tr></thead><tbody><tr><td>id</td><td>string</td><td>Id of the collection</td></tr><tr><td>name</td><td>string</td><td>name of the collection</td></tr></tbody></table>

## Channel Object

Channel of a request is represented as JSON object with the following properties:

<table data-full-width="true"><thead><tr><th width="100">Name</th><th width="100">Type</th><th>Description</th></tr></thead><tbody><tr><td>id</td><td>string</td><td>Id of the channel</td></tr><tr><td>name</td><td>string</td><td>name of the channel</td></tr><tr><td>owner</td><td>string</td><td>id of the channel owner</td></tr></tbody></table>

## Message Object

The message of a request is represented as a JSON object with the following properties. It is included in the API when the `include` query parameter is passed with the value `messages`.

<table data-full-width="true"><thead><tr><th width="150">Name</th><th width="100">Type</th><th>Description</th></tr></thead><tbody><tr><td>text</td><td>string</td><td>Text content of the message</td></tr><tr><td>author</td><td>string</td><td>Author of the message</td></tr><tr><td>ts</td><td>string</td><td>Id of the message</td></tr><tr><td>thread_ts</td><td>string</td><td>Id of the thread where the message was sent</td></tr><tr><td>is_responder</td><td>boolean</td><td>Indicates whether the message was sent by a responder.</td></tr></tbody></table>

## Get Requests

<mark style="color:blue;">`GET`</mark> `https://api.clearfeed.app/v1/rest/requests`

Get all requests in an account

#### Query Parameters

| Name           | Type     | Description                                                                                                                                                                                                                          |
| -------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| collection\_id | Number   | Use the `collection_id` parameter to filter requests for a specific collection. Provide the collection's unique identifier to narrow down the results to that collection's requests.                                                 |
| sort\_order    | String   | The `sort_order` parameter lets you set the result sorting order. Use 'asc' for ascending and 'desc' for descending. By default, results are sorted in 'desc' order, arranging them from newest to oldest based on creation time.    |
| next\_cursor   | String   | Utilize the `next_cursor` parameter to access the next batch of results when paginating. This field will be present under `response_metadata` in the previous API response.                                                          |
| limit          | Number   | Specify the number of results per response (1-100), defaulting to 50.                                                                                                                                                                |
| filter\_by     | String   | Specify which field to use for sorting and filtering. Allowed values: `created_at`, `updated_at`. Defaults to `created_at` if not specified. When set to `updated_at`, requests are sorted and paginated by their last updated time. |
| after          | ISO Date | Employ the `after` parameter to fetch entities created after the provided ISO8601 date. The default value is None.                                                                                                                   |
| before         | ISO Date | Use the `before` parameter to retrieve entities created before the provided ISO8601 date. The default value is None.                                                                                                                 |
| include        | String   | Must be set to the exact value `messages` to include the list of associated messages (`messages` array) within the response object.                                                                                                  |
| state          | String   | Fetches Request's based on their State (`open`, `on_hold`, `in_progress`, `solved`, `pending`, `closed`)                                                                                                                             |
| channel\_id    | String   | Fetch all requests created in a specific **Request Channel**, using the channel\_id (ex :- `CABC1234`)                                                                                                                               |
| author\_emails | String   | Fetch all Requests created by an User via their **email** (ex :- `xyz@gmail.com`)                                                                                                                                                    |

**IMPORTANT POINTS :**\
\
1\) When using `filter_by=updated_at`, due to the dynamic nature of updated records, paginating through API responses may occasionally lead to repeated or missing entries if changes occur between requests. For consistent pagination results, consider using `filter_by=created_at` (default behavior).

2\) If you want to search for requests in **multiple states**, you need to add the **`state`** parameter **once for each state** in the URL.\
\
ex :- To get all requests that are in **OPEN** and **PENDING** state\
Request URL : `https://api.clearfeed.app/v1/rest/requests?state=open&state=pending`

{% tabs %}
{% tab title="200 " %}
```javascript
{
  "requests": [
    {
      "id": 1,
      "title": "Can you check this out?",
      "state": "open",
      "priority": "normal",
      "author": "UXYZ123",
      "assignee": {
        "id": "UABC123"
      },
      "assigned_team": {
        "id": 1
      },
      "tickets": [
        {
          "id": "12345",
          "type": "jira",
          "key": "CLRF-2",
          "created_at": "2023-01-01T00:00:00.000Z",
          "url": "https://clearfeed.atlassian.net/browse/CLRF-2"
        }
      ],
      "csat_survey": {},
      "channel": {
        "id": "CABC1234",
        "name": "ClearFeed-Nexova",
        "owner": "UABC1234"
      },
      "collection": {
        "id": 1,
        "name": "enterprise-customers"
      },
      "custom_field_values": {},
      "request_thread": {
        "channel_id": "CABC1234",
        "thread_ts": "1692781448.777319",
        "team_id": "T024NBB217Z",
        "url": "https://clearfeed.slack.com/archives/CABC1234/p1692781448777319?thread_ts=1692781448.777319"
      },
      "triage_thread": {
        "channel_id": "CTRIAG1235",
        "thread_ts": "1692781449.545479",
        "team_id": "T024NBB217Z",
        "url": "https://clearfeed.slack.com/archives/CTRIAG1235/p1692781449545479?thread_ts=1692781449.545479"
      },
      "sla_metrics": {
        "resolution_time": null,
        "first_response_time": null,
        "first_resolution_time": null
      },
      "messages": [
        {
          "text": "I need some help with this issue.",
          "author": "UABC1234",
          "ts": "1670011050.128179",
          "thread_ts": null,
          "is_responder": true
        }
      ],
      "created_at": "2023-01-01T00:00:00.000Z",
      "updated_at": "2023-01-01T00:00:00.000Z"
    }
  ],
  "response_metadata": {
    "next_cursor": "NjM4OQ==",
    "count": "number"
  }
}
```
{% endtab %}
{% endtabs %}
