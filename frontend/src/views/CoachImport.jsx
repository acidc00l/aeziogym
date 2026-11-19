import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { exOr } from '../lib/exercises.js'
import { exLine } from '../lib/history.js'
import { exCount } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { parseCoachPlan, coachPlanChanges, applyCoachPlan } from '../lib/coach-import.js'
import { Thumb } from '../components/Media.jsx'
import { Button } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'

const ENDPOINT = 'https://aezio.website/api/app-routines?token='

// El enlace vale una sola vez: se guarda lo recibido para que recargar la página no lo pierda.
async function loadPlan(token) {
  const key = 'coach_plan_' + token
  const saved = sessionStorage.getItem(key)
  if (saved) return JSON.parse(saved)
  const response = await fetch(ENDPOINT + encodeURIComponent(token), { credentials: 'omit' })
  if (!response.ok) { const e = new Error('load'); e.status = response.status; throw e }
  const data = await response.json()
  sessionStorage.setItem(key, JSON.stringify(data))
  return data
}

export default function CoachImport() {
  const nav = useNavigate()
  const { token } = useParams()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const [plan, setPlan] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    loadPlan(token)
      .then(data => { if (live) setPlan(parseCoachPlan(data)) })
      .catch(e => { if (live) setError(e.status === 410 ? 'expired' : 'failed') })
    return () => { live = false }
  }, [token])

  if (error) return <div className="narrow">
    <div className="hdr"><div><h1>{t('Add your plan')}</h1></div></div>
    <div className="empty"><div className="ico"><Icon name="clipboard" /></div>
      {error === 'expired'
        ? t('This link has expired or was already used. Open your plan in Aezio and tap “Add to my app” again.')
        : t('Could not load the plan. Check your connection and try again.')}
    </div>
    <div style={{ height: 12 }} />
    <Button onClick={() => nav('/plan')}>{t('Go to my plan')}</Button>
  </div>

  if (!plan) return <div className="narrow"><div className="empty"><div className="ico"><Icon name="dumbbell" /></div>{t('Loading your plan…')}</div></div>

  const changes = coachPlanChanges(S, plan)
  const notAdded = plan.skipped.length + plan.dropped
  const updating = changes.routines.some(r => !r.isNew)
  const confirm = () => {
    update(s => { applyCoachPlan(s, plan) })
    sessionStorage.removeItem('coach_plan_' + token)
    useUI.getState().toast(t('Your plan is in the app'))
    nav('/plan')
  }

  return <div className="narrow">
    <div className="hdr"><div>
      <h1>{updating ? t('Update your plan') : t('Add your plan')}</h1>
      <div className="sub">{plan.name} · {t(plan.routines.length === 1 ? '{0} routine' : '{0} routines', plan.routines.length)} · {exCount(plan.exerciseCount)}</div>
    </div></div>

    {plan.routines.map((r, ri) => {
      const change = changes.routines[ri]
      return <div key={r.id} style={{ marginBottom: 18 }}>
        <h4 className="sec">{r.name}</h4>
        {change.changed && <div className="small" style={{ margin: '0 2px 8px', color: 'var(--orange, #ff9f0a)' }}>
          {t('This routine has changed in the app since you added it. Confirming replaces it with the plan.')}
        </div>}
        <div className="list">{r.ex.map((e, i) => {
          const ex = exOr(e.id)
          const range = r.ranges[i]
          return <div className="item" key={i}>
            <Thumb ex={ex} />
            <div className="grow">
              <div className="tt capitalize">{ex.n}</div>
              <div className="ss">{exLine(e, S.unit)}{range ? ' · ' + t('plan: {0}', range) : ''}</div>
            </div>
          </div>
        })}</div>
      </div>
    })}

    {notAdded > 0 && <div className="card" style={{ marginBottom: 14 }}>
      <h2>{t('Not added')}</h2>
      <div className="small dim">{t('These exercises are not in the app. You will find them in your plan on Aezio.')}</div>
      {plan.skipped.map((name, i) => <div className="small" key={i} style={{ marginTop: 6 }}>{name}</div>)}
    </div>}

    {changes.removed.length > 0 && <div className="small" style={{ margin: '0 2px 14px', color: 'var(--orange, #ff9f0a)' }}>
      {t('No longer in the plan, and will be removed: {0}', changes.removed.join(', '))}
    </div>}

    <div className="small dim" style={{ margin: '0 2px 14px', lineHeight: 1.4 }}>
      {t('Effort, rest and your coach’s notes stay in your plan on Aezio. Your workouts and your own routines are not touched.')}
      {plan.routines.some(r => r.ex.some(e => e.weight > 0)) ? ' ' + t('If you already trained an exercise, the app starts from your last weight.') : ''}
    </div>

    {S.active
      ? <div className="small" style={{ margin: '0 2px 10px' }}>{t('Finish your current workout before adding the plan.')}</div>
      : <Button variant="primary" icon="plus" onClick={confirm} disabled={!plan.routines.length}>{updating ? t('Update my app') : t('Add to my app')}</Button>}
    <div style={{ height: 10 }} />
    <Button onClick={() => nav('/plan')}>{t('Cancel')}</Button>
  </div>
}
