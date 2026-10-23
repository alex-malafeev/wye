# WyePoint

Cycle planning for goals and initiatives, stored in a [Wye](../../README.md) vault. (Built as WyeFinder, then Tempo; the
brand is the string "WyePoint" in `server.js`, `lib/store.js`, `public/` and `package.json`. A vault, title, token and
`tempo:<team>/<slug>` references from before the rename keep working.) The UI is a port of the Safety cycle planner
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
Goal  →  Initiative  →  Work item (milestone, risk, or a type of your own)
```

| | |
|---|---|
| **Goal** | What is being worked towards. Has a key (`GOAL-1`), an owner, a target date, a status and an optional Slack channel; its progress is rolled up from the initiatives under it. |
| **Initiative** | The unit that is owned, planned into a cycle and shipped: champion, contributors, effort, target, approval, an optional Slack channel, and one page. Key `INIT-12`. |
| **Work item** | Anything done or tracked inside an initiative: milestones (Wye `task`s), risks, and the types you define in Settings. |
| **Team** | Groups initiatives: a product team or a track, the "Team" column of a planning sheet. Not a level of the hierarchy, a way to slice it. (The code still calls a team a `project`: `/api/projects`, `projects()`.) |
| **Cycle** | The time-box (6 weeks plus cooldown by default). Initiatives are planned into cycles. |

**Keys.** Every goal, initiative and work item has a global id, `PREFIX-n` (`GOAL-1`, `INIT-12`, `TASK-5`, `RISK-2`, `DOC-3`), so it
can be referred to, searched and opened: `#/k/INIT-12` opens it, and the Backlog's search finds it (Enter on a key goes
there). The prefix is the `key:` property of the item's type, set on the type's card in the vault (`INIT`, `RISK`, and
`key` of each type you define in Settings; Wye's own `goal`, `task` and `doc` are given `GOAL`, `TASK` and `DOC` by WyePoint). The
number is the next one for that prefix, counted in `_keys.json`, so one is never used twice, not after a deletion either.

## What it does

| View | |
|---|---|
| Overview | Tiles for the active cycle, its timeline, the most loaded people; **Needs attention** is a floating panel beside it (five at a time, click one to open it) |
| Goals | A card for each goal with its progress and initiatives. A goal has a page of its own, with its properties in a floating panel. |
| Initiatives | One card per team with its links, progress, status mix and open initiatives. **Edit** opens the team's own page. |
| Backlog | Search (names, people, tasks and keys) and filters as searchable lookups (team, status, goal, tier, effort, champion), group rows and columns, sort. Every row has a **cycle** to choose; a click opens the initiative full-page. |
| People | The directory of people who can be champions and contributors (**+ New person**), with load. A person's drawer lists what they carry, the goals they own, the milestones they own, the risks they are responsible for, and a history: the cycles they championed and the updates that name them. |
| Library | Documents that are product context: a customer, the product, research, how you work. Folders are a tree on the left (nested as far as you like; **+ Folder**, rename and delete on hover), and the open folder's subfolders are rows in the list; a document is moved from its **Folder** property. Each has a category, an owner and an optional list of the goals and initiatives it is about (a searchable picker), and a page of its own with pictures. Search by words or filter by category. |
| Plan | The next cycle: pool, approve, ranked plan, plan checks, release (locks), reopen, close the active cycle and start it |
| History | Every cycle; a closed one shows the snapshot taken when it closed |
| Settings | Workspace and cycle length; **Cycles** (a theme and own dates for each, and how many are ahead); **Types**; pushing data in; the write token |

An initiative's full view is two floating panels: the page, and its properties (status, champion, contributors, effort,
cycle, goal, target, Slack, progress, checks, approval, planning) with its History (what came in, from whom; click one to
read it). **New initiative** creates the page at once and opens it with the title selected. The status agent is the round
owl button at the bottom right; its answer opens in a drawer.

## The page, and the blocks in it

An initiative, a goal and a team are each one page, edited in a Notion-style block editor: BlockNote, the library Wye's
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
- **Mentions:** type `@` and a menu of documents, goals, initiatives and people opens, filtered as you type (a key like `INIT-12` works too). The link is written as Wye writes one, `[Acme Freight](doc:acme-freight)` (`goal:<slug>`, `initiative:<team>.<slug>`, `person:<slug>`), so Wye reads it as a mention of that node. A click on one goes there.
- **Pictures** pasted or dropped into a page go to `<team>/docs/images/` and are kept as `![name](images/<file>)`
  (PNG, JPEG, GIF, WebP).

The status agents (per initiative, portfolio, simulation) run through Claude Code: `claude -p` with no tools, from an
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
| Team | `teams/<a>/_team.md`: details in the front matter, then a free body |
| Initiative | `teams/<t>/docs/<slug>.md`, an `initiative:<t>.<slug>` node: `key`, `goal: goal:<slug>`, `champion`, `involves`, `cycle: cycle:<n>`, `slack`, … |
| Page body | free Markdown after the title. Items are lines, wherever they are: `- task:<a>.<slug>.<n> Title #status (owner: …, due: …, part-of: initiative:…, key: TASK-5)`, `- risk:<a>.<slug>.<n> Text #open (severity: high, responsible: person:lee, key: RISK-2)`, `- [label](url) · link · source`, `- [title](url) · pr · date`, `- 2026-10-22T10:27Z · source · text` |
| A library document | `library/<folder>/<slug>.md` (folders are real folders and an empty one stays; `images` is the pictures' folder), a `doc:<slug>` node (Wye's own page type): `key` (DOC-n), `title`, `category`, `owner`, `related-to: goal:…, initiative:<team>.<slug>`, then a free page. Pictures in `library/images/` |
| Types | `types/ontology.md` (person, cycle, initiative, risk) and `types/custom.md` (yours), as Wye type cards with a `key:` |
| Drawings, pictures | `teams/<a>/docs/drawings/`, `teams/<a>/docs/images/` |

A vault written before is moved over the first time it is opened: `projects/` and `areas/` become `teams/`, `goal:` and
`project:` nodes become `initiative:`, `PROJ-n` keys become `INIT-n`, an initiative's `mission` becomes a goal, and every item gets its key.

An initiative's tier is derived: in the active cycle, planned (a later cycle), carry-over (an earlier cycle, not shipped),
shipped, or the bucket it waits in (proposed, next, later, icebox). Cycle dates come from the settings
(`start + n × (weeks×7 + cooldown)` days) unless a cycle has its own; which cycle is active is a fact in the vault,
changed only by closing one and starting the next.

Because it is an ordinary Wye product, `wye build --root <vault>`, `wye check`, `wye query` and the Wye app read it: goals
and initiatives are nodes, an initiative's champion and contributors are edges to people, and so are a risk's `responsible`
and an initiative's goal. A person's drawer follows the same references.

## Public, and pushing data in

```bash
WYEPOINT_TOKEN=<secret> node server.js --vault <vault> --public https://wyepoint.example.com   # binds 0.0.0.0
```

Reading is open; writing, and the agents (they spend model calls), need `Authorization: Bearer $WYEPOINT_TOKEN` (the page
asks once and remembers it). Without `--public` the server binds to loopback and this machine writes without a token.
Put a TLS proxy in front (`--public` redirects plain-http forwarded requests to the https address).

```bash
curl -X POST $URL/api/ingest -H "authorization: Bearer $WYEPOINT_TOKEN" -H 'content-type: application/json' \
  -d '{"source":"jira","initiative":"INIT-12","kind":"link","label":"PROJ-1","url":"https://…","text":"PROJ-1 done"}'
```

`initiative` is a key (`INIT-12`), `team/slug` or a slug (`project` is accepted too, as it was named for a while). `kind` is
`log` (`text`), `link` (`label`, `url`), `pr` (`title`, `url`), `status` or `task` (`title`, `owner`, `due`, `status`; the
same title again updates the task). The GitHub webhook, `POST /api/ingest/github` with `WYEPOINT_GITHUB_SECRET` set,
adds PRs and issues that carry `wyepoint:<team>/<slug>` in their title, branch or description.

The server's routes keep their earlier names: `/api/initiatives` are initiatives and `/api/projects` are teams (the name teams had). Goals are `/api/goals` and library documents `/api/docs`.

## Importing a cycle planning workbook

The "6W Cycle Planning Guide" workbook (a plan tab and a backlog tab for each team) can be imported into a new vault:

```bash
python3 -I scripts/xlsx-to-json.py "6W Cycle Planning Guide.xlsx" plan.json          # standard library only
node scripts/import-cycle-sheet.js plan.json --vault ~/.wye/data/products/safety-cycle
node server.js --vault ~/.wye/data/products/safety-cycle -p 4402
```

The "How to Use" and "PM Instructions" tabs become Library documents. Each tab is a **goal**; each row is a **initiative** (the team column is its team). Rows above the plan's cut line are in
the cycle named in the tab's header; rows below it, and everything on a backlog tab, are in the backlog (a tier of Next
cycle, Later or Icebox becomes the bucket). An initiative's champion and contributors become people (initials like "D. Conde"
and first names are matched to the full names in the sheet; names run together are split; what is not a name stays in
the page as text), what is shipping, the definition of done, the success metric and the notes become sections of its
page, and a dependency or risk becomes a Risk. `--docs-only` adds just the library documents to a vault that is already there. The cycles' dates are the workbook's own timeline. The example tabs, the
instructions and drafts ("… - Proposed") are left out. It refuses a vault that is not empty.

## Not built yet

Pulling from sources on a schedule (today they push), users and per-person permissions, protection against two people
editing one initiative at once beyond atomic file writes, streaming of agent answers, pictures and drawings on a goal's
page (they belong to a team), and counting work-item types of your own in an initiative's progress.
