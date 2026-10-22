'use strict';
// A few projects and initiatives so a first run has something to look at (node server.js --seed, on an empty vault).
const { cycleAt } = require('./cycles');

module.exports = function seed(store) {
  const cur = Math.max(0, cycleAt(store.config()));
  const mk = (project, title, o) => {
    const it = store.createInitiative({ project, title, ...o });
    for (const t of o.tasks || []) store.addTask(it.id, t);
    for (const l of o.links || []) store.addLink(it.id, l);
    for (const l of o.log || []) store.addLog(it.id, l);
    return it;
  };
  const web = store.createProject({ title: 'Customer platform', description: 'The product customers log into every day.', owner: 'Dana' });
  const data = store.createProject({ title: 'Data foundations', description: 'Pipelines and the warehouse the rest of the company reads.', owner: 'Sam' });
  mk(web.slug, 'Self-serve onboarding', { description: 'New accounts reach their first dashboard without talking to anyone.\n\nSuccess: 70% of trials activate within a day.', owner: 'Dana', effort: 'L', status: 'on-track', cycle: cur,
    tasks: [{ title: 'Onboarding checklist UI', status: 'done', owner: 'Dana' }, { title: 'Invite teammates step', status: 'in-progress', owner: 'Lee' }, { title: 'Activation metric in analytics', status: 'todo' }],
    links: [{ label: 'Design spec', url: 'https://example.com/specs/onboarding', source: 'figma' }], log: [{ text: 'Checklist shipped to 10% of trials', source: 'manual' }] });
  mk(web.slug, 'Billing page rewrite', { description: 'Replace the legacy billing page; keep invoices and plan changes in one place.', owner: 'Lee', effort: 'M', status: 'at-risk', cycle: cur,
    tasks: [{ title: 'Invoice list', status: 'review', owner: 'Lee' }, { title: 'Plan change flow', status: 'blocked', owner: 'Lee' }] });
  mk(web.slug, 'Public API v2', { description: 'A versioned public API with scoped tokens.', owner: 'Dana', effort: 'XL', status: 'proposed' });
  mk(data.slug, 'Warehouse migration', { description: 'Move the nightly pipelines to the new warehouse and retire the old one.', owner: 'Sam', effort: 'XL', status: 'on-track', cycle: cur,
    tasks: [{ title: 'Port ingestion jobs', status: 'in-progress', owner: 'Sam' }, { title: 'Backfill 2 years of history', status: 'todo' }] });
  mk(data.slug, 'Metric definitions registry', { description: 'One place that defines every company metric.', owner: 'Priya', effort: 'M', status: 'proposed', cycle: cur + 1, tasks: [{ title: 'Inventory existing metrics', status: 'todo', owner: 'Priya' }] });
};
