# WyePoint

Cycle planning for projects and initiatives, stored in a [Wye](../../README.md) vault. (Built as WyeFinder, then Tempo; the
brand is the string "WyePoint" in `server.js`, `lib/store.js`, `public/` and `package.json`. A vault, title, token and
`tempo:<project>/<slug>` references from before the rename keep working.) The UI is a port of
the Safety cycle planner prototype, generalised: its workstreams are projects, its sheet is the vault.

No dependencies, no build: Node's `http`, Markdown files, a static page of ES modules.

```bash
cd packages/wyepoint
npm run build:editor             # once: bundles the block editor (needs the repo's node_modules)
node server.js --seed            # http://127.0.0.1:4400, a sample vault in ~/.wye/data/products/wyepoint
node server.js --vault ../../data/products/work -p 4400
npm test
```

## What it does

| View | |
|---|---|
| Overview | Tiles for the active cycle, its timeline, what needs attention, the most loaded people |
| Projects | One card per project with its links, progress, status mix, champions and open items. **Edit** (or the title) opens the project's own page: owner, a free Notion-style page with links and updates as blocks, and its initiatives |
| Backlog | Search and filters (project, status, mission, tier, effort, champion), group rows and columns (a matrix), sort |
| People | Load per person (champion ×2 + contributor ×1 on unshipped items of the active cycle), the team roster, who has room |
| Simulate | A button on every initiative that is being planned (the Plan page's pool and ranked plan, and the initiative's page): who it would pull in, what it overlaps with, who gets stretched, plus an agent briefing. Not in the header: it only makes sense for something you are about to start |
| Plan | The next cycle: backlog pool, approve, ranked plan, plan checks, release (locks), reopen, close the active cycle and start it |
| History | Every cycle; a closed one shows the snapshot taken when it closed |
| Initiative page | A property sheet (status, champion, contributors, effort, cycle, mission, target, progress) over one page: a Notion-style document with the description, "What ships", "Risks" and the planner's blocks — milestones, links, pull requests, updates — inserted anywhere with `/`. Planner checks, approval, "Ask status agent" below it |

An initiative is one page, edited in a Notion-style block editor: BlockNote, the library Wye's own document editor
is built on (slash menu, headings, lists, checklists, code, formatting). Milestones, links, pull requests and
updates are blocks of their own (a status, an owner, a due date, a URL) that sit wherever you put them in the page.
The editor reads and writes Markdown, so the vault keeps plain Markdown. `npm run build:editor` bundles it into
`public/vendor/` (not committed); without it the page falls back to a textarea. The page does not redraw while you
type, and a save keeps what a webhook or the API added meanwhile.

The status agents (per initiative, portfolio, simulation) run through Claude Code: `claude -p` with no tools, from an
empty folder, on `sonnet` (`WYEPOINT_AGENT_MODEL`). `WYEPOINT_AGENT_CMD` replaces the command (prompt on stdin, answer on
stdout). The prompts are built on the server from the vault; the page cannot send one.

## What it stores

| In WyePoint | In the vault |
|---|---|
| Workspace + cycle settings (length, cooldown, cycle 0 start) | `_product.md` |
| Roster | `_roster.md` |
| A cycle's status, theme, own dates, close snapshot | `cycles/<n>.md` |
| Project | `projects/<p>/_project.md`: details in the front matter (title, owner, and a description that follows the page), then a free body — links are `- [label](url) · link · source` lines, as in an initiative |
| Initiative | `projects/<p>/docs/<slug>.md`, a page that is a `goal:<p>.<slug>` node |
| Page body | free Markdown after the title. Four kinds of line are items, wherever they are: `- task:<p>.<slug>.<n> Title #status (owner: …, due: …, part-of: goal:…)`, `- [label](url) · link · source`, `- [title](url) · pr · date`, `- <timestamp> · source · text` (an update). Everything else is prose; the description is the prose before the first heading, and the headings "What ships" and "Risks" are read by name |
| Cycle, rank, approval, backlog bucket | `cycle:`, `rank:`, `approved:`, `bucket:` in its frontmatter |

An initiative's tier is derived: in the active cycle, planned (a later cycle), carry-over (an earlier cycle, not
shipped), shipped, or the bucket it waits in (proposed, next, later, icebox). Cycle dates come from the settings
(`start + n × (weeks×7 + cooldown)` days) unless a cycle has its own; which cycle is active is a fact in the vault,
changed only by closing one and starting the next.

Because it is an ordinary Wye product, `wye build --root <vault>`, `wye check`, `wye query` and the Wye app read it:
initiatives are goals, milestones are tasks linked to them.

## Public, and pushing data in

```bash
WYEPOINT_TOKEN=<secret> node server.js --vault <vault> --public https://wyepoint.example.com   # binds 0.0.0.0
```

Reading is open; writing, and the agents (they spend model calls), need `Authorization: Bearer $WYEPOINT_TOKEN` (the page
asks once and remembers it). Without `--public` the server binds to loopback and this machine writes without a token.
Put a TLS proxy in front (`--public` redirects plain-http forwarded requests to the https address).

```bash
curl -X POST $URL/api/ingest -H "authorization: Bearer $WYEPOINT_TOKEN" -H 'content-type: application/json' \
  -d '{"source":"jira","initiative":"project/slug","kind":"link","label":"PROJ-1","url":"https://…","text":"PROJ-1 done"}'
```

`kind` is `log` (`text`), `link` (`label`, `url`), `pr` (`title`, `url`), `status` or `task` (`title`, `owner`, `due`,
`status`; the same title again updates the task). The GitHub webhook, `POST /api/ingest/github` with
`WYEPOINT_GITHUB_SECRET` set, adds PRs and issues that carry `wyepoint:<project>/<slug>` in their title, branch or description.

## Not built yet

Pulling from sources on a schedule (today they push), users and per-person permissions, protection against two people
editing one initiative at once beyond atomic file writes, streaming of agent answers.
