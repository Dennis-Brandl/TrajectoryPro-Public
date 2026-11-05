# Run Trajectory Pro Locally with Node.js

Run the suite from source with Node.js and your own Postgres, without Docker. Part 1 runs everything on one computer. Part 2 makes the apps available to other devices on your local network.

To run with Docker instead, see [`DOCKER-README.md`](DOCKER-README.md).

> **Docker on the same computer:** stop the Docker stacks first. They use some of the same ports, and the Docker setup reads the same `MissionDesigner/.env` and `MissionAutopilot/.env` files.

## What you need

- **Node.js 22 or later**
- **PostgreSQL 16** with the `psql` client
- **Python 3** on your PATH as `python` (Mission Autopilot runs action code with it)
- The full repository, so the apps sit side by side (see **Cloning** in [`README.md`](README.md))

## Ports

| App | Address | Purpose |
| --- | --- | --- |
| Mission Designer | UI `:5174`, API `:3001` | Create workflows |
| Mission Commander | UI `:5273`, API `:3005` | Work centers, users, runtime workflows |
| Mission Engine + Mission Pilot | `:3006` | Runs workflows and serves the Pilot UI |
| Mission Autopilot | Console `:5176`, server `:3002` | Hosts actions |
| Mission Autopilot Tester | UI `:5180` | Tests an action server directly |
| Mission Broker | `:3007` | Distributed Workflow actions |

Commander uses `:3005` because its default API port, `:3002`, clashes with Mission Autopilot. The Autopilot console always looks for its server on `:3002`.

## Part 1: Run on one computer

### 1. Create the databases

Run each command separately, because `CREATE DATABASE` can't share a command with other statements. Choose your own password in place of `choose-a-password`.

```bash
psql -U postgres -c "CREATE ROLE mission LOGIN PASSWORD 'choose-a-password'"
psql -U postgres -c "CREATE DATABASE mission_control OWNER mission"
psql -U postgres -c "CREATE DATABASE mission_designer OWNER mission"
psql -U postgres -c "CREATE DATABASE mission_autopilot OWNER mission"
```

The `mission` role doesn't need to be a superuser.

### 2. Generate the secrets

Run this six times and keep each value. The steps below refer to them by the names in this table:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

| Name | Used by |
| --- | --- |
| `<COMMANDER_SECRET>` | Mission Commander sign-in |
| `<ENGINE_SECRET>` | Mission Pilot sign-in |
| `<INTERNAL_TOKEN>` | Commander's calls to the Engine |
| `<ACTIONS_KEY>` | Engine calls to Autopilot, and the Autopilot console sign-in |
| `<BROKER_TOKEN>` | Engine calls to Mission Broker |
| `<DESIGNER_SECRET>` | Mission Designer sign-in |

### 3. Create the `.env` files

These files are ignored by git. If a file already exists, add these lines to it.

**`MissionDesigner/.env`**

```ini
DATABASE_URL=postgres://mission:choose-a-password@localhost:5432/mission_designer
PORT=3001
BETTER_AUTH_SECRET=<DESIGNER_SECRET>
KEEP_SESSIONS_ON_RESTART=true
```

**`MissionCommander/.env`**

```ini
DATABASE_URL=postgres://mission:choose-a-password@localhost:5432/mission_control
PORT=3005
BASE_URL=http://localhost:5273
BETTER_AUTH_SECRET=<COMMANDER_SECRET>
ENGINE_BASE_URL=http://127.0.0.1:3006
ENGINE_INTERNAL_TOKEN=<INTERNAL_TOKEN>
```

**`MissionEngine/.env`**

```ini
DATABASE_URL=postgres://mission:choose-a-password@localhost:5432/mission_control
ENGINE_PORT=3006
BETTER_AUTH_SECRET=<ENGINE_SECRET>
ENGINE_INTERNAL_TOKEN=<INTERNAL_TOKEN>
MISSION_ACTIONS_URL=http://127.0.0.1:3002
ACTIONS_API_KEY=<ACTIONS_KEY>
MISSION_BROKER_URL=http://127.0.0.1:3007
MISSION_BROKER_TOKEN=<BROKER_TOKEN>
ACTION_SERVER_ALLOWLIST=http://127.0.0.1:3002,http://127.0.0.1:3007
```

**`MissionAutopilot/.env`**

```ini
DATABASE_URL=postgres://mission:choose-a-password@localhost:5432/mission_autopilot
PORT=3002
ACTIONS_API_KEY=<ACTIONS_KEY>
```

**`MissionBroker/.env`**

```ini
DATABASE_URL=postgres://mission:choose-a-password@localhost:5432/mission_control
BROKER_PORT=3007
MISSION_BROKER_TOKEN=<BROKER_TOKEN>
```

### 4. Install and set up

Run these from the repository root. Install `MissionFormKit` and `MissionDesigner` first, because other apps build from them.

```bash
for app in MissionFormKit MissionDesigner mission-control-db MissionCommander MissionEngine MissionPilot MissionAutopilot MissionAutopilotTester MissionBroker; do
  (cd "$app" && npm install)
done

# Create the Commander and Engine tables
cd mission-control-db
DATABASE_URL=postgres://mission:choose-a-password@localhost:5432/mission_control npm run db:migrate
cd ..

# Build Mission Pilot into the Engine
cd MissionPilot && npm run build && cd ..
```

In PowerShell, install each app with `foreach ($app in 'MissionFormKit','MissionDesigner','mission-control-db','MissionCommander','MissionEngine','MissionPilot','MissionAutopilot','MissionAutopilotTester','MissionBroker') { Push-Location $app; npm install; Pop-Location }`, and set the database address with `$env:DATABASE_URL = "postgres://..."` before `npm run db:migrate`.

Designer and Autopilot create their own tables when they start. Commander doesn't, so run `npm run db:migrate` again each time you update the code.

### 5. Start the apps

Open a separate terminal for each command, starting from the repository root. The apps don't load `.env` by themselves, so `--env-file=.env` is what passes your settings to them.

```bash
# Mission Commander API
cd MissionCommander && npx tsx watch --env-file=.env src/server/index.ts

# Mission Commander UI
cd MissionCommander && API_PORT=3005 npm run dev
# PowerShell: cd MissionCommander; $env:API_PORT = 3005; npm run dev

# Mission Engine and Mission Pilot
cd MissionEngine && npx tsx --env-file=.env src/index.ts

# Mission Designer API
cd MissionDesigner && node --env-file=.env --watch --import tsx src/server/index.ts

# Mission Designer UI
cd MissionDesigner && npm run dev -- --port 5174

# Mission Autopilot server and console
cd MissionAutopilot && npm run dev

# Mission Autopilot Tester
cd MissionAutopilotTester && npm run dev -- --port 5180

# Mission Broker
cd MissionBroker && npx tsx --env-file=.env src/index.ts
```

To change Mission Pilot's code with live reload, run `cd MissionPilot && npm run dev` and open `http://localhost:5275`. Otherwise, run `npm run build` in `MissionPilot` after each change.

### 6. Sign in

| App | Open | First sign-in |
| --- | --- | --- |
| Mission Commander | `http://localhost:5273` | Create an account. The first account becomes the administrator. |
| Mission Designer | `http://localhost:5174` | Follow the first-run setup. |
| Mission Pilot | `http://127.0.0.1:3006` | Use a Mission Commander account. |
| Autopilot console | `http://localhost:5176` | Enter `<ACTIONS_KEY>`. |
| Autopilot Tester | `http://localhost:5180` | Add a connection to `http://localhost:3002`. |

`localhost` and `127.0.0.1` keep separate sign-ins in the browser, so use the same one each time.

To run actions, bind each work center's environments on the **Env Specs** tab in Mission Commander:

- Use `http://127.0.0.1:3002` for Mission Autopilot.
- Use `http://127.0.0.1:3007` for the *Distributed Workflow Management* environment on Mission Broker.

These two addresses are added to the allowed list in Commander's **Settings** the first time the Engine starts. Use exactly these addresses, because the Engine only sends its key or token to the address in its `.env`.

## Part 2: Make the apps available on your local network

The apps still run on one host computer. Other devices connect to it by its IP address.

> **Security:** this setup uses plain `http://` and is meant for a trusted network only. Passwords and session cookies aren't encrypted. Don't expose these ports to the internet.

Mission Pilot works in the browser from other devices, but it can't be installed as a PWA without HTTPS.

### 1. Find the host's IP address

```bash
ipconfig        # Windows: look for IPv4 Address on your Wi-Fi or Ethernet adapter
ip -4 addr      # Linux
```

These steps use `192.168.1.50` as the example, so replace it with your address. Reserve the address in your router's DHCP settings. If it changes, you'll need to update every setting below.

### 2. Update the `.env` files

Add or change these lines. Each `ALLOWED_ORIGINS` value must match the browser's address exactly, including the port and with no trailing slash.

**`MissionCommander/.env`**

```ini
BASE_URL=http://192.168.1.50:5273
ALLOWED_ORIGINS=http://192.168.1.50:5273
```

**`MissionEngine/.env`**

```ini
ENGINE_BASE_URL=http://192.168.1.50:3006
ALLOWED_ORIGINS=http://192.168.1.50:3006
```

**`MissionDesigner/.env`** needs both addresses, because setting this variable stops Designer trusting `localhost` automatically:

```ini
ALLOWED_ORIGINS=http://192.168.1.50:5174,http://localhost:5174
```

**`MissionAutopilot/.env`**

```ini
ACTIONS_ALLOWED_ORIGINS=http://192.168.1.50:5176
```

Don't change `ENGINE_BASE_URL=http://127.0.0.1:3006` in `MissionCommander/.env`, because Commander and the Engine are on the same computer.

### 3. Start the UIs with `--host`

`--host` makes a UI reachable from other devices. Start the APIs, Engine and Broker with the Part 1 commands, then use these commands for the UIs:

```bash
# Mission Commander UI
cd MissionCommander && API_PORT=3005 npm run dev -- --host
# PowerShell: cd MissionCommander; $env:API_PORT = 3005; npm run dev -- --host

# Mission Designer UI
cd MissionDesigner && npm run dev -- --host --port 5174

# Mission Autopilot server (replaces npm run dev)
cd MissionAutopilot && npm run dev:server

# Mission Autopilot console (replaces npm run dev)
cd MissionAutopilot/apps/console && npm run dev -- --host

# Mission Autopilot Tester UI
cd MissionAutopilotTester && npm run dev -- --host --port 5180
```

Each UI prints a `Network:` line with its address. If the computer has virtual adapters, you may see several, so use the address from step 1.

### 4. Open the firewall

Allow only the ports that other devices need. On Windows, run this in an administrator PowerShell window:

```powershell
New-NetFirewallRule -DisplayName "Trajectory Pro LAN" -Direction Inbound -Protocol TCP -LocalPort 5273,3006,5176,5174,5180 -Action Allow -Profile Private
```

Your network must be set to **Private** in Windows settings. On Linux with `ufw`, run `sudo ufw allow from 192.168.1.0/24 to any port 5273,3006,5176,5174,5180 proto tcp`.

**Keep the other ports closed.** The Commander (`:3005`), Designer (`:3001`) and Broker (`:3007`) APIs listen on every network interface when run from source, so the firewall is what keeps them private. If Windows asks whether to allow Node.js through the firewall, choose **Cancel** or leave the boxes unticked, because allowing it would open all of these ports.

### 5. Connect from another device

| App | Address |
| --- | --- |
| Mission Commander | `http://192.168.1.50:5273` |
| Mission Pilot | `http://192.168.1.50:3006` |
| Autopilot console | `http://192.168.1.50:5176` |
| Mission Designer | `http://192.168.1.50:5174` |
| Autopilot Tester | `http://192.168.1.50:5180` |

In Mission Commander, keep using `http://127.0.0.1:3002` and `http://127.0.0.1:3007` for action servers. The Engine makes those calls from the host computer, so other devices don't need to reach them.

Opening Mission Pilot on the host computer at `127.0.0.1:3006` now redirects to the IP address. That address keeps a separate sign-in, so you'll sign in once more.

### Optional: use the Tester from other devices

Do this if you want to run the Autopilot Tester on another device, or if other software has to call Mission Autopilot directly. The Tester runs in the browser and calls the action server itself, but the server only accepts connections from the host computer by default.

Add these lines to `MissionAutopilot/.env`, replacing the earlier `ACTIONS_ALLOWED_ORIGINS` line, then open port `3002` in the firewall:

```ini
HOST=0.0.0.0
ACTIONS_ALLOWED_HOSTS=192.168.1.50
ACTIONS_ALLOWED_ORIGINS=http://192.168.1.50:5176,http://192.168.1.50:5180
```

In the Tester, connect to `http://192.168.1.50:3002`. Requests still need `<ACTIONS_KEY>`.

## Troubleshooting

| What you see | Likely cause | Fix |
| --- | --- | --- |
| `Invalid origin` or `FORBIDDEN_ORIGIN` when signing in or saving | The browser's address isn't in the allowed list | Correct `ALLOWED_ORIGINS` or `ACTIONS_ALLOWED_ORIGINS`, then restart that API |
| `FORBIDDEN_HOST` from Mission Autopilot | The server was called by an address it doesn't accept | Add the host to `ACTIONS_ALLOWED_HOSTS` |
| Autopilot says `Refusing to start` | `DATABASE_URL`, or an `ACTIONS_API_KEY` of at least 32 characters, is missing | Check `MissionAutopilot/.env` |
| The Autopilot console can't reach its server | The server isn't on `:3002` | Set `PORT=3002` in `MissionAutopilot/.env` |
| Another device can't connect, but the host can | The firewall, or a missing `--host` | Recheck steps 3 and 4 |
| Commander shows database errors after an update | New migrations haven't been applied | Run `npm run db:migrate` in `mission-control-db` |
| Everything stopped working after the network changed | The host's IP address changed | Update the `.env` files and firewall scope, then restart |
