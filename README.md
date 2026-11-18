# Netcore SOF Engine

Pricing calculator + Sales Order Form dashboard that exports a filled Word SOF.
Sign-in (Google, Netcore accounts only) and saved SOF history run on Supabase.

## Run it

**First time:** follow [SUPABASE_SETUP.md](SUPABASE_SETUP.md) to create the database and Google sign-in,
and put your keys in `.env.local`. Then:

```bash
npm install     # first time only
npm run dev     # opens http://localhost:5173
```

Sign in, fill in the client details and fees on the left, then:
- **Save SOF** stores it in your SOF History (it changes to **Update SOF** once saved)
- **Export SOF** downloads the filled Word file
- **SOF History** (top bar) lists your saved SOFs; admins see everyone's. Click one to open and edit it.

## Where things are

| File | What it does |
| --- | --- |
| `src/App.tsx` | Main page: sign-in gate, dashboard, SOF History, save / open / export |
| `src/components/AuthGate.tsx` | Google sign-in; only @netcore.ai and ankitrihal@gmail.com get in |
| `src/components/SofHistory.tsx` | SOF History panel (own SOFs, or all SOFs for admins) |
| `src/lib/access.ts` | Admins, Account Executives and their country teams (ID/PH lock) |
| `src/lib/sofStore.ts` | Save, update, list and open SOFs in Supabase |
| `src/lib/supabaseClient.ts` | Supabase connection (reads `.env.local`) |
| `supabase/schema.sql` | Database table, security rules and sign-up hook (run once in Supabase) |
| `src/components/SofDashboard.tsx` | The dashboard UI and live SOF preview |
| `src/lib/pricingCalculator.ts` | All pricing math (from the CE-MTU and NETCORE PRICING sheets) |
| `src/lib/exportSOF.js` | Picks the Indonesia or Philippines template by country, fills it and downloads it |
| `public/SOF_Template_ID.docx` | Indonesia Word template (11% VAT, PT Tera Achiever, local transfer) |
| `public/SOF_Template_PH.docx` | Philippines Word template (12% VAT, Netcore Cloud Pte Ltd, Singapore bank details, wire transfer, 30-day terms) |
| `templates/originals/` | Your untagged originals of both templates, for reference |
| `scripts/migrate-calculatePricing.mjs` | One-off migration script for old `calculatePricing` calls |

## Editing the Word template

Open `public/SOF_Template_ID.docx` or `public/SOF_Template_PH.docx` in Word and type tags in curly braces where values should go,
e.g. `{clientName}`. The full list of tags is at the top of `src/lib/exportSOF.js`.
Money tags have no `$`, so keep the `$` in the template: `${platformFeeMonthly}`.

## Other commands

```bash
npm run build       # type-check + production build into dist/
npm run typecheck   # type-check only
```
