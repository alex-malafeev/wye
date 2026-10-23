# WyePoint

Cycle planning for goals and projects, stored in a [Wye](../../README.md) vault. (Built as WyeFinder, then Tempo; the
brand is the string "WyePoint" in `server.js`, `lib/store.js`, `public/` and `package.json`. A vault, title, token and
`tempo:<area>/<slug>` references from before the rename keep working.) The UI is a port of the Safety cycle planner
prototype, generalised: its sheet is the vault.

The server has no dependencies: Node's `http`, Markdown files, a static page of ES modules. Only the block editor is
bundled (`npm run build:editor`), with the packages in the repo's `node_modules`.

```bash
cd packages/wyepoint
npm run build:editor             # once: bundles the block editor and Excalidraw (needs the repo's node_modules)
node server.js --seed            # http://127.0.0.1:4400, a sample vault in ~/.wye/data/products/wyepoint
node server.js --vault ../../data/products/work -p 4400
npm test
npm run dev                      # the same, restarting when the server's code changes
```

**Hot reload.** Run locally, the open page reloads when anything under `public/` changes (and swaps the stylesheet in
place when only CSS did); under `npm run dev` it also reloads once the server is back after a restart for a change
to its own code. It is off when the server is public (`--public`); `WYEPOINT_DEV=1` or `--watch` turns it on anywhere,
`WYEPOINT_DEV=0` turns it off.

## How the work is organised

```
Goal  →  Project  →  Work item (milestone, risk, or a type of your own)
```

| | |
|---|---|
| **Goal** | What is being worked towards. Has a key (`GOAL-1`), an owner, a target date, a status and an optional Slack channel; its progress is rolled up from the projects under it. |
| **Project** | The unit that is owned, planned into a cycle and shipped: champion, contributors, effort, target, approval, an optional Slack channel, and one page. (Called an *initiative* before; the code still does.) |
| **Work item** | Anything done or tracked inside a project: milestones (Wye `task`s), risks, and the types you define in Settings. |
| **Area** | Groups projects: a product area or a team's track. Not a level of the hierarchy, a way to slice it. (Called a *project* before; the code still does.) |
| **Cycle** | The time-box (6 weeks plus cooldown by default). Projects are planned into cycles. |

**Keys.** Every goal, project and work item has a global id, `PREFIX-n` (`GOAL-1`, `PROJ-12`, `TASK-5`, `RISK-2`, `DOC-3`), so it
can be referred to, searched and opened: `#/k/PROJ-12` opens it, and the Backlog's search finds it (Enter on a key goes
there). The prefix is the `key:` property of the item's type, set on the type's card in the vault (`PROJ`, `RISK`, and
`key` of each type you define in Settings; Wye's own `goal`, `task` and `doc` are given `GOAL`, `TASK` and `DOC` by WyePoint). The
number is the next one for that prefix, counted in `_keys.json`, so one is never used twice, not after a deletion either.

## What it does

| View | |
|---|---|
| Overview | Tiles for the active cycle, its timeline, the most loaded people; **Needs attention** is a floating panel beside it (five at a time, click one to open it) |
| Goals | A card for each goal with its progress and projects. A goal has a page of its own, with its properties in a floating panel. |
| Projects | One card per area with its links, progress, status mix and open projects. **Edit** opens the area's own page. |
| Backlog | Search (names, people, tasks and keys) and filters as searchable lookups (area, status, goal, tier, effort, champion), group rows and columns, sort. Every row has a **cycle** to choose; a click opens the project full-page. |
| People | The directory of people who can be champions and contributors (**+ New person**), with load. A person's drawer lists what they carry, the goals they own, the milestones they own, the risks they are responsible for, and a history: the cycles they championed and the updates that name them. |
| Library | Documents that are product context: a customer, the product, research, how you work. Folders are a tree on the left (nested as far as you like; **+ Folder**, rename and delete on hover), and the open folder's subfolders are rows in the list; a document is moved from its **Folder** property. Each has a category, an owner and an optional list of the goals and projects it is about (a searchable picker), and a page of its own with pictures. Search by words or filter by category. |
| Plan | The next cycle: pool, approve, ranked plan, plan checks, release (locks), reopen, close the active cycle and start it |
| History | Every cycle; a closed one shows the snapshot taken when it closed |
| Settings | Workspace and cycle length; **Cycles** (a theme and own dates for each, and how many are ahead); **Types**; pushing data in; the write token |

A project's full view is two floating panels: the page, and its properties (status, champion, contributors, effort,
cycle, goal, target, Slack, progress, checks, approval, planning) with its History (what came in, from whom; click one to
read it). **New project** creates the page at once and opens it with the title selected. The status agent is the round
owl button at the bottom right; its answer opens in a drawer.

## The page, and the blocks in it

A project, a goal and an area are each one page, edited in a Notion-style block editor: BlockNote, the library Wye's
own document editor is built on (slash menu, headings, lists, checklists, code, formatting). The editor reads and writes
Markdown, so the vault keeps plain Markdown. Without the bundle the page falls back to a textarea. The page does not
redraw while you type, and a save keeps what a webhook or the API added meanwhile.

- **Milestones, links, pull requests, updates** are blocks wherever you put them.
- **Risk** is a built-in type; **your own types** are defined in Settings (a name, a key, statuses, fields: text, number,
  date, yes/no, choice, person) and written as a Wye type card in `types/custom.md`. An instance is a card in the page
  (status, field chips) that opens a drawer with its fields and **notes**, a small document of its own. In the
  Markdown the notes are the lines indented under the instance's list line.
- **Drawings** are Excalidraw: `![Title](drawings/<slug>.excalidraw)`, with the scene, an SVG and a PNG preview and a text
  description kept beside the page (the same files Wye writes).
- **Pictures** pasted or dropped into a page go to `<area>/docs/images/` and are kept as `![name](images/<file>)`
  (PNG, JPEG, GIF, WebP).

The status agents (per project, portfolio, simulation) run through Claude Code: `claude -p` with no tools, from an
empty folder, on `sonnet` (`WYEPOINT_AGENT_MODEL`). `WYEPOINT_AGENT_CMD` replaces the command (prompt on stdin, answer on
stdout). The prompts are built on the server from the vault; the page cannot send one.

## What it stores

| In WyePoint | In the vault |
|---|---|
| Workspace + cycle settings (length, cooldown, cycle 0 start, cycles ahead) | `_product.md` |
| Key counters | `_keys.json` |
| A goal | `goals/<slug>.md`, a `goal:<slug>` node: `key`, `title`, `status`, `owner`, `target`, `slack`, then a free page |
| A person | `people/<name>.md`: `title`, `role`, `team`, `email`, and `source` (`manual`, or the system a sync wrote it from, with an `external-id`) |
| A cycle's status, theme, own dates, close snapshot | `cycles/<n>.md`, a `cycle:<n>` node |
| Area | `areas/<a>/_area.md`: details in the front matter, then a free body |
| Project | `areas/<a>/docs/<slug>.md`, a `project:<a>.<slug>` node: `key`, `goal: goal:<slug>`, `champion`, `involves`, `cycle: cycle:<n>`, `slack`, … |
| Page body | free Markdown after the title. Items are lines, wherever they are: `- task:<a>.<slug>.<n> Title #status (owner: …, due: …, part-of: project:…, key: TASK-5)`, `- risk:<a>.<slug>.<n> Text #open (severity: high, responsible: person:lee, key: RISK-2)`, `- [label](url) · link · source`, `- [title](url) · pr · date`, `- 2026-10-22T10:27Z · source · text` |
| A library document | `library/<folder>/<slug>.md` (folders are real folders and an empty one stays; `images` is the pictures' folder), a `doc:<slug>` node (Wye's own page type): `key` (DOC-n), `title`, `category`, `owner`, `related-to: goal:…, project:<area>.<slug>`, then a free page. Pictures in `library/images/` |
| Types | `types/ontology.md` (person, cycle, project, risk) and `types/custom.md` (yours), as Wye type cards with a `key:` |
| Drawings, pictures | `areas/<a>/docs/drawings/`, `areas/<a>/docs/images/` |

A vault written before is moved over the first time it is opened: `projects/` becomes `areas/`, `initiative:` nodes become
`project:`, a project's `mission` becomes a goal, and every item gets its key.

A project's tier is derived: in the active cycle, planned (a later cycle), carry-over (an earlier cycle, not shipped),
shipped, or the bucket it waits in (proposed, next, later, icebox). Cycle dates come from the settings
(`start + n × (weeks×7 + cooldown)` days) unless a cycle has its own; which cycle is active is a fact in the vault,
changed only by closing one and starting the next.

Because it is an ordinary Wye product, `wye build --root <vault>`, `wye check`, `wye query` and the Wye app read it: goals
and projects are nodes, a project's champion and contributors are edges to people, and so are a risk's `responsible`
and a project's goal. A person's drawer follows the same references.

## Public, and pushing data in

```bash
WYEPOINT_TOKEN=<secret> node server.js --vault <vault> --public https://wyepoint.example.com   # binds 0.0.0.0
```

Reading is open; writing, and the agents (they spend model calls), need `Authorization: Bearer $WYEPOINT_TOKEN` (the page
asks once and remembers it). Without `--public` the server binds to loopback and this machine writes without a token.
Put a TLS proxy in front (`--public` redirects plain-http forwarded requests to the https address).

```bash
curl -X POST $URL/api/ingest -H "authorization: Bearer $WYEPOINT_TOKEN" -H 'content-type: application/json' \
  -d '{"source":"jira","project":"PROJ-12","kind":"link","label":"PROJ-1","url":"https://…","text":"PROJ-1 done"}'
```

`project` is a key (`PROJ-12`), `area/slug` or a slug (`initiative` is accepted too, as it was named before). `kind` is
`log` (`text`), `link` (`label`, `url`), `pr` (`title`, `url`), `status` or `task` (`title`, `owner`, `due`, `status`; the
same title again updates the task). The GitHub webhook, `POST /api/ingest/github` with `WYEPOINT_GITHUB_SECRET` set,
adds PRs and issues that carry `wyepoint:<area>/<slug>` in their title, branch or description.

The server's routes keep their earlier names: `/api/initiatives` are projects and `/api/projects` are areas. Goals are `/api/goals` and library documents `/api/docs`.

## Importing a cycle planning workbook

The "6W Cycle Planning Guide" workbook (a plan tab and a backlog tab for each team) can be imported into a new vault:

```bash
python3 -I scripts/xlsx-to-json.py "6W Cycle Planning Guide.xlsx" plan.json          # standard library only
node scripts/import-cycle-sheet.js plan.json --vault ~/.wye/data/products/safety-cycle
node server.js --vault ~/.wye/data/products/safety-cycle -p 4402
```

The "How to Use" and "PM Instructions" tabs become Library documents. Each tab is a **goal**; each row is a **project** (the team column is its area). Rows above the plan's cut line are in
the cycle named in the tab's header; rows below it, and everything on a backlog tab, are in the backlog (a tier of Next
cycle, Later or Icebox becomes the bucket). A project's champion and contributors become people (initials like "D. Conde"
and first names are matched to the full names in the sheet; names run together are split; what is not a name stays in
the page as text), what is shipping, the definition of done, the success metric and the notes become sections of its
page, and a dependency or risk becomes a Risk. `--docs-only` adds just the library documents to a vault that is already there. The cycles' dates are the workbook's own timeline. The example tabs, the
instructions and drafts ("… - Proposed") are left out. It refuses a vault that is not empty.

## Not built yet

Pulling from sources on a schedule (today they push), users and per-person permissions, protection against two people
editing one project at once beyond atomic file writes, streaming of agent answers, pictures and drawings on a goal's
page (they belong to an area), and counting work-item types of your own in a project's progress.
