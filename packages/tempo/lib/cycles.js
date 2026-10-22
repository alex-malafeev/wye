'use strict';
// Planning cycles are derived, not stored one by one: a start date, a length in weeks and a cooldown give every cycle
// (cycle n starts n × (weeks + cooldown) days after cycle 0). Configurable in the vault's _product.md.
const DAY = 86400000;
const iso = d => d.toISOString().slice(0, 10);
const parse = s => { const m = /^(\d{4})-(\d\d)-(\d\d)/.exec(s || ''); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null; };

function cycleOf(cfg, n) {
  const start = parse(cfg.start) || new Date(), span = cfg.weeks * 7 + cfg.cooldown;
  const s = new Date(start.getTime() + n * span * DAY), e = new Date(s.getTime() + (cfg.weeks * 7 - 1) * DAY);
  return { n, name: `Cycle ${n}`, start: iso(s), end: iso(e), cooldownEnd: iso(new Date(e.getTime() + cfg.cooldown * DAY)) };
}
// the cycle a date falls in (cooldown belongs to the cycle before it); negative before the first cycle starts
function cycleAt(cfg, date = new Date()) {
  const span = cfg.weeks * 7 + cfg.cooldown, start = parse(cfg.start) || date;
  return Math.floor((parse(iso(date)) - start) / DAY / span);
}
function cycles(cfg, around = cycleAt(cfg), back = 3, ahead = 2) {
  const out = [];
  for (let n = Math.max(0, around - back); n <= around + ahead; n++) out.push(cycleOf(cfg, n));
  return out;
}
module.exports = { cycleOf, cycleAt, cycles, iso, parse };
