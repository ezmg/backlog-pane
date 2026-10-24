# backlog-pane

A live [Backlog.md](https://github.com/MrLesk/Backlog.md) board in a Claude Code side pane.

> **Unofficial.** backlog-pane is a community mod for Claude Code. It is not part of,
> endorsed by, or maintained by the Backlog.md project or Anthropic. It only drives the
> `backlog` CLI you already have installed.

`/backlog` opens a pane beside the conversation with your tasks grouped by status. The pane
stays in sync with `backlog task list --json --watch`, so it updates when Claude, you or
your teammates change a task. Pick a task to read its description, acceptance criteria and
implementation plan. You can change its status, or press **Work on this task** to put a
ready-made prompt in the prompt box. The prompt is **never sent for you**.

## Features

- **Live board.** Tasks are grouped by status in your configured order. The final status
  (usually *Done*) starts folded and shows only its most recent tasks.
- **Task details.** Description and implementation plan are rendered as Markdown, and the
  acceptance criteria as a checklist.
- **Change status** with a picker. The picker lists your configured statuses.
- **Create a task** from a title.
- **Work on this task** drafts this prompt, using the task's real ID (whatever your
  project's prefix is):

  ```text
  Work on BL-7 only. Research the codebase and write an implementation plan in the task. Wait for my approval before coding.
  ```

  If the prompt box already holds text, the draft is added below it. Nothing is submitted.
- **CLI only.** Every change runs a `backlog` command (`task edit`, `task create`). The mod
  never edits the Markdown files itself.
- **Clear errors.** The pane tells you, with a **Retry** button, when the CLI is not
  installed, the folder has no Backlog.md project, or the live list keeps failing.

## Screenshots

<!-- Replace these with real captures: docs/screenshots/terminal-board.png,
     docs/screenshots/terminal-task.png, docs/screenshots/desktop-board.png -->

_Screenshots are coming. Until then, this is a text preview of the terminal pane:_

```text
┌ Backlog ─────────────────────────────────┐
│ [ New task title            ] [ Create ] │
│                                          │
│ To Do (2)                                │
│ BL-2 Add login                           │
│ BL-5 Rate limiting                       │
│                                          │
│ In Progress (1)                          │
│ BL-1 Write parser 1/2                    │
│                                          │
│ ▸ Done (12)                              │
└──────────────────────────────────────────┘
```

## Requirements

- **Claude Code** with mods: the CLI from v2.1.287, or the Code tab of the Claude Desktop
  app from v2.1.286. Developed against v2.1.308.
- **Backlog.md CLI** on the machine, with JSON output (`schemaVersion` 1). Tested with
  1.55.3.

  ```bash
  npm i -g backlog.md
  ```

  `bun add -g backlog.md` and `brew install backlog-md` also work.
- A project initialized with `backlog init`. The pane uses the session's working folder.

## Install

At the prompt of a Claude Code terminal session:

```text
/plugin install backlog-pane --marketplace ezmg/backlog-pane
```

Answer `y` to add the marketplace, then choose a scope (user scope is the default).

From a shell:

```bash
claude plugin install backlog-pane --marketplace ezmg/backlog-pane
```

**Claude Desktop (Code tab).** `/plugin` does not run there. Click **+** next to the prompt
box, then **Plugins**, **Add marketplace** with `ezmg/backlog-pane`, then **Add plugin**.
A mod you install from a terminal at the user scope also loads in the desktop app's local
sessions.

## Usage

1. Open a session in a folder that has a Backlog.md project.
2. Run `/backlog`.
3. Click a task, or give the pane the keyboard with `ctrl+x` then `tab`. In the pane, Tab
   moves between controls and Esc returns to the prompt.
4. In a task, change **Status**, or press **Work on this task** and review the draft
   before you press Enter.

To close the pane, click its close mark or press `ctrl+x` then `x`. Closing it stops the
`--watch` process.

### Options

| Option | Default | What it does |
| --- | --- | --- |
| `backlogPath` | *(empty)* | Full path to the `backlog` executable. When empty, the mod tries `backlog` on PATH. On Windows it then tries the native binaries npm and bun install globally. |
| `doneLimit` | `5` | How many of the most recent tasks in the final status are listed when that group is unfolded. |

Change them under the plugin's settings in `/plugin`. In a session that loads the mod from
a folder, they appear as rows in `/config`.

## Where it works

| Where | What you get |
| --- | --- |
| Terminal (`claude`) | The full pane. In fullscreen it docks beside the transcript from 110 columns; otherwise it opens inline above the prompt. |
| Claude Desktop, Code tab | The full pane. |
| VS Code extension | The full pane (same elements as desktop). Not tested by hand. |
| Mobile (Remote Control) | Minimal: browse tasks, change status with one button per status. No task creation, because the surface has no text field. |
| `claude -p`, Agent SDK, no surface | `/backlog` answers with the board as text. |

## How it works

| Action | Command it runs |
| --- | --- |
| Live list | `backlog task list --json --watch` (one child per pane, stopped on close) |
| Status order | `backlog config get statuses` |
| Task details | `backlog task view <id> --json` |
| Change status | `backlog task edit <id> --status <status>` |
| Create a task | `backlog task create <title>` |

Commands are started without a shell, with each value passed as its own argument, so titles
with quotes, `&` or `$` are safe. The `--watch` stream is a series of pretty-printed JSON
documents. The mod reassembles them however the output is split. If the child exits, it is
restarted with backoff (1 s, 2 s, 4 s, 8 s). After 5 failures in a row the pane shows the
error and a **Retry** button.

## Known limitations

- **Not in v1:** plan approval, automatic sync when Claude finishes, milestones and the
  definition of done. Subtasks, dependencies, labels and assignees are not shown yet.
- The live list covers what `task list` returns, so drafts and archived tasks are not
  shown.
- Statuses are read when the watch starts. After changing them in the config, press
  **Retry** or reopen the pane.
- The final status counts as "done" because it is last in `statuses`, the same rule
  Backlog.md uses.
- In the terminal's main screen (not fullscreen), the pane opens inline above the prompt
  instead of docking to the side.
- Mobile and headless modes are deliberately minimal (see *Where it works*).
- The mods API is in early access and may change between Claude Code releases.
- **Windows:** if neither `backlog` on PATH nor a global npm/bun install can be started,
  set `backlogPath` to the full path of `backlog.exe`.

## Development

```text
.claude-plugin/plugin.json        manifest and options
.claude-plugin/marketplace.json   makes this repository installable
hooks/register.tsx                command, pane, watch loop and actions
hooks/cli.ts                      pure helpers: commands, JSON stream reader, grouping
types/index.d.ts                  the $.state contract and Backlog.md shapes
tests/                            claude plugin test suites
```

Run the mod from a working copy for one session:

```bash
git clone https://github.com/ezmg/backlog-pane.git
```

```bash
claude --plugin-dir ./backlog-pane
```

Check it:

```bash
claude plugin validate --strict .
```

```bash
claude plugin test .
```

The tests run against Claude Code's own test kit, with a simulated `backlog` CLI. They
cover the stream reader, grouping, every command line, and the pane on the terminal,
desktop and mobile surfaces. They also cover the missing-CLI, uninitialized and
failing-watch states, and headless mode.

## License

[MIT](LICENSE)
