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
const DRAWING = /^!\[(.*?)\]\(([^)\s]*\.excalidraw)\)\s*$/;                  // ![Title](drawings/<slug>.excalidraw), as Wye writes a drawing
const NODE = /^- ([a-z][a-z0-9-]*):([\w.-]+) (.*?)(?: #([\w-]+))?(?: \((.*)\))?\s*$/;   // - risk:p.page.1 Text #status (field: value, …)
let kinds = new Set();                                                     // the custom types: only their lines are instances
const setKinds = list => { kinds = new Set(list); };
const parseProps = s => Object.fromEntries((s || '').split(',').map(x => { const i = x.indexOf(':'); return i > 0 ? [x.slice(0, i).trim(), x.slice(i + 1).trim()] : null; }).filter(Boolean));

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
  if ((m = DRAWING.exec(line))) return { type: 'drawing', title: m[1], src: m[2] };
  if ((m = NODE.exec(line)) && kinds.has(m[1])) return { type: 'node', kind: m[1], id: `${m[1]}:${m[2]}`, text: m[3], status: m[4] || '', props: parseProps(m[5]) };
  return null;
}
const taskLine = (t, node) => `- ${t.id} ${one(t.title)} #${t.status} (${[t.owner && `owner: ${prop(t.owner)}`, t.due && `due: ${prop(t.due)}`, node && `part-of: ${node}`].filter(Boolean).join(', ')})`;
const refLine = r => `- [${one(r.label).replace(/[[\]]/g, '') || r.url}](${String(r.url).trim().replace(/[)\s]/g, c => (c === ')' ? '%29' : '%20'))}) · ${r.type} · ${one(r.meta) || (r.type === 'pr' ? '' : 'manual')}`;
const logLine = l => `- ${l.ts} · ${one(l.source).replace(/\s/g, '-') || 'manual'} · ${one(l.text)}`;
const nodeLine = n => `- ${n.id} ${one(n.text) || 'Untitled'}${n.status ? ` #${n.status}` : ''}${Object.entries(n.props || {}).filter(([, v]) => one(v)).length ? ` (${Object.entries(n.props).filter(([, v]) => one(v)).map(([k, v]) => `${k}: ${prop(v)}`).join(', ')})` : ''}`;
const drawingLine = d => `![${one(d.title).replace(/[[\]]/g, '')}](${d.src})`;
const isItem = line => parseLine(line) !== null;

module.exports = { parseLine, taskLine, refLine, logLine, nodeLine, drawingLine, isItem, setKinds, one };
