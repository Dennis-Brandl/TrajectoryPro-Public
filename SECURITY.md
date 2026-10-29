# Security

Trajectory Pro Mission Control is built to run on a trusted machine or network.

## Supported setup

- Keep every service on loopback (`127.0.0.1`, the default in the compose files), or put it behind a reverse proxy that terminates TLS. Do not expose the plain-HTTP ports to the internet.
- Before the first `docker compose up`, run `sh scripts/setup-secrets.sh`. It generates the database passwords, tokens and keys the compose files require and never prints them or overwrites existing values. See `DOCKER-README.md`.
- Run one Mission Autopilot server per Mission Engine. The engine sends `ACTIONS_API_KEY` to that server only.

## Code that runs on your machine

- Mission Autopilot runs action code as unsandboxed Python with the server's privileges.
- Workflow SCRIPT steps run in Node's `vm` module, which limits resources but is not a security boundary.

Only let people you trust author actions or workflows.

## Reporting a vulnerability

Please use GitHub's **Report a vulnerability** button on the repository's Security tab. That opens a private report. Do not open a public issue for a security problem.
