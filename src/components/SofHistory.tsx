/**
 * SofHistory.tsx: slide-over panel listing saved SOFs.
 *
 * Standard users see only their own SOFs. Admins see every SOF in the company,
 * with a "Created by" column and a switch to show only their own.
 * Clicking a row loads that SOF into the dashboard.
 * In the admin "All SOFs" view each row has a Delete button (asks for confirmation first).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { deleteSof, listSofs, type SavedSofSummary } from '../lib/sofStore';
import type { AppUser } from './AuthGate';

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function SofHistory({
  user,
  open,
  onClose,
  onOpenSof,
  activeId,
  refreshKey,
  onDeleted,
}: {
  user: AppUser;
  open: boolean;
  onClose: () => void;
  onOpenSof: (id: string) => void;
  activeId: string | null;
  /** Change this to reload the list (e.g. after a save). */
  refreshKey: number;
  /** Called after a SOF is deleted from the admin "All SOFs" view. */
  onDeleted?: (sof: SavedSofSummary) => void;
}) {
  const [rows, setRows] = useState<SavedSofSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState<'all' | 'mine'>('all'); // admins only
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // RLS already limits standard users to their own rows; this filter is for the admin's "Mine" view.
      setRows(await listSofs(user.isAdmin && scope === 'mine' ? user.email : undefined));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [user.isAdmin, user.email, scope]);

  useEffect(() => {
    if (open) void load();
  }, [open, load, refreshKey]);

  // Close with Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.client_name.toLowerCase().includes(q) || r.user_email.toLowerCase().includes(q));
  }, [rows, search]);

  const showOwner = user.isAdmin && scope === 'all';
  const canDelete = showOwner; // admin "All SOFs" view only

  const handleDelete = async (r: SavedSofSummary) => {
    if (deletingId) return;
    const ok = window.confirm(
      `Delete the SOF for "${r.client_name}" (created by ${r.user_email})?\n\nThis permanently removes it from SOF History and can't be undone.`,
    );
    if (!ok) return;
    setDeletingId(r.id);
    setDeleteError(null);
    try {
      await deleteSof(r.id);
      setRows((prev) => prev.filter((x) => x.id !== r.id));
      onDeleted?.(r);
      await load();
    } catch (e) {
      setDeleteError((e as Error).message);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className={open ? 'fixed inset-0 z-40' : 'pointer-events-none fixed inset-0 z-40'} aria-hidden={!open}>
      {/* backdrop */}
      <div
        className={`absolute inset-0 bg-slate-900/40 transition-opacity ${open ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />
      {/* panel */}
      <aside
        role="dialog"
        aria-label="SOF History"
        className={`sof-history absolute inset-y-0 right-0 flex w-full max-w-2xl flex-col bg-white shadow-2xl transition-transform duration-200 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <header className="flex items-center justify-between gap-4 bg-slate-800 px-6 py-4">
          <div>
            <h2 className="text-sm font-semibold tracking-wide text-white">SOF History</h2>
            <p className="mt-0.5 text-xs text-slate-300">
              {user.isAdmin ? (scope === 'all' ? 'All SOFs across Netcore (admin view)' : 'SOFs you created') : 'SOFs you created'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-slate-300 transition hover:bg-slate-700 hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
            aria-label="Close SOF History"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5" aria-hidden="true">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </header>

        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-6 py-4">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={showOwner ? 'Search client or creator…' : 'Search client…'}
            className="sof-history-search min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/60"
          />
          {user.isAdmin && (
            <div className="inline-flex rounded-md border border-slate-300 p-0.5 text-sm" role="group" aria-label="Which SOFs to show">
              {(['all', 'mine'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setScope(s)}
                  className={`rounded px-3 py-1.5 font-medium transition ${
                    scope === s ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {s === 'all' ? 'All SOFs' : 'My SOFs'}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
          >
            Refresh
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {deleteError && (
            <p className="sof-delete-error mx-6 mt-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">{deleteError}</p>
          )}
          {error ? (
            <p className="m-6 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">{error}</p>
          ) : loading && rows.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">
              {rows.length === 0 ? 'No saved SOFs yet. Use "Save SOF" on the dashboard to save one.' : 'No SOFs match your search.'}
            </p>
          ) : (
            <table className="sof-history-table w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-6 py-2.5">Client</th>
                  <th className="px-3 py-2.5">Country</th>
                  {showOwner && <th className="px-3 py-2.5">Created by</th>}
                  <th className="px-3 py-2.5">Last updated</th>
                  <th className="px-6 py-2.5">Created</th>
                  {canDelete && <th className="px-6 py-2.5"><span className="sr-only">Delete</span></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => onOpenSof(r.id)}
                    className={`cursor-pointer transition hover:bg-blue-50 ${r.id === activeId ? 'bg-blue-50/70' : ''}`}
                  >
                    <td className="px-6 py-3 font-medium text-slate-900">
                      {r.client_name}
                      {r.id === activeId && (
                        <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-blue-700">Open</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`sof-country-pill rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                          r.country === 'PH' ? 'bg-sky-50 text-sky-700 ring-1 ring-sky-200' : 'bg-orange-50 text-orange-700 ring-1 ring-orange-200'
                        }`}
                        title={r.country === 'PH' ? 'Philippines (12% VAT)' : 'Indonesia (11% VAT)'}
                      >
                        {r.country}
                      </span>
                    </td>
                    {showOwner && <td className="px-3 py-3 text-slate-600">{r.user_email}</td>}
                    <td className="whitespace-nowrap px-3 py-3 text-slate-600">{fmtDate(r.updated_at)}</td>
                    <td className="whitespace-nowrap px-6 py-3 text-slate-500">{fmtDate(r.created_at)}</td>
                    {canDelete && (
                      <td className="px-6 py-3 text-right">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation(); // don't open the SOF
                            void handleDelete(r);
                          }}
                          disabled={deletingId !== null}
                          className="sof-delete-btn rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-400 disabled:cursor-not-allowed disabled:opacity-50"
                          aria-label={`Delete SOF for ${r.client_name}`}
                        >
                          {deletingId === r.id ? 'Deleting…' : 'Delete'}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <footer className="border-t border-slate-200 px-6 py-3 text-xs text-slate-500">
          {filtered.length} of {rows.length} SOF{rows.length === 1 ? '' : 's'}. Click one to open it in the dashboard.
        </footer>
      </aside>
    </div>
  );
}
