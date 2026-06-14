# 日本語 Tutor — Deploy Guide

A Japanese learning app with six tabs — Chat, Alphabet, Vocab, Dictionary,
Translate, and Settings. Includes a speaking tutor that corrects your grammar,
a saved-words list, a searchable Japanese dictionary (free Jisho API), a streak
calendar, and a mistake tracker. Each person signs in with email + password, and
their progress syncs across every device. Multiple people can each have their own
account on the same deployment.

Stack: Vite + React · Supabase (free) · Vercel (free) · Claude API.

---

## What you'll set up
1. **Supabase** — free database for saved chats + progress (syncs across devices).
2. **Anthropic API key** — powers the tutor, deck generator, and translator.
3. **Vercel** — free hosting; gives you a public URL.

Total time: ~15 minutes.

---

## Step 1 — Supabase (saves your chats)

> **Upgrading from an earlier version?** This release adds columns for the
> mistake tracker, streak calendar, saved-word details, and chat renaming. Just
> re-run `supabase_schema.sql` (Step 1, point 3) — it recreates the tables with
> the new structure. It clears existing app data, which is expected.


1. Go to supabase.com → create a free project (pick any name + password).
2. Left sidebar → **SQL Editor** → **New query**.
3. Open `supabase_schema.sql` from this project, paste it all in, click **Run**.
4. Left sidebar → **Project Settings → API**. Copy two values:
   - **Project URL** → this is `VITE_SUPABASE_URL`
   - **anon public** key → this is `VITE_SUPABASE_ANON_KEY`

5. **Enable email login.** Left sidebar → **Authentication → Sign In / Providers**
   → make sure **Email** is enabled. For the easiest start, scroll to **Email**
   settings and turn **OFF** "Confirm email" so accounts work immediately without
   a verification step. (Leave it on if you prefer verified emails — users will
   just need to click a link before signing in.)

Keep the URL + anon key handy for Step 3.

---

## Step 2 — API keys (the tutor's brain)

The app supports **three providers** and you add keys in the app's **Settings**
tab — no need to set an API key in Vercel anymore. It uses them top-to-bottom and
falls back automatically when one runs out of free quota.

| Provider | Cost | Get a key |
|----------|------|-----------|
| **Google Gemini** | Free (no card) | https://aistudio.google.com/apikey |
| **Groq (Llama)** | Free (no card) | https://console.groq.com |
| **Anthropic Claude** | Paid | https://console.anthropic.com |

Recommended: add **both free keys** (Gemini + Groq). If Gemini hits its daily
limit, the app silently switches to Groq, so you rarely get blocked. Add Claude
too if you want the highest-quality tutor and don't mind paying.

You set the keys and their fallback order inside the app after deploying — see
Step 4. They're saved to your synced profile, so they're there on every device.

> Optional: you can still set `GEMINI_API_KEY`, `GROQ_API_KEY`, or
> `ANTHROPIC_API_KEY` as Vercel env vars to act as a server-side default if no
> in-app keys are present. Not required.

---

## Step 3 — Deploy to Vercel

### Option A — through GitHub (recommended)
1. Push this folder to a new GitHub repo.
2. Go to vercel.com → **Add New → Project** → import the repo.
3. Framework preset: **Vite** (auto-detected). Leave build settings default.
4. Before deploying, open **Environment Variables** and add the two Supabase values:

   | Name | Value |
   |------|-------|
   | `VITE_SUPABASE_URL` | your Project URL |
   | `VITE_SUPABASE_ANON_KEY` | your anon public key |

   (API keys for the tutor are added later, inside the app's Settings tab.)

5. Click **Deploy**. You'll get a URL like `https://jp-tutor.vercel.app`.

### Option B — Vercel CLI
```bash
npm i -g vercel
vercel            # follow prompts
vercel env add VITE_SUPABASE_URL
vercel env add VITE_SUPABASE_ANON_KEY
vercel env add GEMINI_API_KEY
vercel --prod
```

---

## Step 4 — Add your API keys in the app

Open your deployed URL. Go to the **設定 / Settings** tab (last one in the bottom
bar) and paste in at least one API key from Step 2 — ideally both free ones
(Gemini and Groq). Drag the order with the ▲▼ arrows so your preferred provider
is first, then tap **Save keys**.

That's it — head to the **Chat** tab and start talking. If your first provider
runs out of free quota, the app automatically uses the next one with a key.

## Step 5 — Use it on phone / tablet / laptop

Open the Vercel URL on any device and **sign in with the same email and
password** — your streak, learned words, saved chats, and API keys all sync,
because they're tied to your account, not the device. To make it feel like a
real app:

- **iPhone/iPad (Safari):** Share → **Add to Home Screen**.
- **Android (Chrome):** ⋮ menu → **Add to Home screen** / **Install app**.
- **Laptop (Chrome/Edge):** install icon in the address bar.

Your streak, learned words, and saved chats sync because they live in Supabase —
open the app anywhere and your **Past conversations** list is there to resume.

> **Note:** progress is tied to your account (email login), so the same data
> follows you on every device you sign in on. Each account's rows are protected
> by row-level security, so people can't see each other's data.

---

## Run locally (optional)

```bash
npm install
cp .env.example .env      # fill in your three values
npm run dev               # opens http://localhost:5173
```

The `/api/claude` route only runs on Vercel. For full local testing of the
tutor, use `vercel dev` instead of `npm run dev`.

---

## A note on accounts & API keys

Each person signs up with their own email + password. Row-level security ensures
one account can never read another's chats, progress, or keys.

API keys saved in Settings are stored in that user's own profile row. They're sent
from the browser to the chosen provider when chatting — standard for a personal
app. Two practical implications:
- Anyone who can use a logged-in session can view that account's keys (they're
  masked with a Show toggle, but present). Don't stay logged in on shared devices.
- Each user supplies their own keys, so one person's free quota doesn't affect
  another's.

If you later want keys hidden even from the account owner, move them to encrypted
server-side storage — out of scope for a personal/portfolio build.

## Heads-up on the microphone

Speech recognition (the 🎙 button) works in **Chrome and Edge**. Safari/Firefox
support is limited. Text input works everywhere. Mic needs HTTPS — Vercel URLs
are HTTPS by default, so it works on your phone.

---

## Files

```
jp-tutor/
├── api/claude.js            # LLM proxy (multi-provider with fallback)
├── api/dictionary.js        # free Jisho dictionary proxy
├── src/
│   ├── App.jsx              # the whole app (4 tabs)
│   ├── supabase.js          # db client + auth helpers
│   └── main.jsx
├── public/                  # icon + manifest (Add to Home Screen)
├── supabase_schema.sql      # paste into Supabase SQL editor
├── .env.example
└── package.json
```
