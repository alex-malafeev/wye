'use strict';
// How the items of an initiative are written into its page. The page is one free-form Markdown document; four kinds of
// line in it are items, wherever the person put them:
//   - task:<id> Title #status (owner: x, due: y, part-of: goal:…)      a milestone — a task node Wye reads
//   - [label](https://…) · link · source                              a link
//   - [title](https://…) · pr · 2026-10-22                            a pull request
//   - 2026-10-22T10:27Z · source · text                               an update (the log)
// Everything else is prose. Shared by the server and the editor bundle, so there is one definition of the format.
const TASK = /^- (task:[\w.-]+) (.*?) #([\w-]+)(?: \((.*)\))?\s*$/;
const REF = /^- \[(.*?)\]\((https?:\/\/[^\s)]*)\) · (link|pr) · (.*)$/;
const LOG = /^- (\d{4}-\d\d-\d\dT\d\d:\d\dZ) · (\S+) · (.*)$/;

const one = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const prop = s => one(s).replace(/[,()]/g, ' ');

function parseLine(line) {
  let m = TASK.exec(line);
  if (m) {
    const props = Object.fromEntries((m[4] || '').split(',').map(x => { const i = x.indexOf(':'); return i > 0 ? [x.slice(0, i).trim(), x.slice(i + 1).trim()] : null; }).filter(Boolean));
    return { type: 'task', id: m[1], title: m[2], status: m[3], owner: props.owner || '', due: props.due || '' };
  }
  if ((m = REF.exec(line))) return { type: m[3], label: m[1], url: m[2], meta: m[4] };
  if ((m = LOG.exec(line))) return { type: 'log', ts: m[1], source: m[2], text: m[3] };
  return null;
}
const taskLine = (t, node) => `- ${t.id} ${one(t.title)} #${t.status} (${[t.owner && `owner: ${prop(t.owner)}`, t.due && `due: ${prop(t.due)}`, node && `part-of: ${node}`].filter(Boolean).join(', ')})`;
const refLine = r => `- [${one(r.label).replace(/[[\]]/g, '') || r.url}](${String(r.url).trim().replace(/[)\s]/g, c => (c === ')' ? '%29' : '%20'))}) · ${r.type} · ${one(r.meta) || (r.type === 'pr' ? '' : 'manual')}`;
const logLine = l => `- ${l.ts} · ${one(l.source).replace(/\s/g, '-') || 'manual'} · ${one(l.text)}`;
const isItem = line => parseLine(line) !== null;

module.exports = { parseLine, taskLine, refLine, logLine, isItem, one };
