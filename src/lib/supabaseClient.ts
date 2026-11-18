/**
 * supabaseClient.ts: the app's single Supabase client.
 *
 * Set these in a file called .env.local in the project folder (see .env.example):
 *   VITE_SUPABASE_URL=https://<your-project>.supabase.co
 *   VITE_SUPABASE_ANON_KEY=<anon / publishable key>
 *
 * Only ever use the public anon (publishable) key here. Row Level Security in
 * supabase/schema.sql decides what each user can read and write.
 * Never put the service_role (secret) key in front-end code.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** False until .env.local has both values; the app shows setup instructions instead of crashing. */
export const supabaseConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(url!, anonKey!, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  : null;
