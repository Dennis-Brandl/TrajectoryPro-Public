# Mission Commander Help Guide

Mission Commander is where Trajectory Pro Mission Control workflows are put to work. It holds the workflow and environment packages exported from Mission Designer, organizes them into work centers, decides who may act on each step, and starts runtime workflows. It then lets you monitor, control and review those runs while Mission Pilot operators do the work and Mission Engine executes it.

---

## Table of Contents

1. [Getting Started](#1-getting-started)
2. [Screen Layout](#2-screen-layout)
3. [Access Levels and Permissions](#3-access-levels-and-permissions)
4. [Work Centers](#4-work-centers)
5. [Loading Packages](#5-loading-packages)
6. [Work-Center Packages (.WFcenterX)](#6-work-center-packages-wfcenterx)
7. [Users](#7-users)
8. [Roles](#8-roles)
9. [Workflows](#9-workflows)
10. [Environments](#10-environments)
11. [Dispatch and Auto-claim](#11-dispatch-and-auto-claim)
12. [Creating Runtime Workflows](#12-creating-runtime-workflows)
13. [Monitoring and Controlling Runtime Workflows](#13-monitoring-and-controlling-runtime-workflows)
14. [Resources and Value Properties](#14-resources-and-value-properties)
15. [E-signatures](#15-e-signatures)
16. [History](#16-history)
17. [Settings](#17-settings)
18. [File Format Reference](#18-file-format-reference)

---

## 1. Getting Started

### First Run

When Mission Commander starts with no administrator account, it opens on **Create the first administrator**. Enter a name, an email address and a password (at least 8 characters), then click **Create administrator**. Once that account exists, public sign-up closes: every further account is created by an administrator from the **Users** area.

### Signing In

1. Open Mission Commander in your browser.
2. Enter your email and password and click **Sign In**.
3. Click **Sign out** in the top-right corner to end your session.

### From Package to Running Workflow

The usual path through the application:

1. **Create a work center** (**Work Centers** area, **＋**) for the place where the work is done.
2. **Create user accounts** (**Users** area, **＋**), then add the users as members on the work center's **Users** tab.
3. **Load packages** exported from Mission Designer into the work center with **Load packages…**. These are `.WFmasterX` workflow packages and any `.WFenvirX` environment packages.
4. **Connect action servers.** On the work center's **Env Specs** tab, an administrator enters the Mission Autopilot server address for each environment.
5. **Decide who may act.** Create roles and give them to members in the work center. Then use **Roles…** on the **Workflows** tab to limit interactive steps to those roles. This is optional: steps without roles are open to every member.
6. **Grant Mission System Commander** to the members who start and control runs.
7. **Create a runtime workflow** with **Create Runtime Workflow…** and start it.
8. Operators sign in to **Mission Pilot**, choose the work center, and claim and complete their steps.
9. **Monitor and control** the run from the **Runtime** area, and review it afterwards in **History**.

---

## 2. Screen Layout

```
+-----------------------------------------------------------------------------+
| Mission Commander       [ suite diagram banner ]      Name | Theme | Sign out |
+------+-------------------+--------------------------------------------------+
| Rail | Hierarchy Pane    | Detail Panel                                     |
|      |                   |                                                  |
| WC   | tree or list for  | details, tabs and actions for the item           |
| RT   | the selected area | selected in the Hierarchy Pane                   |
| US   |                   |                                                  |
| WF   |                   |                                                  |
| EN   |                   |                                                  |
| RO   |                   |                                                  |
| HI   |                   |                                                  |
| SE   |                   |                                                  |
|      |                   |                                                  |
| ?    |                   |                                                  |
+------+-------------------+--------------------------------------------------+
```

![Mission Commander with a work center selected: activity rail, work-center tree and detail panel](/help-images/2-screen-layout.png)

- **Header** (top) -- the application name, a diagram of how the suite fits together, your display name (on wide screens), the light/dark theme toggle, and **Sign out**
- **Activity Rail** (far left) -- switches between the areas of the application; the **?** button at the bottom opens this guide in a new tab
- **Hierarchy Pane** (left) -- the tree or list for the selected area
- **Detail Panel** (right) -- details, tabs and actions for whatever you select

### Activity Rail

| Button           | Hierarchy Pane shows                                                    |
| ---------------- | ----------------------------------------------------------------------- |
| **Work Centers** | The work-center tree                                                    |
| **Runtime**      | The work-center tree with each work center's active runtime workflows   |
| **Users**        | Every user account                                                      |
| **Workflows**    | Every loaded workflow, grouped by work center                           |
| **Environments** | Every loaded environment spec, grouped by work center                   |
| **Roles**        | Every role                                                              |
| **History**      | Finished runs across all work centers (no selection needed)             |
| **Settings**     | System-wide settings (no selection needed)                              |
| **?** (Help)     | Opens this guide in a new browser tab                                   |

### Disabled Controls

A control you are not allowed to use is shown disabled. Hover over it to see what it requires, for example _Requires work_center:edit_ or _Requires Mission System Commander_. See [Access Levels and Permissions](#3-access-levels-and-permissions).

### Live Views

Runtime and shared-state views refresh themselves every few seconds. If the server cannot be reached, they keep showing the last data received with the notice _Live view unavailable — showing last known state_.

---

## 3. Access Levels and Permissions

Two independent kinds of permission govern what you can do: a system-wide **access level**, and the per-work-center **Mission System Commander** flag.

### Access Levels

Every user has exactly one access level:

| Access level      | What it allows                                                                                                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Administrator** | Everything. Only administrators can create users, change access levels, set passwords, enable or disable accounts, manage sessions, impersonate, set action-server addresses and trust, and purge history. |
| **Steward**       | Everything except managing user accounts. Stewards can create, edit and delete work centers, load and delete workflows and environments, assign members and roles, manage roles, and edit user names. |
| **Viewer**        | Read-only access to everything                                                                                                                                                                                            |

Tooltips name the specific right a control needs:

| Right                                        | Needed for                                                                                   |
| -------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `work_center:create`                         | New work center, new child work center, importing a work-center package as a new work center |
| `work_center:edit`                           | Editing a work center; merging a work-center package into an existing one                     |
| `work_center:delete`                         | Deleting a work center                                                                        |
| `work_center:link`                           | Adding and removing members, members' roles, the Mission System Commander flag, allowed roles |
| `workflow:create`                            | Loading packages                                                                             |
| `workflow:edit`                              | A workflow's dispatch policy and auto-claim overrides                                        |
| `workflow:delete`                            | Deleting a workflow                                                                          |
| `environment:delete`                         | Deleting an environment spec                                                                 |
| `user:edit`                                  | Changing a user's display name and login name                                                |
| `access:create`                              | Creating a user                                                                              |
| `access:edit`                                | Access level, **Set password**, **Enable**/**Disable**, **Sessions**, **Impersonate**        |
| `role:create`, `role:edit`, `role:delete`    | Creating, editing and deleting roles                                                         |
| `settings:edit`                              | Saving settings                                                                              |

Administrators hold every right. Stewards hold every right except the `access:` rights. Viewers hold only read rights.

### Mission System Commander

**Mission System Commander** is a flag on a work-center member, set with the checkbox on the work center's **Users** tab. It lets that member operate the work center's runs:

- Create runtime workflows
- Start, pause, resume, stop, abort and delete runtime workflows
- Assign an offered step to an operator, force-release a claimed step, and force a waiting gate to complete
- Release, reset and clear resources, cancel waits, and edit live value properties
- Delete that work center's history entries

Administrators count as Mission System Commanders in every work center. For everyone else the flag is independent of access level: it applies only in the work center where it is set.

### Impersonation

An administrator can click **Impersonate** on another user's detail page to use Mission Commander exactly as that user would. An amber banner reading _Impersonating \<name\>_ stays visible the whole time; click **Stop impersonating** to return to your own account. Other administrators, disabled users and your own account cannot be impersonated.

---

## 4. Work Centers

A **work center** is a place where work is done, such as a line, a cell, a lab or a desk. It owns:
- the workflows and environments loaded into it;
- its members and the roles they hold there;
- the runtime workflows it executes;
- its shared resources and value properties.

Work centers are arranged in a tree.

### The Work-Center Tree

- **＋** beside the _Work Centers_ heading creates a top-level work center.
- **＋** on a row creates a child of that work center.
- **⭳** (Import package) imports a `.WFcenterX` work-center package. See [Work-Center Packages](#6-work-center-packages-wfcenterx).
- The arrow on a row expands it to show its child work centers, followed by its loaded workflows in italics.
- Click a name to open the work center in the Detail Panel.

### Creating and Editing a Work Center

| Field                          | Description                                                                                                          |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| **Name**                       | Required                                                                                                             |
| **Type**                       | Optional ISA 88 type. Pick a suggestion or type your own (up to 50 characters)                                       |
| **Description**                | Optional                                                                                                             |
| **Dispatch policy**            | The default way operators are suggested for steps. See [Dispatch and Auto-claim](#11-dispatch-and-auto-claim)          |
| **Auto-claim follow-on steps** | When on, steps that follow a claimed step are claimed for the same operator automatically                             |
| **Parent**                     | Edit only: move the work center under a different work center, or to the top level                                    |
| **Sort order**                 | Orders sibling work centers                                                                                          |

The **Type** suggestions are Enterprise, Site, Area, Plant Area, Work Unit, Device, Process Cell, Unit, Production Line, Production Unit, Storage Zone, Storage Unit and Equipment. Custom names are allowed, and the type is optional. It is shown after the work center's name in the hierarchy (for example, _Line 1 · Production Line_) and in the detail panel.

### The Work-Center Detail Panel

The header shows the work center's name, its dispatch policy and its auto-claim setting, with these buttons:

![Work-center detail panel: header, settings summary and the Workflows tab](/help-images/4-work-center-detail.png)

| Button              | Action                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------- |
| **Load packages…**  | Load Mission Designer packages into this work center. See [Loading Packages](#5-loading-packages) |
| **Save package…**   | Download this work center and everything beneath it as a `.WFcenterX` package                  |
| **Edit**            | Open the work-center dialog                                                                   |
| **Delete**          | Delete the work center                                                                        |

Below the header are nine tabs:

| Tab              | Contents                                                                                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Workflows**    | Workflows loaded here: name, version, lifecycle state, and how many roles are allowed. Row actions are **Roles…** (see [Allowed Roles](#allowed-roles)), **Create Runtime Workflow…** and delete (trash icon) |
| **Env Specs**    | Environment specs loaded here: name, version, state, and the **Action Server** address used for each environment                                                                                                           |
| **Runtime**      | Cards for this work center's runtime workflows. See [The Work Center's Runtime Tab](#the-work-centers-runtime-tab)                                                                                                         |
| **History**      | This work center's finished runs. See [History](#16-history)                                                                                                                                                              |
| **Env Resources** | This work center's shared resources and value properties. See [Resources and Value Properties](#14-resources-and-value-properties)                                                                                        |
| **Users**        | Members: name and email, login name, roles held here (**Roles…**), access level, the **Mission System Commander** checkbox, and **✕** to remove the member. **＋ Add User** adds a member |
| **Roles**        | The roles used by this work center's workflows, as allowed roles or e-signature roles                                                                                                                                      |
| **Branding** | This work center's colours and logo overrides |
| **Controls** | Which other work centers' runtimes this one may control, and which may control it. See [Control grants](#control-grants) |

### Adding Members

On the work center's **Users** tab, click **＋ Add User**, search for the user and click **Link**. To remove a member, click **✕** on their row. A user can belong to any number of work centers.

![Users tab: members with their roles, access level and the Mission System Commander checkbox](/help-images/4-users-tab.png)

### Connecting Action Servers

An environment's actions and Action Properties are provided by an action server such as Mission Autopilot. To connect one, an administrator opens the work center's **Env Specs** tab, types the server address in each environment's **Action Server** field, and clicks **Save**. Other users see the address read-only.

The address applies to this work center only, so the same environment can use different servers in different work centers. When **Action server trust** is Strict and the address is not in the allowed list, it is flagged _Not in the allowed action servers list_. The engine will not contact that server until an administrator adds it (see [Settings](#17-settings)).

**Distributed Workflow Management.** The Distributed Workflow actions run on the service at
`http://mission-broker:3007`. To use them in a work center: add that address to the
action-server allowlist in **Settings**, then bind the work center's *Distributed Workflow
Management* environment to it on the **Env Specs** tab. Reaching another work center also needs a
grant on the **Controls** tab.

### Control grants

The **Distributed Workflow** actions let a running workflow create, start, stop, abort, suspend and
unsuspend other runtime workflows, read their state and outputs, and wait for them to finish. A
workflow may always do this inside its own work center. To reach another work center, an
administrator grants it on the **Controls** tab of the work center whose runtimes will do the
controlling:

- **Only runtimes it created** — it may create runtimes in the other work center and command the
  ones it (or a runtime it created) started.
- **Any runtime** — it may also command runtimes it did not create.

Reading a runtime's state or outputs, and waiting for it, needs either kind of grant. The tab also
lists the work centers that may control runtimes here.

### Deleting a Work Center

A work center with child work centers cannot be deleted; delete the children first. If the work center still holds workflows, environment specs, runtime workflows or schedules, the dialog lists how many of each. **Delete anyway** then destroys all of them, including their execution history.

---

## 5. Loading Packages

Mission Designer exports a workflow as a **Workflow Package** (`.WFmasterX`) and an environment as a **Single Environment Package** (`.WFenvirX`). To make them usable in a work center, load them into it:

1. Select the work center and click **Load packages…**.
2. Choose one or more `.WFmasterX` and `.WFenvirX` files.
3. Optionally, tick other work centers under **Also load into** to load the same files there too.
4. Click **Load**.

### Load Results

The **Load results** dialog has one row for each file in each target work center:

![Load results dialog after loading three packages](/help-images/5-load-results.png)

| Status              | Meaning                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| **loaded**          | Added to the work center                                                                              |
| **replaced**        | A Draft, In Test or In Review package was re-loaded and the loaded copy was updated in place          |
| **already present** | The same specification at the same version and state is already in that work center; nothing changed |
| **failed**          | Not loaded; the reason is shown. The other files still load                                           |

For a workflow the row also reports its number of nodes, UI steps and environments, plus:

- **roles carried over** -- allowed roles copied from an earlier version (see [New Versions Keep Their Settings](#new-versions-keep-their-settings))
- **Roles created for e-signatures** -- roles named by the workflow's e-signature elements that did not exist yet (see [E-signatures](#15-e-signatures))
- **Roles not carried over (no matching node)** -- allowed roles from the earlier version that could not be placed in the new one
- warnings, shown in amber

For a replaced workflow the row also says how many steps were **removed** (and how many role grants were dropped with them) and how many were **kept until running runtimes finish**. A replaced environment lists the **Updated workflows** that picked it up.

For an environment package, every environment spec inside it is listed with its own status.

### Re-loading a Package

- Re-loading a Draft, In Test or In Review package at the same version replaces the loaded copy. Runtime workflows already created keep the copy they started with.
- Re-loading an environment updates the linked Draft, In Test and In Review workflows.
- A re-load replaces only when the OID, version **and** state all match; a different state is a separate entry. Re-loading an identical package stays _already present_ with _No changes since the last load._
- Re-loading a workflow updates only that workflow's own copy of its environments (and the work center's environment row), never other workflows. Load the environment package itself to update every linked workflow.
- Re-loading an older Draft workflow package also puts its embedded environment copy back into the work center's environment row.
- Released versions (Approved, Effective, Superseded, Obsolete) cannot be replaced; a duplicate shows _Version … is already loaded; raise the version to load changes._ Give the package a new version number in Mission Designer to load changes.

### Load Warnings

Load checks never block a load. They add warnings, in amber, when:

- an environment's action server address is filled in but is not a valid URI;
- an environment the workflow uses has no action server bound in the target work center;
- an environment is bound to an action server that is not on the allowlist (not checked in Loose trust mode).

If the checks themselves cannot run, the row says _Load checks could not be run._ The load itself is unaffected.

### Versions and States

Each load creates an independent entry, identified by the specification's OID, version and lifecycle state (Draft, In Test, In Review, Approved, Effective, Superseded, Obsolete). A work center can therefore hold several versions of one workflow side by side. Each is listed separately and each can start runtime workflows.

### New Versions Keep Their Settings

When you load a new version of a workflow that is already in the work center (the same OID), Mission Commander copies the operator settings from the most recently loaded earlier entry:

- the workflow's **dispatch policy** and **auto-claim** overrides, when they were set;
- its **allowed roles**, matched by each workflow level's path of names.

A level that was renamed, moved or removed, or whose path is ambiguous, cannot be matched. It is listed under _Roles not carried over_ and needs its roles set again.

---

## 6. Work-Center Packages (.WFcenterX)

A **work-center package** copies a work center and everything beneath it to another Mission Commander installation. It contains:
- the work-center tree and each work center's settings, including its ISA 88 **Type**;
- the workflows and environments loaded into each work center, and the links between them;
- the roles and the allowed-role grants.

It contains **no user accounts**, and no runtime workflows, history or operator presence.

### Saving a Package

1. Select the work center and click **Save package…**.
2. Under **Include**, choose **Every entry** or **Effective entries only**.
3. Check the preview: counts of work centers, workflows, environments, roles and role grants, plus any warnings.
4. Click **Download**.

### Importing a Package

1. In the **Work Centers** area, click **⭳** (Import package) and choose the `.WFcenterX` file.
2. Choose how to import it:
   - **Create new work center** -- pick a **Parent work center**, or _(as a new root)_, and click **Import**. The import is refused if a work center of the same name already exists there.
   - **Merge into existing work center** -- pick the **Target work center** and click **Preview merge**. Mission Commander shows what the merge would change without writing anything. Click **Merge** to apply it.
3. The report lists:
   - work centers created or matched;
   - workflows, environments, links, roles and role grants created, and how many were already present;
   - any role grants that could not be applied;
   - warnings recorded when the package was saved.

![Import package dialog in merge mode, showing what the merge would change](/help-images/6-import-package.png)

**How a merge behaves:**
- **It only adds.** It never deletes a work center, workflow, environment, link, role or grant.
- **The package's settings win.** Where a work center or workflow entry already exists, the package's settings, such as its dispatch policy, replace the target's. The preview lists each such change under **Config changes**.
- **The target's extra grants stay.** Grants that exist only on the target are listed as kept.
- **Work center types follow the package.** A typed work center in the package sets the target's type, and an untyped one clears it. A package saved before types existed leaves the target's types unchanged.

---

## 7. Users

Select **Users** on the Activity Rail to list every account alphabetically. Disabled accounts are marked _disabled_.

### Creating a User

An administrator clicks **＋** and enters:

| Field                | Description                                                                                                                                         |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Email**            | What the user signs in with                                                                                                                         |
| **Display name**     | The name shown throughout the suite                                                                                                                 |
| **Login name**       | A short name the user types when signing an e-signature. Lowercase letters, digits, dot, underscore and hyphen; 2–64 characters; starts with a letter or digit |
| **Initial password** | At least 8 characters                                                                                                                               |
| **Access level**     | administrator, steward or viewer                                                                                                                    |

### The User Detail Panel

The header shows the user's name, email and login name, with these controls:

| Control              | Who can use it | Action                                                           |
| -------------------- | -------------- | ---------------------------------------------------------------- |
| **Edit**             | `user:edit`    | Change the display name and login name                           |
| **Access level**     | Administrators | Change the access level (not your own)                           |
| **Set password**     | Administrators | Set a new password; the user is signed out of every session      |
| **Disable / Enable** | Administrators | Disable or re-enable the account (not your own)                  |
| **Impersonate**      | Administrators | See [Impersonation](#impersonation)                              |

Tabs:

- **Work Centers** -- every work center the user belongs to, whether they are Mission System Commander there, and the roles they hold there. **Add Role** opens the roles dialog for that work center. Membership and the Mission System Commander flag are changed on the work center's **Users** tab.
- **Sessions** (administrators) -- the user's active sign-ins, with created and expiry times. **Revoke** ends one and **Revoke all** ends every one. Your own current session is marked _Current_.

---

## 8. Roles

A **role** names a responsibility, such as _Mixer Operator_ or _Quality Approver_. Roles do two jobs:

- **Restricting steps.** A workflow's interactive steps can be limited to certain roles. See [Allowed Roles](#allowed-roles).
- **E-signatures.** An e-signature element can require the signer to hold a role. See [E-signatures](#15-e-signatures).

Roles are defined once for the whole system, but they are **held per work center**. A user who is a _Quality Approver_ in one work center holds nothing in another until given the role there.

### Managing Roles

- **＋** in the **Roles** area creates a role with a name and an optional description.
- **Edit** renames a role or changes its description.
- **Delete** removes a role and takes it away from every member who holds it. A role that a loaded workflow still uses, as an allowed role or as an e-signature role, cannot be deleted.

### Giving a Role to a Member

Use either of these:

- On the work center's **Users** tab, click **Roles…** on the member's row.
- On the user's **Work Centers** tab, click **Add Role** on the work center's row.

Tick the roles the member holds in that work center and click **Save**.

### The Role Detail Panel

- **Users** -- for each work center, the members who hold the role, with their login names
- **Workflows** -- the workflows that restrict steps to this role (read-only)

### Allowed Roles

On a work center's **Workflows** tab, **Roles…** opens **Allowed roles — \<workflow\>**. It lists each level of the workflow that contains interactive steps (User Interaction and Yes/No steps): the workflow itself and each child workflow, indented as they are nested. Tick the roles that may act on the interactive steps at each level, then click **Save**.

![Allowed roles dialog for a workflow](/help-images/8-allowed-roles.png)

- A level with no roles ticked uses the roles of the nearest enclosing level that has some.
- Parent levels that contain no interactive steps of their own are listed too, marked _applies to nested steps_. Roles ticked there apply to the child workflows beneath them.
- When no enclosing level has roles, every member of the work center may act on the step.
- The **Roles** column on the **Workflows** tab counts the distinct roles allowed anywhere in the workflow.

---

## 9. Workflows

Select **Workflows** on the Activity Rail to list every loaded workflow, grouped by work center, with its version and state. Each workflow entry belongs to exactly one work center.

### The Workflow Detail Panel

The header has **Create Runtime Workflow…** (Mission System Commander) and **Delete**. Below it are three tabs:

- **Overview** -- version, state (hover to see the effective date), owning work center (click to open it) and OID, plus two sections:
  - **Operator dispatch** -- the workflow's **Dispatch policy** and **Auto-claim follow-on steps**. Each can be _Inherit work-center default_ or an override (requires `workflow:edit`).
  - **Mission Designer provenance** -- the Mission Designer library the workflow was exported from.
- **Environments** -- the environment specs the workflow embeds; click one to open it.
- **Diagram** -- a read-only diagram of the workflow, drawn in the notation it was designed in (Flowchart, BPMN or ISA 88).

A workflow's ISA 88 type (Procedure, Operation, Phase and so on) is set in Mission Designer and shown here after the workflow's name in the list and as **Type** under the title in the detail panel. It cannot be changed in Mission Commander. Only a top-level workflow's type is shown; the types of its child workflows stay inside the workflow. A workflow loaded before it had a type shows none until it is re-exported from Mission Designer and loaded again.

### Deleting a Workflow

**Delete** removes the entry from its work center permanently. It is blocked while the workflow has runtime workflows or schedules; delete those first.

---

## 10. Environments

Select **Environments** on the Activity Rail to list every loaded environment spec, grouped by work center.

The environment detail panel has a **Delete** button, which is blocked while runtime workflows or schedules depend on the spec. It also has five tabs:

- **Overview** -- version, state, owning work center, OID, and Mission Designer provenance
- **Actions** -- the actions this environment provides, with library, version, inputs and outputs
- **Workflows** -- the workflows that use this environment spec
- **Resources** -- live state of the shared resources this environment declares
- **Value Properties** -- live values of the shared value properties this environment declares

The Overview also has an **Action server** section. It shows the server the environment declares in Mission Designer next to this work center's binding, which is the server calls actually use. It warns when no server is bound, or when the bound address is not on the action-server allowlist.

Loading an environment registers its resources and value properties in the work center as **shared state**. Every runtime workflow in that work center then works with the same resource pools and values (see [Resources and Value Properties](#14-resources-and-value-properties)). Some declared resources or value properties may not be registered yet; a notice then names them: _Declared but not registered … Re-load this environment spec to register them._

---

## 11. Dispatch and Auto-claim

When a runtime workflow reaches an interactive step, the step is **offered** to the operators who may act on it. Those are the work center's members who hold one of the step's allowed roles, or every member when the step has none. Offered steps appear under **Available** in Mission Pilot, and any eligible operator can **claim** one. A claimed step moves to that operator's **My tasks**. They can complete it, or **release** it for someone else.

### Dispatch Policy

For a step restricted to roles, the dispatch policy **suggests** one operator. The suggestion never stops another eligible operator from claiming the step. Only operators who are online in Mission Pilot at that work center are considered, and steps open to every member get no suggestion.

| Policy                              | Suggested operator                                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **least_queued_steps** (default)    | The online candidate who currently holds the fewest claimed steps                                      |
| **highest_priority**                | The online candidate with the highest member priority. Mission Commander does not yet let you set priority, so all members tie |
| **round_robin**                     | Currently behaves like least_queued_steps                                                               |
| **fewest_active_instances**         | Currently behaves like least_queued_steps                                                               |
| **manual**                          | No suggestion; operators pull work themselves                                                          |

The work center sets the default. A workflow can override it on its **Overview** tab.

### Auto-claim Follow-on Steps

**Auto-claim follow-on steps** can be turned on for the whole work center, or overridden per workflow. When it is on:

- **Chains.** Once an operator claims a step, the later interactive steps at the same workflow level are claimed for that same operator automatically. This includes steps in parallel branches, and continues past actions, scripts and waits in between. The operator must still be online in the work center, still be a member, and hold a role the step allows; otherwise the step is offered normally.
- **Child workflows.** A child workflow's first interactive step is offered normally, because its roles may differ. The parent's chain resumes at the parent's next step.
- **Sole candidate.** When exactly one eligible operator is online in the work center, every interactive step is claimed for them. That includes the first step of a run and the first step of a child workflow. Steps already waiting are claimed as soon as that operator comes online.
- **Released steps.** A step an operator releases, or that a Mission System Commander force-releases, is never automatically claimed back to the same operator. That operator can still claim it again by hand.

---

## 12. Creating Runtime Workflows

A **runtime workflow** is one run of a loaded workflow, identified by a **runtime ID**. By default these are numbered **RW-1**, **RW-2**, … within the work center; a work center can define its own format instead. Creating one requires Mission System Commander in the workflow's work center.

![Create Runtime Workflow dialog](/help-images/12-create-runtime-workflow.png)

1. Click **Create Runtime Workflow…**, either on the workflow's row on the work center's **Workflows** tab or on the workflow's detail page.
2. The dialog lists the workflow's **starting parameters**, with any literal defaults already filled in; edit them as needed. A parameter that reads a property shows _Resolved at start: \<property\>_: leave it blank to use that value, or type a value to use instead.
3. Click **Create and Start** to start the run at once, or **Create and Wait** to create it now and start it later.

### Runtime ID Format

A work center's **Edit** dialog has a **Runtime ID format** field. Leave it blank for the default (**RW-1**, **RW-2**, …), or build your own from literal text and these tokens:

| Token                    | Inserts                                                             |
| ------------------------ | -------------------------------------------------------------------- |
| `{YYYY}` / `{YY}`        | 4- or 2-digit year                                                    |
| `{MM}` / `{DD}`          | 2-digit month / day                                                   |
| `{HH}` / `{mm}` / `{ss}` | 2-digit hour (24-hour) / minute / second                              |
| `{WC}`                   | The work center's name, shortened to letters, digits and `-`          |
| `{SEQ}` or `{SEQ:n}`     | A sequence number, zero-padded to `n` digits when a width is given    |

`{SEQ}` is required — it is what keeps IDs unique — and can appear only once. `{WC}` and `{SEQ}` cannot sit directly next to each other with nothing between them (a work-center rename could otherwise blur the boundary between the two and reproduce an earlier ID). The Edit dialog previews the next few IDs live as you type.

The sequence restarts at 1 whenever the rendered date/time portion of the format changes. For example, `{YYYY}{MM}{DD}-{SEQ:3}` restarts every day; a format with no date/time token never restarts.

> **A run's ID is fixed the moment it is created and never changes afterwards.** Editing a work center's format only affects runs created after the edit — every run created before it keeps the ID it was given.

### Runtime Workflow Statuses

| Status        | Meaning                                                  |
| ------------- | -------------------------------------------------------- |
| **Waiting**   | Created with **Create and Wait**; not started yet        |
| **Starting**  | Start requested                                          |
| **Started**   | Running                                                  |
| **Pausing…**  | Pause requested; running actions are being paused. If an action server can't be reached, the run waits up to 2 minutes, then shows Paused with a warning on that step: its action may still be running. A run may briefly go from Paused back to Pausing… while the engine retries. |
| **Paused**    | Paused                                                   |
| **Resuming…** | Resume requested                                         |
| **Stopping…** | Stop requested; the run is ending cleanly. If an action server can't be reached, the STOP is sent as soon as it answers. |
| **Stopped**   | Ended by a stop                                          |
| **Aborting…** | Abort requested                                          |
| **Aborted**   | Ended by an abort                                        |
| **Completed** | Finished normally                                        |
| **Errored**   | Ended by an error that no TRY rule caught                |

---

## 13. Monitoring and Controlling Runtime Workflows

Two places show live runs. The **Runtime** area shows one run in full detail. A work center's **Runtime** tab gives an overview of all of that work center's runs.

### The Runtime Area

Select **Runtime** on the Activity Rail. The Hierarchy Pane shows the work-center tree. Each work center row carries a count, and beneath it are its active runtime workflows (**runtime ID · workflow name**, with a status badge). Click a run to open it. The Detail Panel then shows the following sections.

![Runtime area: runtime workflows by work center, with the live diagram of the selected one](/help-images/13-runtime-area.png)

- **Header** -- the run's runtime ID, workflow name and version, and status
- **Controls** -- **Pause**, **Resume**, **Request stop** and **Abort** (Mission System Commander). Each is enabled only when it applies to the current status; **Request stop** and **Abort** ask for confirmation.
- **Summary** -- master workflow, when the run was created and by whom, when it was queued, started and finished, and **Open work center**
- **Live diagram** -- see below
- **Resources** -- the resources this run uses
- **Active steps** -- each step with its type and state, the operator holding it with a presence dot (green online, amber away, grey offline), and any error. **Assign…** appears on an offered step and **Force release** on a claimed step.
- **Signatures** -- **Show signatures (n)** lists every e-signature attempt on the run (hidden when there are none)
- **Value properties** -- the run's own values under **Workflow** (and **Child · \<name\>** for each child workflow), plus the work center's **Shared (environment)** values

| Control          | Enabled when the run is                                   | Effect                        |
| ---------------- | --------------------------------------------------------- | ----------------------------- |
| **Pause**        | Started                                                   | Pauses the run                |
| **Resume**       | Paused                                                    | Resumes a paused run          |
| **Request stop** | Started, Pausing or Paused                                | Ends the run cleanly          |
| **Abort**        | Starting, Started, Pausing, Paused, Resuming or Stopping  | Ends the run immediately      |

#### The Live Diagram

The diagram colors each step by its state and refreshes every two seconds:

| Color      | State     |
| ---------- | --------- |
| Grey       | Idle      |
| Light blue | Waiting   |
| Blue       | Executing |
| Yellow     | Paused    |
| Green      | Completed |
| Red        | Errored   |

- Click a step to see its type, state, who holds it and any error. From there a Mission System Commander can **Assign** an offered step or **Force release** a claimed one.
- Click a **Child Workflow** step to open the child workflow's diagram. The breadcrumb above the diagram leads back to the parent.
- A Gate step with **Control Previous Action** turned on shows _Controls \<step\>_. Its tooltip also shows whether the gate is still evaluating, is open and waiting for that step to finish, or is open with a STOP requested.

#### Assigning and Force-Releasing Steps

- **Assign…** on an offered step lists the eligible members with their presence. Click one to claim the step on that member's behalf.
- **Force release**, after confirmation, takes a claimed step back from its operator and offers it again. The step is not automatically claimed back to the same operator.

### Forcing a Gate or Repeating Script to Complete

A gate that is waiting, and a Script step set to **Repeat until done** that is still running, show
**Force complete** in the runtime workflow's step list and in its diagram tooltip. Enter a reason and
choose **Confirm**:

- A gate opens at once, exactly as if its condition had become true or its timer had run out, and the
  workflow continues.
- A repeating script completes with the outputs from its latest run; outputs it has not written stay
  as they were.

The workflow's trace records "Forced complete: <reason>" and who did it. A paused workflow must be
resumed first. Timed gates also show when they will open, for example "Opens in 1 h 52 min (at 14:32)";
a repeating script shows "Running script · checks every 5 s" and, if it has a time limit, how long is
left. Operators in the Pilot can continue a timed gate or a repeating script early with
**Continue now**; only a commander can force a gate that waits on a condition.

### The Work Center's Runtime Tab

- **Filter chips** with counts: **Active**, **Waiting to start**, **Finished** and **All**, plus **Refresh**
- **Operators** -- the members currently attending this work center in Mission Pilot, with presence dots
- **A card for each run** -- its runtime ID and status, workflow and version, created and started times, creator, up to two current steps (_Offered_, _Claimed by …_ or the step's state), and any error

![A work center's Runtime tab: status filters, operators and runtime cards](/help-images/13-runtime-tab.png)

**Monitor and Control** on a card opens a dialog with these controls:
- **Start** (for a waiting run), **Pause**, **Resume**, **Request stop**, **Abort** and **Delete** (for a waiting or finished run);
- the step list with **Force release**;
- **Show trace** (every state change so far);
- **Show signatures**.

### Finished Runs

A finished run stays in the Runtime views for about an hour and is then removed from them. It remains available in [History](#16-history). The history entry is written the moment the run finishes, so deleting a finished run from the Runtime tab does not delete its history.

---

## 14. Resources and Value Properties

Environments can declare **resources** and **value properties**:
- **Resources** are things steps must take turns with, such as a machine, a pool of carts, a set of named bays, or a synchronization point between parallel branches.
- **Value properties** are named values that steps read and write.

Once loaded, these are the work center's **shared state**: every runtime workflow in the work center works with the same pools and values. A workflow can also declare its own resources and value properties; each run gets a private copy.

| View                                                 | Shows                                                              |
| ---------------------------------------------------- | ------------------------------------------------------------------ |
| Work center → **Env Resources** tab                  | All of the work center's shared resources and value properties     |
| Environment → **Resources** / **Value Properties**   | The shared resources and value properties that environment declares |
| **Runtime** area → a run                             | The run's own resources and values, plus the shared ones           |

### The Resource Table

| Column         | Contents                                                                                                                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Name**       | The resource. In a run's view a badge shows its scope: _workflow_ (this run only) or _environment_ (shared)                                                                                                             |
| **Type**       | See the type table below                                                                                                                                                                                                |
| **State**      | The current state. **over-committed** means more is in use than the capacity allows; **ledger mismatch** means the holder records claim more than the counters show                                                        |
| **Held by**    | A chip for each holding run (runtime ID, amount, held name, step); click one to open that run. **unaccounted n** means units in use with no run recorded as the holder                                                        |
| **Waiting**    | The runs queued for the resource, in order                                                                                                                                                                              |
| **Defined by** | The environment spec that declares the resource (click to open it). **orphaned** means that spec has been deleted but the resource remains                                                                                |
| **Actions**    | See below                                                                                                                                                                                                               |

![Env Resources tab: the resource table and value properties](/help-images/14-shared-state.png)

| Type                                   | Mission Designer name |
| -------------------------------------- | --------------------- |
| **binary exclusive use**               | Single Use            |
| **binary shared use with pool limits** | Shared Use            |
| **countable use with pool limits**     | Count Limited         |
| **named pool**                         | Named                 |
| **sync**                               | Sync                  |

### Resource Actions

Every resource action requires Mission System Commander. An action on a shared resource affects every runtime workflow in the work center.

| Action                   | Effect                                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Release…**             | Free a hold. Pick a tracked holder, or release a number of untracked units (for a named pool, an untracked name). The next waiter is granted at once |
| **Reset**                | Return the resource to its initial state: every holder is dropped and queued waiters are granted again                                                    |
| **Clear** (sync only)    | Clear every pending Send, Receive and Synchronize. Each waiting step fails, and a TRY rule can catch the failure                                        |
| **Cancel** (on a waiter) | Cancel that run's wait. The step fails (a TRY rule can catch it), and any capacity already reserved for it is returned                                  |

**Reset**, **Clear** and **Cancel** ask for confirmation first.

### Value Properties

Value properties are grouped by property, with one row per entry showing the value and when and by whom it was last updated. A Mission System Commander can click **Edit**, type a new value, and click **Save** or press Enter. Editing a shared value changes it for every runtime workflow that reads it.

Two badges can appear on an entry:

- **annotation** -- a note for people, left out when a step reads the whole property
- **orphaned** -- the environment spec that declared it has been deleted, but the value remains

---

## 15. E-signatures

A Mission Designer form can contain an **e-signature** element. A step with one cannot be completed until someone enters a **login name** and **password** and the engine verifies them. On a Yes/No step, only **Yes** needs a signature; **No** completes without one and takes the No path.

### Setting Up

1. **The role exists.** When an element names a role, a Mission Commander role with exactly that name must exist; the match is case-sensitive. Loading the workflow package creates any missing roles and reports them as _Roles created for e-signatures_.
2. **The signer is a member.** The signer must be a member of the work center the run executes in.
3. **The signer holds the role here.** Give the role to the people allowed to sign, on the work center's **Users** tab with **Roles…**. The same role held in another work center does not count.
4. **Signers know their login name.** Signers type their login name, not their email. It is shown on the user's detail page and on the work center's **Users** tab.

> Roles are matched by name. Renaming a role that an e-signature element names makes every signature on that step fail with an unknown-role error. Mission Commander does refuse to delete a role that a loaded workflow uses.

### What Is Checked

When the operator presses the signing button in Mission Pilot, the engine checks. The button reads **Sign & Continue**, or **Sign & \<label\>** when the button was renamed in Mission Designer:

| Check                                                                          | Message shown to the operator if it fails        |
| ------------------------------------------------------------------------------ | ------------------------------------------------ |
| The login name and password are correct, and the account is enabled            | _Login name or password is incorrect_            |
| The signer is not the operator, when the element requires a different user     | _A different user than the operator must sign_   |
| The signer is a member of this work center                                     | _That user is not a member of this work center_  |
| A role with the element's role name exists                                     | A message naming the missing role                |
| The signer holds that role in this work center                                 | A message naming the role the signer lacks       |

A failure message appears on the form. Everything the operator entered is kept so they can try again.

When the signature is accepted, the step completes. The signer's display name is written to the element's output parameter, and a _SIGNED_ entry is added to the run's trace.

### Signature Records

Every attempt, successful or failed, is recorded with the step, signer, role, decision (on Yes/No steps) and time. To see them, click **Show signatures (n)**. It appears in the **Runtime** area, in the **Monitor and Control** dialog, and in a history entry. Failed attempts are dimmed and show their failure code:

| Failure code                    | Meaning                                                                  |
| ------------------------------- | ------------------------------------------------------------------------ |
| `SIGNATURE_INVALID_CREDENTIALS` | Unknown login name, disabled account, or wrong password                  |
| `SIGNATURE_SAME_USER`           | The operator signed where a different user was required                  |
| `SIGNATURE_NOT_MEMBER`          | The signer is not a member of the work center                            |
| `SIGNATURE_ROLE_UNKNOWN`        | No role with the element's role name exists                              |
| `SIGNATURE_ROLE_MISSING`        | The signer does not hold the role in this work center                    |

Signature records stay after the run leaves the Runtime views. They are deleted only together with the run's history entry.

---

## 16. History

Every run that finishes is recorded in History, whether it completed, stopped, aborted or errored.

- **History** on the Activity Rail shows runs from every work center. A selector narrows it to one work center, or to _(deleted work centers)_.
- A work center's **History** tab shows only that work center's runs.

### Finding a Run

- State chips: **All**, **Completed**, **Stopped**, **Aborted**, **Errored**
- **Search workflow name…** (press Enter)
- **From** and **To** date and time
- **Refresh**

The table shows each run's runtime ID, workflow and version, work center (in the History area only), final status, start, finish and duration. Click a row to open the run.

### A History Entry

The entry shows the work center, the start and finish times and the duration, followed by:

![A History entry: the trace of a completed runtime workflow](/help-images/16-history-entry.png)

- **Trace** -- every state change of every step, with times and errors
- **Show signatures (n)** -- the run's e-signature attempts
- **Show properties** -- the run's value properties when it finished
- **Show starting params** -- the starting parameters it was created with
- **Show step params** -- each step's input and output parameters

If another runtime workflow created this one through a Distributed Workflow action, the header also says **Created by** with that runtime's work center and label (for example `Line A/RW-12`). The runtime detail shows the same line while the runtime is live.

**Delete** removes the entry together with its signature records. It is available to administrators and to Mission System Commanders of the work center.

### Purging History

Administrators can click **Purge…** on the History page to delete every entry older than a chosen date, either for all work centers or for one. The dialog shows how many entries match before anything is deleted.

---

## 17. Settings

Settings apply to the whole system. Saving them requires `settings:edit`.

![Settings panel](/help-images/17-settings.png)

### Action Matching

How the engine matches a workflow's Environment Action steps to the actions an action server offers:

- **Loose (default)** -- by action name and input parameter names. Extra actions and parameters on the server are allowed, and OIDs are ignored.
- **Strict** -- by action OID. The server must hold the exact action OIDs the workflow references.

### Action Server Trust

Only administrators can change these:

- **Strict (default)** -- the engine contacts only action servers whose origin is in **Allowed action servers**. An empty list refuses every action server.
- **Loose** -- the engine contacts any http(s) action server. Use this only for testing or on a controlled network.

A change here reaches the engine within a few seconds.

**Allowed action servers** takes one origin per line, written as scheme, host and port with no path. In the Docker fleet, the engine reaches the Mission Autopilot server at `http://mission-autopilot-server:3002`. The Mission Autopilot console shows the address to use in its top bar, as _Mission Commander address_.

---

## 18. File Format Reference

| Extension      | Produced by                                                  | Loaded with                                  | Contents                                                                                    |
| -------------- | ------------------------------------------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **.WFmasterX** | Mission Designer (**Export Workflow Package**)               | **Load packages…**                           | One workflow with its environments, actions and images                                      |
| **.WFenvirX**  | Mission Designer (single environment export)                 | **Load packages…**                           | One environment and the actions it includes                                                 |
| **.WFcenterX** | Mission Commander (**Save package…**)                        | **⭳** Import package (Work Centers area)     | A work-center subtree: tree and settings, workflows, environments, roles and role grants     |

### What's Inside a Work-Center Package (.WFcenterX)

```
<Work center>.WFcenterX                 -- ZIP archive
├── <Work center>.WFcenter              -- the work-center tree and manifest
├── workflows/<work-center path>/       -- <name>-<version>-<state>.WFmaster
├── environments/<work-center path>/    -- <name>-<version>-<state>.WFenvir
└── roles/
    ├── roles.json                      -- role definitions
    └── allowed-roles.json              -- allowed-role grants per workflow level
```
