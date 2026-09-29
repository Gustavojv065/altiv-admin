import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders })
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("")
}

function normalizeKey(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, "")
}

function makeToken() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("")
}

function clientSource(req: Request) {
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-real-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  )
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return json({ error: "Método não permitido." }, 405)
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? ""
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""

    if (!supabaseUrl || !serviceRole) {
      return json({ error: "Serviço de ativação indisponível." }, 503)
    }

    const admin = createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const body = await req.json()
    const action = String(body.action ?? "activate")
    const deviceFingerprint = String(body.deviceFingerprint ?? "").trim()
    const deviceLabel = String(body.deviceLabel ?? "").trim() || null
    const appVersion = String(body.appVersion ?? "").trim() || null

    if (!deviceFingerprint || deviceFingerprint.length < 12) {
      return json({ error: "Dispositivo inválido." }, 400)
    }

    const fingerprintHash = await sha256(deviceFingerprint)
    const sourceHash = await sha256(clientSource(req))

    async function recordAttempt(
      success: boolean,
      reason: string,
      last4: string | null = null
    ) {
      await admin.from("activation_attempts").insert({
        device_fingerprint_hash: fingerprintHash,
        source_hash: sourceHash,
        license_key_last4: last4,
        success,
        reason,
      })
    }

    if (action === "activate") {
      const windowStart = new Date(Date.now() - 15 * 60 * 1000).toISOString()
      const [deviceFails, sourceFails] = await Promise.all([
        admin
          .from("activation_attempts")
          .select("id", { count: "exact", head: true })
          .eq("device_fingerprint_hash", fingerprintHash)
          .eq("success", false)
          .gte("created_at", windowStart),
        admin
          .from("activation_attempts")
          .select("id", { count: "exact", head: true })
          .eq("source_hash", sourceHash)
          .eq("success", false)
          .gte("created_at", windowStart),
      ])

      if ((deviceFails.count ?? 0) >= 8 || (sourceFails.count ?? 0) >= 12) {
        await recordAttempt(false, "rate_limited")
        return json({
          error: "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
          retryAfterSeconds: 900,
        }, 429)
      }
      const licenseKey = normalizeKey(String(body.licenseKey ?? ""))
      if (!licenseKey.startsWith("ALTIV-")) {
        await recordAttempt(false, "invalid_format")
        return json({ error: "Chave inválida." }, 400)
      }

      const licenseKeyHash = await sha256(licenseKey)

      const { data: license, error: licenseError } = await admin
        .from("licenses")
        .select("id, customer_id, plan_id, status, starts_at, expires_at, max_devices, license_key_last4")
        .eq("license_key_hash", licenseKeyHash)
        .maybeSingle()

      if (licenseError || !license) {
        await recordAttempt(false, "invalid_key", licenseKey.slice(-4) || null)
        return json({ error: "Chave inválida." }, 401)
      }

      if (license.status === "blocked") {
        await recordAttempt(false, "license_blocked", license.license_key_last4)
        return json({ error: "Licença bloqueada." }, 403)
      }

      if (license.status === "cancelled") {
        await recordAttempt(false, "license_cancelled", license.license_key_last4)
        return json({ error: "Licença cancelada." }, 403)
      }

      const now = new Date()
      if (license.expires_at && new Date(license.expires_at) <= now) {
        await recordAttempt(false, "license_expired", license.license_key_last4)
        return json({ error: "Licença vencida.", expiresAt: license.expires_at }, 403)
      }

      const token = makeToken()
      const tokenHash = await sha256(token)
      const nowIso = now.toISOString()
      const { data: transfer, error: transferError } = await admin.rpc(
        "transfer_license_device",
        {
          p_license_id: license.id,
          p_fingerprint_hash: fingerprintHash,
          p_token_hash: tokenHash,
          p_device_label: deviceLabel,
          p_app_version: appVersion,
        }
      )
      if (transferError) return json({ error: "Falha ao transferir licença para este dispositivo." }, 500)
      const replacedCount = Number(transfer?.replacedCount ?? 0)
      const reactivated = Boolean(transfer?.reactivated)

      await admin.from("license_events").insert({
        license_id: license.id,
        customer_id: license.customer_id,
        admin_user_id: null,
        event_type: reactivated ? "device_reactivated" : "device_activated",
        metadata: {
          device_label: deviceLabel,
          app_version: appVersion,
          replaced_count: replacedCount,
        },
      })

      await recordAttempt(
        true,
        reactivated ? "reactivated" : "activated",
        license.license_key_last4
      )

      return json({
        ok: true,
        activationToken: token,
        replacedCount,
        license: {
          status: "active",
          expiresAt: license.expires_at,
          maxDevices: license.max_devices,
          last4: license.license_key_last4,
        },
        serverTime: nowIso,
      })
    }

    if (action === "deactivate") {
      const activationToken = String(body.activationToken ?? "").trim()
      if (!activationToken) return json({ error: "Token ausente." }, 401)

      const tokenHash = await sha256(activationToken)

      const { data: device, error: deviceError } = await admin
        .from("devices")
        .select("id, license_id, is_active")
        .eq("activation_token_hash", tokenHash)
        .eq("device_fingerprint_hash", fingerprintHash)
        .maybeSingle()

      if (deviceError || !device || !device.is_active) {
        return json({ error: "Esta ativação não está mais ativa. Digite a chave para ativar neste dispositivo." }, 401)
      }

      const { data: license } = await admin
        .from("licenses")
        .select("customer_id")
        .eq("id", device.license_id)
        .maybeSingle()

      const nowIso = new Date().toISOString()
      const { error: updateError } = await admin
        .from("devices")
        .update({
          is_active: false,
          revoked_at: nowIso,
          last_seen_at: nowIso,
          activation_token_hash: null,
          token_created_at: null,
        })
        .eq("id", device.id)

      if (updateError) {
        return json({ error: "Falha ao liberar dispositivo." }, 500)
      }

      await admin.from("license_events").insert({
        license_id: device.license_id,
        customer_id: license?.customer_id ?? null,
        admin_user_id: null,
        event_type: "device_deactivated",
        metadata: {
          device_label: deviceLabel,
          app_version: appVersion,
        },
      })

      return json({ ok: true, serverTime: nowIso })
    }

    if (action === "validate") {
      const activationToken = String(body.activationToken ?? "").trim()
      if (!activationToken) return json({ error: "Token ausente." }, 401)

      const tokenHash = await sha256(activationToken)

      const { data: device, error: deviceError } = await admin
        .from("devices")
        .select("id, license_id, is_active, revoked_at")
        .eq("activation_token_hash", tokenHash)
        .eq("device_fingerprint_hash", fingerprintHash)
        .maybeSingle()

      if (deviceError || !device || !device.is_active) {
        return json({ error: "Esta ativação não está mais ativa. Digite a chave para ativar neste dispositivo." }, 401)
      }

      const { data: license } = await admin
        .from("licenses")
        .select("id, customer_id, status, expires_at, max_devices, license_key_last4")
        .eq("id", device.license_id)
        .maybeSingle()

      if (!license) return json({ error: "Licença não encontrada." }, 404)
      if (license.status === "blocked") return json({ error: "Licença bloqueada." }, 403)
      if (license.status === "cancelled") return json({ error: "Licença cancelada." }, 403)

      const now = new Date()
      if (license.expires_at && new Date(license.expires_at) <= now) {
        return json({ error: "Licença vencida.", expiresAt: license.expires_at }, 403)
      }

      await admin
        .from("devices")
        .update({
          last_seen_at: now.toISOString(),
          app_version: appVersion,
          device_label: deviceLabel,
        })
        .eq("id", device.id)

      return json({
        ok: true,
        license: {
          status: "active",
          expiresAt: license.expires_at,
          maxDevices: license.max_devices,
          last4: license.license_key_last4,
        },
        serverTime: now.toISOString(),
      })
    }

    return json({ error: "Ação não reconhecida." }, 400)
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : "Erro interno.",
    }, 500)
  }
})
