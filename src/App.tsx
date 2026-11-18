/**
 * src/App.tsx: SOF Engine web app.
 *
 *   AuthGate        → Google sign-in, Netcore accounts only
 *   SofDashboard    → pricing form, live SOF preview, Save / Update / Export
 *   SofHistory      → saved SOFs (own for users, everyone's for admins); click to open
 */
import { useCallback, useRef, useState } from 'react';
import AuthGate, { type AppUser } from './components/AuthGate';
import SofDashboard, { INITIAL, type FormState, type SofExportData } from './components/SofDashboard';
import SofHistory from './components/SofHistory';
import { getNetcoreSignatory } from './lib/access';
import { exportSOF } from './lib/exportSOF';
import { createSof, getSof, updateSof, type SavedSof } from './lib/sofStore';

export default function App() {
  return <AuthGate>{(user) => <Workspace user={user} />}</AuthGate>;
}

type Toast = { kind: 'busy' | 'ok' | 'error'; msg: string } | null;

function Workspace({ user }: { user: AppUser }) {
  const [toast, setToast] = useState<Toast>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [active, setActive] = useState<SavedSof | null>(null); // saved SOF open in the dashboard
  const [loadRequest, setLoadRequest] = useState<{ key: number; data: unknown } | undefined>(undefined);

  const flash = (t: Toast, ms = 3000) => {
    setToast(t);
    if (t && t.kind !== 'busy') window.setTimeout(() => setToast((cur) => (cur === t ? null : cur)), ms);
  };

  /** Save the open SOF (update) or a new one (insert); returns the saved record. */
  const persist = async (form: FormState, clientName: string) => {
    const saved = active ? await updateSof(active.id, clientName, form) : await createSof(clientName, form);
    setActive(saved);
    setHistoryRefresh((n) => n + 1);
    return saved;
  };

  // ---- Export: save to SOF History first (automatic), then download ----
  const exportingRef = useRef(false);
  const handleExport = async (data: SofExportData) => {
    if (exportingRef.current) return; // ignore double-clicks
    exportingRef.current = true;
    let saveError: string | null = null;
    try {
      if (data.form) {
        flash({ kind: 'busy', msg: 'Saving to SOF History…' });
        try {
          await persist(data.form, data.client.clientName);
        } catch (err) {
          // Never lose the export because the save failed; say so after the download
          saveError = err instanceof Error ? err.message : 'unknown error';
          console.error('Auto-save before export failed', err);
        }
      }
      flash({ kind: 'busy', msg: 'Generating Sales Order Form…' });
      // Signature block: the signed-in user creating this SOF.
      await exportSOF({ ...data, signatory: getNetcoreSignatory(user.email) });
      if (saveError) flash({ kind: 'error', msg: `Exported, but not saved to SOF History: ${saveError}` }, 8000);
      else flash({ kind: 'ok', msg: data.form ? `Saved "${data.client.clientName}" and exported` : 'Exported' });
    } catch (err) {
      console.error('SOF export failed', err);
      flash({ kind: 'error', msg: `Export failed: ${err instanceof Error ? err.message : 'unknown error'}` }, 6000);
    } finally {
      exportingRef.current = false;
    }
  };

  // ---- Save new / update open SOF ----
  const handleSave = async (form: FormState, clientName: string) => {
    try {
      const saved = await persist(form, clientName);
      flash({ kind: 'ok', msg: active ? `Updated "${saved.client_name}"` : `Saved "${saved.client_name}" to SOF History` });
    } catch (err) {
      flash({ kind: 'error', msg: err instanceof Error ? err.message : 'Save failed' }, 6000);
    }
  };

  // ---- Open a saved SOF from History ----
  const openSof = useCallback(async (id: string) => {
    flash({ kind: 'busy', msg: 'Opening SOF…' });
    try {
      const sof = await getSof(id);
      setActive(sof);
      setLoadRequest({ key: Date.now(), data: sof.form_data });
      setHistoryOpen(false);
      flash({ kind: 'ok', msg: `Opened "${sof.client_name}"` });
    } catch (err) {
      flash({ kind: 'error', msg: err instanceof Error ? err.message : 'Could not open SOF' }, 6000);
    }
  }, []);

  // ---- Start a fresh SOF ----
  const newSof = () => {
    setActive(null);
    setLoadRequest({ key: Date.now(), data: INITIAL });
    flash({ kind: 'ok', msg: 'Started a new SOF' });
  };

  const headerRight = (
    <>
      <button
        type="button"
        onClick={() => setHistoryOpen(true)}
        className="sof-history-btn inline-flex items-center gap-2 rounded-md border border-slate-600 px-3 py-1.5 text-sm font-medium text-slate-100 transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-400"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-13a.75.75 0 00-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 000-1.5h-3.25V5z" clipRule="evenodd" />
        </svg>
        SOF History
      </button>
      <div className="flex items-center gap-2 border-l border-slate-700 pl-3">
        {user.avatarUrl ? (
          <img src={user.avatarUrl} alt="" className="h-7 w-7 rounded-full" referrerPolicy="no-referrer" />
        ) : (
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-700 text-xs font-semibold text-white">
            {user.email.charAt(0).toUpperCase()}
          </span>
        )}
        <div className="hidden text-right sm:block">
          <p className="sof-user-email text-xs font-medium text-white">{user.email}</p>
          {user.isAdmin && <p className="sof-admin-badge text-[10px] font-semibold uppercase tracking-wide text-amber-300">Admin · ID + PH</p>}
          {user.countryLock && (
            <p className="sof-team-badge text-[10px] font-semibold uppercase tracking-wide text-sky-300">
              {user.countryLock === 'PH' ? 'Philippines' : 'Indonesia'} team
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void user.signOut()}
          className="sof-signout ml-1 rounded-md px-2 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-slate-800 hover:text-white"
        >
          Sign out
        </button>
      </div>
    </>
  );

  return (
    <>
      {toast && (
        <div
          role="status"
          className={`sof-toast fixed left-1/2 top-4 z-50 flex -translate-x-1/2 items-center gap-3 rounded-md px-4 py-2.5 text-sm font-medium shadow-lg ring-1 ${
            toast.kind === 'error'
              ? 'bg-red-50 text-red-800 ring-red-200'
              : toast.kind === 'ok'
                ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
                : 'bg-blue-50 text-blue-800 ring-blue-200'
          }`}
        >
          {toast.msg}
          {toast.kind === 'error' && (
            <button type="button" onClick={() => setToast(null)} className="font-semibold underline-offset-2 hover:underline">
              Dismiss
            </button>
          )}
        </div>
      )}
      <SofDashboard
        onExport={handleExport}
        onSave={handleSave}
        loadRequest={loadRequest}
        editing={
          active
            ? {
                clientName: active.client_name,
                updatedAt: active.updated_at,
                ownerEmail: active.user_email !== user.email ? active.user_email : undefined,
              }
            : null
        }
        onNew={newSof}
        headerRight={headerRight}
        countryLock={user.countryLock}
      />
      <SofHistory
        user={user}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onOpenSof={openSof}
        activeId={active?.id ?? null}
        refreshKey={historyRefresh}
        onDeleted={(sof) => {
          if (active?.id === sof.id) {
            // Keep the form on screen as an unsaved SOF so nothing is lost by surprise.
            setActive(null);
            flash({ kind: 'ok', msg: `Deleted "${sof.client_name}". It's still in the dashboard as an unsaved SOF.` }, 6000);
          } else {
            flash({ kind: 'ok', msg: `Deleted "${sof.client_name}"` });
          }
        }}
      />
    </>
  );
}
