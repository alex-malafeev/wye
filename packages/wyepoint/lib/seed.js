'use strict';
// A few projects and initiatives so a first run has something to look at (node server.js --seed, on an empty vault).
// The vault's cycle 0 starts two weeks ago, so the active cycle is part-way through.
const DAY = 86400000;
const ago = d => new Date(Date.now() - d * DAY).toISOString().slice(0, 10);
const ahead = d => ago(-d);

module.exports = function seed(store) {
  store.setConfig({ start: ago(14) });
  [['Dana', 'Engineering manager', 'Customer platform'], ['Lee', 'Staff engineer', 'Customer platform'], ['Jo', 'Product designer', 'Customer platform'],
    ['Sam', 'Data lead', 'Data foundations'], ['Priya', 'Data engineer', 'Data foundations'], ['Mika', 'Data engineer', 'Data foundations']]
    .forEach(([name, role, team]) => store.createPerson({ name, role, team, email: `${name.toLowerCase()}@example.com` }));
  const web = store.createProject({ title: 'Customer platform', description: 'The product customers log into every day.', owner: 'Dana' });
  const data = store.createProject({ title: 'Data foundations', description: 'Pipelines and the warehouse the rest of the company reads.', owner: 'Sam' });
  store.updateProject(web.slug, { body: 'The product customers log into every day.\n\n## Links\n\n- [Product roadmap](https://example.com/roadmap) · link · notion\n- [Design system](https://example.com/design) · link · figma' });
  store.updateProject(data.slug, { body: 'Pipelines and the warehouse the rest of the company reads.\n\n## Links\n\n- [Data catalog](https://example.com/catalog) · link · manual' });
  const mk = (project, title, o) => {
    const it = store.createInitiative({ project, title, ...o });
    for (const t of o.tasks || []) store.addTask(it.id, t);
    for (const l of o.links || []) store.addLink(it.id, l);
    for (const p of o.prs || []) store.addPr(it.id, p);
    for (const l of o.log || []) store.addLog(it.id, l);
    return it;
  };
  mk(web.slug, 'Self-serve onboarding', { owner: 'Dana', contributors: ['Lee', 'Jo'], mission: 'Growth', effort: 'L', status: 'on-track', cycle: 0, rank: 1, approved: true, target: ahead(20),
    description: 'New accounts reach their first dashboard without talking to anyone.', ships: 'Onboarding checklist, teammate invites and an activation metric. Success: 70% of trials activate within a day.', risks: 'Depends on the analytics events from Data foundations.',
    tasks: [{ title: 'Onboarding checklist UI', status: 'done', owner: 'Dana', due: ago(3) }, { title: 'Invite teammates step', status: 'in-progress', owner: 'Lee', due: ahead(7) }, { title: 'Activation metric in analytics', status: 'todo', due: ahead(14) }],
    links: [{ label: 'Design spec', url: 'https://example.com/specs/onboarding', source: 'figma' }], prs: [{ title: 'Checklist component', url: 'https://github.com/example/app/pull/101' }], log: [{ text: 'Checklist shipped to 10% of trials' }] });
  mk(web.slug, 'Billing page rewrite', { owner: 'Lee', contributors: ['Dana'], mission: 'Reliability', effort: 'M', status: 'at-risk', cycle: 0, rank: 2, approved: true, target: ago(2),
    description: 'Replace the legacy billing page; keep invoices and plan changes in one place.', ships: 'New invoice list and plan change flow.', risks: 'Payments provider sandbox is flaky; plan change flow is blocked on it.',
    tasks: [{ title: 'Invoice list', status: 'review', owner: 'Lee' }, { title: 'Plan change flow', status: 'blocked', owner: 'Lee' }] });
  mk(web.slug, 'Public API v2', { owner: 'Dana', mission: 'New bets', effort: 'XL', approved: true, bucket: 'next', description: 'A versioned public API with scoped tokens.', ships: 'v2 endpoints, scoped tokens, a migration guide.' });
  mk(web.slug, 'Dark mode', { owner: '', mission: 'Growth', effort: 'S', bucket: 'later', description: 'Customers keep asking for it.' });
  mk(data.slug, 'Warehouse migration', { owner: 'Sam', contributors: ['Priya', 'Mika'], mission: 'Reliability', effort: 'XL', status: 'on-track', cycle: 0, rank: 3, approved: true, target: ahead(25),
    description: 'Move the nightly pipelines to the new warehouse and retire the old one.', ships: 'All nightly jobs on the new warehouse; the old one switched off.', risks: 'Two years of history to backfill; cost of running both in parallel.',
    tasks: [{ title: 'Port ingestion jobs', status: 'in-progress', owner: 'Sam', due: ahead(10) }, { title: 'Backfill 2 years of history', status: 'todo', owner: 'Mika', due: ahead(21) }] });
  mk(data.slug, 'Metric definitions registry', { owner: 'Priya', contributors: ['Sam'], mission: 'Growth', effort: 'M', status: '', cycle: 1, rank: 1, approved: true, description: 'One place that defines every company metric.', ships: 'A registry page and a review process.', tasks: [{ title: 'Inventory existing metrics', status: 'todo', owner: 'Priya' }] });
  mk(data.slug, 'Anomaly alerts', { owner: 'Priya', mission: 'New bets', effort: 'M', bucket: 'next', description: 'Alert when a daily metric moves outside its normal range.', ships: 'Alerts to Slack for the ten core metrics.' });
  mk(data.slug, 'Retire legacy dashboards', { owner: 'Jo', effort: 'S', status: 'not-started', cycle: 0, rank: 4, approved: true, target: ahead(30), description: 'Remove the dashboards nobody opens.', ships: 'List of removed dashboards and a redirect page.' });
};
