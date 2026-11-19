import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { webauthnOK, passkeyLogin, passkeyRegister, api, BIO } from '../lib/api.js'
import { hasData } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { DEMO, REPO } from '../lib/demo.js'
import { useState, useRef, useEffect } from 'react'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'

function RegisterSheet({ close }) {
  const { setUser, pushState, pullState } = useStore()
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [inviteOnly, setInviteOnly] = useState(false)
  const ref = useRef(null)
  
  useEffect(() => { setTimeout(() => ref.current?.focus(), 250) }, [])
  useEffect(() => { api('/api/config').then(c => setInviteOnly(!!c.invite_only)).catch(() => {}) }, [])

  const go = async () => {
    const n = name.trim()
    if (!n) { useUI.getState().toast(t('Nombre del perfil')); return }
    if (inviteOnly && !code.trim()) { useUI.getState().toast(t('Se requiere un código de invitación')); return }
    try {
      const u = await passkeyRegister(n, code.trim())
      setUser(u); close()
      if (hasData(useStore.getState().S)) { 
        await pushState()
        useUI.getState().toast(t('Perfil creado: los datos de este dispositivo se han transferido a él')) 
      } else { 
        await pullState()
        useUI.getState().toast(t('Welcome, {0}', u.name)) 
      }
    } catch (e) {
      console.error('Error de registro Passkey:', e)
      useUI.getState().toast(e.message || t('Falló el registro de Passkey'))
    }
  }

  return (
    <>
      <h3>{t('Create your profile')}</h3>
      <div className="muted small" style={{ marginBottom: 14 }}>
        {t('Elige un nombre y confírmalo con {0}. La clave de acceso se guarda en tu dispositivo; no necesitas contraseña.', BIO)}
      </div>
      <input ref={ref} className="input" placeholder={t('Nombre del perfil')} maxLength={40} value={name} onChange={e => setName(e.target.value)} />
      {inviteOnly && (
        <>
          <div style={{ height: 10 }} />
          <input className="input" placeholder={t('Código de invitación')} maxLength={40} value={code}
            onChange={e => setCode(e.target.value.toUpperCase())} style={{ letterSpacing: '.14em', fontWeight: 600, textAlign: 'center' }} />
          <div className="dim small" style={{ marginTop: 6 }}>{t('Esta aplicación es solo por invitación; introduce el código que te han proporcionado.')}</div>
        </>
      )}
      <div style={{ height: 12 }} />
      <Button variant="primary" onClick={go}>{t('Crear clave de acceso (Face ID)')}</Button>
    </>
  )
}

export default function Login() {
  const { setUser, pullState } = useStore()

  const signIn = async () => {
    try {
      const u = await passkeyLogin()
      setUser(u)
      await pullState()
      useUI.getState().toast(t('Bienvenido de nuevo, {0}', u.name))
    } catch (e) {
      if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') {
        useUI.getState().toast(e.message || t('Error al iniciar sesión'))
      }
    }
  }

  const head = (
    <>
      <div style={{ fontSize: 54, display: 'flex', justifyContent: 'center', color: 'var(--acc)' }}>
        <Icon name="dumbbell" />
      </div>
      <h1 style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-.028em', margin: '10px 0 4px' }}>
        AezioGym
      </h1>
    </>
  )

  const wrap = {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    minHeight: '78vh',
    textAlign: 'center'
  }

  return (
    <div className="narrow" style={wrap}>
      {head}
      <div className="muted" style={{ marginBottom: 34 }}>
        {t('Tu entrenamiento. Tus progresos. Tu evolución.')}
      </div>

      {webauthnOK() ? (
        <>
          <Button variant="primary" icon="person" onClick={signIn}>
            {t('Iniciar sesión con Passkey / Face ID')}
          </Button>
          <div style={{ height: 12 }} />
          <Button variant="primary" icon="sparkles" onClick={() => useUI.getState().openSheet(close => <RegisterSheet close={close} />)}>
            {t('Crear nuevo perfil')}
          </Button>
        </>
      ) : (
        <div className="card small muted" style={{ textAlign: 'left' }}>
          {t('Este navegador no admite claves de acceso (Passkeys). Por favor, utiliza Safari en iOS o Chrome/Edge actualizado.')}
        </div>
      )}

      <div className="dim small" style={{ marginTop: 26, lineHeight: 1.5 }}>
        {t('Las claves de acceso utilizan {0} — sin contraseñas.', BIO)}
        <br />
        {t('Cada perfil mantiene su propio plan, entrenamientos y peso corporal.')}
      </div>
    </div>
  )
}