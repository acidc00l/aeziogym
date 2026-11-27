// «¿Cómo estás hoy?» en Inicio, arriba del todo: cuatro preguntas rápidas (el cuestionario de la web de Aezio,
// lib/wellness.js) para saber cómo entrenar hoy. Solo con un plan de Aezio en la app. Hasta saber el estado en
// la web no se pinta nada; sin red, sin sesión o con error, tampoco. «Ahora no» la oculta hasta mañana.
import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { todayISO } from '../lib/format.js'
import { Button } from './ui.jsx'
import Icon from './Icon.jsx'
import { loadToday, sendLog, shouldAsk, snoozeToday, allAnswered, questions, readLast, saveLast, STATUS_COLOR } from '../lib/wellness.js'

// Lo último que dijo la web hoy, para que al volver a Inicio (o al abrir la app otra vez el mismo día) la tarjeta
// no aparezca de golpe y mueva todo: se pinta ya con eso y se vuelve a preguntar en segundo plano.
let cache = null
export const resetWellnessCache = () => { cache = null }
const lastKnown = today => (cache?.day === today ? cache.state : readLast(storage(), today))

const storage = () => { try { return globalThis.localStorage } catch { return null } }
// Del 1 (muy mal) al 7 (muy bien): tono del texto de ayuda según el valor.
const tone = n => (n <= 2 ? 'var(--red-ink)' : n <= 4 ? 'var(--orange-ink)' : 'var(--green-ink)')

function Question({ q, index, value, onChange }) {
  const id = 'wl-q-' + q.key
  return <fieldset className="wl-q">
    <legend className="wl-t" id={id}><Icon name={q.icon} /><span>{index + 1}. {q.title}</span></legend>
    <div className="wl-scale">
      {[1, 2, 3, 4, 5, 6, 7].map(n => <label key={n} className={'wl-pip wl-v' + n}>
        <input type="radio" name={'wl-' + q.key} value={n} checked={value === n}
          aria-label={`${n}/7 - ${q.labels[n - 1]}`} onChange={() => onChange(n)} />
        <span aria-hidden="true">{n}</span>
      </label>)}
    </div>
    <div className="wl-bar" aria-hidden="true" />
    <div className="wl-help small" aria-live="polite" style={value ? { color: tone(value) } : undefined}>
      {value ? `${value}/7 - ${q.labels[value - 1]}` : ' '}
    </div>
  </fieldset>
}

// El cuestionario, en una hoja. Si falla, lo marcado se queda para reintentar.
export function WellnessForm({ onSaved, onCancel, send = sendLog }) {
  const [picks, setPicks] = useState({ sleep: null, stress: null, fatigue: null, soreness: null })
  const [busy, setBusy] = useState(false)
  const ready = allAnswered(picks)
  const submit = async e => {
    e.preventDefault()
    if (!ready || busy) return
    setBusy(true)
    const r = await send(picks)
    setBusy(false)
    if (r.kind === 'ok') { useUI.getState().toast(t('Answer saved')); onSaved(r.result) }
    else useUI.getState().toast(r.kind === 'limit' ? t('You have already answered several times today.') : t('Could not save. Your answers are still here.'))
  }
  return <form className="wl" onSubmit={submit}>
    <h3>{t('How are you feeling today?')}</h3>
    <div className="wl-scale-ends small" aria-hidden="true">
      <span style={{ color: 'var(--red-ink)' }}>{t('1 = Very bad / Critical')}</span>
      <span style={{ color: 'var(--green-ink)' }}>{t('7 = Excellent / Optimal')}</span>
    </div>
    {questions().map((q, i) => <Question key={q.key} q={q} index={i} value={picks[q.key]} onChange={n => setPicks(p => ({ ...p, [q.key]: n }))} />)}
    <Button variant="primary" type="submit" icon="check" disabled={!ready || busy}>{t('Save and see how to train today')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" type="button" onClick={onCancel}>{t('Cancel')}</Button>
  </form>
}

export default function WellnessCard() {
  const S = useStore(s => s.S)
  const today = todayISO()
  const ok = shouldAsk({ S, storage: storage(), today, online: typeof navigator === 'undefined' ? true : navigator.onLine })
  const [state, setState] = useState(() => (ok ? lastKnown(today) : null))
  const [snoozed, setSnoozed] = useState(false)

  useEffect(() => {
    if (!ok) return
    let live = true
    loadToday().then(s => { cache = { day: today, state: s }; saveLast(storage(), today, s); if (live) setState(s) })
    return () => { live = false }
  }, [ok, today])

  if (!ok || snoozed || !state || state.kind === 'hidden') return null

  if (state.kind === 'done') {
    const { status, label, message } = state.result
    return <div className="card wl-line" role="status">
      <div className="wl-line-t" style={{ color: STATUS_COLOR[status] }}><Icon name="heart" /><span>{t('Today: {0}', label)}</span></div>
      <div className="small muted">{message}</div>
    </div>
  }

  const open = () => useUI.getState().openSheet(close => <WellnessForm onCancel={close}
    onSaved={result => { cache = { day: today, state: { kind: 'done', result } }; saveLast(storage(), today, cache.state); close(); setState(cache.state) }} />)
  return <div className="card wl-card">
    <div className="dim wl-eyebrow">{t('Before training')}</div>
    <h3>{t('How are you feeling today?')}</h3>
    <div className="small muted wl-sub">{t('Four quick questions about sleep, stress, energy and soreness to know how to train today.')}</div>
    <Button variant="primary" icon="heart" onClick={open}>{t('Answer')}</Button>
    <div style={{ height: 6 }} />
    <Button variant="ghost" className="dim" onClick={() => { snoozeToday(storage(), today); setSnoozed(true) }}>{t('Not now')}</Button>
  </div>
}
