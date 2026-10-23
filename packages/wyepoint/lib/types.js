'use strict';
// WyePoint's entities are Wye types. `types/ontology.md` declares the ones the app itself uses (person, cycle,
// initiative); `types/custom.md` holds the ones a person defines in Settings (a risk, a decision, a customer ask …).
// Both are ordinary Wye documents: type cards in a yaml fence, so `wye build`, `wye check` and `wye query` know them
// and an instance of a custom type, written as a list line in any page, is a node in the graph.
const fs = require('fs');
const path = require('path');

const VERSION = 4;

// the core types, as Wye cards. Props are optional (`?`) so a page without one is not a warning.
const CORE = `- id: type:person
  extends: type:node
  purpose: a person who can champion or contribute to an initiative
  plural: People
  props:
    role: string?
    team: string?
    email: string?
    source: string?
    external-id: string?
- id: type:cycle
  extends: type:node
  purpose: a planning cycle, with its dates, its theme and what was in it when it closed
  plural: Cycles
  statuses: [planned, released, active, closed]
  props:
    n: number?
    start: date?
    end: date?
    theme: string?
    released-at: date?
    closed-at: date?
- id: type:project
  extends: type:node
  key: PROJ
  purpose: a piece of work planned in a cycle, with a champion, contributors, milestones, links and updates
  plural: Projects
  open: true
  statuses: [not-started, proposed, on-track, at-risk, off-track, paused, complete]
  props:
    champion: ref person? -(inverse)-> champions
    involves: list of person? -(inverse)-> involved-in
    cycle: ref cycle? -(inverse)-> projects
    contributors: string?
    effort: enum [S, M, L, XL]?
    mission: string?
    approved: bool?
    bucket: enum [proposed, next, later, icebox]?
    rank: number?
    target: string?
    key: string?
    slack: string?
    updated: string?`;

// the types WyePoint ships beyond its entities: usable on any page, not editable in Settings
const BUILTIN = [{ slug: 'risk', key: 'RISK', name: 'Risk', plural: 'Risks', purpose: 'Something that could go wrong, and who is on it', statuses: ['open', 'mitigated', 'accepted', 'closed'], builtin: true,
  fields: [{ name: 'severity', kind: 'choice', options: ['low', 'medium', 'high'] }, { name: 'responsible', kind: 'person' }, { name: 'next-step', kind: 'text' }] }];

function coreDocument() {
  return `---\ntitle: WyePoint types\n---\n<!-- wyepoint-types v${VERSION}: written by WyePoint; edit custom.md for your own types -->\n# WyePoint types\n\nThe types WyePoint is built on. Your own are in custom.md.\n\n\`\`\`yaml\n${CORE}\n${BUILTIN.map(card).join('\n')}\n\`\`\`\n`;
}

// ---- what a custom type may not be called, or have as a field: Wye's own
function baseKinds() {
  let md = ''; try { md = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'schema', 'base-ontology.md'), 'utf8'); } catch { /* not beside the repo */ }
  const kinds = new Set([...md.matchAll(/^- id: type:([\w-]+)/gm)].map(m => m[1]));
  ['person', 'cycle', 'initiative', 'risk', 'project', 'area', 'milestone', 'link', 'update', 'drawing', 'pr', 'task', 'goal'].forEach(k => kinds.add(k));
  return kinds;
}
const RESERVED_PROPS = new Set(['title', 'status', 'owner', 'text', 'icon', 'cover', 'tags', 'since', 'until', 'by', 'session', 'evidence', 'supersedes', 'content', 'related-to', 'mentions', 'part-of', 'depends-on', 'contradicts', 'see', 'resolves', 'produced', 'id', 'type', 'kind', 'node', 'target', 'progress', 'due', 'worker', 'priority', 'blocked-by', 'change', 'ready']);

// ---- the kinds of field a custom type can have, and how each is written as a Wye prop
const FIELD_KINDS = [['text', 'Text'], ['longtext', 'Long text'], ['number', 'Number'], ['date', 'Date'], ['bool', 'Yes or no'], ['choice', 'Choice'], ['person', 'Person']];
const toWye = f => ({ text: 'string', longtext: 'text', number: 'number', date: 'date', bool: 'bool', person: 'ref person', choice: `enum [${(f.options || []).join(', ')}]` }[f.kind]);
const fromWye = v => {
  v = v.replace(/\?\s*$/, '').trim();
  if (v === 'string') return { kind: 'text' };
  if (v === 'text') return { kind: 'longtext' };
  if (v === 'number' || v === 'date' || v === 'bool') return { kind: v };
  if (v === 'ref person') return { kind: 'person' };
  const m = /^enum \[(.*)\]$/.exec(v); if (m) return { kind: 'choice', options: m[1].split(',').map(s => s.trim()).filter(Boolean) };
  return { kind: 'text' };
};

const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const slugOf = s => clean(s).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 40);

// validates a type as a person wrote it and returns the normalised type
// The key of a type: the prefix of the ids its instances are given everywhere (PROJ-12, RISK-3). Wye's own goal and task, which
// WyePoint cannot redeclare, are given theirs here.
const BASE_KEYS = { goal: 'GOAL', task: 'TASK' };
const KEY_FORMAT = /^[A-Z][A-Z0-9]{1,5}$/;
const deriveKey = (name, taken = new Set()) => {
  const letters = String(name || '').toUpperCase().replace(/[^A-Z]/g, '') || 'ITEM';
  let k = (letters.length < 2 ? letters + 'X' : letters).slice(0, 4);
  for (let n = 2; taken.has(k); n++) k = letters.slice(0, 4) + n;
  return k;
};

function normalise(input, { taken = new Set(), takenKeys = new Set() } = {}) {
  const bad = m => Object.assign(new Error(m), { status: 400 });
  const name = clean(input.name); if (!name) throw bad('a type needs a name');
  const slug = input.slug || slugOf(name); if (!/^[a-z][a-z0-9-]*$/.test(slug)) throw bad('the name must start with a letter');
  if (baseKinds().has(slug)) throw bad(`"${slug}" is already a type in Wye or WyePoint; pick another name`);
  if (taken.has(slug)) throw Object.assign(new Error(`there is already a type called "${slug}"`), { status: 409 });
  const statuses = (Array.isArray(input.statuses) ? input.statuses : String(input.statuses || '').split(',')).map(s => slugOf(s)).filter(Boolean);
  const seen = new Set(), fields = [];
  for (const f of input.fields || []) {
    const fname = slugOf(f.name); if (!fname) continue;
    if (!/^[a-z][a-z0-9-]*$/.test(fname)) throw bad(`"${f.name}" is not a usable field name`);
    if (RESERVED_PROPS.has(fname)) throw bad(`"${fname}" is a name Wye uses for every node; call the field something else`);
    if (seen.has(fname)) throw bad(`the field "${fname}" is listed twice`); seen.add(fname);
    if (!FIELD_KINDS.some(k => k[0] === f.kind)) throw bad(`"${f.kind}" is not a kind of field`);
    const options = f.kind === 'choice' ? (Array.isArray(f.options) ? f.options : String(f.options || '').split(',')).map(o => clean(o).replace(/[,[\]()]/g, '')).filter(Boolean) : undefined;
    if (f.kind === 'choice' && !options.length) throw bad(`the choice "${fname}" needs at least one option`);
    fields.push({ name: fname, kind: f.kind, ...(options ? { options } : {}) });
  }
  const key = String(input.key || '').trim().toUpperCase() || deriveKey(name, takenKeys);
  if (!KEY_FORMAT.test(key)) throw bad(`the key "${key}" must be 2 to 6 capital letters or digits, starting with a letter`);
  if (takenKeys.has(key) && !input.slug) throw Object.assign(new Error(`the key ${key} is already used by another type`), { status: 409 });
  return { slug, key, name, plural: clean(input.plural) || `${name}s`, purpose: clean(input.purpose) || name, statuses: statuses.length ? statuses : ['open', 'done'], fields };
}

// ---- custom.md: the cards, written and read in one fixed shape
const card = t => [`- id: type:${t.slug}`, `  extends: type:node`, `  key: ${t.key}`, `  purpose: ${t.purpose}`, `  plural: ${t.plural}`, `  title: ${t.name}`, `  statuses: [${t.statuses.join(', ')}]`,
    '  props:', '    key: string?', ...t.fields.map(f => `    ${f.name}: ${toWye(f)}?`)].join('\n');
function renderCustom(types) {
  const cards = types.map(card);
  return `---\ntitle: Custom types\n---\n# Custom types\n\nTypes defined in WyePoint's Settings. An instance is a list line in any page: \`- ${types[0] ? types[0].slug : 'risk'}:project.page.1 What it is #status (field: value)\`.\n\n\`\`\`yaml\n${cards.join('\n')}\n\`\`\`\n`;
}
function parseCustom(md) {
  const fence = /```yaml\n([\s\S]*?)```/.exec(md); if (!fence) return [];
  return fence[1].split(/^- id: type:/m).slice(1).map(card => {
    const lines = card.split('\n'), slug = lines[0].trim(), get = k => { const l = lines.find(x => x.startsWith(`  ${k}: `)); return l ? l.slice(k.length + 4).trim() : ''; };
    const pi = lines.findIndex(l => l.trim() === 'props:'), fields = [];
    if (pi >= 0) for (let i = pi + 1; i < lines.length && /^ {4}\S/.test(lines[i]); i++) { const m = /^ {4}([\w-]+): (.*)$/.exec(lines[i]); if (m && m[1] !== 'key') fields.push({ name: m[1], ...fromWye(m[2]) }); }
    return { slug, key: get('key'), name: get('title') || slug, plural: get('plural') || `${slug}s`, purpose: get('purpose'), statuses: get('statuses').replace(/^\[|\]$/g, '').split(',').map(s => s.trim()).filter(Boolean), fields };
  });
}

module.exports = { BASE_KEYS, KEY_FORMAT, deriveKey, BUILTIN, VERSION, coreDocument, normalise, renderCustom, parseCustom, baseKinds, FIELD_KINDS, RESERVED_PROPS };
