import test from 'node:test';
import assert from 'node:assert/strict';

import { selectAppHistoryDomain, type AppHistoryDomain } from './appHistoryDomain.ts';

const available = (...domains: AppHistoryDomain[]) =>
  domains.reduce(
    (result, domain) => ({ ...result, [domain]: true }),
    {} as Record<AppHistoryDomain, boolean>,
  );

test('selectAppHistoryDomain prefers the last changed available history domain', () => {
  assert.equal(
    selectAppHistoryDomain({
      activeWorkspace: 'PROJECT',
      lastDomain: 'media',
      availability: available('references', 'media'),
    }),
    'media',
  );
});

test('selectAppHistoryDomain prioritizes project object history in Project Hub', () => {
  assert.equal(
    selectAppHistoryDomain({
      activeWorkspace: 'PROJECT',
      lastDomain: null,
      availability: available('timeline', 'shots', 'media'),
    }),
    'shots',
  );
});

test('selectAppHistoryDomain prioritizes timeline history in editing workspaces', () => {
  assert.equal(
    selectAppHistoryDomain({
      activeWorkspace: 'EDIT',
      lastDomain: null,
      availability: available('timeline', 'references', 'media'),
    }),
    'timeline',
  );
});

test('selectAppHistoryDomain returns null when no domain can move', () => {
  assert.equal(
    selectAppHistoryDomain({
      activeWorkspace: 'EDIT',
      lastDomain: 'timeline',
      availability: available(),
    }),
    null,
  );
});
