import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFeed, monthBefore, parseLastUpdated } from './update.mjs';

const META = { last_updated_at: '2026/09/24 04:18:28 +0000', type: 'full' };

function rec(overrides) {
  return {
    id: 1,
    location_title: 'Полтавський район',
    location_type: 'raion',
    location_uid: '109',
    started_at: '2026-09-23T16:45:37.318Z',
    finished_at: '2026-09-23T17:01:29.585Z',
    alert_type: 'air_raid',
    ...overrides,
  };
}

test('last_updated_at розбирається як UTC', () => {
  assert.equal(parseLastUpdated('2026/09/24 04:18:28 +0000').toISOString(), '2026-09-24T04:18:28.000Z');
});

test('last_updated_at іншого вигляду — відмова', () => {
  assert.throws(() => parseLastUpdated('2026-09-24T04:18:28Z'));
  assert.throws(() => parseLastUpdated(undefined));
});

test('місяць тому — календарний, не 30 діб', () => {
  assert.equal(monthBefore(new Date('2026-09-24T04:18:28Z')).toISOString(), '2026-08-24T04:18:28.000Z');
  assert.equal(monthBefore(new Date('2027-03-24T02:30:00Z')).toISOString(), '2027-02-24T02:30:00.000Z');
  assert.equal(monthBefore(new Date('2027-01-10T02:30:00Z')).toISOString(), '2026-12-10T02:30:00.000Z');
});

test('кінець місяця не перескакує вперед: 31.03 → останній день лютого', () => {
  assert.equal(monthBefore(new Date('2027-03-31T02:30:00Z')).toISOString(), '2027-02-28T02:30:00.000Z');
});

test('бере лише район 109 і тривоги рівня області', () => {
  const feed = buildFeed({
    meta: META,
    alerts: [
      rec({ id: 1 }),
      rec({ id: 2, location_uid: '107', location_title: 'Кременчуцький район' }),
      rec({ id: 3, location_type: 'oblast', location_uid: '19', started_at: '2026-09-20T10:00:00Z', finished_at: '2026-09-20T11:00:00Z' }),
      rec({ id: 4, location_type: 'hromada', location_uid: '1234' }),
    ],
  });
  assert.deepEqual(feed.alerts, [
    { start: '2026-09-20T10:00:00.000Z', end: '2026-09-20T11:00:00.000Z' },
    { start: '2026-09-23T16:45:37.318Z', end: '2026-09-23T17:01:29.585Z' },
  ]);
  assert.equal(feed.version, 1);
  assert.equal(feed.oblast, 'Полтавська область');
  assert.equal(feed.raion, 'Полтавський район');
  assert.equal(feed.source, 'alerts.in.ua');
  assert.equal(feed.from, '2026-08-24T04:18:28.000Z');
  assert.equal(feed.through, '2026-09-24T04:18:28.000Z');
});

test('тривога, що ще триває, лишається з end: null', () => {
  const feed = buildFeed({ meta: META, alerts: [rec({ finished_at: null })] });
  assert.equal(feed.alerts[0].end, null);
});

test('тривога, що почалась до межі місяця, обрізається до from; закінчена до неї — відкидається', () => {
  const feed = buildFeed({
    meta: META,
    alerts: [
      rec({ id: 1, started_at: '2026-08-24T04:00:00Z', finished_at: '2026-08-24T05:00:00Z' }),
      rec({ id: 2, started_at: '2026-08-24T03:00:00Z', finished_at: '2026-08-24T04:00:00Z' }),
    ],
  });
  assert.deepEqual(feed.alerts, [{ start: '2026-08-24T04:18:28.000Z', end: '2026-08-24T05:00:00.000Z' }]);
});

test('зламана відповідь — відмова', () => {
  assert.throws(() => buildFeed({ meta: META }), /alerts/);
  assert.throws(() => buildFeed({ meta: META, alerts: [rec({ started_at: 'вчора' })] }), /started_at/);
  assert.throws(() => buildFeed({ meta: META, alerts: [rec({ finished_at: 'колись' })] }), /finished_at/);
  assert.throws(() => buildFeed({ alerts: [rec({})] }), /last_updated_at/);
});

test('жодної тривоги по району за місяць — відмова, а не порожній файл', () => {
  assert.throws(
    () => buildFeed({ meta: META, alerts: [rec({ location_uid: '107' })] }),
    /no alerts/,
  );
});
