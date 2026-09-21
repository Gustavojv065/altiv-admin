import { FormEvent, useEffect, useMemo, useState } from 'react'
import { KeyRound, LogOut, ShieldCheck, Smartphone, Users, Clock3, Ban } from 'lucide-react'
import { supabase, supabaseConfigured } from './lib/supabase'

type DashboardCounts = {
  active: number
  expired: number
  blocked: number
  customers: number
  devices: number
}

type AuthMode = 'login' | 'signup'

const emptyCounts: DashboardCounts = {
  active: 0,
  expired: 0,
  blocked: 0,
  customers: 0,
  devices: 0,
}

export default function App() {
  const [session, setSession] = useState<any>(null)
  const [authMode, setAuthMode] = useState<AuthMode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [checkingAdmin, setCheckingAdmin] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [counts, setCounts] = useState(emptyCounts)

  useEffect(() => {
    if (!supabase) {
      setCheckingAdmin(false)
      return
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (!data.session) setCheckingAdmin(false)
    })

    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      if (!next) {
        setIsAdmin(false)
        setCheckingAdmin(false)
      }
    })

    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session || !supabase) return

    verifyAdmin()
  }, [session])

  async function verifyAdmin() {
    if (!supabase || !session) return

    setCheckingAdmin(true)

    const { data, error } = await supabase
      .from('admin_profiles')
      .select('user_id, role, is_active')
      .eq('user_id', session.user.id)
      .eq('is_active', true)
      .maybeSingle()

    if (error || !data) {
      setIsAdmin(false)
      setMessage('Este usuário não possui acesso ao ALTIV ADMIN.')
      await supabase.auth.signOut()
      setCheckingAdmin(false)
      return
    }

    setIsAdmin(true)
    setCheckingAdmin(false)
    await loadCounts()
  }

  async function loadCounts() {
    if (!supabase) return

    const now = new Date().toISOString()
    const [active, expired, blocked, customers, devices] = await Promise.all([
      supabase
        .from('licenses')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active')
        .or(`expires_at.is.null,expires_at.gt.${now}`),
      supabase
        .from('licenses')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active')
        .lt('expires_at', now),
      supabase
        .from('licenses')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'blocked'),
      supabase
        .from('customers')
        .select('*', { count: 'exact', head: true }),
      supabase
        .from('devices')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true),
    ])

    setCounts({
      active: active.count ?? 0,
      expired: expired.count ?? 0,
      blocked: blocked.count ?? 0,
      customers: customers.count ?? 0,
      devices: devices.count ?? 0,
    })
  }

  async function submitAuth(event: FormEvent) {
    event.preventDefault()
    if (!supabase) return

    setBusy(true)
    setMessage('')

    if (authMode === 'signup') {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: email.split('@')[0],
          },
        },
      })

      setBusy(false)

      if (error) {
        setMessage(error.message)
        return
      }

      if (!data.session) {
        setMessage(
          'Cadastro criado. Confira seu e-mail para confirmar o acesso e depois faça login.'
        )
        setAuthMode('login')
        return
      }

      setMessage('Acesso criado. Validando perfil administrativo…')
      return
    }

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    setBusy(false)

    if (error) setMessage(error.message)
  }

  async function logout() {
    await supabase?.auth.signOut()
  }

  const cards = useMemo(
    () => [
      { label: 'Licenças ativas', value: counts.active, icon: ShieldCheck },
      { label: 'Clientes', value: counts.customers, icon: Users },
      { label: 'Dispositivos ativos', value: counts.devices, icon: Smartphone },
      { label: 'Vencidas', value: counts.expired, icon: Clock3 },
      { label: 'Bloqueadas', value: counts.blocked, icon: Ban },
    ],
    [counts]
  )

  if (!supabaseConfigured) {
    return (
      <main className="center-shell">
        <section className="login-card">
          <div className="brand">
            <div className="logo">A</div>
            <div>
              <strong>ALTIV ADMIN</strong>
              <span>Fase 1</span>
            </div>
          </div>
          <h1>Projeto pronto para conectar ao Supabase</h1>
          <p>
            Configure as variáveis VITE_SUPABASE_URL e
            VITE_SUPABASE_PUBLISHABLE_KEY no ambiente de publicação.
          </p>
        </section>
      </main>
    )
  }

  if (checkingAdmin && session) {
    return (
      <main className="center-shell">
        <section className="login-card">
          <div className="brand">
            <div className="logo">A</div>
            <div>
              <strong>ALTIV ADMIN</strong>
              <span>Verificando acesso</span>
            </div>
          </div>
          <h1>Validando administrador…</h1>
          <p>Estamos confirmando suas permissões com segurança.</p>
        </section>
      </main>
    )
  }

  if (!session || !isAdmin) {
    return (
      <main className="center-shell">
        <form className="login-card" onSubmit={submitAuth}>
          <div className="brand">
            <div className="logo">A</div>
            <div>
              <strong>ALTIV ADMIN</strong>
              <span>Painel de licenças</span>
            </div>
          </div>

          <h1>
            {authMode === 'login'
              ? 'Acesso administrativo'
              : 'Criar primeiro acesso'}
          </h1>

          <p>
            {authMode === 'login'
              ? 'Entre com seu e-mail e senha de administrador.'
              : 'Use somente um e-mail previamente autorizado pelo administrador do sistema.'}
          </p>

          <label>
            E-mail
            <input
              value={email}
              onChange={e => setEmail(e.target.value)}
              type="email"
              autoComplete="email"
              required
            />
          </label>

          <label>
            Senha
            <input
              value={password}
              onChange={e => setPassword(e.target.value)}
              type="password"
              minLength={8}
              autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
              required
            />
          </label>

          {message && <div className="alert">{message}</div>}

          <button disabled={busy}>
            {busy
              ? 'Aguarde…'
              : authMode === 'login'
                ? 'Entrar'
                : 'Criar acesso'}
          </button>

          <button
            type="button"
            className="auth-switch"
            onClick={() => {
              setMessage('')
              setAuthMode(authMode === 'login' ? 'signup' : 'login')
            }}
          >
            {authMode === 'login'
              ? 'Primeiro acesso? Criar senha'
              : 'Já tenho acesso? Entrar'}
          </button>
        </form>
      </main>
    )
  }

  return (
    <div className="app-shell">
      <aside>
        <div className="brand">
          <div className="logo">A</div>
          <div>
            <strong>ALTIV ADMIN</strong>
            <span>Controle comercial</span>
          </div>
        </div>

        <nav>
          <a className="active">Dashboard</a>
          <a>Licenças</a>
          <a>Clientes</a>
          <a>Dispositivos</a>
          <a>Planos</a>
          <a>Histórico</a>
        </nav>

        <button className="secondary" onClick={logout}>
          <LogOut size={16} /> Sair
        </button>
      </aside>

      <main className="dashboard">
        <header>
          <div>
            <p className="eyebrow">ALTIV CODE MOBILE</p>
            <h1>Painel administrativo</h1>
          </div>

          <button>
            <KeyRound size={17} /> Nova licença
          </button>
        </header>

        <section className="cards">
          {cards.map(({ label, value, icon: Icon }) => (
            <article key={label}>
              <div className="icon">
                <Icon size={19} />
              </div>
              <span>{label}</span>
              <strong>{value}</strong>
            </article>
          ))}
        </section>

        <section className="panel">
          <div>
            <p className="eyebrow">FASE 1</p>
            <h2>Base comercial conectada</h2>
          </div>

          <p>
            Autenticação administrativa, banco de licenças, clientes,
            dispositivos e planos estão preparados. O próximo passo é
            publicar este painel e então ativar as telas operacionais.
          </p>
        </section>
      </main>
    </div>
  )
}
