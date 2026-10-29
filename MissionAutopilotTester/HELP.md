# Mission Autopilot Tester Help Guide

The Mission Autopilot Tester is a developer tool for exercising any Trajectory **Action Container** through its REST API. Connect to a container, browse its actions, invoke one with your own inputs, and watch the instance run — without needing a workflow or the runtime.

> **PLEASE NOTE:** The Mission Autopilot Tester is part of the Trajectory Pro Mission Control suite; a developer tool for exercising an Action Server's REST API.

---

## Table of Contents

1. [Getting Started](#1-getting-started)
2. [Connecting to an Action Container](#2-connecting-to-an-action-container)
3. [Invoking an Action](#3-invoking-an-action)
4. [Monitoring an Instance](#4-monitoring-an-instance)

---

## 1. Getting Started

The tester is a single self-contained page. Across the top are the app title and the **connection bar**; the **sidebar** on the left lists your connections, the actions available on the connected container, and any running instances; the center panel changes to match what you select.

A welcome splash appears the first time — click through it to reach the workspace.

---

## 2. Connecting to an Action Container

1. In the connection bar, open the connection dropdown and click **+ Add connection**.
2. Enter the container's **Server URL** (for example `http://localhost:3002`). A **Name** and an **API key or token** are optional — if you supply a key it is sent as `Authorization: Bearer <key>`.
   **Mission Broker.** The Mission Broker (`http://localhost:3007`) refuses every call without its token. Enter the `MISSION_BROKER_TOKEN` value from the suite's `.env` in **API key or token**. The broker answers the Tester only when the Tester page is served from `http://localhost:3004` or `http://127.0.0.1:3004` (or an origin listed in the broker's `BROKER_CORS_ORIGINS`).

3. Click **Save**. The status dot shows the connection state (connecting, connected, or disconnected).

You can keep several connections and switch between them from the dropdown, and **Edit** or **Delete** each one. Connections are remembered in your browser.

---

## 3. Invoking an Action

1. With a connection selected, the sidebar lists the container's actions.
2. Click an action to open the **invoke panel**.
3. Fill in the action's input parameters and start it. This creates a running **instance** on the container.

---

## 4. Monitoring an Instance

Select a running instance from the sidebar to open the **instance panel**, which shows:

- a **state timeline** of the instance's lifecycle as it progresses,
- the **outputs** it returns,
- any **error** detail, and
- a **command bar** for sending protocol commands (such as pause, resume, or abort) to the instance.

This is the same REST protocol the Trajectory runtime uses when it calls an Environment Action, so the tester is a quick way to confirm an Action Container behaves correctly on its own.
