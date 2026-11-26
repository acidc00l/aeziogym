// Caducidad de medios (api/media-expiry.js): el servidor quita las referencias viejas por el
// camino sellado y un dispositivo que aún las lista no las resucita al fundir tras el 409.
// Se usa el mismo expireMedia y stampPut que la API.
import { describe, expect, it } from 'vitest'
import { mergeStates, mergeWorkoutMedia, stampChange } from './sync-merge.js'
import { expireMedia } from '../../../api/media-expiry.js'
import { stampPut } from '../../../api/sync-stamps.js'

const DAY = 86400000
const clone = o => JSON.parse(JSON.stringify(o))
const H = c => c.repeat(64)
const ref = (c, at) => ({ kind: 'video', hash: H(c), mime: 'video/mp4', size: 5, width: 4, height: 4, at })
const NOW = 1_800_000_000_000

const base = () => ({
  _ts: 1000, _rev: 3, unit: 'kg',
  workouts: [
    { id: 'w1', d: '2026-10-01', start: 1, end: 2, _ts: 900, media: [ref('a', NOW - 20 * DAY), ref('b', NOW - 2 * DAY)],
      entries: [{ id: 'e1', sets: [{ w: 50, r: 5, media: [ref('c', NOW - 20 * DAY)] }] }] },
    { id: 'w2', d: '2026-11-20', start: 1, end: 2, _ts: 900, entries: [{ id: 'e1', sets: [{ w: 50, r: 5, media: [ref('d', NOW - 1 * DAY)] }] }] },
  ],
})

// Lo que hace writeStateAs en server.js: copia, fn, stampPut sellado, revisión +1.
function serverExpire(cur, days = 15) {
  const next = clone(cur)
  const t = Math.max(NOW, 1001)
  const r = expireMedia(next, { now: NOW, days, t })
  stampPut(cur, next, { stamped: true, now: t })
  next._rev = (cur._rev || 0) + 1
  next._ts = t
  return { next, r }
}

describe('caducidad de medios y sincronización', () => {
  it('quita solo lo viejo y sella el entreno', () => {
    const { next, r } = serverExpire(base())
    expect(r).toEqual({ removed: 2, workouts: 1 })
    expect(next.workouts[0].media.map(m => m.hash)).toEqual([H('b')])
    expect(next.workouts[0].entries[0].sets[0].media).toBeUndefined()
    expect(next.workouts[0].mediaGone).toEqual([H('a')])
    expect(next.workouts[0]._ts).toBeGreaterThan(900)
    expect(next.workouts[0]._f.media).toBe(next.workouts[0]._ts)
    expect(next.workouts[1]).toEqual(base().workouts[1])        // el otro entreno no se toca
  })

  it('sin nada caducado no cambia nada', () => {
    const cur = base()
    cur.workouts[0].media = [ref('b', NOW - 2 * DAY)]
    delete cur.workouts[0].entries[0].sets[0].media
    const next = clone(cur)
    expect(expireMedia(next, { now: NOW, days: 15, t: 5000 })).toEqual({ removed: 0, workouts: 0 })
    expect(next).toEqual(cur)
    expect(expireMedia(clone(base()), { now: NOW, days: 0, t: 5000 }).removed).toBe(0)   // 0 = apagada
  })

  for (const order of ['el servidor primero', 'el móvil primero']) {
    it(`un dispositivo con el estado antiguo no resucita nada tras el 409 (${order})`, () => {
      const stale = base()                                   // el móvil no se ha enterado
      const { next: server } = serverExpire(base())
      // El móvil apunta algo (otro campo) con su estado antiguo y choca con el 409.
      const phone = clone(stale)
      phone.workouts[1].note = 'hoy bien'
      phone.workouts[1]._ts = NOW + 10
      phone._ts = stampChange(stale, phone, NOW + 10)
      const merged = order === 'el servidor primero' ? mergeStates(server, phone) : mergeStates(phone, server)
      const w1 = merged.workouts.find(w => w.id === 'w1')
      expect(w1.media.map(m => m.hash)).toEqual([H('b')])
      expect(w1.entries[0].sets[0].media).toBeUndefined()
      expect(merged.workouts.find(w => w.id === 'w2').note).toBe('hoy bien')   // lo suyo se conserva
      // Y si el móvil editó ese mismo entreno (más tarde), la foto caducada tampoco vuelve.
      const phone2 = clone(stale)
      phone2.workouts[0].note = 'nota'
      phone2.workouts[0]._ts = NOW + 20
      phone2._ts = stampChange(stale, phone2, NOW + 20)
      const m2 = (order === 'el servidor primero' ? mergeStates(server, phone2) : mergeStates(phone2, server)).workouts[0]
      expect(m2.media.map(m => m.hash)).toEqual([H('b')])
      expect(m2.note).toBe('nota')
    })
  }

  it('mergeWorkoutMedia respeta mediaGone de cualquiera de las dos copias', () => {
    const a = { media: [ref('a', 1), ref('b', 1)] }
    const b = { media: [ref('c', 1)], mediaGone: [H('a')] }
    expect(mergeWorkoutMedia(a, b).media.map(m => m.hash)).toEqual([H('b'), H('c')])
    expect(a.mediaGone).toEqual([H('a')])
  })
})
