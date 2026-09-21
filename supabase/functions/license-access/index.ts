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

    if (action === "activate") {
      const licenseKey = normalizeKey(String(body.licenseKey ?? ""))
      if (!licenseKey.startsWith("ALTIV-")) {
        return json({ error: "Chave inválida." }, 400)
      }

      const licenseKeyHash = await sha256(licenseKey)

      const { data: license, error: licenseError } = await admin
        .from("licenses")
        .select("id, customer_id, plan_id, status, starts_at, expires_at, max_devices, license_key_last4")
        .eq("license_key_hash", licenseKeyHash)
        .maybeSingle()

      if (licenseError || !license) {
        return json({ error: "Chave inválida." }, 401)
      }

      if (license.status === "blocked") {
        return json({ error: "Licença bloqueada." }, 403)
      }

      if (license.status === "cancelled") {
        return json({ error: "Licença cancelada." }, 403)
      }

      const now = new Date()
      if (license.expires_at && new Date(license.expires_at) <= now) {
        return json({ error: "Licença vencida.", expiresAt: license.expires_at }, 403)
      }

      const { data: existingDevice } = await admin
        .from("devices")
        .select("id, is_active")
        .eq("license_id", license.id)
        .eq("device_fingerprint_hash", fingerprintHash)
        .maybeSingle()

      if (!existingDevice?.is_active) {
        const { count } = await admin
          .from("devices")
          .select("id", { count: "exact", head: true })
          .eq("license_id", license.id)
          .eq("is_active", true)

        if ((count ?? 0) >= license.max_devices) {
          return json({
            error: "Limite de dispositivos atingido.",
            maxDevices: license.max_devices,
          }, 409)
        }
      }

      const token = makeToken()
      const tokenHash = await sha256(token)
      const nowIso = now.toISOString()

      if (existingDevice) {
        const { error } = await admin
          .from("devices")
          .update({
            device_label: deviceLabel,
            app_version: appVersion,
            is_active: true,
            revoked_at: null,
            last_seen_at: nowIso,
            activation_token_hash: tokenHash,
            token_created_at: nowIso,
          })
          .eq("id", existingDevice.id)

        if (error) return json({ error: "Falha ao ativar dispositivo." }, 500)
      } else {
        const { error } = await admin
          .from("devices")
          .insert({
            license_id: license.id,
            device_fingerprint_hash: fingerprintHash,
            device_label: deviceLabel,
            app_version: appVersion,
            first_seen_at: nowIso,
            last_seen_at: nowIso,
            is_active: true,
            activation_token_hash: tokenHash,
            token_created_at: nowIso,
          })

        if (error) return json({ error: "Falha ao vincular dispositivo." }, 500)
      }

      await admin.from("license_events").insert({
        license_id: license.id,
        customer_id: license.customer_id,
        admin_user_id: null,
        event_type: existingDevice ? "device_reactivated" : "device_activated",
        metadata: {
          device_label: deviceLabel,
          app_version: appVersion,
        },
      })

      return json({
        ok: true,
        activationToken: token,
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
        return json({ error: "Ativação inválida." }, 401)
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
        return json({ error: "Ativação inválida." }, 401)
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
