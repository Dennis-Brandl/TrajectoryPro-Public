# Trajectory Pro Mission Control

Trajectory Pro Mission Control is a suite of applications for designing workflows, running
them in work centers, and executing the hard coded actions that they use. Workflow specifications are
authored in Mission Designer and exported as packages; Mission Commander loads them into work
centers and creates runtime workflows; Mission Engine advances each runtime workflow step by
step, serving operator steps to Mission Pilot and dispatching environment actions to Mission
Autopilot.

The following files illustrate all of the features of the Trajectory Pro Mission Control.

## Installing The Suite
There are some steps to follow to get started.
- Clone the GitHub repo to your local system.
- A simple way to start is to use Docker Desktop to build the suite.
  - Docker Desktop has an AI agent "Gordon" which you can use to build the suite.
  - Ask it to "Build the system from the source in ..." and give it the folder you cloned into.
- You can also build the suite yourself. Run these commands from the folder you cloned into:

```bash
sh scripts/setup-secrets.sh
docker compose up --build -d
(cd MissionDesigner && docker compose up --build -d)
```

## Creating the Starting Accounts, Teams, Libraries, and Work Centers

### Start Mission Designer
- If you used Docker Desktop, point your browser to <http://localhost:3000/login>
- At the startup screen create at least one administrator account.
- Create a starting team. (ex: Testing)
- Accept all of the default role specifications, you don't need to use them to start. These roles define which users can perform specific actions on the different libraries.
- On the **Workflows** tab, use the import button (upload icon) in the library sidebar to import "Workflow Test Library(1.0.0).WFlibX".
- Check that you now have a list of sample workflows in the **Workflows** tab.
- Check that you now have a list of sample Environment Libraries in the **Environments** tab.
- Check that you now have a list of sample Action Libraries in the **Actions** tab.

### Start Mission Commander
- If you used Docker Desktop, point your browser to <http://localhost:3005/login>
- At the startup screen create an administrator account.
- Under the left side **Roles** tab, create some sample UI roles (ex: Primary Tester, Secondary Tester, Reviewer).
- Under the left side **Users** tab create other users.
- Under the left side **Work Centers** tab create a work center (ex: Testing Center).
- In the Work Center, under the **Users** tab, add the users with **Add User**, then use **Roles…** on each user's row to assign the UI roles.

### Export a Workflow and then Execute it
Mission Designer and Mission Commander operate independently of each other. This allows for multiple teams, such as project teams or corporate teams to create workflows, which can be executed in different environments, such as multiple sites, buildings, or areas. The only connection between the two is through exported and imported workflow package files.
- In Mission Designer
  - Select a sample workflow, such as **Spaghetti Bolognese Dinner**.
  - Export the workflow in Mission Designer using the **Export** button and the *Export as Workflow ZIP* option.
- In Mission Commander
  - Import the workflow into your Work Center using the **Load packages…** button.
  - In the Work Center, under the **Workflows** tab, use **Roles…** to add one or more UI Roles to the workflow. This defines which users can see and perform the User Interface steps.
  - Run **Create Runtime Workflow…** using the *Create and Start* button.
- In Mission Pilot
  - If you used Docker Desktop, point your browser to <http://localhost:3006>
  - Log in using one of the accounts you created in Mission Commander and choose your Work Center.
  - You will see the UI step.


## Working with Mission Autopilot and Mission Broker

Mission Autopilot executes Python Code to implement Environment Actions.
Mission Broker is a service that handles the Distributed Workflow Actions.

### Installing the Mission Autopilot Sample Code
If you used Docker Desktop, point your browser to <http://localhost:3003> to start the Mission Autopilot console. You will see a screen to enter the API key.
The key is ACTIONS_API_KEY in the *.env* file next to *docker-compose.yml*.
This is a secret key that allows Mission Engine and the console to communicate with the Mission Autopilot server.

After signing in, go to the **Environments** page and use **Upload Package** to import the following files. These files contain the sample environments and associated Python code:
- Cross Workflow Sync.WFenvirBundleX
- Kitchen.WFenvirBundleX
- Moma Jane's Pizza Environment.WFenvirBundleX
- TRY-CATCH Environment.WFenvirBundleX

### Linking Mission Commander to the Action Servers

You must link Mission Commander to Mission Autopilot and Mission Broker. There are two configurations to set.

In Mission Commander, in the **Settings** screen you can specify either **Strict** or **Loose** action server trust. Strict is the default. With Strict, you must list the addresses of the trusted servers, and an empty list refuses every server. In the Docker installation the servers are:
- http://mission-autopilot-server:3002
- http://mission-broker:3007

In Mission Commander, in the Work Center under the **Env Specs** tab, there is a list of the environments loaded into the Work Center. Enter the action server address for each environment that needs one, then click **Save**. When a workflow, using the environment, executes in the work center, it will use the action server to communicate to either Mission Broker or Mission Autopilot using a REST protocol.

http://mission-broker:3007 is used for Mission Broker, and http://mission-autopilot-server:3002 is used for Mission Autopilot.

You are now ready to execute workflows that use Environment Actions and that use the Distributed Workflow Libraries.

From Mission Designer, export the workflow *Test of Kitchen Actions* and load it into your Work Center, or load *Test_of_Kitchen_Actions(1.0.0).WFmasterX* from the *Individual Workflow Tests* folder. This adds the *Kitchen* environment to the **Env Specs** tab, where you enter its action server. Then start the workflow from Mission Commander. Under the left **Runtime** tab you will see the running workflows.

### Using the Distributed Workflow Libraries
The Distributed Workflow actions let a running workflow create, start, control, and wait for other runtime workflows. These actions run on Mission Broker, so there is no code to import into Mission Autopilot.

The following files are for Mission Designer. You don't need them for the samples, because "Workflow Test Library(1.0.0).WFlibX" already includes these libraries. Use them to add the libraries to another team or another Mission Designer. Mission Commander cannot load these files.

| File | In the library sidebar, go to | Contains |
| --- | --- | --- |
| Distributed Workflow Environment Library(1.0.0).WFenvirLibX | **Environments**, import button (upload icon) | The *Distributed Workflow Management* environment and the action library it uses |
| Distributed Workflow Action Library(1.0.0).WFactionLibX | **Actions**, import button (upload icon) | The ten actions only |

Importing the environment library also brings in the action library, so you normally need only that file.

These sample workflows use the Distributed Workflow libraries and Mission Broker:
- **Test Distribution of Workflows** tests the Distributed Workflow actions. **Simple Single Step** is the workflow to use with it.
- **Pizza - Counter Order Screen** and **Pizza - Make and Cook** are the Pizza examples.

To run them:
- Load the workflows into your Work Center. A workflow that is created by another workflow must be loaded too, so load both workflows of each pair.
  - The Pizza packages are in the *Individual Workflow Tests* folder.
  - Export **Test Distribution of Workflows** and **Simple Single Step** from Mission Designer, because they are not in that folder.
- In the Mission Commander **Settings** screen, make sure http://mission-broker:3007 is in the list of trusted servers.
- In the Work Center, under the **Env Specs** tab, set the action server for each environment and click **Save**:
  - *Distributed Workflow Management*: http://mission-broker:3007
  - *Moma Jane's Pizza Environment*: http://mission-autopilot-server:3002
- A workflow can always control runtime workflows in its own Work Center. To reach another Work Center, it needs a grant on the **Controls** tab of the Work Center that does the controlling.

See [The Distributed Workflow Library](docs/DISTRIBUTED_WORKFLOW_LIBRARY.md) for the full guide.
