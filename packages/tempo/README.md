# Tempo

Cycle planning for projects and initiatives, stored in a [Wye](../../README.md) vault. (Working name was WyeFinder;
renaming is a search for "Tempo" in `server.js`, `lib/store.js`, `public/` and `package.json`.) The UI is a port of
the Safety cycle planner prototype, generalised: its workstreams are projects, its sheet is the vault.

No dependencies, no build: Node's `http`, Markdown files, a static page of ES modules.

```bash
cd packages/tempo
node server.js --seed            # http://127.0.0.1:4400, a sample vault in ~/.wye/data/products/tempo
node server.js --vault ../../data/products/work -p 4400
npm test
```

## What it does

| View | |
|---|---|
| Overview | Tiles for the active cycle, its timeline, what needs attention, the most loaded people |
| Projects | One card per project: progress, status mix, champions, open items; new project / initiative |
| Backlog | Search and filters (project, status, mission, tier, effort, champion), group rows and columns (a matrix), sort |
| People | Load per person (champion ×2 + contributor ×1 on unshipped items of the active cycle), the team roster, who has room |
| Simulate | Describe an idea: who is closest to it, what it touches, who gets stretched, plus an agent briefing |
| Plan | The next cycle: backlog pool, approve, ranked plan, plan checks, release (locks), reopen, close the active cycle and start it |
| History | Every cycle; a closed one shows the snapshot taken when it closed |
| Initiative drawer | Status, effort, cycle, champion, contributors, mission, target date; description, what ships, risks; milestones; update log; pull requests; links; planner checks; approval; "Ask status agent" |

The status agents (per initiative, portfolio, simulation) run through Claude Code: `claude -p` with no tools, from an
empty folder, on `sonnet` (`TEMPO_AGENT_MODEL`). `TEMPO_AGENT_CMD` replaces the command (prompt on stdin, answer on
stdout). The prompts are built on the server from the vault; the page cannot send one.

## What it stores

| In Tempo | In the vault |
|---|---|
| Workspace + cycle settings (length, cooldown, cycle 0 start) | `_product.md` |
| Roster | `_roster.md` |
| A cycle's status, theme, own dates, close snapshot | `cycles/<n>.md` |
| Project | `projects/<p>/_project.md` |
| Initiative | `projects/<p>/docs/<slug>.md`, a page that is a `goal:<p>.<slug>` node |
| Milestones | `- task:<p>.<slug>.<n> Title #status (owner: …, due: …, part-of: goal:…)` between `<!-- tasks -->` |
| What ships, risks, links, pull requests, log | sections of the same page |
| Cycle, rank, approval, backlog bucket | `cycle:`, `rank:`, `approved:`, `bucket:` in its frontmatter |

An initiative's tier is derived: in the active cycle, planned (a later cycle), carry-over (an earlier cycle, not
shipped), shipped, or the bucket it waits in (proposed, next, later, icebox). Cycle dates come from the settings
(`start + n × (weeks×7 + cooldown)` days) unless a cycle has its own; which cycle is active is a fact in the vault,
changed only by closing one and starting the next.

Because it is an ordinary Wye product, `wye build --root <vault>`, `wye check`, `wye query` and the Wye app read it:
initiatives are goals, milestones are tasks linked to them.

## Public, and pushing data in

```bash
TEMPO_TOKEN=<secret> node server.js --vault <vault> --public https://tempo.example.com   # binds 0.0.0.0
```

Reading is open; writing, and the agents (they spend model calls), need `Authorization: Bearer $TEMPO_TOKEN` (the page
asks once and remembers it). Without `--public` the server binds to loopback and this machine writes without a token.
Put a TLS proxy in front (`--public` redirects plain-http forwarded requests to the https address).

```bash
curl -X POST $URL/api/ingest -H "authorization: Bearer $TEMPO_TOKEN" -H 'content-type: application/json' \
  -d '{"source":"jira","initiative":"project/slug","kind":"link","label":"PROJ-1","url":"https://…","text":"PROJ-1 done"}'
```

`kind` is `log` (`text`), `link` (`label`, `url`), `pr` (`title`, `url`), `status` or `task` (`title`, `owner`, `due`,
`status`; the same title again updates the task). The GitHub webhook, `POST /api/ingest/github` with
`TEMPO_GITHUB_SECRET` set, adds PRs and issues that carry `tempo:<project>/<slug>` in their title, branch or description.

## Not built yet

Pulling from sources on a schedule (today they push), users and per-person permissions, protection against two people
editing one initiative at once beyond atomic file writes, streaming of agent answers.
