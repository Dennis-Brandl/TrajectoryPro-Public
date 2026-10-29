# Industrial Kitchen Test Scenario — Manual Walkthrough

A self-contained scenario with 10 actions (4 observable + 6 opaque) modelling a
commercial kitchen's single-order lifecycle: ticket → prep → cook → plate → serve.
Includes a `SIMULATION_MODE` toggle for failure injection (10% per execution).

## Build + deploy

```bash
# 1. Start the dev stack (server on :3002, console on :5176)
npm run dev

# 2. In another terminal, build + deploy the scenario
npx tsx scripts/scenarios/cli.ts deploy kitchen --server http://localhost:3002
```

`deploy` builds the artifacts under `scripts/scenarios/dist/kitchen/` and uploads
each action via the per-action `.WFactionCodeX` path.

## What you should see in the console

1. Navigate to `http://localhost:5176/`.
2. Open **Explorer** → expand `IndustrialKitchen` — all 10 actions appear.
3. Click `SearProtein`. The right pane shows:
   - Input Parameters: `protein`, `side`, `target_internal_c`
   - Output Parameters: `internal_temp_c`, `sear_score`, `status`
   - Action Properties (none on this action)
   - Execution Settings: timeout = 3 seconds
4. The center pane shows the Code Status table — `STARTING`, `EXECUTING`,
   `COMPLETING`, `ABORTING` all show `active`.

## Invoke an action

```bash
curl -X POST http://localhost:3002/trajectory/v1/actions/act-kt-sear-001/invoke \
  -H 'Content-Type: application/json' \
  -d '{
    "environment_oid": "env-kitchen-001",
    "workflow_instance_id": "wf-manual-test",
    "step_instance_id": "step-manual",
    "step_oid": "step-oid-manual",
    "input_parameters": [
      { "name": "protein", "value": "ribeye" },
      { "name": "side", "value": "first" },
      { "name": "target_internal_c", "value": "54" }
    ]
  }'
```

Expected: `state: "COMPLETED"`, `outputs.status: "0"`, `outputs.internal_temp_c: "54"`,
`outputs.sear_score: "good"`.

## Failure-mode notes

When `SIMULATION_MODE` is set to `true` (via env property on the environment),
each action has a ~10% chance of injecting a failure. Watch for:

- Opaque actions (e.g., `PrintKitchenTicket`) on failure: ABORTED instance shows
  `outputs.status='1'` AND the error message (`'PrintKitchenTicket: simulated
random abort (printer offline)'`). The `status` being preserved here depends
  on commit `e2b3eef` (sandbox outputs-on-raise fix) shipped 2026-05-17.
- Observable actions on failure: ABORTED instance shows `outputs.status='1'` or
  `'2'`. Status was set during STARTING (before EXECUTING raised), so it's
  visible regardless of the fix.

## Per-action iteration loop

Edited `scripts/scenarios/kitchen/code/SimmerSauce/EXECUTING.py`?

```bash
npx tsx scripts/scenarios/cli.ts build kitchen
npx tsx scripts/scenarios/cli.ts upload-action \
  scripts/scenarios/dist/kitchen/actions/SimmerSauce.WFactionCodeX
```

Server upserts the action (idempotent) and saves+activates the new code version.

## Action inventory

| #   | Action               | Visibility | Notable                                          |
| --- | -------------------- | ---------- | ------------------------------------------------ |
| 1   | `SearProtein`        | observable | 3-in / 3-out, dice roll on STARTING              |
| 2   | `SauteSides`         | observable | 3-in / 2-out                                     |
| 3   | `SimmerSauce`        | observable | long-running (~2s) — best for pause/resume demos |
| 4   | `PlateOrder`         | observable | sets `plated_at` ISO timestamp                   |
| 5   | `PrintKitchenTicket` | opaque     | status-only output                               |
| 6   | `PrepStation`        | opaque     | 3-in / 3-out — opaque ≠ status-only              |
| 7   | `PreheatGrill`       | opaque     | status-only                                      |
| 8   | `GarnishPlate`       | opaque     | minimal action (2-in / 1-out)                    |
| 9   | `ExpoCheck`          | opaque     | single-input                                     |
| 10  | `LogService`         | opaque     | status-only                                      |
