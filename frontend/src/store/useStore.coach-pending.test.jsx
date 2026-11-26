// @vitest-environment happy-dom

/* AezioGym: la cola del entrenador (docs/AEZIOGYM.md, «Contrato Aezio ↔ AezioGym»). La app la lee con
   GET /api/coach-pending, aplica lo recibido como cualquier otro cambio (las rutinas y los entrenos
   sincronizan como siempre), lo sube al servidor y SOLO entonces envía el ack. Si no pudo subirlo,
   no hay ack, y al reintentar no vuelve a aplicar el plan sobre lo que el cliente haya editado. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn(), setRemoteAuth: vi.fn() }))
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast }) } }))

import { api } from '../lib/api.js'
import { DEF, useStore } from './useStore.js'
import { setAezioBuild } from '../lib/build-caps.js'
import { EXDB } from '../lib/exercises.js'

const clone = v => JSON.parse(JSON.stringify(v))
const lift = EXDB.find(e => e.bp !== 'cardio').id
const USER = { id: 'user-1', name: 'One' }
const fresh = { offline: false, pending: false, auth: false, lastError: null, lastSynced: 0, server: null }
const bundle = (planId, reps = 8) => ({
  opengym_plan: 1, plan_id: planId, name: 'Plan', week: {}, customEx: [], skipped: [],
  routines: [{ id: `aezio-${planId}-0`, name: 'Día 1', ex: [{ id: lift, sets: 3, reps, weight: 40 }] }],
})
const queue = items => ({ items })
const calls = () => api.mock.calls.map(([path, o]) => `${o?.method || 'GET'} ${path}`)
const netError = () => new TypeError('Failed to fetch')

// Un servidor que responde a lo que la app le pide.
function server({ items, putFails = false } = {}) {
  api.mockImplementation(async (path, o = {}) => {
    if (path === '/api/coach-pending') return queue(items)
    if (path === '/api/coach-pending/ack') return { ok: true, pending: 0 }
    if (path === '/api/data' && o.method === 'PUT') { if (putFails) throw netError(); return { ok: true, rev: 2 } }
    if (path === '/api/data/rev') return { rev: 1 }
    if (path === '/api/data') return { state: null, rev: 1 }
    return {}
  })
}
const signedIn = S => {
  localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: S._ts || 0 }))
  useStore.setState({ S, user: USER, ready: true, sync: { ...fresh } })
}
const base = () => ({ ...clone(DEF), _ts: 100, routines: [{ id: 'mine', name: 'Mía', _ts: 100, ex: [{ id: lift, sets: 1, reps: 1 }] }] })

// La consulta se espacia (CHECK_MIN_MS): cada prueba arranca un minuto después de la anterior.
let clock = Date.now()
beforeEach(() => {
  clock += 60_000
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(clock)
  localStorage.clear()
  localStorage.setItem('gym_owner', USER.id)
  api.mockReset(); toast.mockReset()
  setAezioBuild(true)
  useStore.setState({ S: clone(DEF), user: null, ready: false, sync: { ...fresh } })
})
afterEach(() => {
  vi.useRealTimers()
  setAezioBuild(false)
  localStorage.clear()
  useStore.setState({ S: clone(DEF), user: null, ready: false, sync: { ...fresh } })
})

describe('pullCoachPending', () => {
  it('aplica el plan como rutinas normales, lo sube y solo entonces envía el ack', async () => {
    server({ items: [{ key: 'k1', kind: 'plan', plan_id: 7, bundle: bundle(7) }] })
    signedIn(base())

    await useStore.getState().pullCoachPending()

    const S = useStore.getState().S
    expect(S.routines.map(r => r.id)).toEqual(['mine', 'aezio-7-0'])
    // rutina normal: con marca de edición para sincronizar, y con el origen del plan
    expect(S.routines[1]._ts).toBeGreaterThan(100)
    expect(S.routines[1].src.plan).toBe(7)
    expect(S.routines[1].ex[0]).toMatchObject({ id: lift, sets: 3, reps: 8, weight: 40 })
    const seq = calls()
    const put = seq.indexOf('PUT /api/data')
    const ack = seq.indexOf('POST /api/coach-pending/ack')
    expect(put).toBeGreaterThan(-1)
    expect(ack).toBeGreaterThan(put)
    expect(JSON.parse(api.mock.calls[ack][1].body)).toEqual({ keys: ['k1'] })
    // lo que subió ya lleva la rutina
    const sent = JSON.parse(api.mock.calls[put][1].body).state
    expect(sent.routines.map(r => r.id)).toContain('aezio-7-0')
    expect(toast).toHaveBeenCalledWith('Your new plan is in the app. Pick a day for each routine.')
  })

  it('sin conexión para subirlo no hay ack, y al reintentar no pisa lo que el cliente editó entre medias', async () => {
    server({ items: [{ key: 'k1', kind: 'plan', plan_id: 7, bundle: bundle(7) }], putFails: true })
    signedIn(base())
    await useStore.getState().pullCoachPending()
    expect(calls()).not.toContain('POST /api/coach-pending/ack')
    expect(useStore.getState().S.routines.map(r => r.id)).toContain('aezio-7-0')

    // El cliente cambia las repeticiones de la rutina importada.
    useStore.getState().update(s => { s.routines.find(r => r.id === 'aezio-7-0').ex[0].reps = 12 })
    server({ items: [{ key: 'k1', kind: 'plan', plan_id: 7, bundle: bundle(7) }] })
    api.mockClear()
    // Pasa el tiempo mínimo entre consultas y vuelve la conexión.
    vi.setSystemTime(clock += 60_000)
    await useStore.getState().pullCoachPending()

    expect(useStore.getState().S.routines.find(r => r.id === 'aezio-7-0').ex[0].reps).toBe(12)
    expect(calls()).toContain('POST /api/coach-pending/ack')
  })

  it('una cola vacía no cambia nada ni hace más peticiones', async () => {
    server({ items: [] })
    const S0 = base()
    signedIn(S0)
    await useStore.getState().pullCoachPending()
    expect(calls()).toEqual(['GET /api/coach-pending'])
    expect(useStore.getState().S.routines).toHaveLength(1)
  })

  it('confirmación del entrenador: el entreno anotado pasa del pendiente al historial', async () => {
    server({ items: [{ key: 'k2', kind: 'confirm', coach: 'Marc', decisions: [{ id: 'p1', ok: true }] }] })
    const S = { ...base(), pendingWorkouts: [{ id: 'p1', d: '2026-11-20', start: 5, end: 6, pending: true, entries: [] }] }
    signedIn(S)
    await useStore.getState().pullCoachPending()
    const after = useStore.getState().S
    expect(after.pendingWorkouts).toEqual([])
    expect(after.workouts.map(w => w.id)).toEqual(['p1'])
    expect(after.workouts[0].confirmed.by).toBe('Marc')
    expect(toast).toHaveBeenCalledWith('Your coach confirmed the workout you logged afterwards.')
  })

  it('fuera de AezioGym, sin sesión y como invitado no pregunta nada', async () => {
    server({ items: [{ key: 'k1', kind: 'plan', plan_id: 7, bundle: bundle(7) }] })
    signedIn(base())
    setAezioBuild(false)
    await useStore.getState().pullCoachPending()
    setAezioBuild(true)
    useStore.setState({ user: null })
    await useStore.getState().pullCoachPending()
    expect(api).not.toHaveBeenCalled()
  })
})
