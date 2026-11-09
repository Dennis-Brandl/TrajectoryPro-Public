# Mission XO Help

Mission XO is the Steward's console for one work center. Use it to start workflows, watch what is running, step in when something needs a person, and look back at what happened. It works on a desktop, a tablet and a phone.

This guide is organized by task. Find what you want to do and follow the steps.

---

## Signing in

1. Open Mission XO in your browser.
2. Enter your email and password and click **Sign in**.

You use the same account and password as in Mission Commander, but Mission XO keeps its own sign-in: signing in or out here does not change who is signed in to Commander in the same browser, and the other way round. Mission XO is for Stewards and Administrators. If your account is not one of those, XO tells you so and you can sign out.

## Choosing a work center

After you sign in, XO opens on **Choose a work center**. Pick the work center you look after. XO remembers your choice and opens it straight away next time.

Some work centers show **View only**. That means you can see everything but you are not a Mission System Commander there, so the buttons that change things are turned off. Ask an administrator for the role if you need to act.

The work center screen has four tabs: **Available** (the workflows you can start), **Running**, **History** and **Schedules**.

## Starting a workflow

1. Open the **Available** tab.
2. Choose a workflow from the list. A workflow that is still a draft carries a **Draft** badge, so you know it has not been released.
3. Fill in the starting parameters. If a value is resolved for you, XO shows it.
4. Click **Start**.

**Start** is the only button. XO always starts the run right away. If you leave the form with values typed in, XO asks before it discards them.

When the run starts, XO takes you to it on the **Running** tab.

## Watching what is running

The **Running** tab lists the runs in your work center. Use the chips above the list to narrow it:

- **Active · n** runs that are going now.
- **Waiting · n** runs that are waiting.
- **Finished** runs that have ended.
- **All** everything.

Two markers tell you where to look first:

- **Needs attention** is a group at the top of the list. It holds runs that are paused or have failed, so a person should look.
- **Waiting for operator** appears on a run's row when one of its steps is waiting for someone at Mission Pilot to pick it up. Open the run and its step list shows how long that step has waited, for example "Waiting for operator, 12 min".

Select a run to see its steps, its step log, its starting parameters, shared state, resources and any child runs. On a wide screen the list and the detail sit side by side. On a phone, selecting a run opens it full screen, and **Back** returns to the list.

If the connection drops, a banner reads **Not connected — last updated hh:mm**. The screen then shows the last information XO received. It catches up on its own when the connection returns.

## Pausing, stopping and aborting

A selected run has a bar of controls. A button is greyed out when it does not apply to the run's current state.

- **Pause** holds a running run. It turns into **Resume** when the run is paused.
- **Stop** asks you to confirm, then stops the run after its current work. Its cleanup steps still run.
- **Abort…** asks you to confirm, then aborts the run. An aborted run cannot be resumed. Its cleanup steps still run.

If a Stop or Abort is waiting on its cleanup and you do not want to wait, a **More** menu appears with the faster options. Each one asks you to confirm:

- **Stop now** skips the cleanup and stops straight away. The cleanup steps are halted.
- **Abort now** skips the cleanup and aborts straight away. The cleanup steps are halted.
- **Delete** removes the run from the work center. It is offered only for a run that has not started or that has ended as completed, stopped, aborted or failed.

The **More** menu only appears when at least one of its items applies.

Every one of these records you as the requester. The record in History shows who asked for the stop or abort.

## Assigning, releasing and force-completing a step

Open a run and look at its steps. The actions sit under the step they apply to, and only appear when they make sense:

- **Assign…** appears on a step that has been offered to operators. It gives the step to a particular person.
- **Force release** appears only on a step that an operator has already claimed. It takes the step back so someone else can pick it up.
- **Force complete…** appears only on a waiting GATE step, or a waiting repeating SCRIPT step. It completes the step without waiting. XO asks for a **reason**, and you cannot continue without one. You are recorded as the requester.

These actions are not shown once the run has ended, or when the work center is **View only**.

Use force complete sparingly. It moves the workflow on without the work being done.

## Schedules

The **Schedules** tab shows workflows that start by themselves at set times, and the chains that start when a run ends. Two kinds of schedule are listed:

- **Runtime Schedules** come first. Each is a working copy that is actually starting workflows, with its label (for example `RS-12`), its status (Active, Paused, Cancelled or Finished), and the next start time in the work center's time zone. A **Needs attention** marker means a workflow failed to start, a run was lost, or start times were missed during an outage. Select one to see its workflows as a tree, what each run did, and a log of who did what.
- **Master Schedules** are the definitions, in a compact list. Click **Enable Recurrence** on one to make a Runtime Schedule that follows its timetable. A dialog shows the first start times and any warning before you confirm. **Run Once** starts the schedule one time, now or at a date and time you choose, and can overlap anything already running. A **Manual** schedule, such as an incident response, has no timetable and starts only this way.

On a Runtime Schedule you can:

- **Pause** it, so nothing new starts. Runs already going carry on.
- **Resume** it. If starts were missed, or chained workflows are waiting, the Resume dialog asks what to do: **Start all**, **Start only the latest** or **Skip them all** for the missed starts, and a tick box for each waiting chained workflow (ticked means it starts). Nothing is chosen for you when more than one start was missed.
- **Cancel** it. XO asks for a reason. Nothing new starts, including chains from runs still going. Runs already going carry on.
- **Remove** it from the list once it is Finished or Cancelled and its runs have ended. The History records of its runs stay.
- **Disable** or **Re-enable** one workflow in the tree. A disabled workflow does not start, so its own chain cannot start either. It is not caught up when re-enabled.
- **Dismiss** a failed or lost workflow, or **Dismiss all**, once you have seen it. There is no retry: start the workflow by hand from **Available**.

XO has no editor. Writing and changing a Master Schedule, and deleting one, are done in Mission Commander. In a **View only** work center, the buttons that change things are turned off. The full explanation, with examples, is in the Workflow Schedules section of the Mission Commander help.

![XO's Schedules view on a phone](/xo/help-images/18-xo-schedules-phone.png)

## History and the record PDF

The **History** tab lists finished runs. Narrow the list with:

- **Search by workflow**, to find runs of one workflow.
- **From** and **To**, the date range. It starts as the last 7 days.
- **Result**, to show all results or only Completed, Failed, Stopped or Aborted runs.

Select a run to open its record. The record is laid out the same way as the PDF: the starting parameters, the steps with who performed them and when, signatures, and the outputs. Times are shown in the work center's time zone.

Click **Download PDF** to save the record as a PDF file.

A completed pass of a schedule also appears in the list, with a dashed border, the schedule's name, and a result such as **Done** or **Problems**. Select it to see each workflow the pass started, with its runtime ID, times, how it ended and its starting values. Tap a runtime ID to open that workflow's record. A Result filter shows workflow runs only.

## Using XO on a tablet or phone

XO adapts to the screen. On a tablet it shows the list and detail side by side. On a phone it shows one at a time.

To install it like an app, use your browser's own option: **Install** on Chrome and Edge, or **Add to Home Screen** on Safari and Android browsers. XO then opens full screen from its own icon.

XO looks for a new version every few minutes, and whenever you come back to its tab. When one is ready, a bar reads **A new version is available — Reload**. Click **Reload** to switch now. Otherwise XO switches by itself when you leave its tab, or after two minutes without typing or tapping, so a form you are filling in is not lost.

## What XO does not do

Mission XO is for running the day. These jobs are done in Mission Commander. Use **Open Mission XO** in the Commander header to come here, and sign in to Commander to do these:

- Users and roles.
- Libraries and loading packages.
- Work-center setup.
- Branding and settings.
- Deleting history.
- Creating a run without starting it.
- Writing and editing Master Schedules.
