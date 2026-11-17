'use strict';
// Tests for the re-measure (self-check loop). Zero-dependency: node:test only.
// Run: npm test  (or: node test.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Isolate the local state in a temp dir BEFORE requiring index.js, so these
// tests never touch the developer's real ~/.verifux.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verifux-cli-test-'));
process.env.VERIFUX_STATE_DIR = TMP;

const { computeDelta, remeasureLines, keyFor, saveLast, loadLast } = require('./index.js');

const snap = (band, passed) => ({ machine_check: { band, checks_run: 10, checks_passed: (passed || []).length, passed_labels: passed || [] } });

test('computeDelta: null when there is no prior run', () => {
  assert.equal(computeDelta(null, snap('Strong', ['A'])), null);
  assert.equal(computeDelta(undefined, snap('Strong', [])), null);
});

test('computeDelta: null when either band is missing (never a fabricated no-change)', () => {
  assert.equal(computeDelta({ band: null, passed_labels: [] }, snap('Strong', [])), null);
  assert.equal(computeDelta({ band: 'Mixed', passed_labels: [] }, { machine_check: { band: null } }), null);
});

test('computeDelta: band direction up / down / same', () => {
  assert.equal(computeDelta({ band: 'Mixed', passed_labels: [] }, snap('Strong', [])).band_direction, 'up');
  assert.equal(computeDelta({ band: 'Strong', passed_labels: [] }, snap('Mixed', [])).band_direction, 'down');
  assert.equal(computeDelta({ band: 'Mixed', passed_labels: [] }, snap('Mixed', [])).band_direction, 'same');
});

test('computeDelta: newly passing/failing come from a set-diff of named checks', () => {
  const prev = { band: 'Mixed', at: '2026-11-15T00:00:00Z', checks_run: 10, passed_labels: ['Contrast', 'Links'] };
  const curr = snap('Strong', ['Contrast', 'Links', 'Viewport']); // Viewport now passes
  const d = computeDelta(prev, curr);
  assert.deepEqual(d.newly_passing, ['Viewport']);
  assert.deepEqual(d.newly_failing, []);
  assert.equal(d.band_from, 'Mixed');
  assert.equal(d.band_to, 'Strong');
  assert.equal(d.at, '2026-11-15T00:00:00Z');

  // A regression is reported too: a check that passed before now fails.
  const d2 = computeDelta({ band: 'Strong', checks_run: 10, passed_labels: ['Contrast', 'Links'] }, snap('Mixed', ['Contrast']));
  assert.deepEqual(d2.newly_failing, ['Links']);
  assert.deepEqual(d2.newly_passing, []);
});

test('computeDelta: when the measured-check COUNT changed, no specific flip is claimed (a dropped probe is not "now failing")', () => {
  // prev measured 10 checks and "Links" passed; curr measured only 9 (a probe
  // could not run), so "Links" leaving passed_labels must NOT read as "now failing".
  const prev = { band: 'Strong', checks_run: 10, passed_labels: ['Links', 'Contrast'] };
  const curr = { machine_check: { band: 'Mixed', checks_run: 9, checks_passed: 1, passed_labels: ['Contrast'] } };
  const d = computeDelta(prev, curr);
  assert.equal(d.comparable, false);
  assert.deepEqual(d.newly_failing, []); // never fabricated from a count change
  assert.deepEqual(d.newly_passing, []);
  assert.equal(d.checks_from, 10);
  assert.equal(d.checks_to, 9);
  const text = remeasureLines(d).join('\n');
  assert.match(text, /9 checks measured this run vs 10 last/);
  assert.doesNotMatch(text, /now failing/);
});

test('remeasureLines: the "re-run to confirm" note appears on a move, not on a no-change run', () => {
  const moved = computeDelta({ band: 'Mixed', checks_run: 10, passed_labels: ['Links'] }, snap('Strong', ['Links', 'Viewport']));
  assert.match(remeasureLines(moved).join('\n'), /re-run to confirm/);
  const same = computeDelta({ band: 'Strong', checks_run: 10, passed_labels: ['A', 'B'] }, snap('Strong', ['A', 'B']));
  assert.doesNotMatch(remeasureLines(same).join('\n'), /re-run to confirm/);
});

test('remeasureLines: measurement framing only, never a causal "your fix worked" claim', () => {
  const d = computeDelta({ band: 'Mixed', at: '2026-11-15T09:00:00Z', checks_run: 10, passed_labels: ['Links'] }, snap('Strong', ['Links', 'Viewport']));
  const text = remeasureLines(d).join('\n');
  assert.match(text, /Since your last run of this URL \(2026-11-15\)/);
  assert.match(text, /band Mixed -> Strong/);
  assert.match(text, /now passing: Viewport/);
  assert.doesNotMatch(text, /fix|fixed|worked|because of you/i); // never attributes causation
  assert.deepEqual(remeasureLines(null), []);
});

test('remeasureLines: a genuinely unchanged re-run says so, does not invent movement', () => {
  const d = computeDelta({ band: 'Strong', checks_run: 10, passed_labels: ['A', 'B'] }, snap('Strong', ['A', 'B']));
  const text = remeasureLines(d).join('\n');
  assert.match(text, /band Strong -> Strong \(no change\)/);
  assert.match(text, /no checks changed since the last run/);
});

test('keyFor: different URLs never collide (no cross-URL comparison)', () => {
  assert.notEqual(keyFor('https://a.com'), keyFor('https://b.com'));
  assert.equal(keyFor('https://a.com'), keyFor('https://a.com')); // stable
});

test('saveLast/loadLast: round-trips, and one URL never reads another URL state', () => {
  saveLast('https://site-a.com', snap('Mixed', ['Contrast']));
  const a = loadLast('https://site-a.com');
  assert.equal(a.band, 'Mixed');
  assert.deepEqual(a.passed_labels, ['Contrast']);
  assert.equal(loadLast('https://site-b.com'), null); // never site-a's data

  // A re-run of the SAME url produces a real, same-url delta.
  const d = computeDelta(loadLast('https://site-a.com'), snap('Strong', ['Contrast', 'Viewport']));
  assert.equal(d.band_direction, 'up');
  assert.deepEqual(d.newly_passing, ['Viewport']);
});

test.after(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {} });
