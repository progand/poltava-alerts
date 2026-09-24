// Pulls the last month of air-raid alerts for Poltavskyi raion from
// alerts.in.ua and rewrites data/poltavskyi.json.
//
// Nothing is accumulated: the file is always exactly the month the API
// returned, so a missed run costs freshness, never history. Any surprise in
// the response fails the run loudly (red workflow, e-mail to the owner) and
// leaves the previous file in place — an empty or half-parsed file would
// reach the app as a confident "0%".

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// month_ago.json answers 404 for a raion uid; only the oblast works, and its
// response carries every raion of the oblast.
const OBLAST_UID = '19';
const RAION_UID = '109';
const ENDPOINT = `https://api.alerts.in.ua/v1/regions/${OBLAST_UID}/alerts/month_ago.json`;
const OUT = fileURLToPath(new URL('../data/poltavskyi.json', import.meta.url));

// "2026/09/24 04:18:28 +0000" — the moment the server built the response.
// The month window counts back from it, not from our request.
export function parseLastUpdated(value) {
  const m = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2}) \+0000$/.exec(String(value));
  if (m === null) throw new Error(`unexpected meta.last_updated_at: ${value}`);
  const [, y, mo, d, h, mi, s] = m.map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, mi, s));
}

// One calendar month back, clamped to the last day of the shorter month:
// 31.03 -> 28.02, never 03.03. Assumed to match the API's own window; the
// clamp errs towards claiming a day or two more, which only matters on the
// 29th–31st after a shorter month.
export function monthBefore(date) {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const lastOfPrevious = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return new Date(Date.UTC(
    y, m - 1, Math.min(date.getUTCDate(), lastOfPrevious),
    date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds(),
  ));
}

function time(value, field) {
  const ms = typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(ms)) throw new Error(`bad ${field}: ${value}`);
  return ms;
}

export function buildFeed(body) {
  const through = parseLastUpdated(body?.meta?.last_updated_at);
  const from = monthBefore(through);
  if (!Array.isArray(body?.alerts)) throw new Error('response has no alerts array');

  const alerts = [];
  for (const a of body.alerts) {
    const start = time(a.started_at, 'started_at');
    const end = a.finished_at === null ? null : time(a.finished_at, 'finished_at');
    // A raion-wide or an oblast-wide alert covers the raion; hromada and city
    // alerts do not.
    const ours = a.location_uid === RAION_UID || a.location_type === 'oblast';
    if (!ours) continue;
    if (end !== null && end <= from.getTime()) continue;
    alerts.push({
      start: new Date(Math.max(start, from.getTime())).toISOString(),
      end: end === null ? null : new Date(end).toISOString(),
    });
  }
  if (alerts.length === 0) throw new Error('no alerts for the raion in a month — refusing to publish');
  alerts.sort((a, b) => a.start.localeCompare(b.start));

  return {
    version: 1,
    oblast: 'Полтавська область',
    raion: 'Полтавський район',
    source: 'alerts.in.ua',
    from: from.toISOString(),
    through: through.toISOString(),
    alerts,
  };
}

async function main() {
  const token = process.env.ALERTS_IN_UA_TOKEN;
  if (!token) throw new Error('ALERTS_IN_UA_TOKEN is not set');
  const response = await fetch(ENDPOINT, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`alerts.in.ua answered ${response.status}`);
  const feed = buildFeed(await response.json());
  await writeFile(OUT, `${JSON.stringify(feed, null, 2)}\n`);
  console.log(`${feed.alerts.length} alerts, ${feed.from} → ${feed.through}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
