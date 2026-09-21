import { createClient } from '@supabase/supabase-js'

const fallbackUrl = 'https://xdixbbhquctxioznxdma.supabase.co'
const fallbackPublishableKey = 'sb_publishable__2UBUgQqikD_PG9PyVnOdQ_j_G18F8r'

const url =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined) ||
  fallbackUrl

const key =
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ||
  fallbackPublishableKey

export const supabaseConfigured = Boolean(url && key)

export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
