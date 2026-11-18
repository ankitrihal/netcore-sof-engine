/**
 * sofStore.ts: read and write saved SOFs in the Supabase `saved_sofs` table.
 *
 * Row Level Security does the filtering: a standard user's list only ever contains
 * their own SOFs, and an admin's contains everyone's. user_email is set by the
 * database from the login, so the app never sends it.
 */
import { supabase } from './supabaseClient';
import { countryFromVat, type Country } from './access';

export interface SavedSofSummary {
  id: string;
  user_email: string;
  client_name: string;
  created_at: string;
  updated_at: string;
  /** From the saved form's Country / VAT field (12% → PH, otherwise ID). */
  country: Country;
}

export interface SavedSof extends SavedSofSummary {
  form_data: unknown;
}

const TABLE = 'saved_sofs';
// vat_rate is read straight out of the saved form JSON, so the list doesn't download every form
const SUMMARY_COLUMNS = 'id, user_email, client_name, created_at, updated_at, vat_rate:form_data->>vatRate';

type SummaryRow = Omit<SavedSofSummary, 'country'> & { vat_rate?: string | null; form_data?: { vatRate?: string } };

const withCountry = (row: unknown): SavedSof => {
  const r = row as Omit<SavedSof, 'country'>;
  return { ...r, country: countryFromVat((r.form_data as { vatRate?: string } | null)?.vatRate) };
};

function db() {
  if (!supabase) throw new Error('Supabase is not configured. Add your keys to .env.local.');
  return supabase;
}

function fail(action: string, error: { message: string; code?: string }): never {
  // PGRST116 = no row came back, which here means RLS hid or refused it
  if (error.code === 'PGRST116') throw new Error(`Couldn't ${action}: it doesn't exist or you don't have access to it.`);
  throw new Error(`Couldn't ${action}: ${error.message}`);
}

/** SOF History list, newest first. `onlyEmail` narrows an admin's list to one person. */
export async function listSofs(onlyEmail?: string): Promise<SavedSofSummary[]> {
  let q = db().from(TABLE).select(SUMMARY_COLUMNS).order('updated_at', { ascending: false });
  if (onlyEmail) q = q.eq('user_email', onlyEmail.toLowerCase());
  const { data, error } = await q;
  if (error) fail('load SOF history', error);
  return ((data ?? []) as unknown as SummaryRow[]).map(({ vat_rate, form_data, ...r }) => ({
    ...r,
    country: countryFromVat(vat_rate ?? form_data?.vatRate),
  }));
}

/** One SOF with its saved form state. */
export async function getSof(id: string): Promise<SavedSof> {
  const { data, error } = await db().from(TABLE).select('*').eq('id', id).single();
  if (error) fail('open this SOF', error);
  return withCountry(data);
}

/** Save a new SOF. */
export async function createSof(clientName: string, formData: unknown): Promise<SavedSof> {
  const { data, error } = await db()
    .from(TABLE)
    .insert({ client_name: clientName, form_data: formData })
    .select('*')
    .single();
  if (error) fail('save this SOF', error);
  return withCountry(data);
}

/** Overwrite an existing SOF (owner, or an admin). */
export async function updateSof(id: string, clientName: string, formData: unknown): Promise<SavedSof> {
  const { data, error } = await db()
    .from(TABLE)
    .update({ client_name: clientName, form_data: formData })
    .eq('id', id)
    .select('*')
    .single();
  if (error) fail('update this SOF', error);
  return withCountry(data);
}
