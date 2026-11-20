/**
 * AuthGate.tsx: Google sign-in for Netcore accounts.
 *
 *   Any verified @netcore.ai account (and the admins) → the app, automatically
 *   An unverified email                               → signed out with a "not verified" message
 *   Anyone else                                       → signed out: "Unauthorized: Only Netcore accounts are allowed."
 * The database enforces the same rules (supabase/schema.sql), so this screen is not the only lock.
 *
 *   <AuthGate>{(user) => <App user={user} />}</AuthGate>
 */
import React, { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, supabaseConfigured } from '../lib/supabaseClient';
import { getAccessLevel, UNAUTHORIZED_MESSAGE, UNVERIFIED_MESSAGE } from '../lib/access';

export interface AppUser {
  email: string;
  name: string;
  avatarUrl?: string;
  isAdmin: boolean;
  signOut: () => Promise<void>;
}

/** Email verified by the identity provider (Google sets this for every Workspace/Gmail address). */
function isEmailVerified(s: Session): boolean {
  const u = s.user as Session['user'] & { email_confirmed_at?: string | null; confirmed_at?: string | null };
  return Boolean(u.email_confirmed_at || u.confirmed_at || u.user_metadata?.email_verified === true);
}

/** Why this session may not use the app, or null if it may. */
function refusal(s: Session): string | null {
  if (getAccessLevel(s.user.email) === 'denied') return UNAUTHORIZED_MESSAGE;
  if (!isEmailVerified(s)) return UNVERIFIED_MESSAGE;
  return null;
}

/** Error passed back in the URL after a refused Google sign-in (e.g. by the sign-up hook). */
function readAuthErrorFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const desc = params.get('error_description') ?? hash.get('error_description');
  const code = params.get('error') ?? hash.get('error');
  if (!desc && !code) return null;
  window.history.replaceState(null, '', window.location.pathname); // clean the address bar
  const text = (desc ?? code ?? '').replace(/\+/g, ' ');
  return /unauthori[sz]ed|not allowed|access_denied|netcore/i.test(text) ? UNAUTHORIZED_MESSAGE : `Sign-in failed: ${text}`;
}

export default function AuthGate({ children }: { children: (user: AppUser) => React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(() => readAuthErrorFromUrl());
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setChecking(false);
      return;
    }
    const sb = supabase;

    /** Keep the session for admins and verified Netcore accounts; sign anyone else out with the reason. */
    const apply = async (s: Session | null) => {
      const reason = s ? refusal(s) : null;
      if (s && reason) {
        setSession(null);
        setError(reason);
        await sb.auth.signOut();
      } else {
        setSession(s);
      }
      setChecking(false);
    };

    sb.auth.getSession().then(({ data }) => apply(data.session));
    const { data: sub } = sb.auth.onAuthStateChange((_event, s) => {
      void apply(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signIn = async () => {
    if (!supabase) return;
    setError(null);
    setSigningIn(true);
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + window.location.pathname,
        queryParams: { prompt: 'select_account' }, // always let the user pick which Google account
      },
    });
    if (err) {
      setError(`Sign-in failed: ${err.message}`);
      setSigningIn(false);
    }
  };

  if (!supabaseConfigured) return <SetupScreen />;
  if (checking) {
    return (
      <Screen>
        <p className="text-sm text-slate-500">Checking your session…</p>
      </Screen>
    );
  }

  if (!session) {
    return (
      <Screen>
        <h1 className="text-lg font-semibold text-slate-900">Sign in to SOF Engine</h1>
        <p className="mt-1 text-sm text-slate-500">Use your Netcore Google account.</p>
        {error && (
          <div role="alert" className="sof-auth-error mt-5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {error}
          </div>
        )}
        <button
          type="button"
          onClick={signIn}
          disabled={signingIn}
          className="sof-google-btn mt-6 inline-flex w-full items-center justify-center gap-3 rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500/60 disabled:opacity-60"
        >
          <GoogleIcon />
          {signingIn ? 'Redirecting to Google…' : 'Sign in with Google'}
        </button>
      </Screen>
    );
  }

  const meta = session.user.user_metadata ?? {};
  const email = (session.user.email ?? '').toLowerCase();
  const name = (meta.full_name as string) || (meta.name as string) || email;
  const signOut = async () => {
    await supabase!.auth.signOut();
  };
  const level = getAccessLevel(email); // 'admin' or 'member' here: refused sessions were signed out above

  const user: AppUser = {
    email,
    name,
    avatarUrl: (meta.avatar_url as string) || (meta.picture as string) || undefined,
    isAdmin: level === 'admin',
    signOut,
  };
  return <>{children(user)}</>;
}

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 font-sans antialiased">
      <div className="w-full max-w-sm overflow-hidden rounded-lg bg-white shadow-md ring-1 ring-slate-900/5">
        <div className="flex items-center gap-3 bg-slate-800 px-6 py-4">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-600 text-sm font-bold text-white">S</span>
          <div>
            <p className="text-sm font-semibold text-white">SOF Engine</p>
            <p className="text-xs text-slate-300">Netcore Sales Order Form builder</p>
          </div>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

function SetupScreen() {
  return (
    <Screen>
      <h1 className="text-base font-semibold text-slate-900">Supabase isn't connected yet</h1>
      <p className="mt-2 text-sm text-slate-600">
        Create a file called <code className="rounded bg-slate-100 px-1">.env.local</code> in the project folder with:
      </p>
      <pre className="mt-3 overflow-x-auto rounded-md bg-slate-900 p-3 text-xs text-slate-100">
        {'VITE_SUPABASE_URL=https://<project>.supabase.co\nVITE_SUPABASE_ANON_KEY=<anon key>'}
      </pre>
      <p className="mt-3 text-sm text-slate-600">Then restart <code className="rounded bg-slate-100 px-1">npm run dev</code>.</p>
    </Screen>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
