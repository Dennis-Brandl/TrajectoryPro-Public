# Mission Designer Help Guide

Mission Designer is a visual workflow specification editor for designing step-by-step procedures, recipes, and batch processes. It produces portable specification files consumed by Trajectory Pro Mission Control runtime applications.

---

## Table of Contents

1. [Getting Started](#1-getting-started)
2. [Screen Layout](#2-screen-layout)
3. [Library Sidebar](#3-library-sidebar)
4. [Step Palette](#4-step-palette)
5. [Canvas](#5-canvas)
6. [Properties Panel](#6-properties-panel)
7. [Toolbar](#7-toolbar)
8. [Node Types Reference](#8-node-types-reference)
9. [Notation Systems](#9-notation-systems)
10. [Environment and Action System](#10-environment-and-action-system)
11. [Resources](#11-resources)
12. [Child Workflows](#12-child-workflows)
13. [Export and Import](#13-export-and-import)
14. [Executing a Workflow](#14-executing-a-workflow)
15. [Version and State Management](#15-version-and-state-management)
16. [Keyboard Shortcuts](#16-keyboard-shortcuts)
17. [Draft Recovery](#17-draft-recovery)
18. [User Accounts and Roles](#18-user-accounts-and-roles)
19. [File Format Reference](#19-file-format-reference)

---

## 1. Getting Started

### Signing In

1. Open Mission Designer in your browser.
2. Enter your email and password (minimum 8 characters).
3. If you are the first user, your account is automatically promoted to Administrator.
4. New users can register from the login page by clicking "Don't have an account? Register".

### Creating Your First Workflow

1. Sign in to reach the main editor.
2. In the Library Sidebar on the left, select the **Workflows** tab.
3. Click **Create Library** at the bottom to create a workflow library.
4. Enter a name and click **Create**.
5. Expand the library and click **Add Specification** (+ button) to create a workflow specification.
6. The canvas appears in the center. Drag steps from the Step Palette onto the canvas.
7. Connect steps by dragging from one node's handle to another.
8. Your work is saved automatically.

---

## 2. Screen Layout

![Editor screen layout](/help-images/2-screen-layout.png)

The editor has four main areas:

```
+------------------------------------------------------------------+
| Toolbar: Mission Designer | Notation | Back | Breadcrumb | Undo Redo | Layout | User |
+----------+------+------------------------------------+-----------+
|          |      |                                    |           |
| Library  | Step |         Canvas                     | Properties|
| Sidebar  |Palette|                                   | Panel     |
|          |      |                                    |           |
|          |      |                                    |           |
+----------+------+------------------------------------+-----------+
```

- **Toolbar** (top) -- Notation switcher, navigation, undo/redo, auto-layout, user menu
- **Library Sidebar** (far left) -- Browse and manage libraries and specifications
- **Step Palette** (left of canvas) -- Drag step types onto the canvas
- **Canvas** (center) -- Visual workflow editor with drag-and-drop nodes and connections
- **Properties Panel** (right) -- View and edit properties of the selected node or workflow

When viewing Environment or Action specifications, the canvas area is replaced by a form editor.

---

## 3. Library Sidebar

![Library Sidebar](/help-images/3-library-sidebar.png)

### Entity Type Tabs

Four tabs at the top of the sidebar switch between library types:

| Tab              | Icon      | Content                                      |
| ---------------- | --------- | -------------------------------------------- |
| **Workflows**    | Workflow  | Workflow libraries and specifications        |
| **Steps**        | Gear      | Reusable step library templates              |
| **Environments** | Server    | Environment definitions with action bindings |
| **Actions**      | Lightning | Action specifications with inputs/outputs    |

### Searching

Type in the search box to filter libraries and specifications by name. The search is case-insensitive and matches against both library and specification names.

### Managing Libraries

**Create a library:** Click the **Create Library** button at the bottom of the sidebar.

**Library context menu** (three-dot button on hover):

- **Add Specification** -- Create a new specification within the library
- **Add Sub-Library** -- Create a nested child library
- **Rename** -- Change the library name
- **Delete** -- Remove the library, its sub-libraries and all their specifications (cannot be undone). A library that contains Approved, Effective or Superseded workflows can only be deleted by an administrator, who first sees the list; anyone else must make them Obsolete first.
- **Share Library / Make Private** -- Toggle visibility for other users (admin only)
- **Import Workflow Package** -- Import a .WFmasterX runtime package (workflow libraries only)
- **Import BatchML (ISA-88)** -- Import a Mission Designer BatchML export (.batchml.xml) as a new workflow (workflow libraries only). BatchML files are produced by the canvas **Export** menu, **Export as BatchML (ISA-88)**.

**Delete a specification:** Hover over the specification name and click the trash icon.

**Specification row menu** (three-dot button on hover) includes:

- **Copy/Move to Library...** -- Copy or move a workflow, environment or action to another library of the same kind in the same team. A GLOBAL environment or action library is allowed only if you have rights there; workflows cannot go to GLOBAL. Needs the library create and delete rights for that kind of library (Librarian), or administrator. Every version moves together and keeps its state and history. References follow the move, including in Approved and Effective versions: workflows that use a moved environment, and environments and ACTION PROXY steps that name a moved action's library. If the destination already has an item with the same name, the move is blocked. **Copy** leaves the original where it is and adds a copy of every version, keeping states, versions and history. It needs the same rights plus create rights in the destination. References keep pointing at the original, and the same name clash blocks it.
- **Copy/Move to Team...** -- Copy or move a workflow (workflows only) to a library in another team. Needs Librarian rights (workflow library create and delete) in both teams, or administrator. The workflow leaves the source team. The environments, actions and sub-workflows it uses are taken as they are from same-named libraries in the destination team (or GLOBAL); missing libraries or items are created or copied in, keeping versions and states. Copying needs create rights in the destination team; the dialog names any that are missing. The source team's environments and actions stay where they are. **Copy** leaves the workflow in the source team too and adds a copy of every version in the destination, using those same environments, actions and sub-workflows. It also needs workflow create rights in the destination team.

### Dragging Specifications to Canvas

In the Workflows tab, you can drag a specification from the sidebar onto the canvas to create a pre-configured node with the specification's inputs, outputs, and values.

### Export and Import Controls

Below the search box:

- **Export menu** (download icon) -- Export the selected library
- **Import button** (upload icon) -- Import a library from file

See [Export and Import](#13-export-and-import) for details on file formats.

---

## 4. Step Palette

![Step Palette](/help-images/4-step-palette.png)

The Step Palette appears to the left of the canvas when editing a workflow. It shows available step types as draggable buttons. The header displays the current notation style (e.g., "BPMN", "ISA 88", "Flowchart").

### Adding Steps to the Canvas

Click and drag any step type from the palette onto the canvas. The node snaps to a 10-pixel grid and centers on the drop point.

### Available Step Types

**Control Flow:**
| Step | Purpose |
|------|---------|
| Start | Entry point of the workflow |
| End | Exit point of the workflow |
| Select 1 | Conditional branching -- routes to one of several options based on a comparison |
| Wait Any | Waits for any one of multiple parallel paths to complete |
| Parallel | Splits execution into parallel branches |
| Wait All | Waits for all parallel branches to complete |

**User Interface Steps (display content and capture input at runtime):**
| Step | Purpose |
|------|---------|
| User Interaction | Design a runtime screen with the UI Canvas -- freely combine text, headers, images, video, text inputs, multi-line text, checkbox and radio groups, dividers, timers, and an e-signature |
| Yes/No | A User Interaction screen plus a built-in two-way Yes/No branch |

See [The User Interface Canvas](#the-user-interface-canvas) under Node Types Reference for the full element list and options.

**Execution Steps:**
| Step | Purpose |
|------|---------|
| Script | Execute TypeScript code with input/output parameter access |
| Gate | Cyclically re-evaluate a boolean script until it returns TRUE, then continue (ISA-88: "Transition Step") |
| Child Workflow | Embed or reference a sub-workflow |

**Error Handling:**
| Step | Purpose |
|------|---------|
| Catch | Entry point of an error-handling path; receives control when a TRY rule -- on a step, or on the workflow itself as a fallback -- fires for a matching `catch_id` |
| Return | Ends an error-handling path and tells the runtime how to proceed (abandon, restart, go to a step, or retry) |

See [Error Handling with TRY, CATCH, and RETURN](#error-handling-with-try-catch-and-return) under Node Types Reference for how these work together.

**Environment Actions (dynamic):**

When environments are linked to a workflow (via the Specification Header), each environment appears as a draggable button in the palette. Hovering shows a tooltip listing the environment's available actions. Dragging an environment button onto the canvas creates an action node pre-linked to that environment.

---

## 5. Canvas

![Canvas](/help-images/5-canvas.png)

### Navigating the Canvas

| Action       | How                                                          |
| ------------ | ------------------------------------------------------------ |
| Pan          | Left-click or middle-click and drag on empty canvas          |
| Zoom         | Scroll the mouse wheel (range: 0.1x to 2x)                   |
| Fit view     | Click the fit-view button in the bottom-left Controls widget |
| Jump to area | Click in the MiniMap (bottom-right corner)                   |

### Selecting Nodes and Edges

| Action       | How                                                    |
| ------------ | ------------------------------------------------------ |
| Select one   | Click a node or edge                                   |
| Multi-select | Hold **Shift** or **Ctrl** and click additional items  |
| Box select   | Click and drag on empty canvas to draw a selection box |
| Deselect all | Click on empty canvas                                  |

Box selection uses partial mode: nodes partially inside the selection box are included.

### Creating Connections

1. Hover over a node to reveal its connection handles (small circles).
2. Click and drag from a source handle to a target handle on another node.
3. Release to create the connection.

**Connection rules:**

- START nodes can only be a connection source (no incoming connections)
- END nodes can only be a connection target (no outgoing connections)
- CATCH nodes can only be a connection source -- they are reached by a matching `catch_id`, not by an incoming edge
- RETURN nodes can only be a connection target (no outgoing connections)
- Connections cannot cross between the main flow and a Catch (error-handling) path
- Self-connections are not allowed
- Duplicate connections between the same handles are not allowed
- Connection snap radius is 10 pixels

Existing connections can be reconnected by dragging their endpoints to a different node.

### Double-Click Actions

| Target                       | Action                                       |
| ---------------------------- | -------------------------------------------- |
| Node                         | Opens the Node Properties Dialog for editing |
| Embedded child workflow node | Navigates into the child workflow canvas     |
| Empty canvas                 | Opens the Workflow Properties Dialog         |

### Deleting Nodes

Select one or more nodes and press **Delete** or **Backspace**. If any selected node has configured parameters, options, or settings, a confirmation dialog appears:

> "Delete selected step(s)? This will remove configured parameters, options, and settings. (Use Ctrl+Z to undo if needed)"

### MiniMap

The MiniMap in the bottom-right corner provides an overview of the entire workflow. Nodes are color-coded:

- **Green** -- Start nodes
- **Red** -- End nodes
- **Amber** -- Select 1, Wait Any
- **Purple** -- Parallel, Wait All
- **Gray** -- All other nodes

You can pan and zoom within the MiniMap to navigate quickly.

---

## 6. Properties Panel

![Properties Panel](/help-images/6-properties-panel.png)

The Properties Panel on the right side shows context-sensitive information based on what is selected on the canvas.

### No Selection (Workflow Summary)

When nothing is selected, the panel displays a summary of the current workflow:

- Workflow name
- Input parameters
- Output parameters
- Value properties
- Resources
- **Edit Workflow Properties** button

When the workflow is open for editing, the properties pane also has a **Type** box next to **Description**. Type is optional and names the kind of workflow in ISA 88 terms. Pick one of the suggestions -- Procedure, Unit Procedure, Operation, Phase, Macro Phase, Recipe Segment, Unit Recipe, Macro Operation, Subphase, Suboperation -- or type your own name (up to 50 characters). Leave it empty for no type. Child workflows can have a type too. The type is saved with the workflow and travels in exported packages. Mission Commander shows a top-level workflow's type after its name, but not a child workflow's.

### Single Node Selected

Shows the node's details:

- Type badge (e.g., "ENVIRONMENT ACTION:", "USER INTERACTION:")
- Label
- Inputs and outputs (for parameterized types)
- Value properties
- UI parameters (for User Interaction and Yes/No steps)
- Resource commands
- **Edit Properties** button to open the full editor dialog

### Single Edge Selected

For edges from Select 1 nodes: shows the connection's actual condition (read-only) as defined on the Select 1 step. Edit conditions on the Select 1 step.

For edges from other node types: displays a message that condition expressions are only available for Select 1 connections.

### Multiple Selection

Shows the count of selected items and a message to select a single item for editing.

### Input Parameters

Each input parameter has a name, an optional description, and a value. The value mode is toggled via **Text** / **Source** radio buttons:

- **Text** -- A literal string value typed directly into the field.
- **Source** -- A reference to a Value Property, Action Property, parameter, or step output. A dropdown picker lists available values:
  - **Value Property names** (e.g., `Temperature`) -- references the entire property
  - **Value Property entries** (e.g., `Temperature.Value`) -- references a specific entry within the property, shown indented below the property name
  - **Action Property names and entries** (e.g., `TankLevel` or `TankLevel.Value`) -- values published live by an action server, listed last in groups named **Env: \<environment name\> (Action Properties)**. See [Action Properties as Input Sources](#action-properties-as-input-sources) below.
  - **Workflow Input Parameters** -- the enclosing workflow's input parameters
  - **Workflow Output Parameters** -- the enclosing workflow's output parameters
  - **Parent Output Parameters** -- the parent workflow's output parameters (when editing a child workflow)
  - **Parent Input Parameters** -- the parent workflow's input parameters (when editing a child workflow)
  - **Step Output Parameters** -- output parameters from other steps in the workflow, grouped by step name

> **NOTE:** When selecting an output parameter from another step, it should be from a preceding step in the workflow execution order. The editor does not enforce execution order -- it is the author's responsibility to ensure the source step runs before the consuming step.

#### Action Properties as Input Sources

An **Action Property** is a value that an action server publishes and keeps current, such as a tank level, a machine status or the recipe loaded on a controller. Action Properties are declared on an environment's **Action Properties** tab (see [Creating Action and Environment Specifications](#creating-action-and-environment-specifications)). Unlike a Value Property, an Action Property's value is not stored in the workflow: at runtime it is read from the action server.

**Choosing an Action Property in the Source picker:**

- **Where they appear.** The picker offers the Action Properties of every environment linked to the workflow and to its parent workflows. They are grouped as **Env: \<environment name\> (Action Properties)**, after the Value Properties. Pick the property name to pass the whole property, or an indented entry (e.g., `TankLevel.Value`) to pass a single value.
- **Name clashes with Value Properties.** An Action Property is not offered when a Value Property in scope has the same name; the Value Property always takes precedence.
- **The same name in several environments.** The property is listed once, and its environment is chosen when the workflow is exported, in this order:
  1. an Environment Action step's own environment;
  2. the environment of an Environment Action step connected directly before this step;
  3. the first environment linked to the workflow. In this last case the export shows a warning naming the step, the input and the property.
- **Which inputs offer them.** Action Properties are offered for the input parameters of every step type that has input parameters. They are not offered for the workflow's own starting parameters.

**At runtime:**

- A step reads its Action Property inputs **once, when it starts**. The workflow waits at the step while the values are fetched from the action server that Mission Commander has registered for that environment in the work center. The step's work begins once the values arrive.
- A **Gate** step instead re-reads its Action Property inputs on **every cycle**. See [Value Properties vs. Action Properties](#value-properties-vs-action-properties).
- If the action server cannot be reached or does not report the property, the step **fails with an ERROR**. A [TRY rule](#error-handling-with-try-catch-and-return) can catch it.
- The value is passed exactly as a Value Property's is (see below): the whole property as a JSON array of name/value pairs, or a single entry as a plain string. It is never written into the workflow's Value Properties.

> **Branching on an Action Property:** a Select 1 step cannot compare an Action Property directly. Instead, give the Select 1 step an input parameter whose Source is the Action Property, then choose that input as the value to compare. The picker lists the step's own inputs under **Step Input Parameters**.

#### How Property Values Are Passed to a Step

When an input parameter has its value mode set to **Source** (`value_type: "property"`):

- **Referencing an entire Value Property** (e.g., `Temperature`) -- The entire property is passed as a JSON array of name/value pairs:
  ```json
  [
    { "name": "Temperature", "value": "22" },
    { "name": "Description", "value": "The Average Temperature over 1 hour" },
    { "name": "Units", "value": "Deg C" }
  ]
  ```
- **Referencing a single entry** (e.g., `Temperature.Value`) -- Only that entry's value is passed as a plain string (e.g., `"22"`).

### Output Parameters

Each output parameter has a name and a **value destination** selector. The destination determines where the step's output value is stored after execution. The dropdown lists available destinations:

- **Value Property entries** (e.g., `Temperature.Value`) -- stores the output in a specific Value Property entry, grouped by workflow level
- **Workflow Output Parameters** -- the enclosing workflow's own output parameters
- **Workflow Input Parameters** -- the enclosing workflow's own input parameters
- **Parent Output Parameters** -- the parent workflow's output parameters (when editing a child workflow)
- **Parent Input Parameters** -- the parent workflow's input parameters (when editing a child workflow)
- **Add Value Property...** -- creates a new Value Property inline and selects its Value entry
- **Add Entry to Property...** -- adds a custom entry to an existing Value Property

### Value Properties

Each Value Property has a name and a list of key/value entries. New properties are created with two default entries: **Value** and **Description**.

- The **Value** entry key is editable -- rename it to match your data model (e.g., `SetPoint`, `Reading`).
- The **Description** entry key is read-only and cannot be deleted.
- Additional entries can be added with the **Add Entry** button and removed with the trash icon.
- Entry key names cannot contain dots or spaces (reserved for dot-notation references).

### Value Types

A **Value Type** is a named entry template defined on an environment (Environment editor → **Value Types** tab). For example, a `CustomerInfo` Value Type might define the entries `Name`, `Address`, `PhoneNumber`, and `Email`, each with an optional default value.

When you add a Value Property — in an environment, a workflow, or a step — you can choose **Freeform** (the usual `Value` + `Description` entries) or **From \<Value Type\>**, which copies the template's entries (plus the protected `Description` entry) into the new property.

Things to know:

- **The copy is one-time.** A property created from a Value Type keeps no link to it. You can rename it, edit, add, or remove its entries freely afterward, and editing or deleting the Value Type never changes existing properties.
- **Mission Designer-only.** Value Types are an authoring convenience. They are saved with the environment and travel in Mission Designer library packages and in `.WFmasterX` workflow packages, so importing a package recreates them. The Mission Engine, Mission Commander, and Mission Autopilot ignore them.
- **Scope.** A workflow's property editors offer the Value Types defined on the environments associated with that workflow (and its parent workflows' environments).
- **Reserved name.** A Value Type entry cannot be named `Description` — every property already carries the protected `Description` entry.

---

## 7. Toolbar

![Toolbar](/help-images/7-toolbar.png)

The toolbar at the top of the screen provides the following controls:

| Control                | Description                                                             |
| ---------------------- | ----------------------------------------------------------------------- |
| **Mission Designer**   | Application title                                                       |
| **Notation Switcher**  | Dropdown to switch between Flowchart, BPMN, and ISA 88 notation styles  |
| **Back** button        | Appears when editing a child workflow; returns to the parent workflow   |
| **Context Breadcrumb** | Shows the current library and specification path                        |
| **Undo**               | Undo the last change (up to 100 steps)                                  |
| **Redo**               | Redo a previously undone change                                         |
| **Auto-layout**        | Automatically arranges all nodes using the dagre graph layout algorithm |
| **User** icon + name   | Shows the current user's identity                                       |
| **Account Management** | Manage user accounts (admin only)                                       |
| **Sign Out**           | End the current session                                                 |

### Canvas Toolbar (Top-Right of Canvas)

| Button                      | Description                                                                                                                                          |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Export Workflow Package** | Creates a self-contained runtime package (.WFmasterX) containing the workflow, all dependent environment and action libraries, and referenced images |

---

## 8. Node Types Reference

### Start

Entry point for the workflow. Only one Start node is recommended per workflow. Cannot receive incoming connections.

### End

Exit point for the workflow. You can have multiple End nodes. Cannot have outgoing connections.

### Environment Action

Executes an ACTION available from a linked environment. See Mission Autopilot for how to create and manage Environment Actions written in Python.

When editing:

- Select an action from the **Action Reference** dropdown (grouped by environment)
- Inputs and outputs are auto-populated from the action specification (read-only when an action is selected)
- Visibility can be "opaque" or "observable"

### User Interaction Step

Displays a screen to the operator at runtime and, optionally, captures input. Double-click the step to design its screen in the **form designer** (see [The User Interface Canvas](#the-user-interface-canvas) below). The operator finishes the step with its completion button. To rename the button, use the **Continue button** field in the form designer's **Actions** panel. If you leave it unchanged, the button reads **Continue**, unless the screen itself holds a Continue button (as screens made in older versions can), whose label is used instead. A screen can also draw its own button; see [Button Element](#button-element).

### Yes/No Step

A User Interaction screen **plus** a built-in two-way branch. It uses the same form designer and the same elements, so a Yes/No step can show any content alongside its decision: text, images, inputs and so on. At runtime the screen ends with a **Yes** button and a **No** button, which route execution down the Yes path or the No path.

- **Button labels** -- rename the two buttons (for example _Approve_ / _Reject_) in the form designer's **Actions** panel. The choice is recorded as `true` for Yes and `false` for No, whatever the labels say. The screen can also draw its own **Yes** and **No** buttons; see [Button Element](#button-element).
- **Default Selection** (Properties Panel) -- pre-select Yes or No, or choose **None** to require an explicit choice.

The node has two outgoing connections, one for the Yes branch and one for the No branch.

### The User Interface Canvas

User Interaction and Yes/No steps share one screen designer, the **form designer**. Double-click the step to open it full-screen.

![Form designer in Edit mode: elements palette, canvas with an image selected, and the inspector](/help-images/8-form-designer.png)

A screen is built from **elements** arranged in **rows**. Each row is a 12-column grid, so elements in the same row sit side by side and share its width. The screen adapts to the device it is shown on: you design the desktop layout, then adjust tablet and phone only where they need to differ.

The form designer has four areas:

- **Toolbar** (top) -- the **Edit** / **Preview** switch, **Undo** / **Redo**, and **Cancel** / **Save**
- **Elements palette** (left) -- the elements you can add. Collapse it with the button in its header, or drag its edge to resize it.
- **Canvas** (center) -- the screen shown inside a device frame, with **Desktop**, **Tablet** and **Phone** tabs above it
- **Inspector** (right) -- the **Actions** panel, then the properties of the selected element. Drag its left edge to resize it.

Your changes stay in the designer until you click **Save**. Save checks the screen and writes it to the step; if the screen is invalid, an error appears and the designer stays open. **Cancel** (or **Esc**) discards every change made since the designer was opened.

![Form designer Preview mode: a Yes/No step with an E-signature, ready to try](/help-images/8-form-designer-preview.png)

#### Adding and Arranging Elements

- **Add an element.** Click it in the palette to add it as a new full-width row at the bottom of the screen. Or drag it onto the canvas:
  - drop it **between two rows** (a blue line appears) to create a new row there;
  - drop it **inside a row**, beside another element (a purple line appears), to join that row.
- **Select an element.** Click it. The selected element is outlined in blue, with a red trash button on its corner.
- **Move elements and rows.** Hover over a row to reveal its drag handles:
  - drag the handle on an element's top-left corner to move that element into another row, or between rows;
  - drag the handle to the left of the row to move the whole row.
- **Resize within a row.** Where a row holds two or more elements, drag the boundary between two neighbors to move grid columns from one to the other. You can also click a boundary and use the **Left** and **Right** arrow keys; **Home** makes the left element as narrow as possible and **End** does the same for the right element.
- **Make columns.** Elements in the same row sit side by side, so columns come from putting several elements in one row. Besides dragging an element beside another, you can right-click an element, or use **Layout** in the properties pane on the right:
  - **Move into row above** puts the element at the end of the row above it;
  - **Move to its own row** takes it out of its row onto a new full-width row just below;
  - **Arrange in 1–4 columns** makes the element's row hold that many elements, pulling elements up from the rows below, or pushing extras down onto new rows.
- **Use the context menu.** Right-click an element for **Duplicate**, **Copy**, **Cut**, **Paste**, **Delete** and the column commands above. Right-click empty canvas to **Paste**.
- **Edit text.** Double-click a Text or Header element to edit its content.
- **Tips and help.** A tip strip above the canvas sums up how to arrange elements; close it with its **×**. The **Help** button in the toolbar opens this section. Hovering a grip or a boundary shows what it does.

A row holds up to 12 elements. When an element joins or leaves a row, the row's desktop column widths are re-divided evenly; three elements, for example, get 4 columns each. Resize them afterwards if you want an uneven split. Deleting the last element in a row removes the row.

| Shortcut                      | Action                                                   |
| ----------------------------- | -------------------------------------------------------- |
| **Delete** / **Backspace**    | Delete the selected element                              |
| **Ctrl+D**                    | Duplicate the selected element (into a new row below it) |
| **Ctrl+C** / **Ctrl+X**       | Copy / cut the selected element                          |
| **Ctrl+V**                    | Paste as a new row at the bottom of the screen           |
| **Ctrl+Z**                    | Undo                                                     |
| **Ctrl+Shift+Z** / **Ctrl+Y** | Redo                                                     |

On macOS, use **Cmd** in place of **Ctrl**.

#### Desktop, Tablet and Phone Layouts

The tabs above the canvas switch the device frame. In the designer the frames are **Desktop** 1152 px wide, **Tablet** 768 px, and **Phone** 390 px. At runtime a screen narrower than 1024 px uses the tablet layout, and one narrower than 600 px uses the phone layout.

**Desktop is the base layout.** Tablet and Phone inherit it, and you override only what should differ:

- **Per-device settings.** **Span**, **Visible**, **Order** and **Size** (in the Inspector), and resizing within a row, apply to the device tab currently selected.
- **Size per device.** The **Size** control follows the Desktop, Tablet and Phone tabs like **Span**. On Tablet and Phone it shows _(from Desktop)_ or _(from Tablet)_ until you pick a size there, and **Clear override** returns it to the inherited size. It applies to Text, Header, Text Input, Multi Line Text, Checkbox Group, Radio Group, Timer and Button. The workflow PDF prints the Desktop size.
- **Inheritance.** A change made on the Tablet or Phone tab becomes an override for that device. Anything you have not overridden follows the next larger device: Phone follows Tablet, and Tablet follows Desktop.
- **Undoing an override.** **Clear tablet override** (or **Clear phone override**) in the Layout section returns the element to the inherited layout.
- **Shared settings.** Everything else, such as content, data settings, alignment, minimum height and maximum width, is the same on every device.

For example, to stack side-by-side elements on a phone, select the **Phone** tab and give each element a **Span** of 12.

#### Previewing a Screen

Click **Preview** to try the screen as an operator would:

- **The screen behaves as at runtime.** Fields accept input, and required fields and any e-signature are enforced.
- **The step's buttons are gated.** **Continue**, or **Yes** and **No**, stay disabled until the screen is complete. Hover over a disabled button in the preview's own bar to see what is missing. The screen's own [Button Element](#button-element) buttons follow the same rules and are greyed out while something is missing, but they show no hover hint.
- **Nothing is recorded.** Pressing a button shows the value that would be recorded, but nothing is saved and the workflow does not advance.
- **Other controls.** **Restart** clears the preview, and the device tabs let you check each layout. Editing is unavailable while previewing.

#### Common Element Properties

Every element has a **Layout** section in the Inspector:

| Property                  | Applies to      | Description                                                                                                                                                |
| ------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Span**                  | Selected device | How many of the row's 12 columns the element occupies (default 12)                                                                                         |
| **Visible on \<device\>** | Selected device | Clear it to hide the element on that device                                                                                                                |
| **Order**                 | Selected device | Reorder the element within its row on that device; **Auto** keeps its position in the row                                                                  |
| **Align**                 | All devices     | Vertical position within the row: Start, Center or End. On a **Button** it also sets the horizontal position: Start = left, Center = centered, End = right |
| **Min Height**            | All devices     | A minimum height, from `none` to `xl`                                                                                                                      |
| **Max Width**             | All devices     | A maximum width, in `ch` (characters) or `rem`                                                                                                             |
| **Aspect Ratio**          | Image and Video | Width to height, for example `16/9` (required for images)                                                                                                  |

Elements that collect data also have:

- a **Field name**, which must be unique on the screen and is generated automatically, for example `Text_4f9a2c`;
- an **Output Parameter**, one of the step's output parameters, which receives the entered value. Choose **+ Add Output Parameter** to create a new one. The step's [Output Parameters](#output-parameters) then decide where the value is stored.

The **Delete** button at the top of the Inspector removes the selected element.

#### Element Types

| Element             | Purpose                                                        | Options                                                                                                                                                                                                                                                                                                         |
| ------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Text**            | Body text                                                      | Content, edited in a rich-text editor (double-click the element, or **Edit content…**): bold, italic, color, size (`xs`–`3xl`), alignment, and input-parameter placeholders                                                                                                                                     |
| **Header**          | A heading                                                      | The same as Text; starts bold at size `xl`                                                                                                                                                                                                                                                                      |
| **Text Input**      | A single-line input                                            | Field name; **Input Mode** (Any Text, Number, Phone Number, Password, Dropdown List, Combo Box); Required; Label; Default Value; Placeholder (fixed text or an input parameter); Size; Output Parameter. Dropdown List and Combo Box add a **List Source**: fixed items (label and value) or an input parameter |
| **Multi Line Text** | A multi-line text area                                         | Field name; Required; Label; Default Value; Placeholder; **Rows** (1–20, default 4); Output Parameter                                                                                                                                                                                                           |
| **Checkbox Group**  | Choose any number of options                                   | Field name; Required; Label; Size; **List Source** (fixed options, reordered by dragging, or an input parameter); Output Parameter                                                                                                                                                                              |
| **Radio Group**     | Choose one option                                              | The same as Checkbox Group                                                                                                                                                                                                                                                                                      |
| **Image**           | Display an image                                               | **Image Source**: **Choose file…** to add an image to the workflow, or type a file name or an `https://` URL; **Object Fit** (Contain, Cover, Fill); **Scale (%)** (10–300, default 100); Aspect Ratio                                                                                                          |
| **Video**           | Play a video                                                   | **Video URL** (a YouTube link or a direct video file); **Poster Image URL** (direct video files only); Aspect Ratio (default `16/9`)                                                                                                                                                                            |
| **Divider**         | A horizontal rule                                              | Color; Weight (Hairline or Thick)                                                                                                                                                                                                                                                                               |
| **Timer**           | A countdown or count-up timer                                  | Label; Field name; **Duration** (hours, minutes, seconds; default 5 minutes); **Direction** (Countdown or Countup); **Block Done until timer expires or is stopped**; Size; Default Value; Output Parameter                                                                                                     |
| **E-signature**     | Requires a verified signature before the step can be completed | Field name; Label; Meaning; Role; "A different user than the operator must sign"; Output Parameter (receives the signer's display name). See [E-signature Element](#e-signature-element)                                                                                                                        |

> **Defaults and parameters:**
>
> - A **Default Value** can be fixed text, a Value Property name, or one of the step's input parameters.
> - To show an input parameter inside Text or Header content, choose it from **Insert parameter…** in the content editor, where it appears as a chip. At runtime the chip, stored as `{{ParameterName}}`, is replaced by the parameter's value.
> - A **List Source** set to an input parameter takes its items from that parameter at runtime. The items shown in the designer are only examples, so leave room for the real list.

#### Button Element

A **Button** element lets the screen draw its own **Continue**, **Yes** or **No** button, in your colour, size and position. Click **Button** in the palette to add it to the bottom bar, or drag it to where you want it.

**Options** (in the Inspector):

| Option       | Description                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Job**      | What the button does: **Continue**, **Yes** or **No**. A new button starts as Continue. On a Yes/No step it starts as whichever of Yes and No the screen still lacks: the first button is Yes and the second is No. You can change it here at any time. It does exactly what Pilot's own button with that job does, including staying disabled until required fields and any e-signature are complete |
| **Label**    | Leave it empty and the button follows the step's label: the **Continue**, **Yes** or **No** label in the **Actions** panel, or the plain word. Text you type on the button wins                                                                                                                                                                                                                       |
| **Colour**   | The button's colour                                                                                                                                                                                                                                                                                                                                                                                   |
| **Emphasis** | **Primary** or **Secondary**                                                                                                                                                                                                                                                                                                                                                                          |
| **Size**     | The text size, set per device like the other sizes (see [Desktop, Tablet and Phone Layouts](#desktop-tablet-and-phone-layouts))                                                                                                                                                                                                                                                                       |

The Layout section (span, order, visible per device, alignment) works as for any element, except that **Align** also moves a button across its space: Start puts it on the left, Center in the middle and End on the right.

**The bottom bar.** The dashed band at the bottom of the canvas, labelled _Bottom bar — drag buttons here_, is a bar that stays pinned at the bottom of the screen in Mission Pilot while the rest of the form scrolls. Only buttons can go in it. Drop a button anywhere on the bar to put it beside the last button there (so Yes and No sit side by side), or drop it on the line above or below a row of buttons to start a new row. Drag buttons in and out of it and arrange them like any row. An empty bar is removed when you save.

**Pilot's own buttons.** Pilot hides its own **Continue**, **Yes** and **No** only when the screen's job buttons cover **every** device (Desktop, Tablet and Phone) for that kind of step: a Continue on a normal step, or both a Yes and a No on a Yes/No step. Otherwise Pilot keeps its own buttons as a fallback, so an operator is never left without a way to finish. Pilot always keeps its **Release** button and the line that says what is missing or that the step is ready.

**Old buttons.** Screens made in older versions can hold buttons with no job. The Inspector shows **None (old button)** and the hint _Pick a job so this button replaces Pilot's own._ Such buttons work exactly as before and never hide Pilot's buttons, until you give them a job.

**Problems are reported, not blocking.** The **Actions** panel shows a red alert for a screen that could leave the operator stuck, for example _No "No" button is visible on Phone._ or _A Yes button only works on a Yes/No step._ Workflow validation, which runs on export, lists the same problems as **Form buttons: ...**. **Save** is never blocked.

#### Converting Existing Forms

Existing screens are never changed automatically. To move one onto the new buttons:

- **One screen.** Click **Convert buttons** in the **Actions** panel. The whole conversion is a single change you can undo.
- **Every screen in a workflow.** Right-click the workflow canvas background and choose **Convert buttons in all forms...**. The dialog lists each step's changes and any remaining problems. Click **Apply** to convert, or **Cancel** to change nothing.

Conversion works on workflows you can edit, not on released versions. It follows these rules:

- On a normal step, every old button becomes **Continue**, including any that sent true or false. On a Yes/No step, a button that sent true becomes **Yes** and one that sent false becomes **No**; anything else, including a button that sent continue, is left as it is and listed as **needs a job**. Pick its job in the Inspector.
- A label that is only _Continue_, _Yes_ or _No_ is cleared, so the button follows the step's label. Any other label is kept, as are colour, emphasis and size.
- Any button the step still lacks is added to the bottom bar, with an empty label, so the screen reads as it did before but the buttons are now yours to restyle and move.

#### E-signature Element

The **E-signature** element makes a person take responsibility for a step. The step cannot be completed until someone enters a **login name** and **password** and Mission Engine verifies them. Use it for approvals, sign-offs and any step that must be signed.

A screen can hold **one** E-signature element. Once a screen has one, the palette item is disabled with the tooltip _A form can hold one e-signature_.

**Options** (in the Inspector):

| Option                                           | Description                                                                                                                                                                                     |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Field name**                                   | The element's field name, unique on the screen                                                                                                                                                  |
| **Label**                                        | The heading shown above the signature fields (default "E-signature")                                                                                                                            |
| **Meaning**                                      | The statement the signer attests to, e.g. _I approve this timesheet as submitted_. It is shown to the signer and recorded with every signature                                                  |
| **Role**                                         | The role the signer must hold in the work center where the step runs. **Any work-center member** (the default) lets any member sign. The list comes from the E-Signature Roles list (see below) |
| **A different user than the operator must sign** | When ticked, the operator who claimed the step cannot sign it; a second person must                                                                                                             |
| **Output parameter**                             | Optional. One of the step's output parameters, which receives the **signer's display name** once the signature is accepted                                                                      |

At runtime the element shows its label and meaning, then a line saying who may sign (_Sign as: \<role\>_ or _Any member of this work center_). Below that are a **Login name** field and a **Password** field. The password is never stored.

**On a User Interaction step:**

- The completion button is relabeled **Sign & \<label\>**. In Mission Pilot that is **Sign & Continue** unless you renamed the button. It stays disabled until both signature fields are filled in, along with any other required fields.
- The step completes only once the signature is accepted.

**On a Yes/No step:**

- The **Yes** button is relabeled **Sign & \<Yes label\>** (for example _Sign & Approve_) and requires the signature.
- The **No** button is unchanged. It never asks for or accepts a signature, and it can be pressed with the signature fields empty (any other required fields still apply). It takes the **No** path, so design that branch as the "not approved" route.
- Only **Yes** is signed. Pressing **No** records no signature.

**Pre-filled login name.** On either step type, when a different user is **not** required, the **Login name** field is pre-filled with the operator's own login name, so the operator only types a password. When a different user **is** required, the field starts empty and a hint reads _Must be signed by someone other than \<operator\>_.

**When someone signs**, Mission Engine checks that:

1. the login name and password belong to an enabled account;
2. the signer is not the operator, if a different user is required;
3. the signer is a member of the work center the run executes in;
4. the signer holds the element's role in that work center, when a role is set.

If a check fails, the reason appears on the form. The operator's entries are kept, so they can correct the signature and try again. Every attempt, accepted or rejected, is recorded and can be reviewed in Mission Commander. When a signature is accepted, the step completes, its output parameter receives the signer's display name, and the run's trace records a _SIGNED_ entry.

**Setting up e-signature roles.** Mission Designer and Mission Commander connect roles **by name**:

1. **Maintain the list in Mission Designer.** An administrator opens **Administration** from the toolbar, selects the **E-Signature Roles** tab, adds each role name (for example _Time Sheet Approver_), and clicks **Save**. Names can be up to 64 characters and must be unique, ignoring case.
2. **Pick the role on the element.** Authors choose the role in the element's **Role** list. Removing a name from the list does not change existing screens; an element whose role is no longer listed keeps it and shows the warning _not in the E-signature roles list_.
3. **Load the workflow into Mission Commander.** Loading the workflow package creates any role it names that Mission Commander does not already have. Names must match exactly, including capitalization.
4. **Give the role to signers in Mission Commander.** Assign the role to the people allowed to sign, in each work center where they will sign. Each user's **login name** is also set in Mission Commander.

PDF exports show an E-signature element as a signature line with its label, meaning and role, and whether a different user is required.

### Script Step

Runs a short JavaScript program on the Mission Engine. Each run may take at most 5 seconds. The script
runs straight through: it is not awaited, so set outputs before it ends, not in a `.then()` or after an
`await` (Gate scripts work the same way). Features:

- CodeMirror 6 editor with syntax highlighting and line numbers
- **Generate Template** button creates a commented template showing input/output parameter usage
- **Repeat until done** turns the step into a poller (see below)

#### Input Parameters

- Each `input_parameter_specifications` entry becomes a local variable in the script, named by its `id`.
- So each input's name must be a valid JavaScript variable name: letters, digits, `_` or `$`, not starting
  with a digit, and not a reserved word such as `class` or `new`. Validation flags any other name on Script
  steps and on Gate steps that run a script.
- If `value_type: "property"`, the variable's value is resolved from the property store at the dot-notation key in `default_value`.
- If `value_type: "literal"` (or omitted), the variable's value is the `default_value` string directly.
- All values are strings.
- If a property reference resolves to a group (no exact entry match), it returns a JSON array of `[{"name":"...","value":"..."}]`.

#### Output Parameters

- An `output` object is provided to the script automatically.
- Write results as `output.someKey = value`.
- If `output_parameter_specifications` exist: each spec's `id` is matched against output keys, and the value is written to the property store at the spec's `target` dot-notation key.
- If no output specs exist: output keys are written directly as dot-notation property keys.

#### Example

Given these specs on a SCRIPT step:

```json
{
  "input_parameter_specifications": [
    { "id": "name", "default_value": "User.Name", "value_type": "property" },
    { "id": "age", "default_value": "30" }
  ],
  "output_parameter_specifications": [
    { "id": "greeting", "target": "Result.Message" },
    { "id": "eligible", "target": "Result.Eligible" }
  ],
  "script_config": {
    "source":
	  "output.greeting = name + ' is ' + age;
	   output.eligible = Number(age) >= 18 ? 'yes' : 'no';"
  }
}
```

If `User.Name = "Alice"` in the property store, the script executes with `name = "Alice"`, `age = "30"`, and writes:

- `Result.Message` = `"Alice is 30"`
- `Result.Eligible` = `"yes"`

#### Repeat until done

Turn on **Repeat until done** to make the step wait for something instead of running once:

- The script runs when the step starts, then again every **Check every** seconds (default 5).
- It is done only when it returns exactly `true`. Any other result — `false`, nothing, `"yes"` — means
  "not yet", and it runs again next cycle.
- Inputs are read again before every run, so the script sees current Value Properties and live Action
  Properties. A change to a bound Action Property wakes it at once.
- A `state` object keeps values between runs: `state.count = (state.count || 0) + 1`. It holds JSON
  data (numbers, strings, true/false, arrays, objects) up to 64 KB. You can change it or replace it.
- Don't name an input parameter `state` or `output`: those names are taken by the script itself, so the input would be hidden.
- Outputs written by a run that is not done yet are held back. They are saved when the step
  completes, using the last run's `output` values. One run's outputs can total up to 64 KB.
- **Time limit** (optional, weeks to seconds, like a timed gate's delay; blank = no limit) stops the
  wait. **When the time limit is reached** either **Fail the step** (it can be caught with TRY /
  CATCH) or **Complete with current outputs**. The limit counts from the step's start and keeps
  counting while the workflow is paused.
- While it waits, Mission Commander shows **Force complete** and the Pilot shows **Continue now**
  (in the Waiting list and the Workflows diagram). Both complete the step with its current outputs.
- A script error, a `state` that is too big or not JSON, or outputs that are too big, fails the step like any script error.

The script runs on a cycle on the server; it does not wait or sleep inside a run. Keep each run short.

#### Sample scripts

Each sample names the step's **Input Parameters** (_in_) and **Output Parameters** (_out_). Every input
arrives as a string; use `Number(...)` before doing arithmetic.

**1. Convert units** (one run). _in:_ `celsius`. _out:_ `fahrenheit`.

```javascript
output.fahrenheit = ((Number(celsius) * 9) / 5 + 32).toFixed(1)
```

**2. Build a lot number** (one run). _in:_ `line`, `product`. _out:_ `lot`.

```javascript
const d = new Date()
const day = d.toISOString().slice(0, 10).replace(/-/g, '')
output.lot = `${line}-${product}-${day}`
```

**3. Check a value and stop the workflow if it is out of range** (one run). _in:_ `weight`, `min`,
`max`. _out:_ `status`. Add a TRY on the step to send the failure to a CATCH.

```javascript
const w = Number(weight)
if (Number.isNaN(w)) throw new Error(`Weight "${weight}" is not a number`)
if (w < Number(min) || w > Number(max)) throw new Error(`Weight ${w} is outside ${min}–${max}`)
output.status = 'in range'
```

**4. Total a group of values** (one run). _in:_ `readings`, set to a property **group** — it arrives as a
JSON list of `{ "name", "value" }` entries. _out:_ `total`, `count`.

```javascript
const entries = JSON.parse(readings)
const values = entries.map((e) => Number(e.value)).filter((n) => !Number.isNaN(n))
output.total = values.reduce((sum, n) => sum + n, 0)
output.count = values.length
```

**5. Wait for a level** (repeat until done). _in:_ `level`, bound to a tank level. _out:_ `finalLevel`.

```javascript
output.finalLevel = level
return Number(level) >= 90
```

**6. Wait until a reading is steady** (repeat; Check every 10 s). Done when the temperature has stayed
within 0.5 degrees for 6 checks in a row (about a minute). _in:_ `temperature`. _out:_ `steadyAt`.

```javascript
const t = Number(temperature)
if (state.last !== undefined && Math.abs(t - state.last) <= 0.5) {
  state.steady = (state.steady || 0) + 1
} else {
  state.steady = 0
}
state.last = t
output.steadyAt = t
return state.steady >= 6
```

**7. Wait for a change** (repeat). Done as soon as the value differs from what it was when the step
started. _in:_ `batchStatus`. _out:_ `newStatus`.

```javascript
if (state.first === undefined) state.first = batchStatus
output.newStatus = batchStatus
return batchStatus !== state.first
```

**8. Give up after a number of tries** (repeat; Check every 30 s). Fails the step after 20 checks — about
10 minutes — without a time limit. Catch the error with TRY / CATCH to take another path.
_in:_ `pressure`.

```javascript
state.tries = (state.tries || 0) + 1
if (Number(pressure) >= 2.5) return true
if (state.tries >= 20) throw new Error(`Pressure still ${pressure} bar after ${state.tries} checks`)
return false
```

**9. Average while waiting** (repeat; Time limit 15 min; _Complete with current outputs_). Keeps a
running average of a flow rate; when the time limit is reached the step completes with the latest
average. _in:_ `flow`. _out:_ `averageFlow`, `samples`.

```javascript
state.sum = (state.sum || 0) + Number(flow)
state.n = (state.n || 0) + 1
output.averageFlow = (state.sum / state.n).toFixed(2)
output.samples = state.n
return false // the time limit ends it
```

**10. Keep the last few readings** (repeat). Done when the last 5 readings are all above 50. _in:_
`reading`. _out:_ `lastFive`.

```javascript
state.recent = [...(state.recent || []), Number(reading)].slice(-5)
output.lastFive = state.recent.join(', ')
return state.recent.length === 5 && state.recent.every((r) => r > 50)
```

### Gate Step

A **cyclic boolean transition**: the workflow pauses at the gate and re-evaluates a script on a fixed cycle until the script returns a truthy value, then continues down its single outgoing connection. In ISA-88 notation the gate IS the transition mark between two steps, so the ISA-88 palette and diagrams label it **"Transition Step"**; in Flowchart and BPMN notation it renders as a diamond gateway. A gate has exactly one incoming and one outgoing connection.

#### The Script Contract

- The script must `return` a value; it is coerced by ordinary JavaScript truthiness (`return "yes"` and `return 1` both open the gate; `return 0`, `return ""`, and a script with no `return` do not).
- Each `input_parameter_specifications` entry becomes a local variable, named by its `id` -- exactly like a [Script Step](#script-step): all values are strings, and `value_type: "property"` entries resolve from a property store at the dot-notation key in `default_value`.
- There is **no `output` object** -- a Gate step has no output parameters. The script's only job is the boolean verdict.
- A gate with no script source at all passes through immediately (treated as `TRUE`).
- Inputs are re-resolved **every cycle**, not just once when the gate is entered, so the script always sees current values.

#### Cycle Time

The **Cycle time** property (default 5 seconds, minimum 1 second) controls how often the script re-evaluates while the gate is waiting.

#### Sample gate scripts

A gate script returns its verdict and has no `output`.

```javascript
// Open when the oven reaches its set point (inputs: temperature, setPoint).
return Number(temperature) >= Number(setPoint)
```

```javascript
// Open once both valves report "Closed" (inputs: valveA, valveB).
return valveA === 'Closed' && valveB === 'Closed'
```

```javascript
// Open at or after 06:00 on the Mission Engine server's clock (often UTC; no inputs).
return new Date().getHours() >= 6
```

To wait a fixed time, use a **Timer** gate rather than a script. To keep values between checks, use a
Script step with **Repeat until done** — a gate has no `state`.

#### Value Properties vs. Action Properties

An input whose `default_value` names a group can resolve two different ways:

- If the name matches a workflow **Value Property**, the value comes from the workflow's own property store (as with any other step) and is re-read every cycle.
- Otherwise, if the name matches an **Action Property** declared by a linked environment, the value is fetched **live from that action server** over the network on every cycle, rather than from the workflow's local store -- so the gate can react to real-time state the action server is reporting (e.g., a sensor reading), not just values already written into the workflow.

A Value Property of the same name always takes precedence over an Action Property.

#### Control Previous Action

The **Control Previous Action** checkbox (default **off**) controls how a Gate step relates to the step immediately before it:

- **Off (default, recommended)** -- the gate waits for the previous step to complete, like any other step. No ISA-88 knowledge is required; this is the behavior most people expect.
- **On** -- when the Gate step is the single step immediately following an **Environment Action** (Action Proxy) step, turning this on makes the two run **concurrently**: the gate starts cycling the moment the action starts, rather than waiting for the action to finish first.
  - If the gate's script returns TRUE while the action is **still running**, the gate opens (stops cycling) and the engine sends the action server a single **STOP** command for that action, if the action server supports it. If the action server can't be reached, the engine keeps trying until it answers. If STOP isn't supported, the workflow instead waits for the action to complete naturally, and a warning is logged on the gate. The successor step starts once the action finishes.
  - If the action **completes before** the gate opens, execution holds at the gate -- it does not continue until the gate's script eventually returns TRUE on its own cycle.

Turning this on only has an effect when the gate directly follows an Environment Action; if it does not, the gate simply cycles on its own regardless of the setting.

#### Errors and Resources

A script error fails the gate step the same way a Script Step failure does, and can be caught with [TRY, CATCH, and RETURN](#error-handling-with-try-catch-and-return). A Gate step cannot hold **Resource Commands** -- a gate's own step logic never acquires a resource, armed or not, but the engine still releases any resource commands a step declares when it finishes, which would release a pool slot no acquire ever granted, so the option is not offered, and an export carrying resource commands on a GATE step is rejected.

#### Timed gates

A gate's **Mode** can be:

- **Condition** — opens when its script returns TRUE (the original gate).
- **Timer** — opens when the **Delay** has passed since the gate started. No script runs. For
  example, a 4-minute cool-down: set Minutes to 4.
- **Condition with timeout** — opens when the script returns TRUE or the Delay has passed,
  whichever comes first.

Enter the delay in any combination of weeks, days, hours, minutes and seconds (for example
2 h 10 min 20 s); blank boxes count as zero, and the total is shown underneath. The longest
delay is 52 weeks. The timer starts when the gate starts — for a gate set to **Control Previous
Action**, when the action starts — and keeps counting while the workflow is paused; if the time
ran out during a pause, the gate opens as soon as the workflow resumes. Timed gates show a small
clock in the diagram.

While a gate is waiting, a Mission System Commander can **Force complete** it in the Mission
Commander (a reason is required), and operators can **Continue now** on a timed gate from the
Pilot's Waiting list or its Workflows diagram. Both are recorded in the workflow's trace.

### Child Workflow

Represents a sub-workflow. Two modes:

- **Embedded** -- A copy of the workflow stored within the parent. Double-click to navigate into it. Fully editable with its own inputs, outputs, values, and resources.
- **Reference** -- A link to an existing step library specification. Changes to the library spec are reflected wherever it is referenced. Properties are read-only.

See [Child Workflows](#12-child-workflows) for details on creating child workflows.

### Select 1

Conditional branching node. Routes execution to one of several paths based on comparing an input value against options.

Configuration:

- **Input Parameter Name** -- The value to compare (literal text or a value property reference)
- **Comparison Options** -- Ordered list of conditions:
  - **Label** -- Display name for the branch
  - **Operator** -- =, !=, <, >, <=, >=, contains, does not contain
  - **Value** -- The comparison value (literal or property reference)
  - **Default** -- One option can be marked as default (takes this path if no other condition matches)

Each option creates a corresponding output handle on the node. New connections from a Select 1 node automatically create a new option if none exists.

### Parallel / Wait All

Use together for parallel execution:

1. **Parallel** splits into multiple branches
2. **Wait All** waits for all branches to complete before continuing

### Wait Any

Similar to Wait All, but continues as soon as any one branch completes.

### Error Handling with TRY, CATCH, and RETURN

Environment Action, Script, User Interaction, Yes/No, and Child Workflow steps can all carry a TRY rule that catches failures and routes them to a recovery path built from **Catch** and **Return** nodes, so a workflow can respond to a step that errors, aborts, or times out instead of simply stopping. The workflow itself can carry TRY rules too, as a fallback for whatever a step doesn't catch -- see [Workflow-level TRY (fallback)](#workflow-level-try-fallback) below.

**1. Add a TRY rule to a step.** Select an Environment Action, Script, User Interaction, Yes/No, or Child Workflow step and open the **TRY / Error Handling** section of its Properties Panel. Click **+ Add TRY** and set:

- **ON** -- the failure mode that triggers the rule: **ERROR**, **ABORT**, or **TIMEOUT**. A step may have at most one rule per mode.
- **CATCH** -- the `catch_id` of the Catch node that handles this failure (picked from the Catch nodes on the canvas).
- **Release resources on catch** -- when checked (the default), resources the step holds are released as control transfers to the Catch.

**2. Build the recovery path.** Add a **Catch** node whose `catch_id` matches the TRY rule, connect the steps that handle the failure, and end the path in a **Return** node that decides what happens next.

**A Catch path is a separate "network."** There is **no edge** between the step and its Catch -- they are linked only by the matching `catch_id`. The Catch begins an independent sub-flow, so the editor blocks any edge that would cross between the main flow and a Catch path (see the connection rules under [Canvas](#5-canvas)). At runtime, when the step fails with a mode that has a TRY rule, control jumps to the matching Catch and follows its path to a Return.

> **Finding what feeds a Catch:** because the link is a `catch_id` rather than an edge, it is not visible as a connection. Select a Catch node and read its **Triggered by** list in the Properties Panel -- it lists every TRY rule that targets this Catch (step name + mode); click a row to jump to that step.

### Catch

Entry point of an error-handling path, drawn as a small funnel. A Catch carries a **`catch_id`** that must be unique within the workflow, and has only an outgoing connection -- it is reached when a TRY rule with a matching `catch_id` fires, never by an incoming edge.

- **`catch_id`** -- edit it in the Properties Panel. Renaming propagates to every TRY rule that references it, in a single undo step.
- **Triggered by** -- a read-only list of the TRY rules routing to this Catch. A Catch that has an id but no referencing TRY shows "Not referenced by any TRY", a hint that nothing reaches it yet.

**CATCH outputs.** Every CATCH carries the same four fixed, read-only outputs, which the runtime fills when the catch fires:

| Output    | Value                                             |
| --------- | ------------------------------------------------- |
| `Message` | the failed action's error message (empty if none) |
| `Reason`  | the failure mode: `ERROR`, `ABORT`, or `TIMEOUT`  |
| `Step`    | the label of the step whose TRY fired             |
| `StepID`  | the OID of that step                              |

They cannot be added, removed, or edited. To use one inside the catch network, pick it from the **Source** dropdown of a downstream step's input parameter -- the Catch appears there as a step group (`Step: CATCH (<catch_id>)`). Workflows saved before this version that bound an output to a Value Property target keep that binding; it is shown read-only under the output's name.

### Return

Ends an error-handling path and tells the runtime how to proceed once the failure has been handled. A Return is drawn as a small trapezoid and has only an incoming connection. Pick a **RETURN command** in the Properties Panel:

| Command      | Purpose                                                                                           | Extra setting |
| ------------ | ------------------------------------------------------------------------------------------------- | ------------- |
| **ABANDON**  | Give up the caught work and end the error path                                                    | --            |
| **RESTART**  | Re-run, with a **restart mode** of **CLEAN** (reset state) or **KEEP** (retain accumulated state) | restart mode  |
| **GOTO**     | Resume the main flow at a chosen step                                                             | target step   |
| **RETRY**    | Retry the action that failed                                                                      | --            |
| **COMPLETE** | Treat the failed step as handled — mark it complete and resume the normal flow                    | --            |

> The precise runtime effect of each command is defined by the Trajectory Pro Mission Control runtime engines; the editor records and validates your choice (RESTART requires a mode, GOTO requires a target step).

> **Authoring tip -- "pick how to recover" with a Select 1.** A common Catch-path pattern is a User step with a **radio** ("Retry / Continue / Abandon") feeding a [Select 1](#select-1) whose branches each end in a different Return. The radio option's **output value must exactly equal the Select 1 option's comparison Value** -- e.g. `complete` on both. If they differ (say the radio emits `complete` but the branch compares against `continue`), no option matches and Select 1 takes its **Default** option, so choosing "Continue" can silently behave like whatever Return the default branch leads to (often RETRY). That is Select 1's normal default routing, not a runtime bug -- keep the two values identical.

### Workflow-level TRY (fallback)

Select nothing on the canvas and the Properties Panel shows the current workflow's summary (see [Properties Panel](#6-properties-panel)) -- alongside its inputs, outputs, value properties, and resources, it now has its own **TRY / Error Handling** section. It uses the same **ON** / **CATCH** / **Release resources on catch** controls as a step's TRY, but scoped to the whole workflow: **ON** still picks **ERROR**, **ABORT**, or **TIMEOUT** with at most one rule per mode, and **CATCH** still targets the `catch_id` of an ordinary Catch node on the canvas -- a workflow-level rule reaches the same kind of Catch a step-level rule does.

A workflow-level TRY rule is a **fallback**: it fires for any step's failure, of any TRY-capable type, as long as that step has no TRY rule of its own for the mode that failed. Routing is checked outward from the step that actually failed:

```
Step fails with mode M
  ├─ step has TRY ON M        → step's CATCH
  ├─ workflow has TRY ON M    → workflow's CATCH
  ├─ (child) escalate to parent proxy step, repeat
  └─ root, nothing matched    → instance ERRORED
```

**Child workflows bubble up.** An uncaught failure inside a Child Workflow step is not the end of the line: it first tries that child's own workflow-level TRY, and if nothing there catches it either, the failure escalates one level up as a failure of the parent's Child Workflow step itself -- which, like any other TRY-capable step, can carry TRY rules of its own. From there the same two-level check repeats at the parent (the Child Workflow step's own TRY, then the parent workflow's TRY), and so on outward until a Catch fires or the root is reached with nothing matching. On a Catch reached this way, `Step` and `StepID` name the Child Workflow step the failure escalated through (not the step that actually failed inside the child), and `Message` carries `Uncaught <MODE> in child workflow '<name>' at step '<step>': <detail>` so the original failure is still identifiable. **RETRY** from a Catch reached this way re-runs the child workflow from scratch, not just the step that failed inside it.

> **`release_on_catch` takes effect.** The **Release resources on catch** checkbox (checked by default, on step-level and workflow-level TRY rows alike) now does what it says: when checked, the failing step's own Release resource commands run before the matching CATCH activates, whichever level of the fallback chain ends up catching the failure.

---

## 9. Notation Systems

Mission Designer supports three visual notation systems. All three represent the same workflow logic -- only the visual appearance and layout direction change.

### Flowchart Style (Default)

![Flowchart notation](/help-images/9-notation-systems-flowchart.png)

- **Layout direction:** Top to bottom
- **Start/End:** Filled circles (green/red)
- **Actions and steps:** Filled rectangles
- **Select 1 / Wait Any:** Filled diamonds (amber)
- **Parallel / Wait All:** Nested diamonds (purple)

### BPMN Style

![BPMN notation](/help-images/9-notation-systems-bpmn.png)

- **Layout direction:** Left to right
- **Start:** Thin circle outline (green)
- **End:** Thick circle outline (red)
- **Tasks:** Rounded rectangles with step-type icons
- **Exclusive Gateway (Select 1, Wait Any):** Diamond with X marker (amber)
- **Parallel Gateway (Parallel, Wait All):** Diamond with + marker (purple)

### ISA 88 Style (Procedural Function Chart)

![ISA 88 notation](/help-images/9-notation-systems-isa88.png)

- **Layout direction:** Top to bottom
- **Start/End:** Circle outlines (green/red)
- **Steps:** Rectangles with corner hierarchy lines
- **Selection (Select 1, Wait Any):** Single horizontal bar (amber)
- **Parallel (Parallel, Wait All):** Double horizontal bar (purple)

### Switching Notations

1. Click the notation dropdown in the toolbar (shows current notation, e.g., "Flowchart Style").
2. Select a different notation.
3. If the canvas has nodes, a confirmation dialog appears explaining the visual changes.
4. Click **Switch Notation** to confirm.
5. All nodes are automatically re-arranged to the new direction (left-to-right for BPMN, top-to-bottom for Flowchart and ISA 88).

Each workflow remembers its notation setting. Switching workflows restores the saved notation.

---

## 10. Environment and Action System

### Concept

Actions define reusable operations (e.g., "Send Email", "Query Sensor") with untyped inputs and outputs, passed as strings. Actions are organized into Action Libraries to aid in managing large collections of actions. Action libraries are organizational only, individual actions are linked to Environments, and Environments are downloaded to the Action execution system (Mission Autopilot).

- **Environments** group the actions available in a specific context (e.g., "Production Line", "Test Lab") and may also define value properties and resources.
- Workflows link to environments to gain access to their actions.

### State Models

Each workflow step and each Environment Action instance runs through a defined lifecycle at runtime. The diagram below shows both side by side -- the workflow step lifecycle on the left, and the action instance lifecycle (opaque and observable variants) on the right.

![Workflow Step and Environment Action Instance State Models](/help-images/10-state-models.png)

- **Workflow Step states** (left panel) -- every step begins in **Started**. If the step is waiting on resources (an acquire that hasn't completed, a sync receive, a child workflow), it moves to **Delayed (Waiting)** and stays there until the resources become available. Once they are, the step proceeds into its Environment Action: observable actions enter at **Starting**, opaque actions enter at **Posted**.
- **Opaque Action states** (top right group) -- the simplified lifecycle: **Posted -> Received -> In Progress -> COMPLETED**. The container drives the internal transitions automatically; the workflow only sees the start, the end, and any abort or stop. Opaque actions support **Abort** and **Stop**, but not **Hold** or **Suspend**.
- **Observable Action states** (bottom right group) -- the full ISA-88-inspired lifecycle: **Starting -> Execute -> Completing -> COMPLETED**, with code-driven **Hold/Unhold** through **Holding -> Held(Internal) -> Unholding**, and operator-driven **Suspend/Unsuspend** through **Suspending -> Suspended(External) -> Unsuspending**. Any active state can be **Stopped** (clean shutdown to **COMPLETED** via **Stopping -> Stopped**) or **Aborted** (error shutdown to **ABORTED** via **Aborting**).
- **Internal vs external pauses** -- **Held (Internal)** is the action pausing _itself_: code running in Execute detects a condition it cannot proceed past (for example, a downstream queue is full) and asks the container to hold. **Suspended (External)** is an operator or the runtime pausing the action from outside. The two paths share the same shape but exist for different reasons; Mission Autopilot's console help guide includes a worked example of the internal Hold/Unhold cycle.
- **SC** (Internal State Change command) annotations on the diagram mark transitions the container drives automatically once a state's code finishes. Named labels -- **Hold**, **Unhold**, **Suspend**, **Unsuspend**, **Stop**, **Abort** -- are triggered either by the action's own code or by the runtime or operator.

Workflow Editor displays each Environment Action as a single node on the canvas; the lifecycle shown above is what each action runs through inside Mission Autopilot after the workflow reaches it.

> The state names on the diagram differ slightly from the names the Action Container uses internally: **Execute** <-> **EXECUTING**, **Held (Internal)** <-> **HELD**, **Suspended (External)** <-> **PAUSED**, **Stopped** <-> **COMPLETED** via the Stop path. The behavior is the same; only the on-screen labels differ.

### Linking Environments to a Workflow

1. Open a workflow specification on the canvas.
2. In the **Specification Header** above the canvas, click the environment dropdown.
3. Select an environment specification from the grouped list.
4. The environment appears as a removable badge. Its actions become available in the Step Palette.

To remove an environment, click the **X** on its badge.

### Using Actions in a Workflow

After linking environments:

1. Drag an environment button from the Step Palette, or drag a generic "Env Action" step.
2. Double-click the node to edit properties.
3. Use the **Action Reference** dropdown to select a specific action.
4. The node's inputs and outputs auto-populate from the action specification.

### Distributed Workflow actions

The GLOBAL **Distributed Workflow Action Library** lets a workflow create and control other
runtime workflows. Add the **Distributed Workflow Management** environment to the workflow, then
use these actions in ACTION PROXY steps:

| Action                                                      | Inputs                                                   | Outputs                                   |
| ----------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------- |
| Create Runtime Workflow                                     | WorkCenter.Name, Workflow.Name, StartingParameters.Value | RuntimeWorkflow.ID, RuntimeWorkflow.Label |
| Create and Start Runtime Workflow                           | same                                                     | same                                      |
| Start / Stop / Abort / Suspend / Unsuspend Runtime Workflow | RuntimeWorkflow.ID                                       | none                                      |
| Get Runtime Workflow Status                                 | RuntimeWorkflow.ID                                       | Runtime.State                             |
| Wait for Runtime Workflow                                   | RuntimeWorkflow.ID                                       | Runtime.State (when it finishes)          |
| Get Runtime Workflow Outputs                                | RuntimeWorkflow.ID                                       | Runtime.State, Outputs                    |

Every action also returns **Completion.Code** (0 no error, 1 other error, 2 not found,
3 not permitted, 4 wrong state, 5 invalid input) and **Error.Text**. Route on the code.

- **WorkCenter.Name**: blank = this workflow's own work center; a unique name; or a path such as
  `Plant/Area A/Line 1` when names repeat.
- **Workflow.Name**: the Master Workflow's name. The in-force Effective version is used; if none,
  the newest Approved, then In Review, In Test, Draft.
- **StartingParameters.Value**: blank; `Batch=B-17; Qty=40`; `{"Batch":"B-17"}`; or bind the input
  to a whole Value Property whose entries are the parameter names.
- **RuntimeWorkflow.ID**: the ID a create action returned, or a label such as `RW-12` (this work
  center) or `Line 1/RW-12`. Bind outputs to whole Value Properties (for example `RuntimeWorkflow`
  to a property `Child`) and then pass `Child.ID` on.
- **Runtime.State** is one of Created, Starting, Running, Suspending, Suspended, Unsuspending,
  Stopping, Aborting, Completed, Stopped, Aborted, Errored, Unknown.
- Stopping or aborting a runtime that was created but never started deletes it; stopping one that
  already finished returns 0.

> **TRY and the create actions:** If the call to Mission Broker times out, the child runtime workflow may already have been created. A TRY that retries the step can then create a second one. After a timeout, check Mission Commander's runtime list before retrying.

- **Wait for Runtime Workflow** ends when the target finishes (code 0, with its final state), when
  the target no longer exists (code 2), or when the waiting workflow is itself being stopped
  (code 4). Aborting the waiting workflow ends the wait with it.
- **Time limit.** An ACTION PROXY step has no time limit by default: it waits as long as the action
  takes. To set one, enter **Time limit (seconds)** under the action in the step's properties (whole
  seconds, 1 or more); when it passes, the step fails with a timeout and the action is asked to
  abort. Leave it blank for no limit. To give up on a step with no limit, stop or abort the
  runtime (a waiting **Wait for Runtime Workflow** then ends with code 4 on Stop).

### Creating Action and Environment Specifications

1. Switch to the **Actions** or **Environments** tab in the Library Sidebar.
2. Create a library, then add specifications.
3. For actions: define inputs, outputs, properties, and visibility (opaque/observable).
4. For environments: the detail view uses a tabbed layout with five tabs:
   - **Included Actions** -- actions available in this environment, referenced by library name and action name
   - **Property Values** -- named value properties scoped to the environment
   - **Action Properties** -- value properties specific to action execution
   - **Resources** -- shared resources (Single Use, Shared Use, Count Limited, Named, Sync) that steps can acquire/release
   - **Registered Action Servers** -- servers that implement the actions defined in the environment (see below)

### Registered Action Servers

The **Registered Action Servers** tab in the Environment detail view is where you register the servers that perform the actions defined in the environment. Each entry identifies a server endpoint that the runtime can call to execute an Environment Action used by the workflow.

Each registered server has:

- **Name** -- a display name identifying the server (e.g., "Production Line Controller")
- **URI** -- the endpoint address (e.g., `https://server-address:port/api`)
- **Description** -- optional notes about the server's purpose or capabilities
- **Connection Type** -- the interface protocol used to communicate with the server. Currently only **REST** is supported; other interface types may be added in future versions.

At runtime, when a workflow step executes an Environment Action, the engine consults the list of Registered Action Servers defined in the environment to identify which server(s) can implement that action.

---

## 11. Resources

Resources model shared physical or logical assets that workflow steps must coordinate access to. Resources are defined at the workflow or environment level and consumed by steps using resource commands.

### Resource Types

| Type              | Description                                                                                 | Count                 | Configuration                 |
| ----------------- | ------------------------------------------------------------------------------------------- | --------------------- | ----------------------------- |
| **Single Use**    | Exclusive access to a single resource. Only one step can hold it at a time.                 | Fixed (1)             | Name, Description             |
| **Shared Use**    | Shared access with pool limits. Multiple steps may hold it concurrently.                    | Fixed (1)             | Name, Description             |
| **Count Limited** | A pool of identical units. Steps acquire and release a specified number of units.           | User-defined          | Name, Description, Count      |
| **Named**         | A pool of individually named items. The acquired item's name is stored in a value property. | Auto (count of names) | Name, Description, Names list |
| **Sync**          | A synchronization point for passing data between parallel branches via Send/Receive.        | Fixed (1)             | Name, Description             |

### Defining Resources

Resources can be defined at two levels:

- **Workflow level** -- In the Properties Panel when no node is selected, under the **Resources** section. These are available to all steps in the workflow and its embedded child workflows.
- **Environment level** -- In an Environment specification's resource section. These become available to any workflow that links to the environment.

To add a resource, click the **+** button and configure:

1. **Name** (required) -- Unique identifier for the resource. Spaces are automatically removed.
2. **Type** -- Select from the five resource types.
3. **Description** (optional) -- Human-readable explanation.
4. **Count** -- Editable for Count Limited type; auto-calculated for Named type; fixed at 1 for others.
5. **Names** (Named type only) -- A list of individual item names. Add or remove names with the **+** and trash buttons.

### Resource Commands

Steps consume resources through resource commands, configured in the step's Properties Panel. Commands are organized into three sections:

#### Acquire at Step Start

Claim a resource before the step executes.

| Field             | When Shown         | Description                                                                        |
| ----------------- | ------------------ | ---------------------------------------------------------------------------------- |
| **Resource**      | Always             | Select from available resources (grouped by source: Workflow, Environment, Parent) |
| **Count**         | Count Limited only | Number of units to acquire                                                         |
| **Store name to** | Named only         | Value property where the acquired item's name is stored                            |

#### Release at Step End

Release a previously acquired resource after the step completes.

| Field        | When Shown         | Description                    |
| ------------ | ------------------ | ------------------------------ |
| **Resource** | Always             | Select the resource to release |
| **Count**    | Count Limited only | Number of units to release     |

#### Sync Command

Coordinate data exchange between parallel branches. Only one sync command is allowed per step.

| Command Type    | Description                                     | Additional Fields                                                    |
| --------------- | ----------------------------------------------- | -------------------------------------------------------------------- |
| **Send**        | Send a value through the sync resource          | **Parameter to send** -- input parameter or value property reference |
| **Receive**     | Receive a value from the sync resource          | **Store received value to** -- output parameter or value property    |
| **Synchronize** | Synchronize execution without transferring data | None                                                                 |

### Execution Order

Resource commands that return values execute **before** input parameters are sent to the step. This applies to:

- **Named resource Acquire** -- The acquired item's name is stored in a value property before the step runs, so it can be referenced as a step input parameter.
- **Sync Receive** -- The received data is stored in a value property before the step runs, so it can be used as a step input parameter.

This ordering allows a step to use the acquired name or received data as part of its input, for example passing the name of an acquired machine to an action that operates on that specific machine.

### Resource Scope and Inheritance

Steps can use resources from multiple sources, listed in priority order:

1. Current workflow's own resources
2. Resources from environments linked to the current workflow
3. Parent workflow's resources (if the current workflow is an embedded child)
4. Resources from environments linked to parent workflows

The resource selector in the command editor groups available resources by source (e.g., "Workflow Resources", "Env: Production Line", "Parent: Main Process"). Each resource can only be acquired or released once per step.

---

## 12. Child Workflows

### Creating a Child Workflow

1. Drag the "Child Workflow" step from the palette onto the canvas.
2. A creation dialog appears with three modes:

| Mode                  | Description                                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Create New**        | Creates a new empty embedded sub-workflow                                                                      |
| **Copy from Library** | Copies the contents of an existing step library specification into a new embedded sub-workflow                 |
| **Reference**         | Links to an existing step library specification (changes to the library spec are shared across all references) |

3. Choose a mode, configure the options, and click **Create**.

### Navigating Child Workflows

- **Double-click** an embedded child workflow node to navigate into its canvas.
- A **Back** button appears in the toolbar to return to the parent workflow.
- Embedded child workflows inherit their parent's environment links.

### Embedded vs. Referenced

| Feature              | Embedded              | Referenced                  |
| -------------------- | --------------------- | --------------------------- |
| Editable content     | Yes                   | No (read-only)              |
| Navigate into canvas | Yes (double-click)    | No                          |
| Shares changes       | No (independent copy) | Yes (all references update) |
| Source               | Created in-place      | Links to Step Library       |

---

## 13. Export and Import

### Export Formats

| Format                         | Extension     | Description                                                                                              |
| ------------------------------ | ------------- | -------------------------------------------------------------------------------------------------------- |
| **Workflow Package**           | .WFmasterX    | Self-contained runtime ZIP with workflow, environments, actions, and images                              |
| **Workflow Library**           | .WFlibX       | Library ZIP with all dependent step, environment, and action libraries                                   |
| **Environment Library**        | .WFenvirLibX  | Library ZIP bundling one or more environments and their included actions                                 |
| **Action Library**             | .WFactionLibX | Library ZIP bundling one or more action libraries                                                        |
| **Step Library**               | .WFstepLibX   | JSON file containing a step library                                                                      |
| **Single Environment Package** | .WFenvirX     | ZIP containing a single environment spec plus the actions it includes (round-trips into one environment) |

Legacy extensions (`.WFenvir`, `.WFaction`, `.WFslib`, `.WFactionX`) are still accepted on import for backward compatibility.

### Exporting

**From the canvas toolbar (top-right):**

- **Export Workflow Package** -- Creates a .WFmasterX runtime package from the current workflow.

**From the library sidebar export menu:**

- Select a library, then click the download icon.
- For workflow libraries: creates a .WFlibX package bundling all dependencies.
- For other library types: creates a JSON library export.

### Importing

**From the library sidebar import button (upload icon):**

- Click the upload icon and select a file matching the current entity type.
- For workflow libraries: accepts both .WFlibX ZIP packages and plain JSON files.
- ZIP packages import all bundled dependencies (actions, environments, steps) automatically.
- Duplicate libraries are detected by name and entity type and skipped on import.

**From the library context menu:**

- Right-click a workflow library and select **Import Workflow Package** to import a .WFmasterX file.
- Right-click a workflow library and select **Import BatchML (ISA-88)** to import a BatchML file exported by Mission Designer (**Export as BatchML (ISA-88)** on the canvas). The embedded canonical specification is restored exactly, including files exported before the 2026-09 rename; the sidebar **Import Library** button also accepts the same .batchml.xml files for the selected workflow library.
- The imported package's actions and environments are created first, then the workflow is loaded.

### What's Inside a Workflow Package (.WFmasterX)

```
workflow.WFmaster           -- Workflow JSON (nodes, edges, properties)
environments/name.WFenvir   -- Environment library JSON files
actions/name.WFaction       -- Action library JSON files
images/filename.png         -- Referenced image files
manifest.json               -- Package metadata
```

### What's Inside a Library Package (.WFlibX)

```
library.WFlibX              -- Workflow library JSON
steps/name.WFslibX          -- Step library JSON files
environments/name.WFenvir   -- Environment library JSON files
actions/name.WFaction       -- Action library JSON files
images/filename.png         -- Referenced image files
manifest.json               -- Package metadata
```

### What's Inside a Single-Environment Package (.WFenvirX)

```
{EnvName}.WFenvir           -- The environment spec JSON (no library wrapper)
actions/{LibName}/*.WFaction -- One file per included action
manifest.json               -- packageType: "environment-package"
```

Use this format when you want to share a single environment together with the actions it
references. Import treats it as a self-contained unit and creates exactly one environment.

---

## 14. Executing a Workflow

The editor produces a workflow specification; the Trajectory Pro Mission Control runtime applications execute it. The bridge between them is the **Workflow Package** (`.WFmasterX`).

### 1. Export the workflow package

With a workflow open, use the **Export** dropdown in the top-right of the workflow editor pane and choose **Export Workflow Package**. This produces a single `.WFmasterX` file -- a self-contained ZIP that bundles the workflow, every environment and action library it depends on, and all referenced images, so it runs without any other files. (The same dropdown also offers PDF, PNG, and SVG exports for documentation and diagrams.)

### 2. Load the package into Mission Commander

Mission Commander is where a package becomes something an operator can run. Packages are loaded **into a work center** -- the work centers you load it into are the ones that can run it.

1. Open **Mission Commander** and select the work center that will run the workflow.
2. Choose **Load**. The **Load packages** dialog takes `.WFmasterX` workflow packages and `.WFenvirX` environment packages, several files at once if you like, and its **Also load into** list sends the same packages to additional work centers in the same pass.
3. Confirm with **Load**. The results panel reports each file as loaded or failed, with the reason for any failure.

### 3. Run it in Mission Pilot

Create the run in Mission Commander, then execute it in Mission Pilot:

1. In Mission Commander, from either the work center or the workflow, choose **Create Runtime Workflow**. **Create and Start** creates the run and starts it straight away; **Create and Wait** creates it and leaves it ready to start later.
2. Open **Mission Pilot** on the operator's device -- phone, tablet, or desktop browser -- sign in, and choose the work center.
3. Work waiting for that work center appears under **Available**. The operator **claims** a task, which moves it to **My tasks**, works through the screen you laid out on the UI Canvas, and **submits** it. A claimed task can be **released** back for someone else to pick up.

**Mission Engine** executes the workflow behind both apps: it advances the steps, evaluates SCRIPT and GATE logic server-side in its own sandbox, and dispatches each Environment Action to the servers registered in that environment (see [Registered Action Servers](#registered-action-servers)).

---

## 15. Version and State Management

Every specification (workflow, step, environment, or action) carries a **version** and a **lifecycle state**, and the editor keeps a history of both.

### Versions

- Each specification has a semantic version (e.g., `1.0.0`), shown on a version badge.
- Bumping the version records a history entry that links back to the previous version, so you can trace how a specification evolved.
- The version history records creation, version bumps, and state changes -- each with the account and timestamp.

### Lifecycle States

A specification moves through a defined set of states as it matures:

| State          | Meaning                            |
| -------------- | ---------------------------------- |
| **Draft**      | Work in progress, under authorship |
| **In Test**    | Being tested                       |
| **In Review**  | Awaiting approval                  |
| **Approved**   | Approved by a reviewer             |
| **Effective**  | Published and active               |
| **Superseded** | Replaced by a newer version        |
| **Obsolete**   | No longer valid                    |

Each state change is recorded in the specification's history.

### Saving

The editor **saves automatically** as you work. Edits are debounced and flushed to the server, and the toolbar's **Save** status indicator shows whether changes are pending or saved (and offers a retry if a save fails). In addition, your in-progress canvas is mirrored to the browser so it can be recovered after an unexpected close -- see [Draft Recovery](#17-draft-recovery).

---

## 16. Keyboard Shortcuts

### Editing

| Shortcut                           | Action                                                        |
| ---------------------------------- | ------------------------------------------------------------- |
| **Ctrl+C** / **Cmd+C**             | Copy selected nodes and their inter-connections               |
| **Ctrl+V** / **Cmd+V**             | Paste copied nodes (offset 20px from originals, with new IDs) |
| **Delete** / **Backspace**         | Delete selected nodes and edges                               |
| **Ctrl+Z** / **Cmd+Z**             | Undo (up to 100 states)                                       |
| **Ctrl+Shift+Z** / **Cmd+Shift+Z** | Redo                                                          |
| **Ctrl+Y** / **Cmd+Y**             | Redo (Windows alternative)                                    |

### Selection

| Shortcut                         | Action                       |
| -------------------------------- | ---------------------------- |
| **Click**                        | Select a single node or edge |
| **Shift+Click** / **Ctrl+Click** | Add to or toggle selection   |
| **Click+Drag** on empty canvas   | Box select (partial mode)    |

Keyboard shortcuts are disabled when typing in text fields, textareas, or editable labels to prevent interference with normal text editing.

---

## 17. Draft Recovery

Mission Designer automatically saves your canvas state to the browser's IndexedDB storage as you work. This includes nodes, edges, workflow properties, and images.

### Recovery on App Load

If a draft is detected when you open the application, a dialog appears:

> **Recover unsaved work?**
> Found an unsaved draft from [timestamp]. Would you like to continue where you left off?

| Button            | Action                                             |
| ----------------- | -------------------------------------------------- |
| **Recover Draft** | Loads the saved state and clears undo history      |
| **Start Fresh**   | Discards the draft and starts with an empty canvas |

### When Drafts Are Cleared

- When you choose "Start Fresh" from the recovery dialog
- When you select and load a workflow specification from the library
- When you sign out

---

## 18. User Accounts and Roles

### Role System

Each user has a set of author roles that control which library types they can create and edit:

| Role                    | Permission                                               |
| ----------------------- | -------------------------------------------------------- |
| **Workflow Author**     | Create and edit workflow libraries and specifications    |
| **Step Library Author** | Create and edit step libraries and specifications        |
| **Environment Author**  | Create and edit environment libraries and specifications |
| **Action Author**       | Create and edit action libraries and specifications      |

### Special Roles

| Role              | Permission                                                                                                |
| ----------------- | --------------------------------------------------------------------------------------------------------- |
| **Administrator** | Manage all user accounts and roles. The first registered user is automatically promoted to administrator. |

### Teams and the GLOBAL team

- Every library belongs to one team. You see the libraries of the teams you belong to; the team filter at the top of the sidebar switches between them.
- **GLOBAL (shared)** is a built-in team whose action, environment and step libraries every user can see and use — for example an action library that every team's environments include. Workflow libraries cannot be placed in GLOBAL.
- To edit GLOBAL libraries, an administrator adds you to the GLOBAL team and gives you a role there, exactly as for any other team. Without a role there, GLOBAL libraries are read-only for you.
- If your team has a library with the same name as a GLOBAL library, your team's library is the one used.
- Importing a workflow package links to a GLOBAL library of the same name instead of making a copy in your team.
- Administrators can move an existing library to or from GLOBAL from **Admin → Libraries → Move library**.

### Account Management

Administrators can manage user accounts by clicking the user icon in the top-right corner. From the Account Management dialog, administrators can:

- View all registered users
- Assign or remove author roles
- Grant or revoke administrator and global privileges
- **Set password** -- give any account a new password (signs that user out everywhere). Use it for accounts restored from a backup, which may arrive without a password.

---

## 19. File Format Reference

### File Extensions

| Extension     | Full Name                      | Format      | Entity Type                         |
| ------------- | ------------------------------ | ----------- | ----------------------------------- |
| .WFmasterX    | Workflow Master Package        | ZIP         | Workflow (runtime, all deps inline) |
| .WFlibX       | Workflow Library Bundle        | ZIP or JSON | Workflow library                    |
| .WFenvirX     | Single Environment Package     | ZIP         | One environment + included actions  |
| .WFenvirLibX  | Environment Library Bundle     | ZIP         | Environment library                 |
| .WFactionLibX | Action Library Bundle          | ZIP         | Action library                      |
| .WFstepLibX   | Step Library                   | JSON        | Step library                        |
| .WFenvir      | Environment Spec (inside ZIPs) | JSON        | Single environment                  |
| .WFaction     | Action Spec (inside ZIPs)      | JSON        | Single action                       |

Legacy/back-compat extensions still accepted on import:

| Extension               | Replaced by   |
| ----------------------- | ------------- |
| .WFslibX                | .WFstepLibX   |
| .WFenvirX (no manifest) | .WFenvirLibX  |
| .WFactionX              | .WFactionLibX |

### Schema Version

All exports use schema version 4.0. The schema uses snake_case field names in exported JSON (converted from camelCase internal representation). Older schema versions (1.0, 2.0, 3.0) are automatically migrated on import.

### Identifiers

Mission Designer uses Snowflake OIDs (Ordered Identifiers) -- 64-bit IDs that encode a timestamp, entity type, and sequence number. These replace UUIDs from earlier versions and are generated client-side.
