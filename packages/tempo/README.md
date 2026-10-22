# Tempo

Cycle planning for projects and initiatives, stored in a [Wye](../../README.md) vault. (Working name was WyeFinder;
renaming is a search for "Tempo" in `server.js`, `lib/store.js`, `public/` and `package.json`.)

No dependencies, no build: Node's `http`, Markdown files, one static page.

```bash
cd packages/tempo
node server.js --seed            # http://127.0.0.1:4400, a sample vault in ~/.wye/data/products/tempo
node server.js --vault ../../data/products/work -p 4400
npm test
```

## What it models

| In Tempo | In the vault |
|---|---|
| Workspace + cycle settings (length, cooldown, cycle 0 start) | `_product.md` (`cycle-weeks`, `cycle-cooldown`, `cycle-start`) |
| Project | `projects/<p>/_project.md` |
| Initiative / track | `projects/<p>/docs/<slug>.md`, a page that is a `goal:<p>.<slug>` node |
| Tasks | `- task:<p>.<slug>.<n> Title #status (owner: …, part-of: goal:…)` lines between `<!-- tasks -->` |
| Links, log | `## Links` and `## Log` lists in the same page |
| Cycle membership, rank, approval | `cycle:`, `rank:`, `approved:` in the page's frontmatter |

Cycles are derived (`start + n × (weeks×7 + cooldown)` days), so changing the length in Settings re-plans the future.
Because it is an ordinary Wye product, `wye build --root <vault>`, `wye check`, `wye query` and the Wye app read it:
initiatives are goals, tasks are tasks, and progress is computed from the tasks unless set by hand.

## Public, and pushing data in

```bash
TEMPO_TOKEN=<secret> node server.js --vault <vault> --public https://tempo.example.com   # binds 0.0.0.0
```

Reading is open; writing needs `Authorization: Bearer $TEMPO_TOKEN` (the page asks once and remembers it). Without
`--public` the server binds to loopback and this machine writes without a token. Put a TLS proxy in front
(`--public` redirects plain-http forwarded requests to the https address).

```bash
curl -X POST $URL/api/ingest -H "authorization: Bearer $TEMPO_TOKEN" -H 'content-type: application/json' \
  -d '{"source":"jira","initiative":"project/slug","kind":"link","label":"PROJ-1","url":"https://…","text":"PROJ-1 done"}'
```

`kind` is `log` (`text`), `link` (`label`, `url`), `status` (`status`) or `task` (`title`, `owner`, `due`, `status`;
the same title again updates the task). The GitHub webhook, `POST /api/ingest/github` with `TEMPO_GITHUB_SECRET`
set, adds PRs and issues that carry `tempo:<project>/<slug>` in their title, branch or description.

## Not built yet

People and workload view, the simulate and status agents from the prototype, per-source pull (instead of push),
users and per-person permissions, concurrent-edit protection beyond atomic file writes. Closing a cycle early moves
the cycle 0 start date, which re-dates past cycles.
