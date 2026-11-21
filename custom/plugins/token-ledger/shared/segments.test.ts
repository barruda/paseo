import assert from 'node:assert/strict';
import { test } from 'node:test';
import { joinWrappableSegments } from './segments.ts';

const NBSP = ' ';

test('segments break only after a separator or a model slash', () => {
  const line = joinWrappableSegments([
    'claude-opus-5-5 / high',
    'in 16 · cache 517.1k · write 4.9k · out 2.0k',
    '79 tok/s',
  ]);
  assert.equal(
    line.split(NBSP).join(' '),
    'claude-opus-5-5 / high · in 16 · cache 517.1k · write 4.9k · out 2.0k · 79 tok/s',
  );
  assert.deepEqual(line.split(' '), [
    `claude-opus-5-5${NBSP}/`,
    `high${NBSP}·`,
    `in${NBSP}16${NBSP}·`,
    `cache${NBSP}517.1k${NBSP}·`,
    `write${NBSP}4.9k${NBSP}·`,
    `out${NBSP}2.0k${NBSP}·`,
    `79${NBSP}tok/s`,
  ]);
});

test('a single segment keeps its words together', () => {
  assert.equal(joinWrappableSegments(['usage gap']), `usage${NBSP}gap`);
  assert.equal(joinWrappableSegments([]), '');
});
