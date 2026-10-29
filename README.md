# Trajectory Pro Mission Control

Trajectory Pro Mission Control is a suite of applications for designing workflows, running
them in work centers, and executing the actions they call. Workflow specifications are
authored in Mission Designer and exported as packages; Mission Commander loads them into work
centers and creates runtime workflows; Mission Engine advances each runtime workflow step by
step, serving operator steps to Mission Pilot and dispatching environment actions to Mission
Autopilot.

This repository holds every application as a subdirectory, plus the root Docker Compose file
that runs the fleet.

## Applications

| Application | Directory | Purpose |
| --- | --- | --- |
| Mission Designer | `MissionDesigner/` | Visual workflow specification editor: workflows, environments, actions, forms, and the packages that carry them |
| Mission Commander | `MissionCommander/` | Work centers, users and roles, loaded packages, and the creation and control of runtime workflows |
| Mission Engine | `MissionEngine/` | Executes runtime workflows against the shared database and dispatches environment actions; its image also serves Mission Pilot |
| Mission Pilot | `MissionPilot/` | Operator task inbox, installable as a PWA: claim, submit, and release workflow steps |
| Mission Autopilot | `MissionAutopilot/` | Action server and console: hosts the environment actions that workflows call, with handlers written in Python |
| Mission Autopilot Tester | `MissionAutopilotTester/` | Browser harness for exercising any action server's REST API directly |
| Mission Broker | `MissionBroker/` | Action server for the Distributed Workflow actions: lets a running workflow create, start, control and wait for other runtime workflows (see the [guide](docs/DISTRIBUTED_WORKFLOW_LIBRARY.md)) |
| Mission FormKit | `MissionFormKit/` | Shared form document schema, tokens, and renderer used by Mission Designer and Mission Pilot |
| Mission Control DB | `mission-control-db/` | Shared Postgres schema, migrations, and data access used by Mission Commander and Mission Engine |

## Cloning

```sh
git clone https://github.com/Dennis-Brandl/TrajectoryPro-Public.git
```

## Running

[`DOCKER-README.md`](DOCKER-README.md) runs the whole suite with Docker, or each application
on its own, and notes how to run each one from source.

## Guides

- [The Distributed Workflow Library](docs/DISTRIBUTED_WORKFLOW_LIBRARY.md)
  ([PDF](docs/DISTRIBUTED_WORKFLOW_LIBRARY.pdf)) — how a workflow creates, starts and controls
  other runtime workflows through Mission Broker, with sample SCRIPT steps that combine and split
  Value Property lists.

## License

[Apache 2.0](LICENSE) &copy; 2026 Dennis L. Brandl.
