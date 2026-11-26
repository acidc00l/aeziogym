/* El contrato Aezio ↔ AezioGym (docs/AEZIOGYM.md): las tres rutas internas que firma la web de Aezio
   (POST /api/internal/delete-profile, restore-profile y coach-pending) y la cola que la app lee con su
   sesión (GET /api/coach-pending y su ack). La firma se calcula aquí igual que OpenGymService.php:
   HMAC-SHA256 en hexadecimal de "<acción>:<id>:<ts>", ts en milisegundos como texto, un minuto de
   margen. server.js real en un proceso hijo, como server-account-delete.test.js. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEY = crypto.randomBytes(32).toString('hex');
const ADMIN = 'u_adm_1', USER = 'u_usr_1', OTHER = 'u_usr_2';
const sign = (action, id, ts, key = KEY) => crypto.createHmac('sha256', key).update(`${action}:${id}:${ts}`).digest('hex');
const mintSession = uid => {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return payload + '.' + crypto.createHmac('sha256', KEY).update(payload).digest('base64url');
};

async function startServer(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-aezio-'));
  // 640, como lo deja el anfitrión para que la web (grupo www-data) lo lea.
  fs.writeFileSync(path.join(dataDir, 'secret'), KEY, { mode: 0o640 });
  fs.chmodSync(path.join(dataDir, 'secret'), 0o640);
  const now = new Date().toISOString();
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [
      { id: ADMIN, name: 'Adminna', created: now, admin: true },
      { id: USER, name: 'Cliente', created: now, invitedBy: 'CODE1' },
      { id: OTHER, name: 'Otra', created: now },
    ],
    creds: [{ id: 'c-user', userId: USER, publicKey: 'x' }, { id: 'c-other', userId: OTHER, publicKey: 'z' }],
    subs: [{ endpoint: 'https://push/user', userId: USER }],
    invites: [{ code: 'CODE1', usedBy: USER, usedAt: now }],
  }), { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, `state-${USER}.json`), JSON.stringify({ unit: 'kg', workouts: [{ id: 'w1', d: '2026-11-01' }], _rev: 3 }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', SHARED_DATA: '1' },
  });
  const h = { log: '', dataDir };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  h.api = `http://127.0.0.1:${await boundPort(child, () => h.log)}`;
  // Como la web: sin cabeceras de firma, todo en el cuerpo.
  h.internal = async (action, id, extra = {}, { ts = String(Date.now()), sig } = {}) => {
    const r = await fetch(`${h.api}/api/internal/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ts, sig: sig ?? sign(action, id, ts), ...extra }),
    });
    return { status: r.status, body: await r.json() };
  };
  h.db = () => JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  h.file = name => path.join(dataDir, name);
  h.get = async p => {
    const r = await fetch(h.api + p, { headers: { Cookie: `gymsid=${mintSession(USER)}` } });
    return { status: r.status, body: await r.json() };
  };
  h.ack = async keys => {
    const r = await fetch(h.api + '/api/coach-pending/ack', {
      method: 'POST', headers: { Cookie: `gymsid=${mintSession(USER)}`, 'Content-Type': 'application/json', Origin: 'http://localhost:8080' },
      body: JSON.stringify({ keys }),
    });
    return { status: r.status, body: await r.json() };
  };
  return h;
}

test('la firma de la web (acción:id:ts) se acepta y la clave no se cierra a 0600 con SHARED_DATA', async t => {
  const h = await startServer(t);
  const ts = String(Date.now());
  const r = await h.internal('coach-pending', USER, { item: { kind: 'confirm', coach: 'Marc', decisions: [] } }, { ts });
  assert.equal(r.status, 200);
  // La app no toca el permiso de la clave ni cierra db.json: la web los lee directamente.
  assert.equal(fs.statSync(h.file('secret')).mode & 0o777, 0o640);
  // Cuando la app guarda db.json (aquí, al restaurar un perfil) lo deja en 0644 para la web.
  assert.equal((await h.internal('restore-profile', 'u_nuevo', { user: { id: 'u_nuevo', name: 'Nuevo' } })).status, 200);
  assert.equal(fs.statSync(h.file('db.json')).mode & 0o777, 0o644);
});

test('firma mala, firma de otra acción o de otro perfil, ts fuera de ventana, sin id: 403 y nada cambia', async t => {
  const h = await startServer(t);
  const item = { kind: 'confirm', decisions: [] };
  const ts = String(Date.now());
  assert.equal((await h.internal('delete-profile', USER, {}, { ts, sig: 'a'.repeat(64) })).status, 403);
  assert.equal((await h.internal('delete-profile', USER, {}, { ts, sig: 'no-hex' })).status, 403);
  // Firmada para otra acción: no vale (la acción va dentro de la firma).
  assert.equal((await h.internal('delete-profile', USER, {}, { ts, sig: sign('restore-profile', USER, ts) })).status, 403);
  // Firmada para otro perfil.
  assert.equal((await h.internal('delete-profile', USER, {}, { ts, sig: sign('delete-profile', OTHER, ts) })).status, 403);
  // Clave equivocada.
  assert.equal((await h.internal('delete-profile', USER, {}, { ts, sig: sign('delete-profile', USER, ts, 'otra') })).status, 403);
  // Fuera de la ventana de un minuto, hacia atrás y hacia delante, con la firma correcta para ese ts.
  for (const skew of [-61000, 61000, -3600000]) {
    const old = String(Date.now() + skew);
    const r = await h.internal('delete-profile', USER, {}, { ts: old });
    assert.equal(r.status, 403, `skew ${skew}`);
    assert.deepEqual(r.body, { error: 'forbidden' });
  }
  // ts no numérico y cuerpo sin id.
  assert.equal((await h.internal('delete-profile', USER, {}, { ts: 'ayer', sig: sign('delete-profile', USER, 'ayer') })).status, 403);
  assert.equal((await h.internal('coach-pending', '', { item }, {})).status, 403);
  // Dentro de la ventana, 30 s antes, sí.
  assert.equal((await h.internal('coach-pending', USER, { item }, { ts: String(Date.now() - 30000) })).status, 200);
  assert.ok(h.db().users.some(u => u.id === USER), 'el perfil sigue ahí');
  assert.ok(fs.existsSync(h.file(`state-${USER}.json`)));
});

test('delete-profile borra todo del perfil; uno que no existe da 200 missing; un admin se rechaza con 403', async t => {
  const h = await startServer(t);
  await h.internal('coach-pending', USER, { item: { kind: 'patch', plan_id: 1, changes: [] } });
  assert.ok(fs.existsSync(h.file(`pending-${USER}.json`)));

  const r = await h.internal('delete-profile', USER);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, result: 'deleted' });
  const db = h.db();
  assert.ok(!db.users.some(u => u.id === USER));
  assert.ok(!db.creds.some(c => c.userId === USER) && !db.subs.some(s => s.userId === USER));
  assert.ok(db.creds.some(c => c.userId === OTHER), 'las credenciales de otros se quedan');
  assert.equal(db.invites[0].usedBy, 'deleted');
  assert.ok(!fs.existsSync(h.file(`state-${USER}.json`)));
  assert.ok(!fs.existsSync(h.file(`pending-${USER}.json`)));

  assert.deepEqual((await h.internal('delete-profile', USER)).body, { ok: true, result: 'missing' });

  const admin = await h.internal('delete-profile', ADMIN);
  assert.equal(admin.status, 403);
  assert.equal(admin.body.error, 'admin profiles cannot be deleted here');
  assert.ok(h.db().users.some(u => u.id === ADMIN));
});

test('restore-profile devuelve el perfil con credenciales, suscripciones y estado; no pisa uno existente', async t => {
  const h = await startServer(t);
  // Lo que guarda la web (profileBackup): user, creds, subs y el estado ya leído.
  const db = h.db();
  const backup = {
    user: db.users.find(u => u.id === USER),
    creds: db.creds.filter(c => c.userId === USER),
    subs: db.subs.filter(s => s.userId === USER),
    state: JSON.parse(fs.readFileSync(h.file(`state-${USER}.json`), 'utf8')),
  };
  assert.equal((await h.internal('delete-profile', USER)).status, 200);

  const bad = await h.internal('restore-profile', USER, { ...backup, user: { ...backup.user, id: 'otro' } });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'bad profile');

  const ok = await h.internal('restore-profile', USER, backup);
  assert.deepEqual([ok.status, ok.body], [200, { ok: true }]);
  const after = h.db();
  assert.equal(after.users.find(u => u.id === USER).name, 'Cliente');
  assert.equal(after.creds.filter(c => c.userId === USER).length, 1);
  assert.equal(after.subs.filter(s => s.userId === USER).length, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(h.file(`state-${USER}.json`), 'utf8')), backup.state);

  const again = await h.internal('restore-profile', USER, backup);
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'already exists');
  // Credenciales de otro perfil dentro de la copia no se cuelan.
  await h.internal('delete-profile', USER);
  await h.internal('restore-profile', USER, { ...backup, creds: [...backup.creds, { id: 'x', userId: OTHER }] });
  assert.ok(!h.db().creds.some(c => c.id === 'x'));
  // Firma de otra acción: no restaura.
  const ts = String(Date.now());
  assert.equal((await h.internal('restore-profile', 'u_nuevo', { user: { id: 'u_nuevo', name: 'N' } }, { ts, sig: sign('delete-profile', 'u_nuevo', ts) })).status, 403);
});

test('coach-pending: la cola la ve la app con su sesión, un plan nuevo descarta lo anterior salvo las confirmaciones, y ack la vacía', async t => {
  const h = await startServer(t);
  assert.deepEqual((await h.get('/api/coach-pending')).body, { items: [] });

  const plan1 = { kind: 'plan', plan_id: 7, bundle: { plan_id: 7, routines: [] } };
  const patch = { kind: 'patch', plan_id: 7, coach: 'Marc', changes: [{ routine: 'aezio-7-1', id: 'x', sets: 4 }] };
  const confirm = { kind: 'confirm', coach: 'Marc', decisions: [{ id: 'w1', ok: true }] };
  for (const item of [plan1, patch, confirm]) assert.equal((await h.internal('coach-pending', USER, { item })).status, 200);
  assert.deepEqual((await h.get('/api/coach-pending')).body.items.map(i => i.kind), ['plan', 'patch', 'confirm']);

  const plan2 = { kind: 'plan', plan_id: 8, bundle: { plan_id: 8, routines: [] } };
  const r = await h.internal('coach-pending', USER, { item: plan2 });
  assert.deepEqual([r.status, r.body], [200, { ok: true, pending: 2 }]);
  const { items } = (await h.get('/api/coach-pending')).body;
  assert.deepEqual(items.map(i => i.kind), ['confirm', 'plan']);
  assert.ok(items.every(i => /^[0-9a-f]{16}$/.test(i.key) && i.at > 0));

  // Lo que lee la web directamente del archivo.
  const file = JSON.parse(fs.readFileSync(h.file(`pending-${USER}.json`), 'utf8'));
  assert.equal(file.length, 2);

  assert.deepEqual((await h.ack([items[0].key, 'no-existe'])).body, { ok: true, pending: 1 });
  assert.deepEqual((await h.get('/api/coach-pending')).body.items.map(i => i.kind), ['plan']);
  assert.deepEqual((await h.ack([items[1].key])).body, { ok: true, pending: 0 });
  assert.ok(!fs.existsSync(h.file(`pending-${USER}.json`)));
});

test('coach-pending: perfil que no existe 404, elemento malo 400, tope de 20, y sin sesión la app recibe 401', async t => {
  const h = await startServer(t);
  const item = { kind: 'confirm', decisions: [] };
  assert.equal((await h.internal('coach-pending', 'u_fantasma', { item })).status, 404);
  for (const bad of [null, 'plan', { kind: 'otra' }, { nokind: 1 }]) {
    assert.equal((await h.internal('coach-pending', USER, { item: bad })).status, 400, JSON.stringify(bad));
  }
  for (let i = 0; i < 25; i++) await h.internal('coach-pending', USER, { item: { ...item, n: i } });
  const { items } = (await h.get('/api/coach-pending')).body;
  assert.equal(items.length, 20);
  assert.equal(items[19].n, 24);
  assert.equal((await fetch(h.api + '/api/coach-pending')).status, 401);
  assert.equal((await fetch(h.api + '/api/coach-pending/ack', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
});
