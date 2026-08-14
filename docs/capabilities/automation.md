# Automation

Automations turn a reusable prompt into a manual workflow or a cron-based scheduled task. They are managed under `/automations`.

## Build a workflow

A workflow stores a name, description, icon, prompt, focus mode, Chat model, optional System model, persona prompts, and one optional research methodology. Its prompt can declare inputs in a frontmatter block and reference them in the body.

Example:

```text
---
topic:
tone: select | options=Formal, Casual | default=Formal
notes: longtext | optional
---
Research {{topic}} in a {{tone}} voice. Include {{notes}} when provided.
```

Fields are required unless marked `optional`. Supported input types are text, longtext, select, and multi. Select and multi fields declare options. Prompts can also use `{{@today}}`, `{{@now}}`, date offsets such as `{{@today-7d}}`, and `{{@today:long}}`; escape braces when literal `{{` or `}}` are needed. The builder validates the syntax and previews the fill form before saving.

A workflow's stored models and instructions are the configuration for its runs. It does not silently inherit the current chat's model, workspace, MCP servers, memory, panel selection, or personalization.

## Run a workflow manually

Choose **Run** on a workflow, fill its required fields, and submit. YAAWC creates a normal chat containing the substituted prompt, starts the run, and routes you to that chat. The run can continue in the background and can be continued like another conversation after it finishes.

Manual workflow runs use the workflow's selected focus mode, models, persona prompts, and methodology. They do not attach workspace files or workspace tools, use MCP tools, retrieve or extract memory, or run Agent Panel fan-out.

## Schedule a workflow

Create one or more schedules for a workflow. A schedule stores a label, the saved input values, a cron expression, an optional timezone, enabled state, and an optional retention override. The scheduler runs enabled schedules in-process while the application is running.

The Scheduled Tasks page shows the cron description, enabled/disabled state, active run, last status, last error, and a link to the latest run chat. You can run a schedule immediately, edit it, toggle it, or delete it. Deleting a workflow or schedule does not delete past run chats.

If a workflow edit makes a saved schedule fill set invalid, the schedule is disabled with a reason. Update its inputs or edit the workflow before enabling it again.

## Headless behavior

Scheduled runs are headless. They persist a chat and answer without waiting for a person, so code execution, ask-user questions, workspace edits, and other approval-gated actions cannot complete as they do in an interactive chat. Scheduled runs do not perform automatic memory extraction. Deep research can be requested through a saved focus configuration, but its nested live activity is not represented in the scheduled result in the same way as an interactive stream.

A manual workflow run is continuable, but it still uses the workflow's stored non-workspace configuration rather than the page from which it was launched.

## Retention and availability

Scheduled-run retention can use the global policy in **Settings → Retention** or a per-schedule override:

- **Keep for N days** removes runs older than the configured number of days.
- **Keep N most recent** keeps the newest N runs for that schedule.
- **Disabled** keeps scheduled runs until they are deleted manually or by another data action.

Pinned chats are not removed by regular chat or scheduled-run retention. Private-session expiry is separate; scheduled runs are not private sessions.

A workflow needs a valid Chat model and, where selected, a valid System and embedding model. A schedule also needs valid required input values and an enabled workflow. Provider outages, invalid models, disabled schedules, and prompt validation errors are recorded as run or schedule errors rather than producing a misleading success.

## Privacy and storage

Workflow definitions, schedules, input values, run status, and generated run chats are stored in the local YAAWC database. The substituted prompt and answer are sent to the providers selected by the workflow. Configure the workflow with the minimum data and retention period it needs. See [Privacy and data](./privacy-and-data.md) and [Models and providers](./models-and-providers.md).
