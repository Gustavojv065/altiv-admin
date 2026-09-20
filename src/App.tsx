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

const emptyCounts: DashboardCounts = { active: 0, expired: 0, blocked: 0, customers: 0, devices: 0 }

export default function App() {
  const [session, setSession] = useState<any>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [counts, setCounts] = useState(emptyCounts)

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session || !supabase) return
    loadCounts()
  }, [session])

  async function loadCounts() {
    if (!supabase) return
    const now = new Date().toISOString()
    const [active, expired, blocked, customers, devices] = await Promise.all([
      supabase.from('licenses').select('*', { count: 'exact', head: true }).eq('status', 'active').or(`expires_at.is.null,expires_at.gt.${now}`),
      supabase.from('licenses').select('*', { count: 'exact', head: true }).eq('status', 'active').lt('expires_at', now),
      supabase.from('licenses').select('*', { count: 'exact', head: true }).eq('status', 'blocked'),
      supabase.from('customers').select('*', { count: 'exact', head: true }),
      supabase.from('devices').select('*', { count: 'exact', head: true }).eq('is_active', true),
    ])
    setCounts({
      active: active.count ?? 0,
      expired: expired.count ?? 0,
      blocked: blocked.count ?? 0,
      customers: customers.count ?? 0,
      devices: devices.count ?? 0,
    })
  }

  async function login(event: FormEvent) {
    event.preventDefault()
    if (!supabase) return
    setBusy(true)
    setMessage('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (error) setMessage(error.message)
  }

  async function logout() {
    await supabase?.auth.signOut()
  }

  const cards = useMemo(() => [
    { label: 'Licenças ativas', value: counts.active, icon: ShieldCheck },
    { label: 'Clientes', value: counts.customers, icon: Users },
    { label: 'Dispositivos ativos', value: counts.devices, icon: Smartphone },
    { label: 'Vencidas', value: counts.expired, icon: Clock3 },
    { label: 'Bloqueadas', value: counts.blocked, icon: Ban },
  ], [counts])

  if (!supabaseConfigured) {
    return (
      <main className="center-shell">
        <section className="login-card">
          <div className="brand"><div className="logo">A</div><div><strong>ALTIV ADMIN</strong><span>Fase 1</span></div></div>
          <h1>Projeto pronto para conectar ao Supabase</h1>
          <p>Crie o arquivo <code>.env</code> usando o modelo <code>.env.example</code> e informe URL + publishable key.</p>
        </section>
      </main>
    )
  }

  if (!session) {
    return (
      <main className="center-shell">
        <form className="login-card" onSubmit={login}>
          <div className="brand"><div className="logo">A</div><div><strong>ALTIV ADMIN</strong><span>Painel de licenças</span></div></div>
          <h1>Acesso administrativo</h1>
          <p>Entre com seu e-mail e senha de administrador.</p>
          <label>E-mail<input value={email} onChange={e => setEmail(e.target.value)} type="email" required /></label>
          <label>Senha<input value={password} onChange={e => setPassword(e.target.value)} type="password" required /></label>
          {message && <div className="alert">{message}</div>}
          <button disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
        </form>
      </main>
    )
  }

  return (
    <div className="app-shell">
      <aside>
        <div className="brand"><div className="logo">A</div><div><strong>ALTIV ADMIN</strong><span>Controle comercial</span></div></div>
        <nav>
          <a className="active">Dashboard</a>
          <a>Licenças</a>
          <a>Clientes</a>
          <a>Dispositivos</a>
          <a>Planos</a>
          <a>Histórico</a>
        </nav>
        <button className="secondary" onClick={logout}><LogOut size={16}/> Sair</button>
      </aside>
      <main className="dashboard">
        <header><div><p className="eyebrow">ALTIV CODE MOBILE</p><h1>Painel administrativo</h1></div><button><KeyRound size={17}/> Nova licença</button></header>
        <section className="cards">
          {cards.map(({ label, value, icon: Icon }) => (
            <article key={label}><div className="icon"><Icon size={19}/></div><span>{label}</span><strong>{value}</strong></article>
          ))}
        </section>
        <section className="panel">
          <div><p className="eyebrow">Fase 1</p><h2>Base comercial criada</h2></div>
          <p>O painel já está preparado para autenticação administrativa e leitura das tabelas de licenças, clientes e dispositivos. Na próxima fase ligamos geração, renovação, bloqueio e liberação de aparelhos.</p>
        </section>
      </main>
    </div>
  )
}
