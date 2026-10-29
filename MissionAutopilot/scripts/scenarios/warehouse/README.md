# Automated Warehouse Test Scenario — Manual Walkthrough

A self-contained scenario with 10 actions (7 observable + 3 opaque) for testing
Mission Autopilot's full ISA-88 state machine. Includes a `SIMULATION_MODE`
toggle for failure injection (Phases 2-4 — Phase 1 stubs all states with
`outputs['status'] = '0'`).

## Build + deploy

```bash
# 1. Start the dev stack (server on :3002, console on :5176)
npm run dev

# 2. In another terminal, build + deploy the scenario
npx tsx scripts/scenarios/cli.ts deploy warehouse --server http://localhost:3002
```

`deploy` builds the artifacts under `scripts/scenarios/dist/warehouse/` and uploads
each action via the per-action `.WFactionCodeX` path (recommended).

## What you should see in the console

1. Navigate to the console (default `http://localhost:5176/`).
2. Open the **Explorer** panel. Expand `AutomatedWarehouse` — all 10 actions appear.
3. Click `PickItem`. The right pane shows:
   - Input Parameters: `shelf_location`, `item_sku`, `quantity`
   - Output Parameters: `picked_quantity`, `pick_status`, **`status`** (the cross-cutting one)
   - Action Properties (none on this action)
   - Execution Settings: timeout = 3 seconds
4. The center pane shows the Code Status table — `STARTING`, `EXECUTING`, `COMPLETING`,
   `ABORTING` rows all show `active` (the stub is loaded).
5. Open the code editor for `PickItem / EXECUTING` — see `outputs['status'] = '0'`.

## Invoke an action

The Trajectory protocol requires workflow-execution context (`environment_oid`,
`workflow_instance_id`, `step_instance_id`, `step_oid`) on every invoke. For
manual smoke tests you can pass any string for the workflow/step IDs.

```bash
curl -X POST http://localhost:3002/trajectory/v1/actions/act-wh-pick-001/invoke \
  -H 'Content-Type: application/json' \
  -d '{
    "environment_oid": "env-warehouse-001",
    "workflow_instance_id": "wf-manual-test",
    "step_instance_id": "step-manual",
    "step_oid": "step-oid-manual",
    "input_parameters": [
      { "name": "shelf_location", "value": "BIN-A1" },
      { "name": "item_sku", "value": "SKU-1001" },
      { "name": "quantity", "value": "1" }
    ]
  }'
```

The response includes an `instance_id`. Poll `GET /trajectory/v1/instances/<id>` until
the state is terminal. Expected: `state: "COMPLETED"`, `outputs.status: "0"`.

## Per-action iteration loop

Edited `scripts/scenarios/warehouse/code/PickItem/EXECUTING.py`? Push just that
action without redeploying everything:

```bash
npx tsx scripts/scenarios/cli.ts build warehouse  # rebuild artifacts
npx tsx scripts/scenarios/cli.ts upload-action \
  scripts/scenarios/dist/warehouse/actions/PickItem.WFactionCodeX
```

The server upserts the action (idempotent) and saves+activates the new code as a
new version.

## Phase 1 vs later phases

Phase 1 (this scaffold) ships stubs that always set `status = '0'`. Phases 2-4
replace these with simulation-aware Python that reads
`props["SIMULATION_MODE"]["Value"]` and injects ~10% failures when set to `true`.
