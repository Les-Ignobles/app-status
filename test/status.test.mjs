import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMessage, diff, summarize, boardLine, boardLines } from '../src/status.mjs';

const v = (version, state, createdDate, build = null) => ({ version, state, createdDate, build });

test('summarize : version en ligne + version en cours plus récente', () => {
  const s = summarize([
    v('1.1.53', 'IN_REVIEW', '2026-11-26', '270'),
    v('1.1.51', 'READY_FOR_DISTRIBUTION', '2026-11-10', '262'),
    v('1.1.50', 'REPLACED_WITH_NEW_VERSION', '2026-11-01'),
  ]);
  assert.deepEqual(s.live, { version: '1.1.51', build: '262' });
  assert.deepEqual(s.pending, { version: '1.1.53', build: '270', state: 'IN_REVIEW' });
});

test('summarize : rien en cours quand la dernière version est en ligne', () => {
  const s = summarize([v('2.0.3', 'READY_FOR_DISTRIBUTION', '2026-11-20')]);
  assert.equal(s.pending, null);
  assert.equal(s.live.version, '2.0.3');
});

test('summarize : app jamais sortie', () => {
  const s = summarize([v('1.0.0', 'PREPARE_FOR_SUBMISSION', '2026-11-20')]);
  assert.equal(s.live, null);
  assert.equal(s.pending.state, 'PREPARE_FOR_SUBMISSION');
});

const app = (name, live, pending) => ({ name, live, pending });

test('diff : un changement d\'état de la version en cours', () => {
  const before = { a: app('Parkeur', { version: '1.1.51' }, { version: '1.1.53', state: 'WAITING_FOR_REVIEW' }) };
  const after = { a: app('Parkeur', { version: '1.1.51' }, { version: '1.1.53', build: '270', state: 'IN_REVIEW' }) };
  const changes = diff(before, after);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].fromState, 'WAITING_FOR_REVIEW');
  assert.equal(changes[0].toState, 'IN_REVIEW');
});

test('diff : passage en ligne (la version en cours devient la version en ligne)', () => {
  const before = { a: app('Parkeur', { version: '1.1.51' }, { version: '1.1.53', state: 'PENDING_DEVELOPER_RELEASE' }) };
  const after = { a: app('Parkeur', { version: '1.1.53' }, null) };
  const [c] = diff(before, after);
  assert.equal(c.fromState, 'PENDING_DEVELOPER_RELEASE');
  assert.equal(c.toState, 'READY_FOR_DISTRIBUTION');
});

test('diff : rien ne change, ou app nouvelle → pas de message', () => {
  const s = { a: app('Nimble', { version: '2.0.3' }, null) };
  assert.deepEqual(diff(s, s), []);
  assert.deepEqual(diff({}, s), []);
});

test('boardLine : rejetée en rouge, en ligne en vert', () => {
  assert.match(boardLine(app('La Taupe', null, { version: '1.0.4', state: 'REJECTED' })), /^🔴 \*\*La Taupe\*\*.*rejetée/);
  assert.match(boardLine(app('Nimble', { version: '2.0.3' }, null)), /^🟢 \*\*Nimble\*\* — iOS 2.0.3 en ligne$/);
  assert.match(boardLine(app('GetUp', null, null)), /rien en cours/);
});

test('buildMessage : titre et en-tête du changement, puis le tableau', () => {
  const current = {
    a: app('Parkeur', { version: '1.1.51' }, { version: '1.1.53', build: '270', state: 'IN_REVIEW' }),
    b: app('Nimble', { version: '2.0.3' }, null),
  };
  const changes = [{ name: 'Parkeur', fromState: 'WAITING_FOR_REVIEW', toState: 'IN_REVIEW', version: current.a.pending }];
  const { embeds: [e] } = buildMessage(changes, current, new Date('2026-11-26T13:32:00Z'));
  assert.equal(e.title, '🔵 Parkeur passe en review');
  assert.match(e.description, /^iOS 1\.1\.53 \(270\) · Waiting for review → In review/);
  assert.match(e.description, /\*\*🏠 Apps internes\*\*\n```\n/);
  assert.match(e.description, /🟢 Nimble\s+2\.0\.3/);
  assert.equal(e.footer.text, 'Mis à jour à 14:32');
});

test('boardLines : colonnes alignées (nom, version en ligne, en cours)', () => {
  const lines = boardLines([
    app('Le temps merde', { version: '1.0' }, null),
    app('Parkeur', { version: '1.1.51' }, { version: '1.1.53', state: 'IN_REVIEW' }),
    app('Kut', null, { version: '1.0', state: 'WAITING_FOR_REVIEW' }),
  ]);
  // La version en ligne commence à la même colonne sur chaque ligne.
  const col = (l, v) => [...l].indexOf(v[0], 3);
  assert.equal(col(lines[0], '1.0'), col(lines[1], '1.1.51'));
  assert.match(lines[1], /1\.1\.51\s+🔵 1\.1\.53 en review$/);
  assert.match(lines[2], /—\s+🟡 1\.0 en attente de review$/);
});

test('app externe : nouvelle version en ligne → « 2.23.3 → 2.23.4 »', () => {
  const before = { p: { ...app('Pol', { version: '2.23.3' }, null), group: 'external' } };
  const after = { p: { ...app('Pol', { version: '2.23.4' }, null), group: 'external' } };
  const changes = diff(before, after);
  const { embeds: [e] } = buildMessage(changes, after);
  assert.equal(e.title, '🎉 Pol est en ligne');
  assert.match(e.description, /^iOS 2\.23\.3 → 2\.23\.4\n/);
  assert.match(e.description, /\*\*🤝 Apps externes\*\*/);
});
