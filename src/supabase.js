import { createClient } from "@supabase/supabase-js";

// These are safe to expose in the browser (anon key is public by design).
// Set them in Vercel as VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
const url = (import.meta.env.VITE_SUPABASE_URL || "").trim();
const anon = (import.meta.env.VITE_SUPABASE_ANON_KEY || "").trim();

function isValidHttpUrl(s) {
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

let client = null;
if (isValidHttpUrl(url) && anon) {
  client = createClient(url, anon);
} else if (url || anon) {
  // Something was set but it's wrong — surface it clearly instead of crashing.
  console.warn(
    "[jp-tutor] Supabase not initialised. Check your env vars in Vercel.\n" +
      "VITE_SUPABASE_URL should look like https://abcd1234.supabase.co (no quotes, no trailing slash).\n" +
      "Got URL:",
    JSON.stringify(url)
  );
}

export const supabase = client;

// ── Auth helpers (email + password) ────────────────────────────
export async function signUp(email, password) {
  if (!supabase) return { error: "Database not configured." };
  const { data, error } = await supabase.auth.signUp({ email, password });
  return { data, error: error?.message };
}
export async function signIn(email, password) {
  if (!supabase) return { error: "Database not configured." };
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  return { data, error: error?.message };
}
export async function signOut() {
  if (supabase) await supabase.auth.signOut();
}
export async function getSession() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}
// Subscribe to login/logout changes. Returns an unsubscribe function.
export function onAuthChange(cb) {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => cb(session));
  return () => data.subscription.unsubscribe();
}
