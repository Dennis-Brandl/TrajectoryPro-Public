# External scheduling interface

This is the REST interface a higher-level scheduling system, such as an ERP, uses to send schedules to Trajectory Pro and start them. Mission Commander serves it at:

```
/api/external/v1
```

Every path below starts from there. Requests and responses are JSON.

## Getting a token

1. Sign in to Commander as an Administrator.
2. Open **Settings** and find **API clients**.
3. Create a client. Give it a name, the scopes it needs, and the work centers it may use. The name appears in the audit log and on the schedules it sends ("Managed by ERP Scheduler").
4. Copy the token. It is shown once and cannot be read again. If you lose it, revoke the client and create a new one.

The three scopes:

| Scope | Allows |
|---|---|
| `schedules:read` | Every `GET` |
| `schedules:write` | Send or delete a Master Schedule |
| `schedules:control` | Enable, Run Once, Pause, Resume, Cancel, dismiss failures, and Disable an item |

A `PUT` with `?enable=true` needs both `schedules:write` and `schedules:control`. Without both, it answers 403 and saves nothing.

## Sending the token

Send the token in this header on every request:

```
Authorization: Bearer mcx_...
```

A signed-in browser session does not count, and neither does a token in the URL.

## Connection and network

- **Use TLS in production.** The token is a password. Plain HTTP works where a deployment already allows it, such as a closed test network, but anything that can read the traffic can use the token.
- **Behind a proxy, set `TRUSTED_PROXIES`** on Commander to the proxy's address. Without it, Commander sees every caller as coming from the proxy.
- **Failed tokens are limited per IP address.** After 10 failed attempts in one minute, that address gets `429` with a `Retry-After` header until the minute has passed. This also blocks valid tokens from that address. So one client with a bad token can block every other client that shares its IP, such as several systems behind one proxy when `TRUSTED_PROXIES` is not set. A request with no `Authorization` header does not count as a failure.

## Errors

Errors have this shape. `details` is present only when there is a list of problems.

```json
{ "error": { "code": "ENABLE_INVALID", "message": "...", "details": [] } }
```

| Status | Code | Meaning |
|---|---|---|
| 400 | `MASTER_SCHEDULE_INVALID` | The schedule body is not valid, or has a field it should not. `details` lists the problems, at most 20. Nothing is saved |
| 400 | `RESUME_CHOICE_REQUIRED` | Starts were missed, so Resume needs `missed`; or the count differs from your `expectedMissedCount` |
| 400 | `validation` | A query or another body is not in the expected form. Unknown fields are refused |
| 401 | `unauthorized` | The token is missing, wrong, revoked or expired |
| 403 | `forbidden` | The client does not have the scope |
| 404 | `not_found` | See below |
| 409 | `RUNTIME_ACTIVE` | The Master already has a Runtime Schedule running. See [Re-sending](#re-sending-a-schedule) |
| 409 | `RUNTIME_SCHEDULE_STATE` | That control does not apply in the current state, such as Pause on a cancelled schedule |
| 409 | `MASTER_SCHEDULE_NAME_CONFLICT` | Another Master Schedule in this work center has that name |
| 413 | `too_large` | The body is over 1 MB |
| 422 | `ENABLE_INVALID` | The schedule cannot be enabled. `details` lists every problem. The Master stays saved |
| 429 | `rate_limited` | Too many failed tokens from this IP address |

A work center outside the client's list, an id that does not exist, an id from another work center, and a badly formed id all get the same answer, so nothing can be learned by trying:

```json
{ "error": { "code": "not_found", "message": "Not found" } }
```

## Dates and times

- Each send that changes a Master gives it the next version number (`revision`), and records **Sent through the REST interface** with your client's name in its change history, which Commander's Export PDF includes.
- `recurrence` may be `{ "type": "manual" }`: a schedule with no start times, started only by Run Once. Enabling one is refused with `MANUAL_ONLY`.
- A datetime you send, such as `recurrence.at` or `recurrence.startAt`, has no zone: `2026-11-10T06:00`. It is read in the work center's zone. A datetime with a zone or seconds is refused.
- A datetime you receive is a UTC instant to the second, `2026-11-10T12:00:00Z`. The response gives the `timeZone` with it.

`GET /work-centers` gives each work center's zone.

## Endpoints

`{wc}` is a work center id. `{key}` is your own reference for the schedule, up to 200 characters, with no control characters. Encode it for use in a URL.

| Method and path | Scope | Success |
|---|---|---|
| `GET /work-centers` | read | `200` |
| `GET /work-centers/{wc}/workflows` | read | `200` |
| `GET /work-centers/{wc}/master-schedules` | read | `200` |
| `PUT /work-centers/{wc}/master-schedules/by-key/{key}` | write, and control with `?enable=true` | `201` or `200` |
| `GET /work-centers/{wc}/master-schedules/{id}` | read | `200` |
| `DELETE /work-centers/{wc}/master-schedules/{id}` | write | `204` |
| `POST /work-centers/{wc}/master-schedules/{id}/enable` | control | `201` |
| `POST /work-centers/{wc}/master-schedules/{id}/run-once` | control | `201`, or `200` for a repeated `requestId` |
| `GET /work-centers/{wc}/runtime-schedules?status=` | read | `200` |
| `GET /work-centers/{wc}/runtime-schedules/{id}` | read | `200` |
| `GET /work-centers/{wc}/runtime-schedules/{id}/occurrences` | read | `200` |
| `POST /work-centers/{wc}/runtime-schedules/{id}/pause` | control | `204` |
| `POST /work-centers/{wc}/runtime-schedules/{id}/resume` | control | `202` |
| `POST /work-centers/{wc}/runtime-schedules/{id}/acknowledge` | control | `200` |
| `POST /work-centers/{wc}/runtime-schedules/{id}/cancel` | control | `204` |
| `PUT /work-centers/{wc}/runtime-schedules/{id}/items/{itemId}/disabled` | control | `204` |

### Work centers

`GET /work-centers` lists only the work centers this client may use:

```json
[{ "id": "3f2c...", "name": "Line 1", "timeZone": "America/Chicago" }]
```

### Workflows

`GET /work-centers/{wc}/workflows` shows what a schedule can name:

```json
[{
  "name": "Blend Batch", "version": "1.0.0", "state": "Effective",
  "startingParameters": [
    { "id": "BatchId", "description": null, "defaultValue": "", "valueType": "literal" }
  ],
  "outputs": ["Yield"]
}]
```

### Sending a Master Schedule

`PUT .../master-schedules/by-key/{key}` creates or replaces the Master Schedule with that key. See the [example](#example-an-erp-sends-tomorrows-batch) for the body.

| Query | Meaning |
|---|---|
| `enable=true` | Also enable it |
| `replaceActive=true` | With `enable=true`: cancel a running Runtime Schedule with different content and enable this one |

Each may appear once. A repeated or unknown query field is refused with `400`, and any `true` needs the `schedules:control` scope.

The body is always saved first. An identical body changes nothing and keeps the `revision`.

The body takes only the fields in the example: `name`, `description`, `recurrence` and `items`, and within each item `workflow`, `triggerOn`, `params` and `chain`. Any other field, at any level, is refused with one `details` row naming it, such as `{ "path": "items[0].parms", "code": "UNKNOWN_FIELD" }`, and nothing is saved. A misspelling therefore cannot pass as a change that did nothing. Inside a value source (an entry of `params`), an unknown key gives `VALUE_SOURCE_INVALID` instead, with the key named in the message.

**Do not send a Master back as you read it.** `GET` adds fields of its own, such as `id`, `revision`, `source`, `externalKey`, `recurrenceText`, `updatedAt`, `managedBy` and `timeZone`, and a `PUT` carrying them is refused. If you read a Master to change it, send only the fields above.

| Result | Status | Body |
|---|---|---|
| New, without `enable` | `201` | `masterSchedule` |
| Existing, without `enable` | `200` | `masterSchedule` |
| With `enable` | See [Re-sending](#re-sending-a-schedule) | `masterSchedule`, `runtimeSchedule` |

`GET` and `DELETE` use the `id` in `masterSchedule.id`. Deleting a Master leaves any Runtime Schedule running.

`POST .../enable` starts a Master that has no Runtime Schedule running, and answers `201` with the same body as a send. It is also how to start again one that was cancelled.

### Reading a Runtime Schedule

`GET .../runtime-schedules/{id}` gives its state, next start, the tree of items with their ids and disabled flags, and `missedCount` and `missedMore`, which say how many starts were missed.

### Occurrences

`GET .../runtime-schedules/{id}/occurrences?limit=&offset=` gives the newest first. `limit` is 1 to 100 and defaults to 25; a larger one is refused with `400`.

```json
{
  "total": 12, "limit": 25, "offset": 0, "timeZone": "America/Chicago",
  "rows": [{
    "id": "...", "number": 12, "scheduledAt": "2026-11-10T12:00:00Z", "firedAt": "2026-11-10T12:00:02Z", "origin": "on_time",
    "runs": [{
      "id": "...", "itemId": "...", "workflowName": "Blend Batch", "parentRunId": null,
      "runtimeLabel": "RW-50", "status": "finished", "ending": "completed", "finishedAt": "2026-11-10T13:30:00Z",
      "detail": null, "acknowledgedAt": null, "outputs": { "Yield": "97" }
    }]
  }]
}
```

`ending` is `completed`, `stopped`, `aborted` or `errored`, and is `null` until the run has ended. `outputs` is present only on a run that has ended.

`status` is one of:

| Status | Meaning |
|---|---|
| `started` | Running |
| `finished` | Ended; see `ending` |
| `not_triggered` | Its parent ended in a way this item does not react to |
| `skipped_disabled` | The item was disabled |
| `held` | Waiting for Resume |
| `start_requested` | Will start shortly |
| `cancelled` | The schedule was cancelled before this started |
| `skipped_on_resume` | Declined at Resume |
| `failed_to_start` | Could not start; see `detail`. Needs attention |
| `lost` | The run disappeared and left no history; see `detail`. Needs attention |

### Run Once

`POST .../master-schedules/{id}/run-once` starts a Master Schedule one time, whatever its pattern. This is how another system, such as an alarm panel, starts an incident response written as a Manual schedule. Find the Master's `id` once with `GET .../master-schedules`. It stays the same when the Master is edited or sent again, and changes only if the Master is deleted and made anew.

Every field is optional:

```json
{ "requestId": "alarm-2026-11-09-0042", "at": "2026-11-10T06:00" }
```

| Field | Meaning |
|---|---|
| `requestId` | Your id for this request, 1 to 200 characters. **Send one if you may retry.** |
| `at` | When to start, in the work center's time zone. Leave it out to start now. A time already past is refused with `422 ENABLE_INVALID` and the code `RUN_ONCE_TIME_PASSED`. |

Each new request makes its own Runtime Schedule, and it can overlap anything, including another Run Once of the same Master. So a retry without a `requestId` starts the work a second time. With one, sending the same `requestId` to the same Master again starts nothing and answers `200` with the first Runtime Schedule and `"repeated": true`, even long after that run has ended. Use a new `requestId` for each new event.

The answer has the same body as a send, plus `repeated`:

```json
{
  "masterSchedule": { "id": "...", "externalKey": null, "revision": 1, "source": "commander" },
  "runtimeSchedule": { "id": "...", "label": "RS-7", "status": "active", "nextFireAt": "2026-11-09T15:00:12Z", "timeZone": "America/Chicago", "warnings": [] },
  "repeated": false
}
```

The answer means the request is recorded. The engine starts the workflows on its next tick, normally within about five seconds, so read the Runtime Schedule's `occurrences` to confirm they started. If the engine is down for longer than the late tolerance, 15 minutes by default, the run does not start by itself: it shows **Needs attention** and waits for a Resume. A workflow it cannot start is refused with `422 ENABLE_INVALID` and every problem listed, and nothing is created.

A Run Once does not count as a send's running schedule, so re-sending by key and `?enable=true` behave as if it were not there.

### Removed schedules

A person can remove a Finished or Cancelled Runtime Schedule from the list in Commander or XO. `GET .../runtime-schedules` then leaves it out, but reading it by `id` still works, and it still counts when you re-send by key or repeat a `requestId`.

### Controls

| Control | Body |
|---|---|
| `pause` | None |
| `resume` | `{ "missed": "all" \| "latest" \| "skip", "heldChains": "start" \| "skip", "expectedMissedCount": 3 }`, all optional |
| `cancel` | `{ "reason": "Plan changed" }`, required |
| `acknowledge` | `{ "runIds": "all" }`, or a list of run ids |
| `items/{itemId}/disabled` | `{ "disabled": true }` or `{ "disabled": false }` |

**Resume:**

- `missed` is required when any starts were missed, or you get `400 RESUME_CHOICE_REQUIRED`. It also resolves the missed starts left by an outage, on a schedule that is not paused.
- `heldChains` defaults to `start`.
- `expectedMissedCount` is optional. Pass the `missedCount` you read and, if the number has changed since, nothing happens and you get the same `400`. A paused schedule keeps missing starts, so this keeps you from deciding on an old number.
- The answer is `202`, because the engine starts the runs on its next tick:

```json
{ "startedSlots": 1, "startedChains": 0, "skippedSlots": 2, "skippedChains": 0, "missedMore": false }
```

- `missedMore: true` means more than 500 starts were missed, so counting stopped and the skipped count is a lower limit. At that point `"missed": "all"` is refused; choose `latest` or `skip`.

**Acknowledge** dismisses failed and lost runs from Needs attention, and answers with the count: `{ "dismissed": 1 }`.

**Disable** stops an item starting from now on. It does not touch runs already going, and turning it back on does not start anything it skipped.

## Re-sending a schedule

Re-sending replaces the Master Schedule. People can also edit it in Commander, so the last write wins: a re-send overwrites their edits, and their save stands until your next send.

With `?enable=true`, the answer compares what you sent with what your key's latest Runtime Schedule froze when it was enabled. "Latest" means the most recent one with that key in the work center, even if its Master has since been deleted. "Same content" means the name, description, recurrence and items all match. The answer does not depend on how many times you have tried, or on edits made in between.

| The key's latest Runtime Schedule is | Result |
|---|---|
| None | Enable: `201` |
| Live, same content | `200` with that Runtime Schedule. A retry is safe |
| Live, different content | `409 RUNTIME_ACTIVE`, every time, until you add `&replaceActive=true`. That cancels the old one with the reason "Replaced by re-send" and enables the new one, together: `201` |
| Cancelled or finished, same content | `200` with that Runtime Schedule and `"enabled": false`. **It is not started again,** even if the Master was edited or deleted and recreated, so a routine re-send cannot revive a schedule someone cancelled on purpose. To start it, use `POST .../enable` |
| Cancelled or finished, different content | Enable: `201`. The content changed, so this is new work |

If you delete a Master while its Runtime Schedule runs, that Runtime Schedule carries on, and a later send with the same key is still compared with it, so there is never a second one running for a key. `POST .../enable` on the recreated Master answers `409 RUNTIME_ACTIVE` until it ends.

`replaceActive` has to be asked for, so that a higher-level system cannot cancel running plans by mistake.

With `replaceActive`, the answer tells you what was replaced:

```json
{
  "masterSchedule": { "id": "a81...", "externalKey": "PO-88123", "revision": 2, "source": "api" },
  "runtimeSchedule": {
    "id": "d55...", "label": "RS-32", "status": "active",
    "nextFireAt": "2026-11-10T14:00:00Z", "timeZone": "America/Chicago", "warnings": []
  },
  "replacedRuntimeSchedule": {
    "id": "c44...", "label": "RS-31", "status": "cancelled", "runsStillGoing": 1, "chainsCancelled": 0
  }
}
```

If the old one had already started, `runsStillGoing` counts the runs still going. They carry on, but their chained workflows will not start. `chainsCancelled` counts the chained items that were waiting to start and now will not.

If the new one cannot be enabled, you get `422`, the old one is not cancelled, and the new body stays saved.

## Example: an ERP sends tomorrow's batch

```http
PUT /api/external/v1/work-centers/3f2c.../master-schedules/by-key/PO-88123?enable=true
Authorization: Bearer mcx_...
Content-Type: application/json

{
  "name": "PO-88123 Blend",
  "recurrence": { "type": "once", "at": "2026-11-10T06:00" },
  "items": [
    {
      "workflow": { "name": "Blend Batch" },
      "params": { "BatchId": { "value": "B-88123" }, "Size": { "value": "2500" } },
      "chain": [
        {
          "workflow": { "name": "Move Material" },
          "triggerOn": ["completed"],
          "params": { "BatchId": { "from": "trigger.input", "name": "BatchId" } }
        },
        {
          "workflow": { "name": "Lab Test" },
          "triggerOn": ["completed"],
          "params": {
            "BatchId": { "from": "trigger.input", "name": "BatchId" },
            "Yield":   { "from": "trigger.output", "name": "Yield", "fallback": "unknown" }
          },
          "chain": [
            {
              "workflow": { "name": "Release Batch", "version": "2.0" },
              "triggerOn": ["completed"],
              "params": { "LabResult": { "from": "trigger.output", "name": "Result" } }
            }
          ]
        },
        {
          "workflow": { "name": "Clean Equipment" },
          "triggerOn": ["completed", "stopped", "aborted", "errored"],
          "params": { "Reason": { "value": "Post-batch clean" } }
        }
      ]
    }
  ]
}
```

```http
HTTP/1.1 201 Created

{
  "masterSchedule": { "id": "a81...", "externalKey": "PO-88123", "revision": 1, "source": "api" },
  "runtimeSchedule": {
    "id": "c44...", "label": "RS-31", "status": "active",
    "nextFireAt": "2026-11-10T12:00:00Z", "timeZone": "America/Chicago",
    "warnings": []
  }
}
```

`warnings` names anything that does not stop the schedule but that you should know about, such as a workflow that is not Effective.

A failed Enable returns every problem. The Master stays saved, so you can correct it and send it again. This example is illustrative: it shows the shape, and these two problems would not come from the body above as written:

```http
HTTP/1.1 422 Unprocessable Entity

{
  "error": {
    "code": "ENABLE_INVALID",
    "message": "2 problems prevent this schedule from being enabled",
    "details": [
      { "path": "items[0].chain[1].workflow", "code": "WORKFLOW_NOT_FOUND",
        "message": "Master Workflow \"Lab Test\" not found in that work center" },
      { "path": "items[0].chain[0].params.BatchId", "code": "UNKNOWN_PARENT_PARAMETER",
        "message": "\"Blend Batch\" has no starting parameter named \"BatchId\"" }
    ]
  }
}
```

## Polling

The interface does not call you back, so read the results when you need them.

- To follow a schedule, read `GET .../runtime-schedules/{id}` and `.../occurrences` about once a minute. Once every 15 seconds is the most that is useful, because the engine checks for due starts only every few seconds and workflows take far longer.
- Read only the first page of occurrences unless you are catching up. They come newest first, and `total` tells you if anything new arrived.
- A schedule needs attention when `needsAttention` shows `failed` or `lost` above 0, or `missedWindow` is true. Check for it when you poll.
- Stop polling a Runtime Schedule once its `status` is `cancelled` or `finished` and its runs have ended. Runs can go on after the schedule ends.
- With the scheduler off or an engine not yet updated, ended scheduled runs stay unprocessed, so their History records cannot be deleted or purged until the scheduler runs.
- On a network failure, it is safe to send the same `PUT` again. On `429`, wait for the time in `Retry-After`.
