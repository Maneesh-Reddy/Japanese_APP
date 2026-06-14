// Vercel Serverless Function — multi-provider LLM router.
// Runs on the server. Accepts keys + provider order from the request and tries
// each provider in turn, falling back to the next when one is rate-limited or
// out of quota.
//
// Request body:
//   { messages, system, max_tokens, providers: [{ name, key, model? }, ...] }
// Response:
//   { text, used }              on success (used = which provider answered)
//   { error, triedAll: true }   when every provider failed
//
// Supported provider names: "claude", "gemini", "groq".

const DEFAULT_MODELS = {
  claude: "claude-sonnet-4-6",
  gemini: "gemini-2.5-flash",
  groq: "llama-3.3-70b-versatile",
};

// Errors that mean "this provider is exhausted/over quota" — trigger fallback.
function isQuotaError(status, msg = "") {
  const m = msg.toLowerCase();
  return (
    status === 429 ||
    status === 402 ||
    m.includes("quota") ||
    m.includes("rate limit") ||
    m.includes("credit balance") ||
    m.includes("insufficient") ||
    m.includes("billing")
  );
}

async function callClaude({ key, model, messages, system, max_tokens }) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: model || DEFAULT_MODELS.claude, max_tokens: max_tokens || 1024, system, messages }),
  });
  const data = await r.json();
  if (!r.ok) return { ok: false, status: r.status, error: data.error?.message || "Claude error" };
  const text = (data.content || []).map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  return { ok: true, text };
}

async function callGemini({ key, model, messages, system, max_tokens, json }) {
  const contents = (messages || []).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }],
  }));
  const generationConfig = { maxOutputTokens: max_tokens || 1024, temperature: 0.7 };
  if (json) generationConfig.responseMimeType = "application/json";
  const body = { contents, generationConfig };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model || DEFAULT_MODELS.gemini}:generateContent?key=${key}`;
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await r.json();
  if (!r.ok) return { ok: false, status: r.status, error: data.error?.message || "Gemini error" };
  const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
  if (!text) return { ok: false, status: 500, error: "Empty response (possibly blocked)" };
  return { ok: true, text };
}

async function callGroq({ key, model, messages, system, max_tokens, json }) {
  // Groq is OpenAI-compatible. System prompt goes in as a system message.
  const msgs = [];
  if (system) msgs.push({ role: "system", content: system });
  for (const m of messages || []) {
    msgs.push({ role: m.role === "assistant" ? "assistant" : "user", content: typeof m.content === "string" ? m.content : JSON.stringify(m.content) });
  }
  const payload = { model: model || DEFAULT_MODELS.groq, messages: msgs, max_tokens: max_tokens || 1024, temperature: 0.7 };
  if (json) payload.response_format = { type: "json_object" };
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(payload),
  });
  const data = await r.json();
  if (!r.ok) return { ok: false, status: r.status, error: data.error?.message || "Groq error" };
  const text = (data.choices?.[0]?.message?.content || "").trim();
  return { ok: true, text };
}

const CALLERS = { claude: callClaude, gemini: callGemini, groq: callGroq };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { messages, system, max_tokens, providers, json } = req.body;

    // Build the provider list. If the client sent saved keys, use those in order.
    // Otherwise fall back to server env vars (legacy single-key setup).
    let list = Array.isArray(providers) ? providers.filter((p) => p && p.key && CALLERS[p.name]) : [];
    if (list.length === 0) {
      if (process.env.GEMINI_API_KEY) list.push({ name: "gemini", key: process.env.GEMINI_API_KEY });
      if (process.env.ANTHROPIC_API_KEY) list.push({ name: "claude", key: process.env.ANTHROPIC_API_KEY });
      if (process.env.GROQ_API_KEY) list.push({ name: "groq", key: process.env.GROQ_API_KEY });
    }
    if (list.length === 0) {
      return res.status(400).json({ error: "No API keys configured. Open Settings and add at least one key." });
    }

    const errors = [];
    for (const p of list) {
      const out = await CALLERS[p.name]({ key: p.key, model: p.model, messages, system, max_tokens, json });
      if (out.ok && out.text) {
        return res.status(200).json({ text: out.text, used: p.name });
      }
      errors.push(`${p.name}: ${out.error}`);
      // Only continue to the next provider on quota/rate errors. For other
      // errors (bad key, bad request) also continue, since a fallback may work.
      // (We try the rest regardless, then report all failures.)
    }

    // Everything failed.
    const lastWasQuota = errors.some((e) => isQuotaError(0, e));
    return res.status(429).json({
      error: lastWasQuota
        ? "All providers are out of free quota right now. Add another key in Settings or try later."
        : "All providers failed: " + errors.join(" | "),
      triedAll: true,
      details: errors,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
