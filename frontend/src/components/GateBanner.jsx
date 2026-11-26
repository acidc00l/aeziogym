import { useEffect, useState } from 'react'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'

// AezioGym: la puerta de la web de Aezio responde 401 {"error":"aezio_gate"} cuando el acceso ha
// caducado (lib/api.js lo avisa con el evento «aezio-gate»). En vez de fallar en silencio, se avisa
// y se ofrece volver a entrar. Los entrenos siguen en este dispositivo y se suben solos en cuanto
// vuelve el acceso («aezio-gate-ok» quita el aviso).
export const GATE_URL = 'https://aezio.website/app-entrenamiento'

export default function GateBanner() {
  const [blocked, setBlocked] = useState(false)
  useEffect(() => {
    const on = () => setBlocked(true)
    const off = () => setBlocked(false)
    window.addEventListener('aezio-gate', on)
    window.addEventListener('aezio-gate-ok', off)
    return () => { window.removeEventListener('aezio-gate', on); window.removeEventListener('aezio-gate-ok', off) }
  }, [])
  if (!blocked) return null
  return (
    <div role="alert" style={{
      position: 'fixed', left: 12, right: 12, top: 'calc(var(--sat, 0px) + 10px)', zIndex: 1000,
      background: 'var(--surface-2)', border: '1px solid var(--orange)', borderRadius: 'var(--r-card, 14px)',
      padding: '12px 14px', boxShadow: '0 8px 24px rgba(0,0,0,.35)', color: 'var(--label)'
    }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <span style={{ color: 'var(--orange)', fontSize: 20, lineHeight: 1 }}><Icon name="lock" /></span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, marginBottom: 2 }}>{t('Your access has expired')}</div>
          <div className="small" style={{ color: 'var(--label-2)', marginBottom: 10 }}>
            {t('Your workouts are safe on this device and will upload as soon as you sign in again.')}
          </div>
          <a href={GATE_URL} style={{
            display: 'inline-block', background: 'var(--acc)', color: 'var(--on-acc)', fontWeight: 700,
            padding: '8px 16px', borderRadius: 999, textDecoration: 'none'
          }}>{t('Sign in again')}</a>
        </div>
      </div>
    </div>
  )
}
