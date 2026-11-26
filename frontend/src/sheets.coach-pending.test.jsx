// @vitest-environment happy-dom
// AezioGym: un entreno anotado después de una rutina del plan de Aezio no cuenta hasta que lo confirme
// el entrenador (docs/AEZIOGYM.md, «Contrato Aezio ↔ AezioGym»). Espera en `pendingWorkouts`, que la web lee.
// Sin rutinas de Aezio, o al editar uno ya guardado, se guarda como siempre.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { finishWorkoutNow, dayOverrideSheet } from './sheets.jsx'
import { applyCoachConfirm } from './lib/coach-import.js'

const clone = v => JSON.parse(JSON.stringify(v))
const S = () => useStore.getState().S
const mounted = []
const entry = { id: '0025', rid: 'r1', target: { sets: 1, reps: 5, weight: 60 }, sets: [{ w: 60, r: 5, done: true }] }

function install(routineId, backfill = { durationMin: 60, replaceId: null }) {
  const st = clone(DEF)
  st.routines = [{ id: routineId, name: 'Día 1', ex: [{ id: '0025', sets: 1, reps: 5, weight: 60 }] }]
  st.workouts = []
  st.active = { id: 'fin', d: '2026-09-28', start: new Date(2026, 8, 28, 18, 0).getTime(), routineIds: [routineId], routineId, name: 'Día 1', bw: null, cur: 0, entries: [clone(entry)], backfill }
  useStore.setState({ S: st, user: null })
}
const mountTopSheet = () => {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  useUI.setState({ sheets: [], timer: null, work: null, toasts: [] })
})
afterEach(() => {
  mounted.splice(0).forEach(r => act(() => r.unmount()))
  document.body.innerHTML = ''
})

describe('entreno anotado después con un entrenador de Aezio', () => {
  it('queda pendiente, no entra en el historial ni sube el peso máximo', () => {
    install('aezio-7-0')
    act(() => { finishWorkoutNow() })
    expect(S().workouts).toEqual([])
    expect(S().exWeights['0025']).toBeUndefined()
    expect(S().active).toBeNull()
    expect(S().pendingWorkouts).toHaveLength(1)
    expect(S().pendingWorkouts[0]).toMatchObject({ id: 'fin', d: '2026-09-28', pending: true })
    expect(S().pendingWorkouts[0].end - S().pendingWorkouts[0].start).toBe(60 * 60000)
  })

  it('al confirmarlo el entrenador pasa al historial como cualquier otro', () => {
    install('aezio-7-0')
    act(() => { finishWorkoutNow() })
    act(() => { useStore.getState().update(s => { applyCoachConfirm(s, { coach: 'Marc', decisions: [{ id: 'fin', ok: true }] }) }) })
    expect(S().pendingWorkouts).toEqual([])
    expect(S().workouts.map(w => w.id)).toEqual(['fin'])
    expect(S().exWeights['0025']).toEqual({ w: 60, d: '2026-09-28' })
  })

  it('sin rutinas de Aezio se guarda directamente', () => {
    install('r1')
    act(() => { finishWorkoutNow() })
    expect(S().pendingWorkouts || []).toEqual([])
    expect(S().workouts.map(w => w.id)).toEqual(['fin'])
  })

  it('editar un entreno ya guardado (replaceId) no espera a nadie', () => {
    install('aezio-7-0', { durationMin: 60, replaceId: 'old' })
    useStore.setState(s => ({ S: { ...s.S, workouts: [{ id: 'old', d: '2026-09-28', start: 1, end: 2, name: 'Día 1', entries: [], prs: [] }] } }))
    act(() => { finishWorkoutNow() })
    expect(S().pendingWorkouts || []).toEqual([])
    expect(S().workouts.map(w => w.id)).toEqual(['fin'])
  })

  it('el día muestra el aviso de espera y no ofrece anotarlo otra vez', () => {
    const st = clone(DEF)
    st.routines = [{ id: 'aezio-7-0', name: 'Día 1', ex: [] }]
    st.week = { [new Date('2026-09-28T12:00:00').getDay()]: ['aezio-7-0'] }
    st.pendingWorkouts = [{ id: 'p', d: '2026-09-28', start: 1, end: 2, name: 'Día 1', pending: true, entries: [] }]
    useStore.setState({ S: st, user: null })
    dayOverrideSheet('2026-09-28')
    const host = mountTopSheet()
    expect(host.textContent).toContain('Día 1 logged afterwards: waiting for your coach to confirm it.')
    expect([...host.querySelectorAll('button')].some(b => b.textContent.trim() === 'Log this workout')).toBe(false)
  })
})
