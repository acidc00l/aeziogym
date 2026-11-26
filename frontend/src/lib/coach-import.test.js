import { describe, it, expect } from 'vitest'
import { parseCoachPlan, coachPlanChanges, applyCoachPlan, coachNextRoutine, applyCoachPatch, applyCoachPending, applyCoachConfirm } from './coach-import.js'
import { EXDB } from './exercises.js'
import { mergeStates, stampChange } from './sync-merge.js'

const lift = EXDB.find(e => e.bp !== 'cardio').id
const lift2 = EXDB.filter(e => e.bp !== 'cardio')[1].id
const cardio = EXDB.find(e => e.bp === 'cardio').id
const raw = (routines, extra = {}) => ({ opengym_plan: 1, plan_id: 36, name: 'Plan', week: {}, customEx: [], routines, skipped: [], ...extra })
const day = (n, ex) => ({ id: `aezio-36-${n}`, name: `Día ${n + 1}`, ex })
const state = () => ({ routines: [{ id: 'mine', name: 'Mía', ex: [{ id: lift, sets: 1, reps: 1 }] }], week: { 1: 'mine' }, dayPlan: {}, workouts: [{ id: 'w1' }] })

describe('parseCoachPlan', () => {
  it('uses the minimum reps and keeps the plan range for the preview', () => {
    const p = parseCoachPlan(raw([day(0, [{ id: lift, sets: 4, reps: 8, plan: '8-10' }])]))
    expect(p.routines[0].ex[0]).toEqual({ id: lift, sets: 4, reps: 8 })
    expect(p.routines[0].ranges[0]).toBe('8-10')
  })
  it('keeps timed work timed and turns cardio into minutes', () => {
    const p = parseCoachPlan(raw([day(0, [{ id: lift, sets: 3, mode: 'time', sec: 45, plan: '45-60s' }, { id: cardio, sets: 1, mode: 'time', sec: 1200 }])]))
    expect(p.routines[0].ex[0]).toEqual({ id: lift, sets: 3, mode: 'time', sec: 45 })
    expect(p.routines[0].ex[1]).toEqual({ id: cardio, sets: 1, min: 20 })
  })
  it('carries the coach weight when there is one, and never on cardio', () => {
    const p = parseCoachPlan(raw([day(0, [{ id: lift, sets: 3, reps: 8, weight: 62.5 }, { id: lift2, sets: 3, reps: 8 }, { id: cardio, sets: 1, mode: 'time', sec: 600, weight: 5 }])]))
    expect(p.routines[0].ex[0]).toEqual({ id: lift, sets: 3, reps: 8, weight: 62.5 })
    expect(p.routines[0].ex[1]).toEqual({ id: lift2, sets: 3, reps: 8 })
    expect(p.routines[0].ex[2]).toEqual({ id: cardio, sets: 1, min: 10 })
  })
  it('drops unknown exercises and reports them', () => {
    const p = parseCoachPlan(raw([day(0, [{ id: 'nope', sets: 3, reps: 8 }, { id: lift, sets: 3, reps: 8 }])], { skipped: ['Libre'] }))
    expect(p.dropped).toBe(1)
    expect(p.exerciseCount).toBe(1)
    expect(p.skipped).toEqual(['Libre'])
  })
  it('rejects routines that do not belong to the plan and invalid plans', () => {
    const p = parseCoachPlan(raw([{ id: 'aezio-99-0', name: 'x', ex: [{ id: lift, sets: 3, reps: 8 }] }, { id: 'mine', name: 'y', ex: [{ id: lift, sets: 3, reps: 8 }] }]))
    expect(p.routines).toEqual([])
    expect(() => parseCoachPlan({ opengym_plan: 1, routines: [] })).toThrow()
  })
})

describe('applyCoachPlan', () => {
  const plan = parseCoachPlan(raw([day(0, [{ id: lift, sets: 3, reps: 8 }]), day(1, [{ id: lift2, sets: 3, reps: 8 }])]))

  it('adds routines without touching anything else', () => {
    const s = state()
    applyCoachPlan(s, plan)
    expect(s.routines.map(r => r.id)).toEqual(['mine', 'aezio-36-0', 'aezio-36-1'])
    expect(s.routines[0]).toEqual(state().routines[0])
    expect(s.week).toEqual({ 1: 'mine' })
    expect(s.workouts).toEqual([{ id: 'w1' }])
  })
  it('sending again updates instead of duplicating, and a clean routine is not flagged', () => {
    const s = state()
    applyCoachPlan(s, plan)
    expect(coachPlanChanges(s, plan).routines.every(r => !r.isNew && !r.changed)).toBe(true)
    applyCoachPlan(s, plan)
    expect(s.routines).toHaveLength(3)
  })
  it('flags a routine the client changed, and replaces it on confirm', () => {
    const s = state()
    applyCoachPlan(s, plan)
    s.routines[1].ex[0].reps = 20
    expect(coachPlanChanges(s, plan).routines[0].changed).toBe(true)
    applyCoachPlan(s, plan)
    expect(s.routines[1].ex[0].reps).toBe(8)
  })
  it('removes a day the plan no longer has, with its schedule, and the routines of earlier plans', () => {
    const s = state()
    applyCoachPlan(s, plan)
    s.week[2] = 'aezio-36-1'
    s.routines.push({ id: 'aezio-7-0', name: 'Otro', ex: [], src: { plan: 7, sig: '[]' } })
    const shorter = parseCoachPlan(raw([day(0, [{ id: lift, sets: 3, reps: 8 }])]))
    expect(coachPlanChanges(s, shorter).removed).toEqual(['Día 2', 'Otro'])
    applyCoachPlan(s, shorter)
    expect(s.routines.map(r => r.id)).toEqual(['mine', 'aezio-36-0'])
    expect(s.week).toEqual({ 1: 'mine' })
  })
})

describe('coachNextRoutine', () => {
  const plan = n => ({ id: `aezio-36-${n}`, name: `Día ${n + 1}`, ex: [], src: { plan: 36 } })
  const S = workouts => ({ routines: [{ id: 'mine', name: 'Mía', ex: [] }, plan(1), plan(0), plan(2)], workouts })
  const w = (routineId, end) => ({ routineId, end })
  it('starts with the days never done, in plan order', () => {
    expect(coachNextRoutine(S([]), w('aezio-36-0', 10)).id).toBe('aezio-36-1')
  })
  it('picks the day done longest ago, even when the order was changed', () => {
    const done = [w('aezio-36-0', 10), w('aezio-36-1', 20), w('mine', 25)]
    expect(coachNextRoutine(S(done), w('aezio-36-2', 30)).id).toBe('aezio-36-0')
    expect(coachNextRoutine(S([w('aezio-36-1', 20), w('aezio-36-2', 30)]), w('aezio-36-2', 40)).id).toBe('aezio-36-0')
  })
  it('says nothing for a freestyle workout or a routine of your own', () => {
    expect(coachNextRoutine(S([]), w('mine', 10))).toBe(null)
    expect(coachNextRoutine(S([]), w(null, 10))).toBe(null)
  })
})

describe('coach changes sent straight to the app', () => {
  const bundle = (planId, days) => ({ opengym_plan: 1, plan_id: planId, name: 'Plan', week: {}, customEx: [], skipped: [],
    routines: days.map(n => ({ id: `aezio-${planId}-${n}`, name: `Día ${n + 1}`, ex: [{ id: lift, sets: 3, reps: 8, weight: 40 }, { id: lift2, sets: 3, reps: 12 }] })) })
  const withPlan = planId => { const S = state(); applyCoachPlan(S, parseCoachPlan(bundle(planId, [0, 1]))); return S }

  it('a new plan replaces the routines of earlier Aezio plans and frees their days, keeping your own', () => {
    const S = withPlan(36)
    S.week[2] = 'aezio-36-0'
    const result = applyCoachPending(S, [{ kind: 'plan', bundle: bundle(82, [0, 1, 2]) }])
    expect(result).toEqual({ plans: 1, exercises: 0, confirmed: 0, rejected: 0 })
    expect(S.routines.map(r => r.id)).toEqual(['mine', 'aezio-82-0', 'aezio-82-1', 'aezio-82-2'])
    expect(S.week).toEqual({ 1: 'mine' })
    expect(S.workouts).toEqual([{ id: 'w1' }])
  })
  it('a tweak changes only that exercise and leaves the rest of the routine alone', () => {
    const S = withPlan(82)
    S.week[2] = 'aezio-82-0'
    const n = applyCoachPatch(S, { kind: 'patch', changes: [{ routine: 'aezio-82-0', id: lift, sets: 4, reps: 6, weight: 60 }, { routine: 'aezio-82-9', id: lift, sets: 1, reps: 1 }] })
    expect(n).toBe(1)
    const r = S.routines.find(x => x.id === 'aezio-82-0')
    expect(r.ex).toEqual([{ id: lift, sets: 4, reps: 6, weight: 60 }, { id: lift2, sets: 3, reps: 12 }])
    expect(S.week[2]).toBe('aezio-82-0')
    expect(coachPlanChanges(S, parseCoachPlan(bundle(82, [0, 1]))).routines[0].changed).toBe(false)
  })
  it('keeps what the client added and still counts the routine as edited by them', () => {
    const S = withPlan(82)
    const r = S.routines.find(x => x.id === 'aezio-82-0')
    r.ex.push({ id: cardio, sets: 1, min: 10 })
    applyCoachPatch(S, { changes: [{ routine: 'aezio-82-0', id: lift2, sets: 3, mode: 'time', sec: 45, weight: 20 }] })
    expect(r.ex[1]).toEqual({ id: lift2, sets: 3, mode: 'time', sec: 45, weight: 20 })
    expect(r.ex[2]).toEqual({ id: cardio, sets: 1, min: 10 })
    expect(coachPlanChanges(S, parseCoachPlan(bundle(82, [0, 1]))).routines[0].changed).toBe(true)
  })
  it('skips an unreadable item without blocking the rest', () => {
    const S = withPlan(82)
    const result = applyCoachPending(S, [{ kind: 'plan', bundle: { nope: 1 } }, { kind: 'patch', changes: [{ routine: 'aezio-82-1', id: lift, sets: 5, reps: 5 }] }])
    expect(result).toEqual({ plans: 0, exercises: 1, confirmed: 0, rejected: 0 })
  })
})

describe('applyCoachConfirm (entrenos anotados después)', () => {
  const base = () => ({
    exWeights: { a: { w: 100, d: '2026-11-13' } },
    workouts: [{ id: 'w1', d: '2026-11-19', start: 1, end: 2, entries: [] }],
    pendingWorkouts: [
      { id: 'p1', d: '2026-11-20', start: 5, end: 6, pending: true, entries: [{ id: 'a', sets: [{ w: 110, r: 5, done: true }], topW: null }] },
      { id: 'p2', d: '2026-11-18', start: 3, end: 4, pending: true, entries: [] },
    ],
  })
  it('confirmado pasa al historial, en orden, y sube el peso máximo', () => {
    const s = base()
    const out = applyCoachConfirm(s, { kind: 'confirm', coach: 'Marc', decisions: [{ id: 'p1', ok: true }] })
    expect(out).toEqual({ confirmed: 1, rejected: 0 })
    expect(s.pendingWorkouts.map(w => w.id)).toEqual(['p2'])
    expect(s.workouts.map(w => w.id)).toEqual(['w1', 'p1'])
    expect(s.workouts[1].pending).toBeUndefined()
    expect(s.workouts[1].confirmed.by).toBe('Marc')
    expect(s.exWeights.a).toEqual({ w: 110, d: '2026-11-20' })
  })
  it('rechazado desaparece sin tocar el historial', () => {
    const s = base()
    expect(applyCoachConfirm(s, { decisions: [{ id: 'p2', ok: false }] })).toEqual({ confirmed: 0, rejected: 1 })
    expect(s.pendingWorkouts.map(w => w.id)).toEqual(['p1'])
    expect(s.workouts.map(w => w.id)).toEqual(['w1'])
  })
  it('ignora decisiones de entrenos que ya no están pendientes', () => {
    const s = base()
    expect(applyCoachConfirm(s, { decisions: [{ id: 'nope', ok: true }] })).toEqual({ confirmed: 0, rejected: 0 })
    expect(applyCoachPending(s, [{ kind: 'confirm', decisions: [{ id: 'p2', ok: true }] }]).confirmed).toBe(1)
  })
})

describe('AezioGym 1.4.5: unidad, catálogo y sincronización', () => {
  it('los pesos del plan van en kg: con la app en lb se convierten', () => {
    const kg = parseCoachPlan(raw([day(0, [{ id: lift, sets: 3, reps: 8, weight: 100 }])]), 'kg')
    const lb = parseCoachPlan(raw([day(0, [{ id: lift, sets: 3, reps: 8, weight: 100 }])]), 'lb')
    expect(kg.routines[0].ex[0].weight).toBe(100)
    expect(lb.routines[0].ex[0].weight).toBeGreaterThan(220)
    expect(lb.routines[0].ex[0].weight).toBeLessThan(221)
  })
  it('los ejercicios que Aezio publica existen en el catálogo de la app', async () => {
    const names = (await import('../aezio/names-es.json')).default
    const ids = Object.keys(names).slice(0, 200)
    const p = parseCoachPlan(raw([day(0, ids.map(id => ({ id, sets: 3, reps: 8 })))]))
    expect(p.dropped).toBe(0)
    expect(p.routines[0].ex.map(e => e.id)).toEqual(ids)
  })
  it('las rutinas importadas son rutinas normales: se estampan y sincronizan con otro dispositivo', () => {
    const prev = { ...state(), _ts: 1, edited: {}, deleted: {} }
    const next = JSON.parse(JSON.stringify(prev))
    applyCoachPlan(next, parseCoachPlan(raw([day(0, [{ id: lift, sets: 3, reps: 8 }]), day(1, [{ id: lift2, sets: 3, reps: 8 }])])))
    next._ts = stampChange(prev, next, 1000)
    const imported = next.routines.filter(r => r.id.startsWith('aezio-36-'))
    expect(imported).toHaveLength(2)
    expect(imported.every(r => r._ts >= 1000 && r.src.plan === 36)).toBe(true)
    // El otro dispositivo solo tenía la rutina propia: al sincronizar, las dos rutinas llegan con su `src`.
    const merged = mergeStates({ ...prev, _ts: 5 }, next)
    expect(merged.routines.map(r => r.id).sort()).toEqual(['aezio-36-0', 'aezio-36-1', 'mine'])
    expect(merged.routines.find(r => r.id === 'aezio-36-1').src.plan).toBe(36)
  })
  it('confirmar un entreno lo deja con marca de cambio para que sincronice, en su sitio por fecha', () => {
    const s = { exWeights: {}, workouts: [{ id: 'a', d: '2026-11-01', start: 1, entries: [] }, { id: 'c', d: '2026-11-30', start: 1, entries: [] }],
      pendingWorkouts: [{ id: 'b', d: '2026-11-15', start: 9, pending: true, entries: [] }] }
    applyCoachConfirm(s, { coach: 'Marc', decisions: [{ id: 'b', ok: true }] })
    expect(s.workouts.map(w => w.id)).toEqual(['a', 'b', 'c'])
    expect(s.workouts[1]._ts).toBeGreaterThan(0)
  })
  it('un peso que no supera el máximo guardado no lo baja', () => {
    const s = { exWeights: { [lift]: { w: 100, d: '2026-10-01' } }, workouts: [],
      pendingWorkouts: [{ id: 'p', d: '2026-11-20', start: 1, entries: [{ id: lift, sets: [{ w: 80, r: 5, done: true }] }] }] }
    applyCoachConfirm(s, { decisions: [{ id: 'p', ok: true }] })
    expect(s.exWeights[lift]).toEqual({ w: 100, d: '2026-10-01' })
  })
})
