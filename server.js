// PitchCall backend
// Run: npm install && API_FOOTBALL_KEY=your_key node server.js
// Needs Node 18+. Free key: https://www.api-football.com (100 requests/day on free plan)

const express = require('express');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

const KEY = process.env.API_FOOTBALL_KEY;
const PORT = process.env.PORT || 3000;
const DAYS_AHEAD = Number(process.env.DAYS_AHEAD || 3);           // how many days to load
const MAX_PREDICTIONS = Number(process.env.MAX_PREDICTIONS || 60); // API calls spent on probabilities per run
const CACHE = path.join(__dirname, 'fixtures.json');
const BASE = 'https://v3.football.api-sports.io';

if (!KEY) console.warn('Missing API_FOOTBALL_KEY. Fixtures will not update.');

async function api(endpoint) {
  const r = await fetch(BASE + endpoint, { headers: { 'x-apisports-key': KEY } });
  if (!r.ok) throw new Error(endpoint + ' -> ' + r.status);
  const j = await r.json();
  return j.response || [];
}

const isoDate = (offset) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);
const num = (s) => parseInt(String(s).replace('%', ''), 10) || 0;

// Pull every football fixture worldwide for the next few days,
// then fetch win/draw/loss probabilities for as many as the quota allows.
async function refresh() {
  if (!KEY) return;
  console.log('Refreshing fixtures...', new Date().toISOString());
  const out = [];
  let budget = MAX_PREDICTIONS;

  for (let d = 0; d < DAYS_AHEAD; d++) {
    let fixtures = [];
    try { fixtures = await api('/fixtures?date=' + isoDate(d)); }
    catch (e) { console.error(e.message); continue; }

    for (const fx of fixtures) {
      if (['FT', 'AET', 'PEN', 'PST', 'CANC', 'ABD'].includes(fx.fixture.status.short)) continue;
      let p = [40, 27, 33]; // fallback when no prediction is available
      if (budget > 0) {
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
        p,
      });
    }
  }
  fs.writeFileSync(CACHE, JSON.stringify(out));
  console.log('Saved', out.length, 'fixtures');
}

const app = express();
app.use(express.static(__dirname)); // serves index.html

app.get('/api/fixtures', (req, res) => {
  try {
    res.json(JSON.parse(fs.readFileSync(CACHE, 'utf8')));
  } catch (e) {
    res.json([]); // site falls back to its sample list
  }
});

// Runs every day at 00:05 server time, and once at startup
cron.schedule('5 0 * * *', refresh);
refresh();

app.listen(PORT, () => console.log('PitchCall running on http://localhost:' + PORT));

// VIP gating tip: the demo unlock code lives in index.html. For real users,
// add a login and return the VIP list from a protected /api/vip route instead.
