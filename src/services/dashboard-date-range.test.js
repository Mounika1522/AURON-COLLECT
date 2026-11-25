import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDashboardDateRange } from './dashboard-date-range.js';

const now = new Date('2026-11-21T11:00:00.000Z');

test('resolves dashboard presets to UTC calendar dates', () => {
  assert.deepEqual(resolveDashboardDateRange('Today', '', '', now), {
    from: '2026-11-21',
    to: '2026-11-21',
    label: 'Today',
    error: null,
  });
  assert.deepEqual(resolveDashboardDateRange('This Week', '', '', now), {
    from: '2026-11-16',
    to: '2026-11-21',
    label: 'This Week',
    error: null,
  });
  assert.deepEqual(resolveDashboardDateRange('This Month', '', '', now), {
    from: '2026-11-01',
    to: '2026-11-21',
    label: 'This Month',
    error: null,
  });
  assert.deepEqual(resolveDashboardDateRange('Last Month', '', '', now), {
    from: '2026-10-01',
    to: '2026-10-31',
    label: 'Last Month',
    error: null,
  });
  assert.deepEqual(resolveDashboardDateRange('This Quarter', '', '', now), {
    from: '2026-10-01',
    to: '2026-11-21',
    label: 'This Quarter',
    error: null,
  });
});

test('validates custom date ranges and rejects future or reversed ranges', () => {
  assert.deepEqual(
    resolveDashboardDateRange('Custom Range', '2026-11-01', '2026-11-20', now),
    {
      from: '2026-11-01',
      to: '2026-11-20',
      label: 'Custom Range',
      error: null,
    },
  );
  assert.ok(
    resolveDashboardDateRange('Custom Range', '2026-11-02', '2026-11-01', now).error,
  );
  assert.ok(
    resolveDashboardDateRange('Custom Range', '2026-02-30', '2026-03-01', now).error,
  );
  assert.ok(
    resolveDashboardDateRange('Custom Range', '2026-11-01', '2026-11-22', now).error,
  );
});
