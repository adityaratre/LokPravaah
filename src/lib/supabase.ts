import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isSupabaseConfigured = Boolean(url && anonKey)
// Explicit settings prevent auth storage behaviour from changing if client defaults evolve.
// Browser localStorage lets the Supabase session survive refresh; secrets are never stored here.
export const supabase = isSupabaseConfigured ? createClient(url!, anonKey!, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
  },
}) : null
