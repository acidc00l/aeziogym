/* Caducidad de fotos y vídeos de entrenos (media-expiry.js): qué se quita, qué nunca, que el
   archivo sin referencia se borra con gracia de 1 día y que el servidor entero lo hace en su
   pasada, sellado y sin tocar _rev cuando no hay nada. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { retentionDays, expiresAt, hasExpired, expireMedia } from '../media-expiry.js';
import { createMediaStore, mediaLimits } from '../media.js';
import { boundPort } from './helpers.mjs';
import * as M from './media-samples.mjs';

const DAY = 86400000;
const NOW = 1_800_000_000_000;
const H = c => c.repeat(64);
const ref = (c, at, extra = {}) => ({ kind: 'image', hash: H(c), mime: 'image/jpeg', size: 1, width: 1, height: 1, at, ...extra });

test('retentionDays: 15 por defecto, 0 apaga, lo inválido vuelve a 15', () => {
  assert.equal(retentionDays({}), 15);
  assert.equal(retentionDays({ MEDIA_RETENTION_DAYS: '' }), 15);
  assert.equal(retentionDays({ MEDIA_RETENTION_DAYS: '0' }), 0);
  assert.equal(retentionDays({ MEDIA_RETENTION_DAYS: '30' }), 30);
  assert.equal(retentionDays({ MEDIA_RETENTION_DAYS: 'x' }), 15);
  assert.equal(retentionDays({ MEDIA_RETENTION_DAYS: '-3' }), 15);
  assert.equal(expiresAt(1000, 15), 1000 + 15 * DAY);
  assert.equal(expiresAt(1000, 0), null);
});

test('expireMedia quita lo más viejo que la retención, en entrenos y en series, y nada más', () => {
  const S = {
    workouts: [{ id: 'w1', _ts: 10, media: [ref('a', NOW - 16 * DAY, { poster: { hash: H('p') } }), ref('b', NOW - 14 * DAY), ref('n', 0)],
      entries: [{ id: 'e1', sets: [{ media: [ref('c', NOW - 30 * DAY)] }, { media: [ref('d', NOW - DAY)] }] }] }],
    customEx: [{ id: 'c1', media: ref('x', 1) }],
    exMedia: { '0025': { m: ref('y', 1) } },
    dayPhotos: { [H('z')]: { d: '2026-01-01', m: ref('z', 1) } },
    sounds: [{ id: 's', m: ref('s', 1) }],
    avatar: { m: ref('v', 1) },
  };
  const before = JSON.parse(JSON.stringify(S));
  assert.equal(hasExpired(S, { now: NOW, days: 15 }), true);
  assert.equal(hasExpired(S, { now: NOW, days: 0 }), false);
  const r = expireMedia(S, { now: NOW, days: 15, t: 999 });
  assert.deepEqual(r, { removed: 2, workouts: 1 });
  const w = S.workouts[0];
  assert.deepEqual(w.media.map(m => m.hash), [H('b'), H('n')], 'sin `at` no caduca');
  assert.equal(w.entries[0].sets[0].media, undefined);
  assert.deepEqual(w.entries[0].sets[1].media.map(m => m.hash), [H('d')]);
  assert.deepEqual(w.mediaGone, [H('a')]);
  assert.equal(w._ts, 999);
  assert.equal(w._f.media, 999);
  assert.equal(w._f.entries, 999);
  // fotos de progreso, ejercicios propios y de catálogo, sonidos y avatar, intactos
  for (const k of ['customEx', 'exMedia', 'dayPhotos', 'sounds', 'avatar']) assert.deepEqual(S[k], before[k], k);
  assert.equal(hasExpired(S, { now: NOW, days: 15 }), false);
});

test('el archivo caducado, ya sin referencia, se borra con gracia de 1 día y no antes', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'media-exp-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const clock = { t: NOW };
  let S = null;
  const store = createMediaStore({ dir: path.join(root, 'uploads'), limits: { ...mediaLimits({ MEDIA_GC_GRACE_DAYS: '1' }) }, now: () => clock.t, readState: () => S, log: { warn() {}, error() {}, log() {} } });
  const d = path.join(root, 'uploads', 'u1');
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  const bytes = M.jpeg(), keep = M.jpeg();
  const h = M.sha(bytes), hk = M.sha(keep);
  fs.writeFileSync(path.join(d, `${h}.jpg`), bytes);
  fs.writeFileSync(path.join(d, `${hk}.jpg`), keep);
  S = { workouts: [{ id: 'w1', media: [ref('a', NOW - 20 * DAY, { hash: h }), ref('b', NOW - DAY, { hash: hk })] }] };
  assert.equal(store.sweep('u1').removed, 0);
  expireMedia(S, { now: NOW, days: 15, t: 5 });            // pasada de caducidad
  store.noteState('u1', S);                                 // lo que hace writeStateAs
  clock.t += DAY - 1000;
  assert.equal(store.sweep('u1').removed, 0, 'aún dentro de la gracia');
  clock.t += 2000;
  assert.equal(store.sweep('u1').removed, 1);
  assert.deepEqual(fs.readdirSync(d).filter(n => !n.startsWith('.')), [`${hk}.jpg`]);
});

test('el servidor, en su pasada, quita lo caducado sellado, sube _rev una vez y deja el resto', async t => {
  const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const KEY = crypto.randomBytes(32).toString('hex');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-exp-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), KEY, { mode: 0o600 });
  const now = new Date().toISOString();
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: [{ id: 'u_a', name: 'A', created: now }, { id: 'u_b', name: 'B', created: now }], creds: [], subs: [], invites: [] }), { mode: 0o600 });
  const at = Date.now();
  const sa = { unit: 'kg', _rev: 7, _ts: 1000, workouts: [{ id: 'w1', d: '2026-10-01', _ts: 900, media: [ref('a', at - 20 * DAY), ref('b', at - DAY)] }] };
  const sb = { unit: 'kg', _rev: 2, workouts: [{ id: 'w1', d: '2026-11-01', media: [ref('b', at - DAY)] }] };
  fs.writeFileSync(path.join(dataDir, 'state-u_a.json'), JSON.stringify(sa));
  fs.writeFileSync(path.join(dataDir, 'state-u_b.json'), JSON.stringify(sb));
  const child = spawn(process.execPath, ['server.js'], { cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', MEDIA_SWEEP_FIRST_MS: '100' } });
  let log = '';
  child.stdout.on('data', d => log += d);
  child.stderr.on('data', d => log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  await boundPort(child, () => log);
  const read = u => JSON.parse(fs.readFileSync(path.join(dataDir, `state-${u}.json`), 'utf8'));
  for (let i = 0; i < 50 && read('u_a')._rev === 7; i++) await new Promise(r => setTimeout(r, 100));
  const a = read('u_a');
  assert.equal(a._rev, 8);
  assert.deepEqual(a.workouts[0].media.map(m => m.hash), [H('b')]);
  assert.deepEqual(a.workouts[0].mediaGone, [H('a')]);
  assert.ok(a.workouts[0]._ts > 1000 && a._ts > 1000, 'sellado por encima de todo lo anterior');
  assert.deepEqual(read('u_b'), sb, 'un perfil sin nada caducado no se toca');
});
