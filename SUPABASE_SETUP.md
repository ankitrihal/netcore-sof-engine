# SOF Engine: Supabase setup

About 20 minutes, one time. You need admin access to a Google Cloud project and a Supabase account.

## 1. Create the Supabase project

1. Go to <https://supabase.com/dashboard> → **New project**.
2. Name it (e.g. `sof-engine`), set a database password, and pick the **Southeast Asia (Singapore)** region.
3. When it's ready, open **Project Settings → API** (or **API Keys**) and keep this tab open. You'll need the **Project URL** and the **anon / publishable** key.

## 2. Create the database table and security rules

1. In Supabase, open **SQL Editor → New query**.
2. Paste the whole of `supabase/schema.sql` from this project and click **Run**. It's safe to run again later.

This creates the `saved_sofs` table and these rules, enforced by the database itself:

| Who | What they get |
| --- | --- |
| Admins: `ankitrihal@gmail.com`, `ankit.rihal@netcore.ai` | See, edit and delete **every** SOF (master history); switch freely between Indonesia and Philippines |
| **Any verified `@netcore.ai` account** | Gets in automatically (no list to maintain); their **own** SOFs only; can choose Indonesia or Philippines |
| Philippines team: `don.gonzales`, `yuvraj.bhattee` (`@netcore.ai`) | As above, but locked to Philippines (12% VAT, `SOF_Template_PH.docx`, Netcore Cloud Pte Ltd) |
| Indonesia team: `mohd.pakzad`, `prathamesh.borkar` (`@netcore.ai`) | As above, but locked to Indonesia (11% VAT, `SOF_Template_ID.docx`, PT Tera Achiever) |
| A `@netcore.ai` address whose email isn't verified | Nothing ("…your Netcore email address is not verified…") |
| Anyone else, or signed-out visitors | Nothing ("Unauthorized: Only Netcore accounts are allowed.") |

**Already set up with an older `schema.sql`?** Run `supabase/migrations/003_netcore_domain_access.sql` once
in the SQL Editor (or simply re-run the current `schema.sql`; both end in the same state).

## 3. Create the Google sign-in credentials

1. Go to <https://console.cloud.google.com> and pick (or create) a project.
2. **APIs & Services → OAuth consent screen**
   - User type: **External**. Don't choose "Internal": it only allows `netcore.ai` Workspace accounts, which would lock out `ankitrihal@gmail.com`. The app itself restricts who gets in.
   - Fill in the app name (SOF Engine), support email and developer email. Scopes: the defaults (`email`, `profile`, `openid`) are enough.
   - Publish the app, or, while testing, add each user under **Test users**.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Application type: **Web application**
   - **Authorized JavaScript origins:** `http://localhost:5173` (add your live URL later)
   - **Authorized redirect URIs:** `https://<your-project-ref>.supabase.co/auth/v1/callback`
     (Supabase shows this exact URL on its Google provider page; see step 4.)
4. Copy the **Client ID** and **Client secret**.

## 4. Turn on Google sign-in in Supabase

1. **Authentication → Sign In / Providers → Google** → enable it.
2. Paste the Client ID and Client secret → **Save**.
3. **Authentication → URL Configuration**
   - **Site URL:** `http://localhost:5173`
   - **Redirect URLs:** add `http://localhost:5173/**`

## 5. (Recommended) Block outside accounts from being created at all

**Authentication → Hooks → Before User Created** → **Postgres function** → choose `public.hook_restrict_signup` → enable.

It lets in admins and any `@netcore.ai` account and rejects everything else. Without it, an outside Google account can still create a user record in Supabase. It can't read or save anything, and the app signs it straight out, but the hook stops it at the door and keeps your user list clean.

## 6. Connect the app

1. In the project folder, copy `.env.example` to a new file called `.env.local`.
2. Fill in the two values from step 1:
   ```
   VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon / publishable key>
   ```
   `.env.local` is git-ignored. Never use the `service_role` / secret key here.
3. Run:
   ```bash
   npm install
   npm run dev
   ```

## 7. Check it works

- Sign in with any `@netcore.ai` account → the dashboard opens. **Save SOF**, then **SOF History** shows only their SOFs.
- Sign in as `ankit.rihal@netcore.ai` or `ankitrihal@gmail.com` → an **Admin** badge, and SOF History lists everyone's SOFs with a **Created by** column.
- Sign in with any other Google account → "Unauthorized: Only Netcore accounts are allowed."

## New team members, country locks and admins

- **New Netcore colleague:** nothing to do. They sign in with their `@netcore.ai` Google account and get in.
- **Lock someone to a country:** add their email to `COUNTRY_TEAMS` in `src/lib/access.ts` (and to `NETCORE_SIGNATORIES`
  for their name and title on the SOF signature block), then redeploy.
- **Change admins:** edit `ADMIN_EMAILS` in `src/lib/access.ts` **and** `is_admin_email()` + `is_admin()` in
  `supabase/schema.sql`, re-run the file in the Supabase SQL Editor, and redeploy.

## Going live later (e.g. Vercel or Netlify)

1. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as environment variables in the hosting dashboard.
2. Add the live URL in Google Cloud (Authorized JavaScript origins) and Supabase (Site URL and Redirect URLs, as `https://your-site/**`).
