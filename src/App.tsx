import { FormEvent, useEffect, useMemo, useState } from 'react'
import {
  Ban,
  Clock3,
  Eye,
  KeyRound,
  LogOut,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Unlock,
  Users,
  XCircle,
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
  notes: string | null
  is_active: boolean
}

type Device = {
  id: string
  device_label: string | null
  app_version: string | null
  first_seen_at: string
  last_seen_at: string
  is_active: boolean
  revoked_at: string | null
}

type LicenseEvent = {
  id: number
  event_type: string
  metadata: Record<string, unknown>
  created_at: string
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

const eventLabels: Record<string, string> = {
  license_created: 'Licença criada',
  license_renewed: 'Licença renovada',
  license_active: 'Licença ativada',
  license_blocked: 'Licença bloqueada',
  license_cancelled: 'Licença cancelada',
  devices_reset: 'Dispositivos liberados',
  device_activated: 'Dispositivo ativado',
  device_reactivated: 'Dispositivo reativado',
}

function eventDetails(event: LicenseEvent) {
  const metadata = event.metadata || {}
  const parts: string[] = []

  if (typeof metadata.plan === 'string') {
    parts.push(`Plano: ${metadata.plan}`)
  }

  if (typeof metadata.duration_days === 'number') {
    parts.push(`${metadata.duration_days} dias`)
  }

  if (typeof metadata.days === 'number') {
    parts.push(`+${metadata.days} dias`)
  }

  if (typeof metadata.max_devices === 'number') {
    parts.push(`${metadata.max_devices} dispositivo(s)`)
  }

  if (typeof metadata.device_label === 'string' && metadata.device_label) {
    parts.push(`Aparelho: ${metadata.device_label}`)
  }

  return parts.length ? parts.join(' • ') : 'Sem detalhes adicionais'
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
  const [notice, setNotice] = useState('')
  const [selectedLicense, setSelectedLicense] = useState<License | null>(null)
  const [licenseDevices, setLicenseDevices] = useState<Device[]>([])
  const [licenseEvents, setLicenseEvents] = useState<LicenseEvent[]>([])
  const [detailsBusy, setDetailsBusy] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null)
  const [editCustomerName, setEditCustomerName] = useState('')
  const [editCustomerEmail, setEditCustomerEmail] = useState('')
  const [editCustomerPhone, setEditCustomerPhone] = useState('')
  const [editCustomerNotes, setEditCustomerNotes] = useState('')

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
      .select('id, name, email, phone, notes, is_active')
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
    setNotice('Cliente cadastrado com sucesso.')
    await refreshAll()
  }

  function openCustomerEditor(customer: Customer) {
    setEditingCustomer(customer)
    setEditCustomerName(customer.name)
    setEditCustomerEmail(customer.email ?? '')
    setEditCustomerPhone(customer.phone ?? '')
    setEditCustomerNotes(customer.notes ?? '')
    setMessage('')
    setNotice('')
  }

  async function updateCustomer(event: FormEvent) {
    event.preventDefault()
    if (!supabase || !editingCustomer || !editCustomerName.trim()) return

    setBusy(true)
    setMessage('')
    setNotice('')

    const { error } = await supabase
      .from('customers')
      .update({
        name: editCustomerName.trim(),
        email: editCustomerEmail.trim() || null,
        phone: editCustomerPhone.trim() || null,
        notes: editCustomerNotes.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', editingCustomer.id)

    setBusy(false)

    if (error) {
      setMessage(error.message)
      return
    }

    setEditingCustomer(null)
    setNotice('Cliente atualizado com sucesso.')
    await refreshAll()
  }

  async function openLicenseDetails(license: License) {
    if (!supabase) return

    setSelectedLicense(license)
    setLicenseDevices([])
    setLicenseEvents([])
    setDetailsBusy(true)
    setMessage('')
    setNotice('')

    const [devicesResult, eventsResult] = await Promise.all([
      supabase
        .from('devices')
        .select('id, device_label, app_version, first_seen_at, last_seen_at, is_active, revoked_at')
        .eq('license_id', license.id)
        .order('last_seen_at', { ascending: false }),
      supabase
        .from('license_events')
        .select('id, event_type, metadata, created_at')
        .eq('license_id', license.id)
        .order('created_at', { ascending: false })
        .limit(50),
    ])

    if (devicesResult.error || eventsResult.error) {
      setMessage(devicesResult.error?.message || eventsResult.error?.message || 'Erro ao carregar detalhes.')
    } else {
      setLicenseDevices((devicesResult.data ?? []) as Device[])
      setLicenseEvents((eventsResult.data ?? []) as LicenseEvent[])
    }

    setDetailsBusy(false)
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
    const labels = {
      active: 'desbloquear',
      blocked: 'bloquear',
      cancelled: 'cancelar',
    }

    if (!window.confirm(`Confirma ${labels[status]} esta licença?`)) return

    setMessage('')
    setNotice('')

    const data = await invokeLicense('status', { licenseId: id, status })

    if (data) {
      setNotice(
        status === 'active'
          ? 'Licença desbloqueada com sucesso.'
          : status === 'blocked'
            ? 'Licença bloqueada com sucesso.'
            : 'Licença cancelada com sucesso.'
      )
      await refreshAll()

      const updated = licenses.find(item => item.id === id)
      if (updated && selectedLicense?.id === id) {
        setSelectedLicense({ ...updated, status })
        await openLicenseDetails({ ...updated, status })
      }
    }
  }

  async function renewLicense(id: string) {
    const raw = window.prompt('Quantos dias deseja adicionar?', '30')
    if (!raw) return
    const days = Number(raw)
    if (!Number.isInteger(days) || days < 1) {
      setMessage('Quantidade de dias inválida.')
      return
    }
    setMessage('')
    setNotice('')

    const data = await invokeLicense('renew', { licenseId: id, days })

    if (data) {
      setNotice(`Licença renovada por mais ${days} dia(s).`)
      await refreshAll()

      if (selectedLicense?.id === id) {
        const refreshed = licenses.find(item => item.id === id) ?? selectedLicense
        await openLicenseDetails(refreshed)
      }
    }
  }

  async function resetDevices(id: string) {
    if (!window.confirm('Liberar todos os dispositivos desta licença?')) return
    setMessage('')
    setNotice('')

    const data = await invokeLicense('reset_devices', { licenseId: id })

    if (data) {
      setNotice('Dispositivos liberados com sucesso.')
      await refreshAll()

      if (selectedLicense?.id === id) {
        await openLicenseDetails(selectedLicense)
      }
    }
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
        {notice && <div className="notice-box">{notice}</div>}
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
            {customers.map(c => <div className="row" key={c.id}>
              <div><strong>{c.name}</strong><span>{c.phone || c.email || 'Sem contato informado'}</span>{c.notes && <span>{c.notes}</span>}</div>
              <div className="row-actions"><span className="badge">{c.is_active ? 'Ativo' : 'Inativo'}</span><button className="ghost" onClick={() => openCustomerEditor(c)}><Pencil size={15}/> Editar</button></div>
            </div>)}
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
                  <button className="ghost" onClick={() => openLicenseDetails(l)}><Eye size={15}/> Detalhes</button>
                  <button className="ghost" onClick={() => renewLicense(l.id)}>Renovar</button>
                  <button className="ghost" onClick={() => resetDevices(l.id)}><Smartphone size={15}/> Liberar aparelhos</button>
                  {l.status === 'blocked'
                    ? <button className="ghost" onClick={() => changeStatus(l.id, 'active')}><Unlock size={15}/> Desbloquear</button>
                    : l.status === 'cancelled'
                      ? <button className="ghost" onClick={() => changeStatus(l.id, 'active')}><Unlock size={15}/> Reativar</button>
                      : <button className="danger-button" onClick={() => changeStatus(l.id, 'blocked')}><Ban size={15}/> Bloquear</button>}
                  {l.status !== 'cancelled' && <button className="danger-button" onClick={() => changeStatus(l.id, 'cancelled')}><XCircle size={15}/> Cancelar</button>}
                </div>
              </div>
            })}
            {!licenses.length && <p>Nenhuma licença gerada ainda.</p>}
          </div>
        </section>}

        {editingCustomer && <div className="modal-backdrop" onClick={() => setEditingCustomer(null)}>
          <form className="modal" onClick={e => e.stopPropagation()} onSubmit={updateCustomer}>
            <h2>Editar cliente</h2>
            <label>Nome<input value={editCustomerName} onChange={e => setEditCustomerName(e.target.value)} required /></label>
            <label>E-mail<input value={editCustomerEmail} onChange={e => setEditCustomerEmail(e.target.value)} type="email" /></label>
            <label>Telefone / WhatsApp<input value={editCustomerPhone} onChange={e => setEditCustomerPhone(e.target.value)} /></label>
            <label>Observações<textarea value={editCustomerNotes} onChange={e => setEditCustomerNotes(e.target.value)} rows={3}/></label>
            <div className="modal-actions"><button type="button" className="ghost" onClick={() => setEditingCustomer(null)}>Cancelar</button><button disabled={busy}>{busy ? 'Salvando…' : 'Salvar alterações'}</button></div>
          </form>
        </div>}

        {selectedLicense && <div className="modal-backdrop" onClick={() => setSelectedLicense(null)}>
          <section className="modal modal-wide" onClick={e => e.stopPropagation()}>
            <div className="detail-header">
              <div>
                <p className="eyebrow">LICENÇA</p>
                <h2>{selectedLicense.customers?.name || 'Sem cliente vinculado'}</h2>
                <p>{selectedLicense.plans?.name || 'Plano personalizado'} • final {selectedLicense.license_key_last4}</p>
              </div>
              <button className="ghost" onClick={() => setSelectedLicense(null)}>Fechar</button>
            </div>

            <div className="detail-grid">
              <div><span>Status</span><strong>{selectedLicense.status === 'active' ? 'Ativa' : selectedLicense.status === 'blocked' ? 'Bloqueada' : 'Cancelada'}</strong></div>
              <div><span>Início</span><strong>{new Date(selectedLicense.starts_at).toLocaleDateString('pt-BR')}</strong></div>
              <div><span>Vencimento</span><strong>{selectedLicense.expires_at ? new Date(selectedLicense.expires_at).toLocaleDateString('pt-BR') : 'Vitalícia'}</strong></div>
              <div><span>Dispositivos permitidos</span><strong>{selectedLicense.max_devices}</strong></div>
            </div>

            {selectedLicense.notes && <div className="detail-note"><span>Observação</span><p>{selectedLicense.notes}</p></div>}

            <div className="detail-actions">
              <button className="ghost" onClick={() => renewLicense(selectedLicense.id)}>Renovar</button>
              <button className="ghost" onClick={() => resetDevices(selectedLicense.id)}><Smartphone size={15}/> Liberar aparelhos</button>
              {selectedLicense.status === 'blocked'
                ? <button className="ghost" onClick={() => changeStatus(selectedLicense.id, 'active')}><Unlock size={15}/> Desbloquear</button>
                : selectedLicense.status === 'cancelled'
                  ? <button className="ghost" onClick={() => changeStatus(selectedLicense.id, 'active')}><Unlock size={15}/> Reativar</button>
                  : <button className="danger-button" onClick={() => changeStatus(selectedLicense.id, 'blocked')}><Ban size={15}/> Bloquear</button>}
              {selectedLicense.status !== 'cancelled' && <button className="danger-button" onClick={() => changeStatus(selectedLicense.id, 'cancelled')}><XCircle size={15}/> Cancelar</button>}
            </div>

            <div className="detail-section">
              <h3>Dispositivos vinculados</h3>
              {detailsBusy && <p>Carregando…</p>}
              {!detailsBusy && !licenseDevices.length && <p>Nenhum dispositivo vinculado.</p>}
              {!detailsBusy && licenseDevices.map(device => <div className="history-row" key={device.id}>
                <div><strong>{device.device_label || 'Dispositivo sem nome'}</strong><span>{device.app_version ? `Versão ${device.app_version}` : 'Versão não informada'}</span></div>
                <div className="history-meta"><span>{device.is_active ? 'Ativo' : 'Liberado'}</span><span>Último acesso: {new Date(device.last_seen_at).toLocaleString('pt-BR')}</span></div>
              </div>)}
            </div>

            <div className="detail-section">
              <h3>Histórico da licença</h3>
              {detailsBusy && <p>Carregando…</p>}
              {!detailsBusy && !licenseEvents.length && <p>Nenhum evento registrado.</p>}
              {!detailsBusy && licenseEvents.map(event => <div className="history-row" key={event.id}>
                <div><strong>{eventLabels[event.event_type] || event.event_type.replaceAll('_', ' ')}</strong><span>{new Date(event.created_at).toLocaleString('pt-BR')}</span></div>
                <span>{eventDetails(event)}</span>
              </div>)}
            </div>
          </section>
        </div>}

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
