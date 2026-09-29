// PitchCall backend
// Run: npm install && API_FOOTBALL_KEY=your_key node server.js
// Needs Node 18+.

const express = require('express');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

const KEY = process.env.API_FOOTBALL_KEY;
const PORT = process.env.PORT || 3000;
const DAYS_AHEAD = Number(process.env.DAYS_AHEAD || 7);
const MAX_PREDICTIONS = Number(process.env.MAX_PREDICTIONS || 50); // free plan: 100 requests/day total
const CACHE = path.join(__dirname, 'fixtures.json');
const BASE = 'https://v3.football.api-sports.io';

// Big leagues get real predictions first (API-Football league ids)
const TOP = [39, 140, 135, 78, 61, 2, 3, 848, 5, 40, 88, 94, 253, 332, 6, 36, 1, 10];

if (!KEY) console.warn('Missing API_FOOTBALL_KEY. Fixtures will not update.');

async function api(endpoint) {
  const r = await fetch(BASE + endpoint, { headers: { 'x-apisports-key': KEY } });
  if (!r.ok) throw new Error(endpoint + ' -> ' + r.status);
  const j = await r.json();
  if (j.errors && Object.keys(j.errors).length) console.warn(endpoint, JSON.stringify(j.errors));
  return j.response || [];
}

const isoDate = (offset) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);
const num = (s) => parseInt(String(s).replace('%', ''), 10) || 0;

async function refresh() {
  if (!KEY) return;
  console.log('Refreshing fixtures...', new Date().toISOString());
  let all = [];

  for (let d = 0; d < DAYS_AHEAD; d++) {
    try {
      const fixtures = await api('/fixtures?date=' + isoDate(d));
      all = all.concat(fixtures.filter((fx) => ['NS', 'TBD'].includes(fx.fixture.status.short)));
    } catch (e) { console.error(e.message); }
  }

  // Big leagues first, then by kickoff time
  const rank = (fx) => { const i = TOP.indexOf(fx.league.id); return i === -1 ? 999 : i; };
  all.sort((a, b) => rank(a) - rank(b) || new Date(a.fixture.date) - new Date(b.fixture.date));

  const out = [];
  let budget = MAX_PREDICTIONS;
  for (const fx of all) {
    let p = null;
    if (budget > 0 && rank(fx) < 999) {
      try {
        const pr = await api('/predictions?fixture=' + fx.fixture.id);
        budget--;
        const pc = pr[0] && pr[0].predictions && pr[0].predictions.percent;
        if (pc) p = [num(pc.home), num(pc.draw), num(pc.away)];
      } catch (e) { console.error(e.message); }
    }
    out.push({
      id: String(fx.fixture.id),
      league: fx.league.name + (fx.league.country && fx.league.country !== 'World' ? ' (' + fx.league.country + ')' : ''),
      home: fx.teams.home.name,
      away: fx.teams.away.name,
      ko: new Date(fx.fixture.date).toISOString(),
      p: p || [40, 27, 33],
      est: !p, // true = no real prediction, estimate only
    });
  }
  fs.writeFileSync(CACHE, JSON.stringify(out));
  console.log('Saved', out.length, 'fixtures');
}

const app = express();
app.use(express.static(__dirname));

app.get('/api/fixtures', (req, res) => {
  try { res.json(JSON.parse(fs.readFileSync(CACHE, 'utf8'))); }
  catch (e) { res.json([]); }
});

cron.schedule('5 0 * * *', refresh);
refresh();

app.listen(PORT, () => console.log('PitchCall running on http://localhost:' + PORT));
