# Mission Designer Web Site {#trajectory-master-data-web-site .TOC-Heading}

# Introduction

Project Trajectory[^1] is the development of a distributed workflow system
for individuals and work groups using personnel devices such as
smartphones and tablets, and for area, site, or enterprise level
workflow systems using standard IT equipment.

A workflow defines any activity that is a sequence and/or set of actions
that must be performed to accomplish a goal. Examples of consumer
workflow types include exercise routines, party planning, recipes, trip
planning, and instruction manuals. Examples of business workflow types
include expense report filling, weekly activity checklists, and service
call resolution checklist. Examples of manufacturing workflows include
recipe execution, equipment startup procedures, equipment shutdown
procedures, and emergency response procedures. Workflows can be
triggered by external event, time, location, messages or any other
defined event.

Workflows are generated within a department or group in a company,
across the entire company, or even across companies in a supply chain.
Workflow requirements often change and require distributed workflows to
be revised or replaced. This work describes a set of applications and
interface specifications that allow for exchange of workflow
specifications and communication of triggers and information between
independent workflow execution environments.

Trajectory is envisioned as a crowd sourcing application, with individuals
authoring workflows that can be downloaded and executed by other users.
For example, a person may author a recipe as a workflow and upload it to
the Trajectory website for distribution. Each workflow is defined as a set
of actions and their sequencing[^2]. A user may then download the recipe
workflow and execute it on their smartphone or tablet, and the workflow
would walk the user through the actions of the recipe[^3].

Trajectory Pro is envisioned as an area, site and enterprise level set of
applications to create Master Workflows, manage Master Workflow
libraries, manage Master Action libraries, create and execute Runtime
Workflows, and provide a set of preengineered Runtime Actions and
environments.

Trajectory will include a limited set of default actions, in an action
library, which will handle a majority of the anticipated initial uses.
Additional action libraries may be created by users for custom
functionality. For example, a travel agency may define a workflow action
that retrieves the lowest price for a plane flight. This action could
then be used inside a trip planning workflow.

Trajectory's income model is multi-fold:

- Income from ads on the Trajectory web site.

- Income from protected workflows. Workflow authors will have the
  ability to sign and protect their workflows and require a fee or
  license to run the workflow. This will be enabled through a public key
  / private key mechanism. The income will come from the fee to manage
  the public/private key mechanism.

- Income from protected action libraries. Action library editors will
  have the ability to distribute their libraries and require a fee or
  license to run the actions. This will be enabled through a public key
  / private key mechanism. The income will come from the fee to manage
  the public/private key mechanism.

- Leasing/subscription model for support of area, site, or enterprise
  level workflow creation and management.

## Trajectory Pro

The default Trajectory Pro version consists of:

- A template for a vendor defined website that contains Master Workflow
  Specifications, a set of Master Action Specifications, a set of
  Runtime Action Realizations, and a set of Master Environment
  Specifications.

- A Runtime Workflow Execution system which is available on PCs, tablets
  and smart phones. It contains the built-in Runtime Actions, a set of
  Runtime Workflow Environments, loaded with the execution system, and
  the set of default Runtime Action Realizations, loaded with the
  execution system.

- A template for a system to create and manage Master Action
  Specifications, which the vendor may use to create a system for their
  environment.

- A template for a Runtime Action Execution system, which the vendor may
  use to create a system for their specific actions and execution
  environment.

![](media/image2.emf){width="4.0625in" height="3.0343810148731407in"}

# Specification Scope

## Main Functions

This specification is for the web site that supports develop and
management of:

1.  Master Action Libraries and Master Action Specifications

2.  Master Environment Libraries and Master Environment Specifications

3.  Master Workflow Step Libraries and Master Workflow Steps

4.  Master Workflow Libraries and Master Workflow Specifications

## Import and Export Functions

1.  Export and import of Master Action Libraries

2.  Export of Master Action Libraries and Master Action Specifications
    in a JSON format using the JSON Schema listed below.

3.  Import of Master Action Libraries and Master Action Specifications
    in a JSON format using the JSON Schema listed below.

4.  Export of Master Environments Libraries and Master Environments
    Specifications in a JSON format using the JSON Schema listed below.

5.  Import of Master Environments Libraries and Master Environments
    Specifications in a JSON format using the JSON Schema listed below.

6.  Export of Master Workflow Step Libraries and Master Workflow Step
    Libraries in a JSON format using the JSON Schema listed below.

7.  Import of Master Workflow Step Libraries and Master Workflow Step
    Libraries in a JSON format using the JSON Schema listed below.

8.  Export of Master Workflow Libraries and Master Workflow Steps in a
    JSON format using the JSON Schema listed below.

9.  Import of Master Workflow Libraries and Master Workflow Steps in a
    JSON format using the JSON Schema listed below.

10. The web site must support importing elements from exported files

11. The web site must support exporting elements to files

### Managed Element JSON Schema

    {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "$id": "https://trajectorypro.io/schemas/managed-element.json",
      "title": "Managed Workflow Element",
      "type": "object",
      "properties": {
        "local_id": { "type": "string" },
        "uuid": { "type": "string", "format": "uuid" },
        "description": { "type": "string" },
        "version": { "type": "string" },
        "last_modified_date": { "type": "string", "format": "date-time" }
      },
      "required": ["local_id", "uuid", "version", "last_modified_date"]
    }

### Managed Workflow Step Base JSON Schema

    {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "$id": "https://trajectorypro.io/schemas/master-workflow-step-base.json",
      "title": "Master Workflow Step Base",
      "description": "The base structure for both Master Workflow Steps and Master Workflow Library Steps.",
      "allOf": [
        { "$ref": "managed-element.json" }
      ],
      "type": "object",
      "required": ["step_type"],
      "properties": {
        "step_type": {
          "type": "string",
          "enum": [
            "START",
            "END",
            "WAIT ACTION PROXY",
            "NOWAIT ACTION PROXY",
            "WORKFLOW PROXY",
            "SELECT 1",
            "WAIT ANY",
            "PARALLEL",
            "WAIT ALL",
            "MATH",
            "SCRIPT"
          ],
          "description": "The functional type of the workflow step."
        },
        "resource_command_specifications": {
          "type": "array",
          "description": "Commands to acquire or release resources during step execution.",
          "items": {
            "type": "object",
            "required": ["command_type", "resource_name"],
            "properties": {
              "command_type": {
                "type": "string",
                "enum": ["Acquire", "Release", "Acquire Pool Amount", "Release Pool Amount"],
                "description": "The action to perform on the resource."
              },
              "resource_name": { "type": "string" },
              "amount": {
                "type": "integer",
                "description": "Used for Pool Amount commands."
              }
            }
          }
        },
        "value_property_specifications": {
          "type": "array",
          "description": "Named values used as input/output parameters.",
          "items": {
            "type": "object",
            "required": ["name"],
            "properties": {
              "name": { "type": "string" },
              "default_value": { "type": "string" },
              "description": { "type": "string" }
            }
          }
        },
        "input_parameter_specifications": {
          "type": "array",
          "description": "Parameters passed as strings with optional schema validation.",
          "items": {
            "type": "object",
            "required": ["id", "default_value"],
            "properties": {
              "id": { "type": "string" },
              "description": { "type": "string" },
              "default_value": { "type": "string" },
              "json_schema": { "type": "string" }
            }
          }
        },
        "output_parameter_specifications": {
          "type": "array",
          "description": "Named output placeholders.",
          "items": {
            "type": "object",
            "required": ["id"],
            "properties": {
              "id": { "type": "string" },
              "description": { "type": "string" }
            }
          }
        },
        "connection_references": {
          "type": "array",
          "description": "References to Workflow Step Connections that define the execution order.",
          "items": {
            "type": "string",
            "format": "uuid"
          }
        }
      }
    }

### Master Action Library JSON Specification

    {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "$id": "https://trajectorypro.io/schemas/master-action-library.json",
      "title": "Master Action Library",
      "description": "A collection of Master Actions Specifications.",
      "allOf": [
        { "$ref": "managed-element.json" }
      ],
      "type": "object",
      "required": ["action_specifications"],
      "properties": {
        "action_specifications": {
          "type": "array",
          "description": "List of UUIDs and/or full specifications contained in the library.",
          "items": {
            "$ref": "master-action-specification.json"
          }
        }
      }
    }

### Master Action Specification JSON Schema

    {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "$id": "https://trajectorypro.io/schemas/master-action-specification.json",
      "title": "Master Action Specification",
      "description": "A template for information exchanged during Runtime Action Realization.",
      "allOf": [
        { "$ref": "managed-element.json" }
      ],
      "type": "object",
      "properties": {
        "input_parameter_specifications": {
          "type": "array",
          "description": "Untyped parameters passed as strings.",
          "items": {
            "type": "object",
            "required": ["id", "default_value"],
            "properties": {
              "id": { "type": "string" },
              "description": { "type": "string" },
              "default_value": {
                "type": "string",
                "description": "All values are represented as strings per spec."
              },
              "json_schema": {
                "type": "string",
                "description": "Optional schema for type checking of input values."
              }
            }
          }
        },
        "output_parameter_specifications": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["id"],
            "properties": {
              "id": { "type": "string" },
              "description": { "type": "string" }
            }
          }
        },
        "property_specifications": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["name"],
            "properties": {
              "name": { "type": "string" },
              "default_value": { "type": "string" },
              "description": { "type": "string" }
            }
          }
        }
      }
    }

### Master Environment Library JSON Schema

    {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "$id": "https://trajectorypro.io/schemas/master-environment-library.json",
      "title": "Master Environment Library",
      "description": "A collection of Master Environment Specifications.",
      "allOf": [
        { "$ref": "managed-element.json" }
      ],
      "type": "object",
      "required": ["environment_specifications"],
      "properties": {
        "environment_specifications": {
          "type": "array",
          "description": "The list of Master Environment Specifications within this library.",
          "items": {
            "$ref": "master-environment-specification.json"
          }
        }
      }
    }

### Master Environment Specification JSON Schema

    {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "$id": "https://trajectorypro.io/schemas/master-environment-specification.json",
      "title": "Master Environment Specification",
      "description": "A collection of Master Action IDs and property specifications used by Master Workflow Specifications.",
      "allOf": [
        { "$ref": "managed-element.json" }
      ],
      "type": "object",
      "required": ["included_actions"],
      "properties": {
        "included_actions": {
          "type": "array",
          "description": "Actions included in this environment, inlined with their full MasterActionSpecification body so the environment file is self-contained for runtime / Action Server consumers. action_name + action_library are the cross-package join keys; the remaining fields mirror a .WFaction action_specifications entry.",
          "items": {
            "type": "object",
            "required": ["action_name", "action_library"],
            "properties": {
              "action_library": { "type": "string", "description": "Source action library name. Cross-package join key." },
              "action_name":    { "type": "string", "description": "Action name. Mirrors local_id when the body is inlined." },
              "local_id":       { "type": "string", "description": "Action local_id (same value as action_name when present)." },
              "oid":            { "type": "string", "description": "Action OID." },
              "description":    { "type": "string" },
              "version":        { "type": "string" },
              "last_modified_date": { "type": "string", "format": "date-time" },
              "action_visibility":  { "type": "string", "enum": ["opaque", "observable"] },
              "input_parameter_specifications":  { "type": "array" },
              "output_parameter_specifications": { "type": "array" },
              "property_specifications":         { "type": "array" }
            }
          }
        },
        "value_property_specifications": {
          "type": "array",
          "description": "Definition of named values in master elements.",
          "items": {
            "type": "object",
            "required": ["name"],
            "properties": {
              "name": { "type": "string" },
              "default_value": { "type": "string" },
              "description": { "type": "string" }
            }
          }
        },
        "resource_property_specifications": {
          "type": "array",
          "description": "Templates for creating resource property realizations.",
          "items": {
            "type": "object",
            "required": ["name", "resource_type"],
            "properties": {
              "name": { "type": "string" },
              "resource_type": {
                "type": "string",
                "enum": [
                  "binary exclusive use",
                  "binary shared use with pool limits",
                  "countable use with pool limits"
                ],
                "description": "The specific logic for resource access control."
              },
              "use_limit": {
                "type": "integer",
                "description": "Optional limit for shared or countable resources."
              },
              "description": { "type": "string" }
            }
          }
        }
      }
    }

### Master Workflow Step Library JSON Schema

    {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "$id": "https://trajectorypro.io/schemas/master-workflow-step-library.json",
      "title": "Master Workflow Step Library",
      "description": "A collection of Master Workflow Library Steps.",
      "allOf": [
        { "$ref": "managed-element.json" }
      ],
      "type": "object",
      "required": ["library_steps"],
      "properties": {
        "library_steps": {
          "type": "array",
          "description": "A collection of steps with the same structure as Master Workflow Steps.",
          "items": {
            "$ref": "master-workflow-step-base.json"
          }
        }
      }
    }

### Master Workflow Library JSON Schema

    {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "$id": "https://trajectorypro.io/schemas/master-workflow-specification.json",
      "title": "Master Workflow Specification",
      "description": "A workflow template used to create RunWFs.",
      "allOf": [
        { "$ref": "managed-element.json" }
      ],
      "type": "object",
      "required": ["steps", "connections"],
      "properties": {
        "steps": {
          "type": "array",
          "items": { "$ref": "master-workflow-step-base.json" }
        },
        "connections": {
          "type": "array",
          "description": "Defines the execution order by connecting steps into a network.",
          "items": {
            "type": "object",
            "required": ["from_step_id", "to_step_id"],
            "properties": {
              "from_step_id": { "type": "string", "format": "uuid" },
              "to_step_id": { "type": "string", "format": "uuid" }
            }
          }
        },
        "resource_command_specifications": { "type": "array", "items": { "type": "object" } },
        "value_property_specifications": { "type": "array", "items": { "type": "object" } },
        "starting_parameter_specifications": {
          "type": "array",
          "items": { "type": "object" },
          "description": "Optional set of starting parameter specifications."
        },
        "output_parameter_specifications": {
          "type": "array",
          "items": { "type": "object" },
          "description": "Optional set of output parameter specifications."
        }
      }
    }

## Editing and Management Functions

1.  The web site should use a tree hierarchy on the left sidebar for the
    libraries.

2.  The web site should have a top tab bar that contains an undo and
    auto layout button in addition to bringing up separate pages for:

    a. Workflows -- Bring up the tree of master workflow libraries,
    user can select a library, then select a workflow, the drawing
    pane is then used to create or edit a graphical; workflow
    diagram.

    b. Step Libraries -- Bring up the tree of master workflow step
    libraries, user can select a library, then select a master
    workflow library step, the drawing pane shows a form for
    creating/editing the workflow step information.

    c. Environments - Bring up the tree of master environment
    libraries, user can select a library, then select a master
    environment specification, the drawing pane shows a form for
    creating/editing the list of master action specifications in the
    master environment specification.

    d. Actions - Bring up the tree of master action libraries, user can
    select a library, then select a master action specification, the
    drawing pane shows a form for creating/editing the master action
    specification information.

3.  Selecting an action, environment, or library step should show a form
    in the middle drawing pane for entering information

## Workflow Editing Functions

When operating in the Workflow editing page:

1.  The available step types are shown as symbols in the left sidebar.

2.  The symbols for the step types are:

    a. START -- A circle with one connection point, only one outgoing
    connection allowed and the word "START" in the circle.

    b. END -- A circle with one connection point, only one incoming
    connection allowed and the word "END" in the circle

    c. ACTION -- A rounded rectangle with only one incoming and one
    outgoing connection allowed, and the name of the action in the
    rectangle. If the action is a WAIT ACTION PROXY then show a
    small hourglass in the bottom right corner of the rectangle.

    d. SUB-WORKFLOW -- A rounded double outline rectangle with only one
    incoming and one outgoing connection allowed, and a name of the
    sub-workflow in the rectangle.

    e. SELECT 1 -- A diamond with one incoming connection and multiple
    outgoing connections allowed. Each outgoing connection has an
    associated check of the form: property / equal, not equal, less
    then, less than or equal to, greater than, greater than or equal
    / property of value. The resulting expression, such as ABC=23,
    is displayed at the head of the connection arrow as plain text
    (not box).

    f. WAIT ANY -- A diamond with multiple incoming connections and one
    outgoing connection.

    g. PARALLEL -- A double outlined diamond with one incoming
    connection and multiple outgoing connections.

    h. WAIT ALL -- A double outlined diamond with multiple incoming
    connections and one out going connection.

    i. MATH -- future function -- Grayed out and not selectable for
    this version.

    j. SCRIPT -- future function -- Grayed out and not selectable for
    this version.

3.  Connections between steps are shown as arrows. The connection lines
    should not be curved.

4.  When editing a workflow, when a step is selected the step's
    information (parameters, etc.) should be shown in the right sidebar.

5.  The workflow editing pane should allow for the following
    presentation selections for a workflow:

    a. Flowchart style -- The connections are on the top and bottom of
    the symbols, so that the diagram is read from top to bottom.

    b. BPMN Style -- The connections are on the left and right sides of
    the symbols, so that the diagram is read from left to right.
    BPMN -- Business Process Modeling Language.

    c. ISA 88 Batch Style -- The connections are on the top and bottom
    of the symbols, so that the diagram is read from top to bottom.
    The following symbols are used:

        i.  BEGIN -- An upside-down triangle, no text in the triangle

        ii. END -- A triangle, no text in the triangle.

        iii. ACTION -- a rectangle with the name of the action in the
             rectangle

        iv. SUB-WORKFLOW -- A rectangle, with a small "+" sign in the
            top right corner, and the name of the action in the
            rectangle.

        v.  SELECT 1 -- A horizontal line with outgoing connection
            points spread out on the line. The line is resizable to
            increase the number of outgoing connections.

        vi. WAIT ANY -- A horizontal line with incoming connection
            points spread out on the line. The line is resizable to
            increase the number of incoming connections.

        vii. PARALLEL - A double horizontal line with outgoing
             connection points spread out on the line. The line is
             resizable to increase the number of outgoing connections.

        viii. WAIT ANY -- A double horizontal line with incoming
              connection points spread out on the line. The line is
              resizable to increase the number of incoming connections.

6.  The editing pane should support undo.

7.  The editing pane should support auto layout, using the center of the
    symbols to line up elements.

# Use Cases

The use cases are conceptual examples of user interfaces. The actual
user interface will evolve during implementation. The purpose of the use
cases is to show the expected actions of different users.

There are three user types defined:

1.  Action Creators -- These are users that create new Master Action
    Specifications and code Runtime Action Realizations.

2.  Workflow Creators -- These are users that create new Master
    Workflows Specifications, Master Workflow Steps, and Master Workflow
    Library Steps.

3.  Workflow Users -- These are users that use the workflows.

## Workflow Creator use cases

Table 1 -- Workflow Creator Use Cases

+-------------+--------------------------------------------------------+
| Use Case | Description |
+=============+========================================================+
| Creation of | 1. Workflow Creator obtains 1 or more Master |
| a Master | Environments |
| Workflow | |
| | 2. Workflow Creator creates a Master Workflow using |
| | the actions available in Master Environments. |
| | |
| | 3. The workflow author creates a new workflow, using |
| | a graphical editor. The editor allows the user to |
| | create workflows by dropping actions on a |
| | workspace and connecting the actions together |
| | using directed arrows. |
| | |
| | 4. Workflow Creator makes the Master Workflow |
| | available for creation of a Runtime Workflow. |
| | |
| | ![](media/image3.emf){width="4.805555555555555in" |
| | height="0.8860433070866142in"} |
+-------------+--------------------------------------------------------+

## Action Creator use cases

+--------------+--------------------------------------------------------+
| Creation of | 1. Action Creator browses current Master Action |
| a | Specifications in a Master Action Environment. |
| downloadable | |
| Runtime | 2. Action Creator determines that a new action is |
| Action | needed in the environment. |
| Realization | |
| | 3. In a test system, the Action Creator creates a new |
| | Master Action Specification. |
| | |
| | 4. Action Creator codes the Runtime Action |
| | Realization logic that implement the new Master |
| | Action Specification, in a downloadable form, for |
| | one or more target hardware environments. |
| | |
| | 5. Action Creator installs a Runtime Action |
| | Environment in a test system and tests the action. |
+==============+========================================================+

## Workflow User use cases

Table 2 -- Workflow User Use Cases

+-------------+--------------------------------------------------------+
| Select | 1. User clicks on phone/tablet icon to bring up |
| workflow | Trajectory. |
| from | |
| website and | 2. User browses website to select a workflow. |
| start | |
| workflow | 3. User obtains the master workflows. |
| | |
| | 4. User starts workflow. |
| | |
| | 5. The execution system creates a Runtime Workflow |
| | and links it to a Runtime Action Environment |
| | |
| | 6. User starts the Runtime Workflow. |
| | |
| | 7. User enters initial information, such as |
| | parameters or execution environment, and enters |
| | START to start workflow execution. |
| | |
| | ![](media/image4.emf){width="4.375in" |
| | height="1.7083333333333333in"} |
+=============+========================================================+
| Continue | 1. User clicks on phone/tablet icon to bring up |
| workflow | Trajectory. |
| execution | |
| | 2. The Trajectory screen displays the active and paused |
| | workflows (shown here in a up/down list) |
| | |
| | 3. Workflow user clicks on a selected active workflow |
| | |
| | 4. The system displays the current step(s) of the |
| | resumed workflow |
| | |
| | 5. Workflow user enters step information and |
| | continues workflow. |
| | |
| | ![](media/image5.emf){width="4.375in" |
| | height="1.7083333333333333in"} |
+-------------+--------------------------------------------------------+
| Continue a | 1. User clicks on phone/tablet icon to bring up |
| paused | Trajectory. |
| workflow | |
| | 2. The Trajectory screen displays the active and paused |
| | workflows (shown here in a up/down list) |
| | |
| | 3. Workflow user clicks on a selected paused workflow |
| | |
| | 4. The execution system sends a RESUME to the |
| | workflow |
| | |
| | 5. The system displays the current step(s) of the |
| | resumed workflow |
| | |
| | 6. Workflow user enters step information and |
| | continues workflow. |
| | |
| | ![](media/image6.emf){width="4.375in" |
| | height="1.7083333333333333in"} |
+-------------+--------------------------------------------------------+
| External | 1. Workflow is executing in the background, and an |
| event | event occurs that will fire off an action |
| triggers | (example: Email received, text message received, |
| workflow | timer expired) |
| resume. | |
| | 2. If the action is defined as non-HMI interrupting, |
| | then the action indicator is displayed on the |
| | screen (top line icon in the Android or iPhone) |
| | |
| | 3. User clicks the Trajectory icon. |
| | |
| | 4. Trajectory brings up the To Do Action List with the |
| | triggered action selected. |
| | |
| | 5. Workflow user selects the workflow and goes to a |
| | screen that displays the action. |
+-------------+--------------------------------------------------------+
| Show | 1. User selects an active step (note, there may be |
| history of | multiple active staps from multiple workflows |
| previous | available) |
| steps | |
| | 2. Workflow user brings up menu and selects "Show |
| | History" to see previous steps of the workflow |
| | associated with the selected active step. |
| | |
| | ![](media/image7.emf){width="2.8645833333333335in" |
| | height="1.6979166666666667in"} |
+-------------+--------------------------------------------------------+
| Show next | 1. User selects an active step (note, there may be |
| steps | multiple active staps from multiple workflows |
| | available) |
| | |
| | 2. Workflow user brings up menu and selects "Show |
| | Next" to see next steps of the workflow associated |
| | with the selected active step. These are steps |
| | until a selection in the workflow procedure, where |
| | the future path is not known. |
| | |
| | 3. User completes the current action and the action |
| | is removed from current action list and would be |
| | visible on the past step list. |
| | |
| | ![](media/image8.emf){width="2.8645833333333335in" |
| | height="1.6979166666666667in"} |
+-------------+--------------------------------------------------------+
| User | The user is prompted to take an action and/or answer a |
| performs | question. Each action may fill the screen, or fill a |
| action | smaller portion of the screen on a tablet. |
| | |
| | The following illustrate some sample actions; |
| | instruction with a Yes/No selection, a list of |
| | checkboxes, an instruction with just an OK, and an |
| | action which uses the smartphone's camera to scan a |
| | barcode and make the value available for next steps in |
| | the workflow. |
| | |
| | ![](media/image9.emf){width="4.889583333333333in" |
| | height="1.695138888888889in"} |
+-------------+--------------------------------------------------------+
| Pending | 1. User is notified that a manually gated workflow |
| manually | step has been triggered. |
| gated | |
| workflow | 2. User sees all active steps assigned to the user |
| step | and selects step to execute. |
| | |
| | 3. User executes the step's instructions and |
| | indicates completion of the action. |
| | |
| | ![](media/image10.emf){width="4.383333333333334in" |
| | height="1.7013888888888888in"} |
+-------------+--------------------------------------------------------+
| Workflow | A runtime workflow executes a step that triggers an |
| starts | action in another device (for example, the action |
| action in | performs a remote database query). The workflow waits |
| another | until a COMLETED response and output parameters are |
| device | received. |
| | |
| | ![](media/image11.emf){width="2.71875in" |
| | height="1.8020833333333333in"} |
+-------------+--------------------------------------------------------+
| Workflow | A Runtime Workflow executes a step that starts a |
| starts a | workflow in another device (for example a step in a |
| workflow in | invoicing workflow queues and payment workflow to be |
| another | started). First workflow waits until COMPLETED |
| device and | received from the second workflow. |
| waits for | |
| completion | ![](media/image12.emf){width="4.302083333333333in" |
| | height="1.8541666666666667in"} |
+-------------+--------------------------------------------------------+
| Workflow | A Runtime Workflow executes a step that a workflow in |
| starts a | another device, and is informed when the triggered |
| workflow in | workflow is POSTED, but does not wait for the second |
| another | workflow to complete. |
| device and | |
| does not | ![](media/image13.emf){width="4.302083333333333in" |
| wait for | height="1.8541666666666667in"} |
| complete | |
+-------------+--------------------------------------------------------+

## Execution Environment use cases

+--------------+--------------------------------------------------------+
| Different | 1. User selects a Master Workflow and an execution |
| execution | environment and creates a Runtime Workflow. |
| environments | |
| | 2. The runtime workflow determines the appropriate or |
| | selected execution environment. |
| | |
| | 3. The execution environment defines the action logic |
| | to be executed (for example, there may be |
| | different Runtime Action code in a PC and a Tablet |
| | environment). |
| | |
| | ![](media/image14.emf){width="4.447916666666667in" |
| | height="1.5587926509186352in"} |
+==============+========================================================+
| Different | Systems performing actions change, but the |
| Execution | coordinating workflow remains the same. |
| Environments | |
| | ![](media/image15.emf){width="5.290510717410323in" |
| | height="3.4791666666666665in"} |
+--------------+--------------------------------------------------------+

# Implementation Models

## Workflow Data Models

### Conceptual Main systems and Data Objects

The following model defines main systems and data objects of the system.

![](media/image16.emf){width="7.0in" height="6.134027777777778in"}

### Object Types and Property Types

The following model shows:

1.  The "is a type of" relations,

- Managed Workflow Element is an abstract type.

- Master Workflow Libraries, Master Environment Libraries, Master Action
  Libraries, and Master Workflow Step Libraries are subtypes of Managed
  Workflow Elements

- Managed Instance Elements and Managed Master Elements are abstract
  types and are subtypes of Managed Workflow Elements

2.  Which objects have value property specifications,

3.  Which objects have value property realizations (actual values),

4.  Which objects have resource command specifications,

5.  Which objects have resource commands,

6.  Which objects have resource property specifications,

7.  Which objects have resource property realizations.

![](media/image17.emf){width="7.0in" height="5.616666666666666in"}

### Data Objects

#### Master Action Library (MasActLib)

A MasActLib is a collection of Master Actions Specifications.

A MasActLib is a specialized type of Managed Workflow Element.

Contains a local identification and UUID of the MasActLib, an optional
description of the MasActLib, a version number, and the last modified
date.

#### Master Action Specification (MasActSpec)

A template and description for the information to be exchanged when
performing a Runtime Action Realization.

Contains a local identification and UUID of the MasActSpec, an optional
description of the MasActSpec, a version number, and the last modified
date.

The specification does not define the logic in the action, it does
contain the input parameters specifications, output parameters
specifications, and property specifications.

- Input parameter specifications contain an ID, optional description, a
  default value and an optional JSON schema.

- Parameters are not typed and all values are represented as strings.
  This includes single values, arrays, structures, and other complex
  types.

- The JSON schema is used to provide type checking of input values
  against conformance criteria.

<!-- -->

- Output parameter specifications contain an ID and optional
  description.

#### Master Environment Library (MasEnvLib)

A MasEnvLib is a collection of Master Environment Specifications.

A MasEnvLib is a specialized type of Managed Workflow Element.

Contains a local identification and UUID of the MasEnvLib, an optional
description of the MasEnvLib, a version number, and the last modified
date.

#### Master Environment Specification (MasEnvSpec)

A MasEnvSpec is a collection of IDs of Master Actions Specifications
that may be referenced by a Master Workflow Specification.

Contains:

- a local identification and UUID of the MasEnvSpec,

- an optional description of the MasEnvSpec,

- a version number,

- the last modified date,

- a list of value property specifications, and

- a list of resource property specifications.

Master Workflow Steps in a Master Workflow Specification that reference
Actions may only use Master Action Specifications that are identified in
the Master Environment Specification.

#### Master Workflow Library (MasWFLib

A MasWFLib is a collection of Master Workflow Specifications.

A MasWFLib is a specialized type of Managed Workflow Element.

#### Master Workflow Step Library (MasWFStepLib)

A MasWFStepLib is a collection of Master Workflow Library Steps.

#### Master Workflow Specification (MasWFSpec)

A MasWFSpec contains:

- a collection of MasWFSteps and Workflow Step Connections,

- an optional set of Resource Command Specifications,

- an optional set of Value Property Specifications,

- an optional set of starting parameter specifications, and

- an optional set of output parameter specifications.

A MasWFSpec is a workflow template used to create RunWFs.

A MasWFSpec is a specialized type of Managed Master Element and Managed
Workflow Element.

#### Master Workflow Step (MasWFStep)

A MasWFStep contains an optional set of:

- Resource Command Specifications,

- Value Property Specifications,

- Input parameter specifications with default values,

- Output parameter specifications

A MasWFStep references zero or more Workflow Step Connections.

#### Master Workflow Library Step (MasWFLibStep)

A MasWFLibStep has the same structure as a MasWFStep.

### Workflows

Workflows are represented as a collection of steps and connections.

Master Workflow Steps and Master Workflow Library Steps have the same
structure.

1.  Master Workflow Specifications and Master Workflow Steps contain
    values for default value properties and resource properties.

#### Workflow Step Types

Step types are:

1.  START -- Defines the initial step in a workflow. There are no
    incoming connections. It may contain resource commands (ex: acquire
    resources) and completes when the resources are acquired and the
    outgoing connection is made active.

2.  END -- Defines the final step in a workflow. It may contain resource
    commands (ex: release resources) and completes when the resources
    are released. There are no outgoing connections. If the workflow is
    a sub-workflow then any input parameters are sent to the parent
    workflow as output parameters.

3.  WAIT ACTION PROXY -- Defines an action to be performed. It contains
    the information needed to exchange information with the Runtime
    Action Realization and Runtime Action Instance. Any step input
    parameters are sent to the action as action input parameters. Any
    received output parameters from the action are passed to the step's
    output parameters. The step waits until the action is COMPLETED
    before continuing and the outgoing connection is made active.

4.  NOWAIT ACTION PROXY -- Defines an action to be performed. It
    contains the information needed to exchange information with the
    Runtime Action Realization and Runtime Action Instance. Any step
    input parameters are sent to the action as action input parameters.
    Any received output parameters from the action are passed to the
    step's output parameters. The step does not wait until the action is
    COMPLETED before continuing and the outgoing connection is made
    active.

5.  WORKFLOW PROXY -- Defines a sub-workflow to be performed. It
    contains the identification of the sub-workflow. Any step input
    parameters are sent to the sub-workflow as input parameters. Any
    received output parameters from the sub-workflow are passed to the
    step's output parameters. The step waits until the sub-workflow ENDs
    before continuing and the outgoing connection is made active.

6.  SELECT 1 -- Defines a step with multiple outgoing connections, with
    only one connection selected at a time. The set has one input
    parameter. Each outgoing connection contains a value, the connection
    value that matches the input parameter is made active. There is one
    connection defined as the default connection to use if none of the
    values match.

7.  WAIT ANY -- Defines a step with multiple incoming connections. The
    step waits until any incoming connection is made active, then the
    step completes and the outgoing connection is made active.

8.  PARALLEL -- Defines a set with multiple outgoing connections. All
    outgoing connections are made active.

9.  WAIT ALL -- Defines a set of multiple incoming connections. When all
    incoming connections are active the step completes and the outgoing
    connection is made active.

10. MATH -- (FOR A FUTURE VERSION) Defines a set of mathematical
    equations that are executed. The step input is a list of assignment
    expressions. The left side of the assignment are output parameters.
    The right side of the assignment are simple expressions support
    numbers, strings, input parameters, and output parameters. A MATH
    step is an opaque step.

> Example EBNF:
>
> _(\* Assignment Statements Grammar \*)_
>
> _Assignment Step = { assignment } ;_
>
> _assignment = Output Parameter , \"=\", expression, \";\" ;_
>
> _expression = term, { (\"+\" \| \"-\"), term } ;_
>
> _term = factor, { (\"\*\" \| \"/\"), factor } ;_
>
> _factor = Input Parameter_
>
> _\| Output Parameter_
>
> _\| number_
>
> _\| string_
>
> _\| \"(\", expression, \")\" ;_
>
> _variable = letter, { letter \| digit \| \"\_\" } ;_
>
> _number = \[ \"-\" \], digit, { digit }, \[ \".\", digit, { digit } \]
> ;_
>
> _string = \'\"\', { string_char }, \'\"\'_
>
> _\| \"\'\", { string_char }, \"\'\" ;_
>
> _string_char = ? any character except quote marks and newlines ? ;_
>
> _letter = \"a\" \| \"b\" \| \"c\" \| \"d\" \| \"e\" \| \"f\" \| \"g\"
> \| \"h\" \| \"i\" \| \"j\"_
>
> _\| \"k\" \| \"l\" \| \"m\" \| \"n\" \| \"o\" \| \"p\" \| \"q\" \|
> \"r\" \| \"s\" \| \"t\"_
>
> _\| \"u\" \| \"v\" \| \"w\" \| \"x\" \| \"y\" \| \"z\"_
>
> _\| \"A\" \| \"B\" \| \"C\" \| \"D\" \| \"E\" \| \"F\" \| \"G\" \|
> \"H\" \| \"I\" \| \"J\"_
>
> _\| \"K\" \| \"L\" \| \"M\" \| \"N\" \| \"O\" \| \"P\" \| \"Q\" \|
> \"R\" \| \"S\" \| \"T\"_
>
> _\| \"U\" \| \"V\" \| \"W\" \| \"X\" \| \"Y\" \| \"Z\" ;_
>
> _digit = \"0\" \| \"1\" \| \"2\" \| \"3\" \| \"4\" \| \"5\" \| \"6\"
> \| \"7\" \| \"8\" \| \"9\" ;_

11. SCRIPT -- (FOR A FUTURE VERSION) The step executes a JAVA script
    that uses the properties as variables. When the script completes a
    COMPLETED state is entered. A SCRIPT step is an opaque step.

#### Workflow Step Connections

Workflow Step Connections define the structure of the workflow by
connecting Workflow Steps into a network.

The connections defined the execution order of steps. Each Workflow Step
Connections contains a FROM connection, which specifies what step it
comes from, and a TO connection which specifies what step it goes to.

In the example below there is a Workflow Step Connection between the
Assign Local Lot ID and the exclusive gateway (merging).

![](media/image18.emf){width="7.0in" height="2.6944444444444446in"}

#### Built-in Actions

There are multiple different types of built-in actions in the Runtime
Workflow System:

1.  User Interface Action: The action contains a list of input
    parameters and the list of output variables that will contain the
    returned values.

    a. Text

        i.  Input parameter -- text to be displayed

    b. Text and Check Box

        i.  Input parameters -- text to display and list of check box
            texts

        ii. Output parameter -- selected text

    c. Text and Entry

        i.  Input parameter -- test to be displayed

        ii. Output parameter -- entered text

    d. Text and Typed Entry

        i.  Input parameter -- test to be displayed and JSON schema of
            allowed text

        ii. Output parameter -- entered text

    e. Text and Select Multiple

        i.  Input parameter -- text to be displayed and list of selected
            texts

        ii. Output parameter -- list of returned selected texts

    f. Display URL

        i.  Display the URI web site

2.  Service Action: An action which contains actions that can be
    immediately executed within the scope of the Runtime Action
    Execution System:

    a. Wait for a specified delay time (DELAY)

    b. Wait for a specified time of day (TIME)

    c. Wait for a specified date and time (DATE)

    d. Wait until at a specified location (LOCATION)

    e. (FUTURE REQUIREMENT) Receipt of an Email with the specified
    subject line (EMAIL)

    f. (FUTURE REQUIREMENT) Receipt of a text message with the
    specified text (TEXT)

3.  Management Action: An action which contains the information to
    change the state of another workflow, workflow step, or workflow
    action. This includes:

    a. Pausing another workflow, step, or action

    b. Resuming another workflow, step or action

    c. Stopping another workflow, step, or action

    d. Aborting another workflow, step, or action

4.  Remote Action: The action contains the name of a Master Workflow to
    be executed, and the list of input parameters to be used to start
    the Runtime Workflow. The following logic is used to determine the
    status of a remote workflow

    a. Status of POSTED when the start message is posted

    b. Status of RECEIVED when a response is received that the message
    was delivered

    c. Status of IN PROGRESS sent on the completion of the first step
    in the work flow, captured with the time of the step. This
    allows the sender to determine if there is any progress on the
    remote workflow.

    d. Complete sent on the completion of the workflow, along with any
    output parameters defined form the workflow.

### Properties

#### Value Property Specification

Value properties specifications are the definition of named values in
master elements that can be identified as input parameters to a step or
places to put output parameters from the execution of a step.

They contain a name for the property, an optional default value for the
property, and an optional description of the property. This information
is used to create a Value Property Realization.

Value property specifications are name / default value pairs.

#### Value Property Realizations

Value property realizations are where the actual values are maintained
in runtime elements.

Value property realizations are name / actual value pairs.

Value property realizations are used to hold information passed to
actions and nested workflows, and to store information returned from
actions and nested workflows.

### Resources

Resources may represent physical equipment, logical equipment, or
abstract limited availability objects or information

The system allows for single use resources, multiple use resources with
limits, and named resource pools.

Allow for acquiring and releasing resources within workflows and
environments, and acquiring partial resources

#### Resource Property Specifications

Resources are specific properties that are managed by the runtime
execution system. They provide a method to control access to limited use
capabilities. The resources may represent physical entities, such as
Bags or Totes, virtual entities, or any other entity type.

Resource Property Specifications are used as templates for creating
Resource Property Realizations from master elements. They contain a name
of the resource, the type of resource (binary exclusive use, binary
shared use with use limits, or shared use with use limits), an optional
use limit, and an optional description of the resource.

Resource acquiring requests are queued. Requests on single and multiple
use resources are served on a first come first served basis. (NOTE: In
order to prevent deadlocks, all requests from a single runtime are
alphabetically sorted by resource name.)

The Resource Property Specifications define resource properties in
master definitions.

- Single use resource -- The property represents a single resource that
  can only be used by one runtime workflow at a time.

- Multiple use resource -- The property represents a set of resources
  that can be used by multiple runtime workflows at the same time, but
  that have a limit on multiple use.

- Resource Amount Pool -- The property represents a set of named
  resources that can be used by multiple runtime workflows at the same
  time, with each resource in the pool independently identified.

#### Resource Property Realizations

Resource Property Realizations are name/value pairs used to hold
information for the management of resources.

Resource Property Specifications define resource pools in runtime
definitions.

- Single use resource -- Contains a named resource property.

- Multiple use resource -- Contains a named resource property and a
  maximum use count.

- Resource Amount Pool -- Contains a named resource pool property with a
  set of named pool elements.

Resource types:

- Binary exclusive use -- Only one RunWF, RunWFStep, or RunWFStepIns at
  a time may use the resource. For example: a single mixer used by
  multiple kitchen lines.

- Binary shared use with pool limits -- Multiple RunWF, RunWFStep, and
  RunWFStepIns may use the resource at the same time, until the resource
  count reaches zero. Each acquire of the resource decreases the
  available count by one. Each release of the resource increases the
  availability count by one. For example: a set of knifes used by
  multiple cooks, but each cook only uses one knife at a time.

- Countable use with pool limits - Multiple RunWF, RunWFStep, and
  RunWFStepIns may use the resource at the same time, until the resource
  count reaches zero. Each acquire of the resource decreases the
  available count by the count specified by the acquire. Each release of
  the resource increases the availability count by the amount specified
  by the release. For example: a pool of mixing bowls, each with an ID,
  when each workflow may require a different number of bowls, and the
  bowls must be identified to be cleaned after use.

#### Resource Command Specifications

Resource command specifications are the definition of resource commands
in master definitions. The following commands for resources are:

- Acquire -- Identifies a resource to be acquired before the step can
  continue.
  - Example: Acquire _Mixer_

- Release -- Identifies a resource to be released.
  - Example: Release _Mixer_

- Acquire Pool Amount -- Identifies the amount of a resource to be
  acquired from a resource pool.
  - Example: Acquire 3 Bags from Bag Pool, returns IDs 123, 456,789

- Release Pool Amount -- Identifies the amount of a resource to be
  returned to the resource pool.
  - Example: Return 3 Bags to the Bag Pool, with IDs 123, 456, 789

#### Resource Commands

Resource commands are the definition of resource commands in runtime
definitions.

Resource Command behavior for steps:

- Acquire -- The step is put into the WAITING state until all the
  identified resources are acquired by the step.
  - Single Use Resource -

  - Resource Pool -- A local resource pool ID is returned for each
    resource acquired.

- Release -- When the step is COMPLETED all identified resources are
  released .

- Acquire Amount -- The step is put into the WAITING state until all
  identified resources are acquired at the requested amounts.

### Parameters

All input and output parameters of a Runtime Workflow are also Value
Properties.

#### Parameters in Master Elements

- _Master Workflow Step_, _Master Workflow Library Step_, and _Master
  Action Specification_ input parameters are not typed -- passed as
  strings.
  - EXAMPLES: abbbbc, 0110110, \[1,2,3,4\], ...

- Input parameter specification may optionally include a JSON
  specification to support restrictions on inputs, and representations
  of complex types, arrays, and structures:
  - EXAMPLES: {\"type\": \"string\", \"pattern\": \"\^ab+c\$\"}

> {\"type\": \"string\", \"pattern\": \"\^\[01\]+\$\"}
>
> {\"type\": \"array\", \"items\": {\"type\": \"number\"},\"minItems\":
> 5,\"maxItems\": 5}

- Output parameters are not typed -- returned as strings

#### Parameters in Runtime Workflow Elements

> _Runtime Workflows_ and _Runtime Workflow Steps_ Input parameters
> reference properties in the workflow or environment hierarchy where
> the value is obtained.

- EX: specification of _CheckID_ (Input _ID_, Output _Valid_)
  - _ID_ may be a constant value

  - _ID_ may identify a ValPropReal of the RunWFStep

  - _ID_ may identify a ValPropReal of the RunWFStep's parent, or
    parent's parent, up to the Runtime Workflow

  - _ID_ may identify a ValPropReal property of the Runtime Workflow

  - _ID_ may identify a ValPropReal property of the Runtime Workflow
    Environment

  - _ID_ may identify a ValPropReal property of the Runtime Workflow
    Environment's parent, up to the top level Runtime Workflow
    Environment

- _(FUTURE REQUIREMENT) Runtime Workflow_ Input parameters may be simple
  mathematical and string expressions

> _Runtime Workflow_ Output parameters reference objects in the workflow
> environment where the returned value is to be placed.

- EX: specification of _CheckID_ (Input _ID_, Output _Valid_)
  - _Valid_ may identify a ValPropReal in the workflow step

  - _Valid_ may identify a ValPropReal of the workflow step's parent,...

  - _Valid_ may identify a ValPropReal of the workflow

  - _Valid_ may identify a ValPropReal of the Runtime environment

  - _Valid_ may identify a ValPropReal of the Runtime environment's
    parent, ...

### Environment Specifications

For each created Master Environment Specification, assign it a UUID.

For each MasterWorkflow Specification, assign it a UUID, and contain the
list of UUIDs of the Master Environment Specifications.

For each created Master Action Specification, assign it a UUID.

For each created Runtime Action Environment, assign it a UUID, and store
the UUIDs of the related Master Environment Specifications and related
Master Action Specifications.

### Independent Systems

#### Master Workflow Information System

The Master Workflow Information System is the application, collection of
applications, or services that provide the functionality of creating
Master Workflow Specifications, Master Workflow Steps, Master Workflow
Step Libraries, and Master Workflow Library Steps. It uses the
information from the Master Environment System to access Master
Environment Specifications, which define the Master Action
Specifications available for linking to Master Workflow Steps and Master
Workflow Library Steps.

The Master Workflow Information System makes Master Workflow
Specifications available to a Runtime Workflow Execution System.

A Master Workflow Information System creates and manages one or more
Master Workflow Libraries and zero or more Master Workflow Step
Libraries.

#### Master Environment Information System

The Master Environment Information System is the application, collection
of applications, or services that provide the functionality of creating
and managing Master Environment Specifications.

The Master Environment Information System makes Master Environment
Specifications available to a Master Information Workflow System.

A Master Environment Information System creates and manages one or more
Master Environment Libraries.

#### Master Action Information System

The Master Action Information System is the application, collection of
applications, or services that provide the functionality of creating and
managing Master Action Specifications.

The Master Action Information System makes Master Action Specifications
available to a Master Environment Information System, and to systems
used to create Runtime Action Realizations.

A Master Action Information System creates and manages one or more
Master Action Libraries.

# Security Considerations

## Trajectory Pro

- Control who can get a Master Workflow Specification based on security
  access rights.

# Security Architecture

The following table summarizes the four levels of security discussed
above.

---

                Transport      Uses      Encrypts  Uses Identity  Role-Based  3^rd^ Party   End-to-end     Suitable for
                  Layer      Security    Security   Certificate     Access        KMS       encryption
                Security      Token       Tokens                   Control

---

**Security False True/False False False False False False Development and
Level 1** Testing
environment

**Security True True True False True/False False False Intra-enterprise
Level 2** connectivity

**Security True True True True True True/False False Inter-Enterprise
Level 3** connectivity

**Security True True True True True True True Highly secure
Level 4** environments

---

[^1]: Trajectory is the working name, a market name to be decided later

[^2]:
    There may be sequential, parallel or conditional actions in a
    workflow

[^3]:
    Users will be able to execute multiple workflows simultaneously,
    such as running a main course recipe and desert recipe at the same
    time, or running an exercise routine while also working on an
    expense report procedure.
