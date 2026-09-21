import { FormEvent, useEffect, useMemo, useState } from 'react'
import {
  Ban,
  Clock3,
  KeyRound,
  LogOut,
  Plus,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Unlock,
  Users,
} from 'lucide-react'
import { supabase, supabaseConfigured } from './lib/supabase'

type AuthMode = 'login' | 'signup'
type Page = 'dashboard' | 'licenses' | 'customers'

type DashboardCounts = {
  active: number
  expired: number
  blocked: number
  customers: number
  devices: number
}

type Customer = {
  id: string
  name: string
  email: string | null
  phone: string | null
  is_active: boolean
}

type Plan = {
  id: string
  name: string
  duration_days: number | null
  max_devices: number
  is_lifetime: boolean
}

type License = {
  id: string
  customer_id: string | null
  plan_id: string | null
  status: 'active' | 'blocked' | 'cancelled'
  starts_at: string
  expires_at: string | null
  max_devices: number
  license_key_last4: string
  notes: string | null
  customers?: { name: string } | null
  plans?: { name: string } | null
}

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
  const [page, setPage] = useState<Page>('dashboard')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [checkingAdmin, setCheckingAdmin] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [counts, setCounts] = useState(emptyCounts)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [licenses, setLicenses] = useState<License[]>([])
  const [showLicenseForm, setShowLicenseForm] = useState(false)
  const [createdKey, setCreatedKey] = useState('')
  const [licenseCustomer, setLicenseCustomer] = useState('')
  const [licensePlan, setLicensePlan] = useState('')
  const [maxDevices, setMaxDevices] = useState(1)
  const [notes, setNotes] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')

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
    await refreshAll()
  }

  async function refreshAll() {
    await Promise.all([loadCounts(), loadCustomers(), loadPlans(), loadLicenses()])
  }

  async function loadCounts() {
    if (!supabase) return
    const now = new Date().toISOString()
    const [active, expired, blocked, customerCount, devices] = await Promise.all([
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
      customers: customerCount.count ?? 0,
      devices: devices.count ?? 0,
    })
  }

  async function loadCustomers() {
    if (!supabase) return
    const { data } = await supabase
      .from('customers')
      .select('id, name, email, phone, is_active')
      .order('created_at', { ascending: false })
    setCustomers((data ?? []) as Customer[])
  }

  async function loadPlans() {
    if (!supabase) return
    const { data } = await supabase
      .from('plans')
      .select('id, name, duration_days, max_devices, is_lifetime')
      .eq('is_active', true)
      .order('duration_days', { ascending: true, nullsFirst: false })
    setPlans((data ?? []) as Plan[])
  }

  async function loadLicenses() {
    if (!supabase) return
    const { data } = await supabase
      .from('licenses')
      .select('id, customer_id, plan_id, status, starts_at, expires_at, max_devices, license_key_last4, notes, customers(name), plans(name)')
      .order('created_at', { ascending: false })
    setLicenses((data ?? []) as unknown as License[])
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
        options: { data: { full_name: email.split('@')[0] } },
      })
      setBusy(false)
      if (error) return setMessage(error.message)
      if (!data.session) {
        setMessage('Cadastro criado. Confira seu e-mail e depois faça login.')
        setAuthMode('login')
      }
      return
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (error) setMessage(error.message)
  }

  async function createCustomer(event: FormEvent) {
    event.preventDefault()
    if (!supabase || !customerName.trim()) return
    setBusy(true)
    setMessage('')

    const { error } = await supabase.from('customers').insert({
      name: customerName.trim(),
      email: customerEmail.trim() || null,
      phone: customerPhone.trim() || null,
    })

    setBusy(false)
    if (error) return setMessage(error.message)

    setCustomerName('')
    setCustomerEmail('')
    setCustomerPhone('')
    await refreshAll()
  }

  async function invokeLicense(action: string, payload: Record<string, unknown>) {
    if (!supabase) return null
    const { data, error } = await supabase.functions.invoke('admin-license', {
      body: { action, ...payload },
    })
    if (error) {
      setMessage(error.message)
      return null
    }
    if (data?.error) {
      setMessage(data.error)
      return null
    }
    return data
  }

  async function createLicense(event: FormEvent) {
    event.preventDefault()
    if (!licensePlan) {
      setMessage('Selecione um plano.')
      return
    }
    setBusy(true)
    setMessage('')
    setCreatedKey('')

    const data = await invokeLicense('create', {
      customerId: licenseCustomer || null,
      planId: licensePlan,
      maxDevices,
      notes,
    })

    setBusy(false)
    if (!data) return

    setCreatedKey(data.key)
    setShowLicenseForm(false)
    setNotes('')
    setLicenseCustomer('')
    await refreshAll()
    setPage('licenses')
  }

  async function changeStatus(id: string, status: 'active' | 'blocked' | 'cancelled') {
    setMessage('')
    const data = await invokeLicense('status', { licenseId: id, status })
    if (data) await refreshAll()
  }

  async function renewLicense(id: string) {
    const raw = window.prompt('Quantos dias deseja adicionar?', '30')
    if (!raw) return
    const days = Number(raw)
    if (!Number.isInteger(days) || days < 1) {
      setMessage('Quantidade de dias inválida.')
      return
    }
    const data = await invokeLicense('renew', { licenseId: id, days })
    if (data) await refreshAll()
  }

  async function resetDevices(id: string) {
    if (!window.confirm('Liberar todos os dispositivos desta licença?')) return
    const data = await invokeLicense('reset_devices', { licenseId: id })
    if (data) await refreshAll()
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
    return <main className="center-shell"><section className="login-card"><h1>Supabase não configurado</h1></section></main>
  }

  if (checkingAdmin && session) {
    return <main className="center-shell"><section className="login-card"><h1>Validando administrador…</h1></section></main>
  }

  if (!session || !isAdmin) {
    return (
      <main className="center-shell">
        <form className="login-card" onSubmit={submitAuth}>
          <div className="brand"><div className="logo">A</div><div><strong>ALTIV ADMIN</strong><span>Painel de licenças</span></div></div>
          <h1>{authMode === 'login' ? 'Acesso administrativo' : 'Criar primeiro acesso'}</h1>
          <p>{authMode === 'login' ? 'Entre com seu e-mail e senha.' : 'Use um e-mail previamente autorizado.'}</p>
          <label>E-mail<input value={email} onChange={e => setEmail(e.target.value)} type="email" required /></label>
          <label>Senha<input value={password} onChange={e => setPassword(e.target.value)} type="password" minLength={8} required /></label>
          {message && <div className="alert">{message}</div>}
          <button disabled={busy}>{busy ? 'Aguarde…' : authMode === 'login' ? 'Entrar' : 'Criar acesso'}</button>
          <button type="button" className="auth-switch" onClick={() => { setMessage(''); setAuthMode(authMode === 'login' ? 'signup' : 'login') }}>
            {authMode === 'login' ? 'Primeiro acesso? Criar senha' : 'Já tenho acesso? Entrar'}
          </button>
        </form>
      </main>
    )
  }

  return (
    <div className="app-shell">
      <aside>
        <div className="brand"><div className="logo">A</div><div><strong>ALTIV ADMIN</strong><span>Controle comercial</span></div></div>
        <nav>
          <button className={page === 'dashboard' ? 'active' : ''} onClick={() => setPage('dashboard')}>Dashboard</button>
          <button className={page === 'licenses' ? 'active' : ''} onClick={() => setPage('licenses')}>Licenças</button>
          <button className={page === 'customers' ? 'active' : ''} onClick={() => setPage('customers')}>Clientes</button>
        </nav>
        <button className="secondary" onClick={logout}><LogOut size={16}/> Sair</button>
      </aside>

      <main className="dashboard">
        <header>
          <div><p className="eyebrow">ALTIV CODE MOBILE</p><h1>{page === 'dashboard' ? 'Painel administrativo' : page === 'licenses' ? 'Licenças' : 'Clientes'}</h1></div>
          <button onClick={() => setShowLicenseForm(true)}><KeyRound size={17}/> Nova licença</button>
        </header>

        <div className="mobile-nav">
          <button onClick={() => setPage('dashboard')}>Dashboard</button>
          <button onClick={() => setPage('licenses')}>Licenças</button>
          <button onClick={() => setPage('customers')}>Clientes</button>
        </div>

        {message && <div className="alert">{message}</div>}
        {createdKey && <div className="success-box"><strong>Chave criada</strong><code>{createdKey}</code><button onClick={() => navigator.clipboard.writeText(createdKey)}>Copiar chave</button></div>}

        {page === 'dashboard' && <>
          <section className="cards">
            {cards.map(({ label, value, icon: Icon }) => <article key={label}><div className="icon"><Icon size={19}/></div><span>{label}</span><strong>{value}</strong></article>)}
          </section>
          <section className="panel"><p className="eyebrow">FASE 2</p><h2>Operação comercial ativa</h2><p>O painel agora cadastra clientes, gera licenças seguras, renova, bloqueia, desbloqueia e libera dispositivos.</p></section>
        </>}

        {page === 'customers' && <section className="panel">
          <h2>Novo cliente</h2>
          <form className="form-grid" onSubmit={createCustomer}>
            <label>Nome<input value={customerName} onChange={e => setCustomerName(e.target.value)} required /></label>
            <label>E-mail<input value={customerEmail} onChange={e => setCustomerEmail(e.target.value)} type="email" /></label>
            <label>Telefone / WhatsApp<input value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} /></label>
            <button disabled={busy}><Plus size={16}/> Salvar cliente</button>
          </form>
          <div className="list">
            {customers.map(c => <div className="row" key={c.id}><div><strong>{c.name}</strong><span>{c.phone || c.email || 'Sem contato informado'}</span></div><span className="badge">{c.is_active ? 'Ativo' : 'Inativo'}</span></div>)}
            {!customers.length && <p>Nenhum cliente cadastrado ainda.</p>}
          </div>
        </section>}

        {page === 'licenses' && <section className="panel">
          <div className="panel-title"><div><h2>Licenças geradas</h2><p>Controle de validade, bloqueio e dispositivos.</p></div><button className="ghost" onClick={refreshAll}><RefreshCw size={16}/> Atualizar</button></div>
          <div className="list">
            {licenses.map(l => {
              const expired = Boolean(l.expires_at && new Date(l.expires_at) < new Date())
              return <div className="license-card" key={l.id}>
                <div>
                  <strong>{l.customers?.name || 'Sem cliente vinculado'}</strong>
                  <span>{l.plans?.name || 'Plano personalizado'} • final {l.license_key_last4}</span>
                  <span>{l.expires_at ? `Vence em ${new Date(l.expires_at).toLocaleDateString('pt-BR')}` : 'Vitalícia'} • {l.max_devices} dispositivo(s)</span>
                </div>
                <div className="license-actions">
                  <span className={`badge ${l.status === 'blocked' ? 'danger' : expired ? 'warn' : ''}`}>{l.status === 'blocked' ? 'Bloqueada' : expired ? 'Vencida' : l.status === 'cancelled' ? 'Cancelada' : 'Ativa'}</span>
                  <button className="ghost" onClick={() => renewLicense(l.id)}>Renovar</button>
                  <button className="ghost" onClick={() => resetDevices(l.id)}><Smartphone size={15}/> Liberar aparelhos</button>
                  {l.status === 'blocked'
                    ? <button className="ghost" onClick={() => changeStatus(l.id, 'active')}><Unlock size={15}/> Desbloquear</button>
                    : <button className="danger-button" onClick={() => changeStatus(l.id, 'blocked')}><Ban size={15}/> Bloquear</button>}
                </div>
              </div>
            })}
            {!licenses.length && <p>Nenhuma licença gerada ainda.</p>}
          </div>
        </section>}

        {showLicenseForm && <div className="modal-backdrop" onClick={() => setShowLicenseForm(false)}>
          <form className="modal" onClick={e => e.stopPropagation()} onSubmit={createLicense}>
            <h2>Gerar nova licença</h2>
            <label>Cliente<select value={licenseCustomer} onChange={e => setLicenseCustomer(e.target.value)}><option value="">Sem cliente</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label>Plano<select value={licensePlan} onChange={e => { setLicensePlan(e.target.value); const p = plans.find(x => x.id === e.target.value); if (p) setMaxDevices(p.max_devices) }} required><option value="">Selecione</option>{plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label>Máximo de dispositivos<input type="number" min="1" max="50" value={maxDevices} onChange={e => setMaxDevices(Number(e.target.value))} /></label>
            <label>Observação<textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}/></label>
            <div className="modal-actions"><button type="button" className="ghost" onClick={() => setShowLicenseForm(false)}>Cancelar</button><button disabled={busy}>{busy ? 'Gerando…' : 'Gerar licença'}</button></div>
          </form>
        </div>}
      </main>
    </div>
  )
}
