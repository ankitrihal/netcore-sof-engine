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
| Admins: `ankitrihal@gmail.com`, `ankit.rihal@netcore.ai` | See and edit **every** SOF (master history); switch freely between Indonesia and Philippines |
| Philippines Account Executives: `don.gonzales`, `yuvraj.bhattee` (`@netcore.ai`) | Their **own** SOFs only; locked to Philippines (12% VAT, `SOF_Template_PH.docx`, Netcore Cloud Pte Ltd) |
| Indonesia Account Executives: `mohd.pakzad`, `prathamesh.borkar` (`@netcore.ai`) | Their **own** SOFs only; locked to Indonesia (11% VAT, `SOF_Template_ID.docx`, PT Tera Achiever) |
| Any other `@netcore.ai` account | Can sign in, but only sees a **Request Access** screen; no data |
| Anyone else, or signed-out visitors | Nothing ("Unauthorized: Only Netcore accounts are allowed.") |

**Already ran the first version of `schema.sql`?** Run `supabase/migrations/002_approved_users.sql` instead
(or simply re-run the current `schema.sql`; both end in the same state).

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

It lets in admins and any `@netcore.ai` account (unapproved ones need to reach the Request Access screen) and rejects everything else. Without it, an outside Google account can still create a user record in Supabase. It can't read or save anything, and the app signs it straight out, but the hook stops it at the door and keeps your user list clean.

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

- Sign in as an approved Account Executive → the dashboard opens. **Save SOF**, then **SOF History** shows only their SOFs.
- Sign in as `ankit.rihal@netcore.ai` or `ankitrihal@gmail.com` → an **Admin** badge, and SOF History lists everyone's SOFs with a **Created by** column.
- Sign in with a `@netcore.ai` account that isn't approved → the **Request Access** screen. Clicking **Request Access**
  opens an email to `ankit.rihal@netcore.ai` titled "SOF Engine Access Request - their email".
- Sign in with any other Google account → "Unauthorized: Only Netcore accounts are allowed."

## Approving an Account Executive (or changing admins)

When an access request email arrives, edit **both** places so the app and the database agree:

1. `src/lib/access.ts`: add the email to `AE_EMAILS` **and** to their country in `COUNTRY_TEAMS` (or to `ADMIN_EMAILS`).
2. `supabase/schema.sql`: add the same email inside `is_approved_email()` (admins also go in `is_admin()`),
   then re-run the file in the Supabase SQL Editor.
3. Restart or redeploy the app. Then tell the person; they just sign in again.

Until both are updated, the person stays on the Request Access screen and the database gives them no data.

## Going live later (e.g. Vercel or Netlify)

1. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as environment variables in the hosting dashboard.
2. Add the live URL in Google Cloud (Authorized JavaScript origins) and Supabase (Site URL and Redirect URLs, as `https://your-site/**`).
