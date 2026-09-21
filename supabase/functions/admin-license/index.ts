import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders,
  })
}

function generateKey() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)

  const chars = Array.from(bytes, byte => alphabet[byte % alphabet.length])
  return `ALTIV-${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars.slice(8, 12).join("")}`
}

async function sha256(value: string) {
  const data = new TextEncoder().encode(value.trim().toUpperCase())
  const digest = await crypto.subtle.digest("SHA-256", data)
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("")
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return json({ error: "Método não permitido." }, 405)
  }

  try {
    const authHeader = req.headers.get("Authorization")
    if (!authHeader) return json({ error: "Não autenticado." }, 401)

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? ""
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? ""

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: { Authorization: authHeader },
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })

    const token = authHeader.replace(/^Bearer\s+/i, "")
    const { data: authData, error: authError } = await supabase.auth.getUser(token)

    if (authError || !authData.user) {
      return json({ error: "Sessão inválida." }, 401)
    }

    const user = authData.user
    const { data: admin, error: adminError } = await supabase
      .from("admin_profiles")
      .select("role, is_active")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle()

    if (adminError || !admin) {
      return json({ error: "Acesso administrativo não autorizado." }, 403)
    }

    const body = await req.json()
    const action = String(body.action ?? "")

    if (action === "create") {
      const customerId = body.customerId || null
      const planId = body.planId || null
      const notes = String(body.notes ?? "").trim() || null

      let durationDays: number | null = null
      let isLifetime = false
      let maxDevices = Number(body.maxDevices ?? 1)
      let planName = "Personalizado"

      if (!Number.isInteger(maxDevices) || maxDevices < 1 || maxDevices > 50) {
        return json({ error: "Quantidade de dispositivos inválida." }, 400)
      }

      if (planId) {
        const { data: plan, error: planError } = await supabase
          .from("plans")
          .select("id, name, duration_days, max_devices, is_lifetime, is_active")
          .eq("id", planId)
          .eq("is_active", true)
          .maybeSingle()

        if (planError || !plan) {
          return json({ error: "Plano não encontrado ou inativo." }, 400)
        }

        planName = plan.name
        isLifetime = Boolean(plan.is_lifetime)
        durationDays = isLifetime ? null : Number(plan.duration_days)
        if (!body.maxDevices) maxDevices = Number(plan.max_devices ?? 1)
      } else {
        const customDays = Number(body.customDays)
        if (!Number.isInteger(customDays) || customDays < 1 || customDays > 3650) {
          return json({ error: "Informe uma duração entre 1 e 3650 dias." }, 400)
        }
        durationDays = customDays
      }

      if (customerId) {
        const { data: customer } = await supabase
          .from("customers")
          .select("id")
          .eq("id", customerId)
          .eq("is_active", true)
          .maybeSingle()

        if (!customer) {
          return json({ error: "Cliente não encontrado ou inativo." }, 400)
        }
      }

      const startsAt = new Date()
      const expiresAt = isLifetime || durationDays === null
        ? null
        : addDays(startsAt, durationDays).toISOString()

      let created: any = null
      let plaintextKey = ""

      for (let attempt = 0; attempt < 5 && !created; attempt++) {
        plaintextKey = generateKey()
        const hash = await sha256(plaintextKey)
        const last4 = plaintextKey.slice(-4)

        const { data, error } = await supabase
          .from("licenses")
          .insert({
            customer_id: customerId,
            plan_id: planId,
            license_key_hash: hash,
            license_key_last4: last4,
            status: "active",
            starts_at: startsAt.toISOString(),
            expires_at: expiresAt,
            max_devices: maxDevices,
            notes,
            created_by: user.id,
          })
          .select("id, customer_id, plan_id, status, starts_at, expires_at, max_devices, license_key_last4, notes, created_at")
          .single()

        if (!error) {
          created = data
          break
        }

        if (error.code !== "23505") {
          return json({ error: error.message }, 400)
        }
      }

      if (!created) {
        return json({ error: "Não foi possível gerar uma chave única. Tente novamente." }, 500)
      }

      const { error: recoveryError } = await supabase.rpc(
        "store_license_recovery_key",
        {
          p_license_id: created.id,
          p_plaintext_key: plaintextKey,
        }
      )

      if (recoveryError) {
        await supabase
          .from("licenses")
          .delete()
          .eq("id", created.id)

        return json({
          error: "Não foi possível proteger a chave para recuperação. Tente novamente.",
        }, 500)
      }

      await supabase.from("license_events").insert({
        license_id: created.id,
        customer_id: customerId,
        admin_user_id: user.id,
        event_type: "license_created",
        metadata: {
          plan: planName,
          duration_days: durationDays,
          max_devices: maxDevices,
        },
      })

      return json({
        ok: true,
        key: plaintextKey,
        license: created,
      })
    }

    if (action === "reveal_key") {
      const licenseId = String(body.licenseId ?? "")
      if (!licenseId) {
        return json({ error: "Licença inválida." }, 400)
      }

      const { data: key, error } = await supabase.rpc(
        "reveal_license_key",
        { p_license_id: licenseId }
      )

      if (error) {
        return json({ error: error.message }, 403)
      }

      if (!key) {
        return json({
          error: "Esta licença antiga ainda não possui chave recuperável salva.",
          recoveryRequired: true,
        }, 404)
      }

      return json({ ok: true, key })
    }

    if (action === "store_recovery_key") {
      const licenseId = String(body.licenseId ?? "")
      const key = String(body.key ?? "").trim()

      if (!licenseId || !key) {
        return json({ error: "Informe a licença e a chave completa." }, 400)
      }

      const { error } = await supabase.rpc(
        "store_license_recovery_key",
        {
          p_license_id: licenseId,
          p_plaintext_key: key,
        }
      )

      if (error) {
        return json({ error: error.message }, 400)
      }

      await supabase.from("license_events").insert({
        license_id: licenseId,
        admin_user_id: user.id,
        event_type: "license_key_recovery_enabled",
        metadata: {},
      })

      return json({ ok: true })
    }

    if (action === "renew") {
      const licenseId = String(body.licenseId ?? "")
      const days = Number(body.days ?? 30)

      if (!licenseId || !Number.isInteger(days) || days < 1 || days > 3650) {
        return json({ error: "Dados de renovação inválidos." }, 400)
      }

      const { data: license, error } = await supabase
        .from("licenses")
        .select("id, customer_id, expires_at, status")
        .eq("id", licenseId)
        .maybeSingle()

      if (error || !license) return json({ error: "Licença não encontrada." }, 404)
      if (!license.expires_at) return json({ error: "Licenças vitalícias não precisam de renovação." }, 400)

      const now = new Date()
      const currentExpiry = new Date(license.expires_at)
      const base = currentExpiry > now ? currentExpiry : now
      const nextExpiry = addDays(base, days)

      const { error: updateError } = await supabase
        .from("licenses")
        .update({
          expires_at: nextExpiry.toISOString(),
          status: "active",
          updated_at: now.toISOString(),
        })
        .eq("id", licenseId)

      if (updateError) return json({ error: updateError.message }, 400)

      await supabase.from("license_events").insert({
        license_id: licenseId,
        customer_id: license.customer_id,
        admin_user_id: user.id,
        event_type: "license_renewed",
        metadata: { days, expires_at: nextExpiry.toISOString() },
      })

      return json({ ok: true, expiresAt: nextExpiry.toISOString() })
    }

    if (action === "status") {
      const licenseId = String(body.licenseId ?? "")
      const status = String(body.status ?? "")

      if (!licenseId || !["active", "blocked", "cancelled"].includes(status)) {
        return json({ error: "Status inválido." }, 400)
      }

      const { data: license, error } = await supabase
        .from("licenses")
        .select("id, customer_id")
        .eq("id", licenseId)
        .maybeSingle()

      if (error || !license) return json({ error: "Licença não encontrada." }, 404)

      const { error: updateError } = await supabase
        .from("licenses")
        .update({
          status,
          updated_at: new Date().toISOString(),
        })
        .eq("id", licenseId)

      if (updateError) return json({ error: updateError.message }, 400)

      await supabase.from("license_events").insert({
        license_id: licenseId,
        customer_id: license.customer_id,
        admin_user_id: user.id,
        event_type: `license_${status}`,
        metadata: { status },
      })

      return json({ ok: true })
    }

    if (action === "reset_devices") {
      const licenseId = String(body.licenseId ?? "")
      if (!licenseId) return json({ error: "Licença inválida." }, 400)

      const { data: license, error } = await supabase
        .from("licenses")
        .select("id, customer_id")
        .eq("id", licenseId)
        .maybeSingle()

      if (error || !license) return json({ error: "Licença não encontrada." }, 404)

      const now = new Date().toISOString()
      const { error: resetError } = await supabase
        .from("devices")
        .update({
          is_active: false,
          revoked_at: now,
        })
        .eq("license_id", licenseId)
        .eq("is_active", true)

      if (resetError) return json({ error: resetError.message }, 400)

      await supabase.from("license_events").insert({
        license_id: licenseId,
        customer_id: license.customer_id,
        admin_user_id: user.id,
        event_type: "devices_reset",
        metadata: {},
      })

      return json({ ok: true })
    }

    return json({ error: "Ação não reconhecida." }, 400)
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : "Erro interno.",
    }, 500)
  }
})
