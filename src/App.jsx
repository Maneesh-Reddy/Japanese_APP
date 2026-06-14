import React, { useState, useEffect, useRef } from "react";
import { supabase, signUp, signIn, signOut, getSession, onAuthChange } from "./supabase.js";

// ─────────────────────────────────────────────────────────────
//  日本語 — Japanese Tutor (deployable build)
//  Palette: ai (indigo) / kinari (off-white) / shu (vermilion)
// ─────────────────────────────────────────────────────────────

const C = {
  ai: "#1a2740", aiSoft: "#2d3e5f", kinari: "#f4f0e6", paper: "#fbf9f3",
  shu: "#d4452f", shuSoft: "#e8654d", sumi: "#16181d", gold: "#c9a24b", mist: "#e3ddcd",
};
const FONT_DISPLAY = "'Hiragino Mincho ProN', 'Yu Mincho', 'Georgia', serif";
const FONT_BODY = "'Hiragino Sans', 'Yu Gothic', 'Helvetica Neue', sans-serif";

// The logged-in user's id. Set once auth resolves; used by db helpers below.
let USER_ID = null;
function setUserId(id) { USER_ID = id; }
const todayStr = () => new Date().toISOString().slice(0, 10);

// ── speech helpers ─────────────────────────────────────────────
// Browsers block speech until the user interacts with the page once.
// We "unlock" it on the first tap by speaking a silent utterance.
let speechUnlocked = false;
function unlockSpeech() {
  if (speechUnlocked || !window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance("");
  u.volume = 0;
  window.speechSynthesis.speak(u);
  speechUnlocked = true;
}
if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", unlockSpeech, { once: true });
  window.addEventListener("keydown", unlockSpeech, { once: true });
}

function speak(text, lang = "ja-JP", rate = 0.85) {
  if (!window.speechSynthesis) return;
  unlockSpeech();
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang; u.rate = rate;
  const voices = window.speechSynthesis.getVoices();
  const jp = voices.find((v) => v.lang === "ja-JP") || voices.find((v) => v.lang.startsWith("ja"));
  if (jp) u.voice = jp;
  window.speechSynthesis.speak(u);
}

// ── Provider settings (set by Settings tab, read by callClaude) ────
// Held at module scope so any component's callClaude picks up the current keys.
export const PROVIDERS = [
  { name: "gemini", label: "Google Gemini", free: true, hint: "Free · aistudio.google.com/apikey" },
  { name: "groq", label: "Groq (Llama)", free: true, hint: "Free · console.groq.com" },
  { name: "claude", label: "Anthropic Claude", free: false, hint: "Paid · console.anthropic.com" },
];
const defaultSettings = {
  keys: { gemini: "", groq: "", claude: "" },
  order: ["gemini", "groq", "claude"], // try in this order
};
let activeSettings = { ...defaultSettings };
export function setActiveSettings(s) { activeSettings = s; }

// Build the ordered [{name, key}] list of providers that actually have a key.
function buildProviderList() {
  return activeSettings.order
    .map((name) => ({ name, key: (activeSettings.keys[name] || "").trim() }))
    .filter((p) => p.key);
}

// ── LLM call via our serverless proxy (with provider fallback) ─────
async function callClaude(messages, system, maxTokens = 1024, json = false) {
  const providers = buildProviderList();
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, system, max_tokens: maxTokens, providers, json }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "API error");
  return data.text;
}
function parseJSON(text) {
  let t = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  // If the model added prose around the JSON, grab the first {...} or [...] block.
  try {
    return JSON.parse(t);
  } catch {
    const match = t.match(/[\{\[][\s\S]*[\}\]]/);
    if (match) return JSON.parse(match[0]);
    throw new Error("Could not parse model response as JSON");
  }
}

// ── profile (streak + learned) in Supabase ─────────────────────
async function loadProfile() {
  if (!supabase || !USER_ID) return null;
  const { data, error } = await supabase.from("profiles").select("*").eq("user_id", USER_ID).maybeSingle();
  if (error) { console.error("[jp-tutor] load profile failed:", error.message); return null; }
  return data;
}
async function saveProfile(profile) {
  if (!supabase || !USER_ID) return;
  const { error } = await supabase.from("profiles").upsert({ user_id: USER_ID, ...profile }, { onConflict: "user_id" });
  if (error) console.error("[jp-tutor] save profile failed:", error.message);
}

// ─────────────────────────────────────────────────────────────
//  Shared UI
// ─────────────────────────────────────────────────────────────
function SpeakBtn({ text, size = 34, lang = "ja-JP" }) {
  return (
    <button onClick={(e) => { e.stopPropagation(); speak(text, lang); }} title="Play sound" style={{
      width: size, height: size, borderRadius: "50%", border: "none", background: C.ai,
      color: C.kinari, cursor: "pointer", display: "inline-flex", alignItems: "center",
      justifyContent: "center", flexShrink: 0, fontSize: size * 0.45, lineHeight: 1,
    }}>▸</button>
  );
}
function Seal({ label }) {
  return (
    <div style={{
      width: 46, height: 46, borderRadius: 8, background: C.shu, color: C.paper, display: "flex",
      alignItems: "center", justifyContent: "center", fontFamily: FONT_DISPLAY, fontSize: 22,
      fontWeight: 700, boxShadow: "0 2px 0 rgba(0,0,0,.15)", flexShrink: 0, writingMode: "vertical-rl",
    }}>{label}</div>
  );
}

// ─────────────────────────────────────────────────────────────
//  TAB 1 — CHAT  (with saved sessions: list + resume)
// ─────────────────────────────────────────────────────────────
const SCENARIOS = {
  free: { jp: "自由会話", en: "Free chat", emoji: "💬" },
  coffee: { jp: "喫茶店", en: "Order coffee", emoji: "☕" },
  meet: { jp: "初対面", en: "Meet someone", emoji: "🤝" },
  airport: { jp: "空港", en: "At the airport", emoji: "✈️" },
};

function ChatTab({ logMistake }) {
  const [view, setView] = useState("list"); // "list" | "chat"
  const [sessions, setSessions] = useState([]);
  const [sessionId, setSessionId] = useState(null);
  const [scenario, setScenario] = useState("free");
  const [history, setHistory] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const recogRef = useRef(null);
  const scrollRef = useRef(null);

  useEffect(() => { refreshSessions(); }, []);
  useEffect(() => { scrollRef.current?.scrollTo({ top: 999999, behavior: "smooth" }); }, [history, busy]);

  async function refreshSessions() {
    if (!supabase) return;
    const { data, error } = await supabase.from("chat_sessions").select("*")
      .eq("user_id", USER_ID).order("updated_at", { ascending: false });
    if (error) { console.error("[jp-tutor] load sessions failed:", error.message); return; }
    setSessions(data || []);
  }

  async function newChat(sc) {
    // Always open the chat view so the app is usable even without a database.
    setScenario(sc); setHistory([]); setSessionId(null); setView("chat");
    if (!supabase) return;
    const { data, error } = await supabase.from("chat_sessions")
      .insert({ user_id: USER_ID, scenario: sc, messages: [] }).select().single();
    if (error || !data) {
      console.error("[jp-tutor] couldn't create chat session:", error?.message);
      alert("Couldn't save this chat to the database.\n\n" + (error?.message || "Unknown error") +
        "\n\nMost likely the database tables aren't set up yet — run supabase_schema.sql in the Supabase SQL editor. You can still chat; it just won't be saved until that's fixed.");
      return;
    }
    setSessionId(data.id);
    refreshSessions();
  }
  function resume(s) {
    setSessionId(s.id); setScenario(s.scenario); setHistory(s.messages || []);
    setView("chat");
  }
  async function persist(msgs) {
    if (!supabase || !sessionId) return;
    await supabase.from("chat_sessions")
      .update({ messages: msgs, updated_at: new Date().toISOString() }).eq("id", sessionId);
  }
  async function removeSession(id, e) {
    e.stopPropagation();
    if (!supabase) return;
    await supabase.from("chat_sessions").delete().eq("id", id);
    refreshSessions();
  }
  async function renameSession(s, e) {
    e.stopPropagation();
    const current = s.title || SCENARIOS[s.scenario]?.en || "Chat";
    const name = window.prompt("Rename this chat:", current);
    if (name === null) return; // cancelled
    const title = name.trim();
    if (!supabase) return;
    await supabase.from("chat_sessions").update({ title: title || null }).eq("id", s.id);
    refreshSessions();
  }
  async function copySession(s, e) {
    e.stopPropagation();
    const lines = (s.messages || []).map((m) => {
      const who = m.role === "user" ? "You" : "Tutor";
      let line = `${who}: ${m.jp}`;
      if (m.romaji) line += ` (${m.romaji})`;
      if (m.en) line += ` — ${m.en}`;
      if (m.correction) line += `\n   ✎ ${m.correction.original} → ${m.correction.fixed} (${m.correction.note})`;
      return line;
    });
    const text = (s.title || SCENARIOS[s.scenario]?.en || "Chat") + "\n\n" + lines.join("\n");
    try {
      await navigator.clipboard.writeText(text);
      alert("Chat copied to clipboard.");
    } catch {
      alert("Couldn't copy automatically. Here's the chat:\n\n" + text);
    }
  }

  const sysPrompt = `You are a warm, patient Japanese tutor for a BEGINNER doing this role-play: ${SCENARIOS[scenario].en}.

On EVERY student message you must do TWO things: (1) grade their Japanese, and (2) continue the conversation.

GRADING — this is your top priority. Before replying, analyse the student's latest message word by word. Beginners very frequently make these errors, so look hard for them:
- particles: は vs が, を, に, で, へ, も used wrongly or missing
- pointing words: この/その/あの need a noun after them (この + noun); これ/それ/あれ stand alone
- politeness: missing です / ます, or mixing plain and polite
- verb conjugation and word order
- using English or romaji instead of Japanese script

You MUST return this exact JSON object every time (ALL fields required, never leave a romaji field empty):
{
  "user_romaji": "romaji (Hepburn) reading of EXACTLY what the student just wrote, so they can read their own message",
  "is_correct": true or false,
  "mistake": "" if correct, otherwise the specific error in plain English (e.g. "この needs a noun; use これ for 'this one'")",
  "fixed": "" if correct, otherwise the corrected full Japanese sentence,
  "fixed_romaji": "" if correct, otherwise romaji of the fix,
  "reply_jp": "your short, simple Japanese reply that continues the role-play",
  "reply_romaji": "romaji (Hepburn) reading of reply_jp — ALWAYS fill this, never blank",
  "reply_en": "English translation of reply_jp"
}

Rules:
- Judge honestly. If there is ANY mistake, set is_correct=false and fill mistake/fixed/fixed_romaji. Only set is_correct=true when the sentence is fully correct and natural.
- "user_romaji" and "reply_romaji" are mandatory on every single response. Romaji means the Latin-alphabet pronunciation (e.g. 私はコーヒーを飲みたいです → "watashi wa kōhī o nomitai desu").
- Keep reply_jp short and beginner-friendly.
- Do not mention the grading inside reply_jp; keep the conversation flowing naturally there.`;

  async function send(text) {
    if (!text.trim() || busy) return;
    const newHist = [...history, { role: "user", jp: text }];
    setHistory(newHist); setInput(""); setBusy(true);
    try {
      const apiMessages = newHist.map((m) => ({
        role: m.role,
        content: m.role === "user" ? m.jp : JSON.stringify({ reply_jp: m.jp, reply_en: m.en }),
      }));
      const raw = await callClaude(apiMessages, sysPrompt, 800, true);
      let p;
      try {
        p = parseJSON(raw);
      } catch {
        p = { reply_jp: raw, reply_romaji: "", reply_en: "" };
      }
      const replyJp = p.reply_jp || raw;
      // Attach romaji + any correction to the student's message.
      const userMsg = newHist[newHist.length - 1];
      if (p.user_romaji) userMsg.romaji = p.user_romaji;
      const hasMistake = p.is_correct === false && (p.fixed || p.mistake);
      if (hasMistake) {
        const corr = { original: text, fixed: p.fixed || "", romaji: p.fixed_romaji || "", note: p.mistake || "" };
        userMsg.correction = corr;
        logMistake?.(corr);
      }
      const finalHist = [...newHist.slice(0, -1), userMsg, { role: "assistant", jp: replyJp, romaji: p.reply_romaji, en: p.reply_en }];
      setHistory(finalHist);
      speak(replyJp);
      persist(finalHist);
      refreshSessions();
    } catch (e) {
      setHistory((h) => [...h, { role: "assistant", jp: "ごめんなさい、もう一度お願いします。", romaji: "Gomen nasai, mou ichido onegai shimasu.", en: "Sorry, please try again. (" + e.message + ")" }]);
    }
    setBusy(false);
  }

  function toggleMic() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert("Speech recognition needs Chrome / Edge."); return; }
    if (listening) { recogRef.current?.stop(); return; }
    const r = new SR();
    r.lang = "ja-JP"; r.interimResults = false; r.maxAlternatives = 1;
    r.onresult = (e) => { const t = e.results[0][0].transcript; setInput(t); send(t); };
    r.onend = () => setListening(false); r.onerror = () => setListening(false);
    recogRef.current = r; setListening(true); r.start();
  }

  // ── SESSION LIST VIEW ──
  if (view === "list") {
    return (
      <div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.aiSoft, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 12 }}>Start a new chat</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 22 }}>
          {Object.entries(SCENARIOS).map(([k, v]) => (
            <button key={k} onClick={() => newChat(k)} style={{
              padding: "16px 12px", borderRadius: 14, cursor: "pointer", border: `1.5px solid ${C.mist}`,
              background: C.paper, color: C.ai, textAlign: "left",
            }}>
              <div style={{ fontSize: 22 }}>{v.emoji}</div>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 17, marginTop: 4 }}>{v.jp}</div>
              <div style={{ fontSize: 12, color: C.aiSoft, fontFamily: FONT_BODY }}>{v.en}</div>
            </button>
          ))}
        </div>

        <div style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.aiSoft, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 12 }}>Past conversations</div>
        {!supabase && <div style={{ fontSize: 13, color: C.shu, fontFamily: FONT_BODY }}>Supabase not configured — chats won't save. Add your keys in Vercel.</div>}
        {supabase && sessions.length === 0 && <div style={{ fontSize: 13, color: C.aiSoft, opacity: .7, fontFamily: FONT_BODY }}>No saved chats yet. Pick a scenario above to begin.</div>}
        {sessions.map((s) => {
          const last = (s.messages || []).slice(-1)[0];
          const name = s.title || SCENARIOS[s.scenario]?.en || "Chat";
          return (
            <div key={s.id} onClick={() => resume(s)} style={{
              display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 12,
              background: C.paper, border: `1px solid ${C.mist}`, marginBottom: 8, cursor: "pointer",
            }}>
              <span style={{ fontSize: 20 }}>{SCENARIOS[s.scenario]?.emoji || "💬"}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 13, color: C.ai, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</div>
                <div style={{ fontSize: 12, color: C.aiSoft, opacity: .8, fontFamily: FONT_DISPLAY, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {last ? last.jp : "empty"}
                </div>
              </div>
              <button onClick={(e) => renameSession(s, e)} title="Rename" style={iconBtn}>✎</button>
              <button onClick={(e) => copySession(s, e)} title="Copy chat" style={iconBtn}>⧉</button>
              <button onClick={(e) => removeSession(s.id, e)} title="Delete" style={iconBtn}>✕</button>
            </div>
          );
        })}
      </div>
    );
  }

  // ── CHAT VIEW ──
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, paddingBottom: 12 }}>
        <button onClick={() => { setView("list"); refreshSessions(); }} style={{
          border: "none", background: "transparent", color: C.ai, cursor: "pointer",
          fontFamily: FONT_BODY, fontSize: 14, fontWeight: 600, padding: 0,
        }}>‹ All chats</button>
        <span style={{ marginLeft: "auto", fontSize: 13, color: C.aiSoft, fontFamily: FONT_BODY }}>
          {SCENARIOS[scenario].emoji} {SCENARIOS[scenario].en}
        </span>
      </div>

      <div ref={scrollRef} style={{
        flex: 1, overflowY: "auto", background: C.paper, borderRadius: 14, padding: 18,
        border: `1px solid ${C.mist}`, minHeight: 0,
      }}>
        {history.length === 0 && !busy && (
          <div style={{ textAlign: "center", color: C.aiSoft, opacity: .65, marginTop: 40, fontFamily: FONT_BODY }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>{SCENARIOS[scenario].emoji}</div>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 20, color: C.ai }}>{SCENARIOS[scenario].jp}</div>
            <div style={{ fontSize: 13, marginTop: 6 }}>Speak or type to start. Try「こんにちは」</div>
          </div>
        )}
        {history.map((m, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start", marginBottom: 14 }}>
            <div style={{
              maxWidth: "82%", padding: "11px 14px", borderRadius: 14,
              background: m.role === "user" ? C.ai : C.kinari, color: m.role === "user" ? C.kinari : C.sumi,
              border: m.role === "user" ? "none" : `1px solid ${C.mist}`,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontFamily: FONT_DISPLAY, fontSize: 19, lineHeight: 1.4 }}>{m.jp}</span>
                {m.role === "assistant" && <SpeakBtn text={m.jp} size={28} />}
              </div>
              {m.romaji && <div style={{ fontSize: 12.5, opacity: .7, marginTop: 4, fontStyle: "italic" }}>{m.romaji}</div>}
              {m.en && <div style={{ fontSize: 13, opacity: .85, marginTop: 3, fontFamily: FONT_BODY }}>{m.en}</div>}
            </div>
            {m.correction && (
              <div style={{ maxWidth: "82%", marginTop: 6, padding: "10px 12px", borderRadius: 12, background: "#fdeee9", border: `1.5px solid ${C.shuSoft}` }}>
                <div style={{ fontFamily: FONT_BODY, fontSize: 10.5, fontWeight: 700, color: C.shu, letterSpacing: 1, textTransform: "uppercase", marginBottom: 5 }}>✎ Correction</div>
                <div style={{ fontSize: 13.5, color: C.sumi, fontFamily: FONT_BODY }}>
                  <span style={{ textDecoration: "line-through", opacity: .55 }}>{m.correction.original}</span>{" → "}
                  <span style={{ fontFamily: FONT_DISPLAY, fontSize: 16, color: C.ai }}>{m.correction.fixed}</span>
                  {m.correction.romaji && <span style={{ fontStyle: "italic", opacity: .7 }}>  ({m.correction.romaji})</span>}
                </div>
                {m.correction.note && <div style={{ fontSize: 13, marginTop: 5, color: C.aiSoft, fontFamily: FONT_BODY }}>{m.correction.note}</div>}
              </div>
            )}
          </div>
        ))}
        {busy && <div style={{ color: C.aiSoft, fontFamily: FONT_BODY, fontSize: 13, opacity: .7 }}>先生 is typing…</div>}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
        <button onClick={toggleMic} title="Speak Japanese" style={{
          width: 50, height: 50, borderRadius: "50%", flexShrink: 0, cursor: "pointer", border: "none",
          background: listening ? C.shu : C.ai, color: C.kinari, fontSize: 22,
          animation: listening ? "pulse 1s infinite" : "none",
        }}>🎙</button>
        <input value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send(input)}
          placeholder={listening ? "Listening…" : "Type or speak Japanese…"}
          style={{
            flex: 1, padding: "13px 16px", borderRadius: 999, fontSize: 15, border: `1.5px solid ${C.mist}`,
            background: C.paper, fontFamily: FONT_DISPLAY, outline: "none", color: C.sumi,
          }} />
        <button onClick={() => send(input)} disabled={busy} style={{
          padding: "13px 22px", borderRadius: 999, border: "none", cursor: "pointer", background: C.shu,
          color: C.paper, fontWeight: 700, fontSize: 14, fontFamily: FONT_BODY,
        }}>Send</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  TAB 2 — ALPHABET
// ─────────────────────────────────────────────────────────────
const HIRAGANA = [
  ["あ","a","朝","asa","morning"],["い","i","犬","inu","dog"],["う","u","海","umi","sea"],["え","e","駅","eki","station"],["お","o","お茶","ocha","tea"],
  ["か","ka","傘","kasa","umbrella"],["き","ki","木","ki","tree"],["く","ku","靴","kutsu","shoes"],["け","ke","景色","keshiki","scenery"],["こ","ko","声","koe","voice"],
  ["さ","sa","魚","sakana","fish"],["し","shi","白","shiro","white"],["す","su","寿司","sushi","sushi"],["せ","se","先生","sensei","teacher"],["そ","so","空","sora","sky"],
  ["た","ta","卵","tamago","egg"],["ち","chi","地図","chizu","map"],["つ","tsu","月","tsuki","moon"],["て","te","手","te","hand"],["と","to","友達","tomodachi","friend"],
  ["な","na","名前","namae","name"],["に","ni","虹","niji","rainbow"],["ぬ","nu","布","nuno","cloth"],["ね","ne","猫","neko","cat"],["の","no","飲み物","nomimono","drink"],
  ["は","ha","花","hana","flower"],["ひ","hi","火","hi","fire"],["ふ","fu","船","fune","boat"],["へ","he","部屋","heya","room"],["ほ","ho","星","hoshi","star"],
  ["ま","ma","窓","mado","window"],["み","mi","水","mizu","water"],["む","mu","村","mura","village"],["め","me","目","me","eye"],["も","mo","桃","momo","peach"],
  ["や","ya","山","yama","mountain"],["ゆ","yu","雪","yuki","snow"],["よ","yo","夜","yoru","night"],
  ["ら","ra","来週","raishuu","next week"],["り","ri","林檎","ringo","apple"],["る","ru","留守","rusu","absence"],["れ","re","歴史","rekishi","history"],["ろ","ro","廊下","rouka","hallway"],
  ["わ","wa","笑う","warau","to laugh"],["を","wo","—","(w)o","particle"],["ん","n","本","hon","book"],
];
const KATAKANA = [
  ["ア","a","アイス","aisu","ice cream"],["イ","i","インク","inku","ink"],["ウ","u","ウール","ūru","wool"],["エ","e","エアコン","eakon","air conditioner"],["オ","o","オレンジ","orenji","orange"],
  ["カ","ka","カメラ","kamera","camera"],["キ","ki","キー","kī","key"],["ク","ku","クラス","kurasu","class"],["ケ","ke","ケーキ","kēki","cake"],["コ","ko","コーヒー","kōhī","coffee"],
  ["サ","sa","サラダ","sarada","salad"],["シ","shi","シャツ","shatsu","shirt"],["ス","su","スープ","sūpu","soup"],["セ","se","セーター","sētā","sweater"],["ソ","so","ソファ","sofa","sofa"],
  ["タ","ta","タクシー","takushī","taxi"],["チ","chi","チーズ","chīzu","cheese"],["ツ","tsu","ツアー","tsuā","tour"],["テ","te","テレビ","terebi","TV"],["ト","to","トマト","tomato","tomato"],
  ["ナ","na","ナイフ","naifu","knife"],["ニ","ni","ニュース","nyūsu","news"],["ヌ","nu","カヌー","kanū","canoe"],["ネ","ne","ネクタイ","nekutai","necktie"],["ノ","no","ノート","nōto","notebook"],
  ["ハ","ha","ハム","hamu","ham"],["ヒ","hi","ヒーター","hītā","heater"],["フ","fu","フォーク","fōku","fork"],["ヘ","he","ヘリ","heri","helicopter"],["ホ","ho","ホテル","hoteru","hotel"],
  ["マ","ma","マスク","masuku","mask"],["ミ","mi","ミルク","miruku","milk"],["ム","mu","ゲーム","gēmu","game"],["メ","me","メニュー","menyū","menu"],["モ","mo","メモ","memo","memo"],
  ["ヤ","ya","タイヤ","taiya","tire"],["ユ","yu","ユーザー","yūzā","user"],["ヨ","yo","ヨガ","yoga","yoga"],
  ["ラ","ra","ラジオ","rajio","radio"],["リ","ri","リスト","risuto","list"],["ル","ru","ルール","rūru","rule"],["レ","re","レモン","remon","lemon"],["ロ","ro","ロボット","robotto","robot"],
  ["ワ","wa","ワイン","wain","wine"],["ヲ","wo","—","(w)o","particle"],["ン","n","パン","pan","bread"],
];

function AlphabetTab() {
  const [set, setSet] = useState("hira");
  const [active, setActive] = useState(null);
  const rows = set === "hira" ? HIRAGANA : KATAKANA;
  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {[["hira","ひらがな","Hiragana"],["kata","カタカナ","Katakana"]].map(([k,jp,en]) => (
          <button key={k} onClick={() => { setSet(k); setActive(null); }} style={{
            flex: 1, padding: "12px", borderRadius: 12, cursor: "pointer",
            border: `1.5px solid ${set === k ? C.ai : C.mist}`, background: set === k ? C.ai : C.paper,
            color: set === k ? C.kinari : C.ai, fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 600,
          }}>{jp} <span style={{ fontSize: 12, fontFamily: FONT_BODY, opacity: .75 }}>{en}</span></button>
        ))}
      </div>
      {active && (
        <div style={{ padding: 18, borderRadius: 14, background: C.ai, color: C.kinari, marginBottom: 16, display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 60, lineHeight: 1 }}>{active[0]}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, opacity: .8, fontStyle: "italic" }}>「{active[1]}」</div>
            <div style={{ marginTop: 6, fontFamily: FONT_DISPLAY, fontSize: 22 }}>{active[2]}
              <span style={{ fontSize: 13, fontStyle: "italic", opacity: .8, fontFamily: FONT_BODY }}>  {active[3]}</span>
            </div>
            <div style={{ fontSize: 13, opacity: .85, fontFamily: FONT_BODY }}>{active[4]}</div>
          </div>
          <SpeakBtn text={active[2] === "—" ? active[0] : active[2]} size={44} />
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
        {rows.map((r) => (
          <button key={r[0]} onClick={() => { setActive(r); speak(r[0]); }} style={{
            aspectRatio: "1", borderRadius: 12, cursor: "pointer",
            border: `1.5px solid ${active && active[0] === r[0] ? C.shu : C.mist}`,
            background: active && active[0] === r[0] ? C.shu : C.paper,
            color: active && active[0] === r[0] ? C.paper : C.sumi,
            fontFamily: FONT_DISPLAY, fontSize: 28, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
          }}>{r[0]}<span style={{ fontSize: 10, fontFamily: FONT_BODY, opacity: .6, marginTop: 2 }}>{r[1]}</span></button>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  TAB 3 — VOCAB
// ─────────────────────────────────────────────────────────────
const DECKS = {
  greetings: { name: "Greetings", emoji: "👋", cards: [
    ["こんにちは","konnichiwa","Hello"],["おはよう","ohayou","Good morning"],["こんばんは","konbanwa","Good evening"],
    ["ありがとう","arigatou","Thank you"],["すみません","sumimasen","Excuse me / Sorry"],["さようなら","sayounara","Goodbye"],
    ["はじめまして","hajimemashite","Nice to meet you"],["お元気ですか","ogenki desu ka","How are you?"],
    ["おやすみ","oyasumi","Good night"],["またね","mata ne","See you"],
  ]},
  food: { name: "Food", emoji: "🍜", cards: [
    ["ご飯","gohan","Rice / meal"],["水","mizu","Water"],["お茶","ocha","Tea"],["寿司","sushi","Sushi"],
    ["ラーメン","rāmen","Ramen"],["魚","sakana","Fish"],["肉","niku","Meat"],["野菜","yasai","Vegetables"],
    ["美味しい","oishii","Delicious"],["いただきます","itadakimasu","Let's eat"],
  ]},
  travel: { name: "Travel", emoji: "🧳", cards: [
    ["駅","eki","Station"],["電車","densha","Train"],["空港","kūkō","Airport"],["ホテル","hoteru","Hotel"],
    ["切符","kippu","Ticket"],["地図","chizu","Map"],["どこ","doko","Where"],["右","migi","Right"],
    ["左","hidari","Left"],["まっすぐ","massugu","Straight ahead"],
  ]},
  numbers: { name: "Numbers", emoji: "🔢", cards: [
    ["一","ichi","One"],["二","ni","Two"],["三","san","Three"],["四","yon","Four"],["五","go","Five"],
    ["六","roku","Six"],["七","nana","Seven"],["八","hachi","Eight"],["九","kyū","Nine"],["十","jū","Ten"],
  ]},
};

function VocabTab({ learned, toggleLearned }) {
  const [deckKey, setDeckKey] = useState("greetings");
  const [cards, setCards] = useState(DECKS.greetings.cards);
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const [customName, setCustomName] = useState(null);

  function loadDeck(k) { setDeckKey(k); setCards(DECKS[k].cards); setIdx(0); setFlipped(false); setCustomName(null); }
  async function generate() {
    if (!topic.trim() || busy) return;
    setBusy(true);
    try {
      const raw = await callClaude(
        [{ role: "user", content: `Make a 10-card beginner Japanese flashcard deck about "${topic}". Return a JSON object of the form {"cards":[["japanese","romaji","english"], ... 10 items]}. Simple beginner vocabulary. No markdown.` }],
        "You output only valid JSON. No markdown, no commentary.", 1200, true);
      const parsed = parseJSON(raw);
      const arr = Array.isArray(parsed) ? parsed : parsed.cards;
      if (!Array.isArray(arr) || arr.length === 0) throw new Error("bad deck");
      setCards(arr); setIdx(0); setFlipped(false); setDeckKey("custom"); setCustomName(topic); setTopic("");
    } catch (e) { alert("Couldn't generate that deck. Try another topic."); }
    setBusy(false);
  }

  const card = cards[idx];
  const cardId = card ? card[0] : "";
  const isLearned = learned.some((x) => x[0] === cardId);
  function nav(d) { setFlipped(false); setIdx((i) => (i + d + cards.length) % cards.length); }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        {Object.entries(DECKS).map(([k, v]) => (
          <button key={k} onClick={() => loadDeck(k)} style={{
            padding: "8px 14px", borderRadius: 999, cursor: "pointer",
            border: `1.5px solid ${deckKey === k ? C.ai : C.mist}`, background: deckKey === k ? C.ai : C.paper,
            color: deckKey === k ? C.kinari : C.ai, fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600,
          }}>{v.emoji} {v.name}</button>
        ))}
        {customName && <span style={{ padding: "8px 14px", borderRadius: 999, background: C.shu, color: C.paper, fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600 }}>✦ {customName}</span>}
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        <input value={topic} onChange={(e) => setTopic(e.target.value)} onKeyDown={(e) => e.key === "Enter" && generate()}
          placeholder="Type any topic (e.g. weather, animals)…"
          style={{ flex: 1, padding: "12px 16px", borderRadius: 999, fontSize: 14, border: `1.5px solid ${C.mist}`, background: C.paper, outline: "none", fontFamily: FONT_BODY, color: C.sumi }} />
        <button onClick={generate} disabled={busy} style={{ padding: "12px 20px", borderRadius: 999, border: "none", cursor: "pointer", background: C.shu, color: C.paper, fontWeight: 700, fontSize: 14, fontFamily: FONT_BODY, opacity: busy ? .6 : 1 }}>{busy ? "…" : "Generate"}</button>
      </div>
      {card && (
        <>
          <div onClick={() => setFlipped((f) => !f)} style={{
            position: "relative", height: 260, borderRadius: 18, cursor: "pointer",
            background: flipped ? C.kinari : C.ai, color: flipped ? C.sumi : C.kinari,
            border: `1px solid ${C.mist}`, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", textAlign: "center", padding: 24,
            boxShadow: "0 8px 24px rgba(26,39,64,.12)",
          }}>
            {isLearned && <div style={{ position: "absolute", top: 14, right: 14 }}><Seal label="済" /></div>}
            {!flipped ? (
              <><div style={{ fontFamily: FONT_DISPLAY, fontSize: 54, lineHeight: 1.2 }}>{card[0]}</div>
                <div style={{ fontSize: 13, opacity: .65, marginTop: 14, fontFamily: FONT_BODY }}>tap to flip</div></>
            ) : (
              <><div style={{ fontSize: 16, fontStyle: "italic", opacity: .7 }}>{card[1]}</div>
                <div style={{ fontFamily: FONT_DISPLAY, fontSize: 30, marginTop: 10 }}>{card[2]}</div></>
            )}
            <div style={{ position: "absolute", bottom: 14, left: 14, fontSize: 12, opacity: .55, fontFamily: FONT_BODY }}>{idx + 1} / {cards.length}</div>
            <div style={{ position: "absolute", bottom: 12, right: 14 }}><SpeakBtn text={card[0]} size={36} /></div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 14, alignItems: "center" }}>
            <button onClick={() => nav(-1)} style={navBtn}>‹ Prev</button>
            <button onClick={() => toggleLearned(card)} style={{
              flex: 1, padding: "13px", borderRadius: 12, cursor: "pointer", border: "none",
              background: isLearned ? C.gold : C.shu, color: C.paper, fontWeight: 700, fontFamily: FONT_BODY, fontSize: 14,
            }}>{isLearned ? "✓ Learned" : "Mark as learned"}</button>
            <button onClick={() => nav(1)} style={navBtn}>Next ›</button>
          </div>
        </>
      )}
    </div>
  );
}
const navBtn = { padding: "13px 16px", borderRadius: 12, cursor: "pointer", border: `1.5px solid ${C.mist}`, background: C.paper, color: C.ai, fontWeight: 600, fontFamily: FONT_BODY, fontSize: 14 };

// ─────────────────────────────────────────────────────────────
//  TAB 4 — TRANSLATE
// ─────────────────────────────────────────────────────────────
function TranslateTab() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  async function translate() {
    if (!text.trim() || busy) return;
    setBusy(true); setResult(null);
    try {
      const raw = await callClaude(
        [{ role: "user", content: `Translate this between English and Japanese (auto-detect direction): "${text}".
Return ONLY JSON: {"direction":"EN→JP" or "JP→EN","japanese":"...","romaji":"...","english":"...","breakdown":[{"word":"part","romaji":"...","meaning":"...","note":"grammar/particle note"}]}` }],
        "You are a precise Japanese translator. Output only valid JSON.", 1400, true);
      setResult(parseJSON(raw));
    } catch (e) { alert("Translation failed. Try again."); }
    setBusy(false);
  }
  return (
    <div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Type English or Japanese…" rows={3}
        style={{ width: "100%", padding: "14px 16px", borderRadius: 14, fontSize: 16, border: `1.5px solid ${C.mist}`, background: C.paper, outline: "none", fontFamily: FONT_DISPLAY, color: C.sumi, resize: "vertical", boxSizing: "border-box" }} />
      <button onClick={translate} disabled={busy} style={{ width: "100%", marginTop: 10, padding: "14px", borderRadius: 12, border: "none", cursor: "pointer", background: C.shu, color: C.paper, fontWeight: 700, fontSize: 15, fontFamily: FONT_BODY, opacity: busy ? .6 : 1 }}>{busy ? "Translating…" : "Translate ⇄"}</button>
      {result && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.shu, letterSpacing: 1.5, marginBottom: 8 }}>{result.direction}</div>
          <div style={{ padding: 18, borderRadius: 14, background: C.ai, color: C.kinari }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontFamily: FONT_DISPLAY, fontSize: 26, lineHeight: 1.4, flex: 1 }}>{result.japanese}</span>
              <SpeakBtn text={result.japanese} size={40} />
            </div>
            <div style={{ fontSize: 14, fontStyle: "italic", opacity: .75, marginTop: 6 }}>{result.romaji}</div>
            <div style={{ fontSize: 15, opacity: .9, marginTop: 8, fontFamily: FONT_BODY, paddingTop: 8, borderTop: `1px solid ${C.aiSoft}` }}>{result.english}</div>
          </div>
          {result.breakdown?.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.aiSoft, letterSpacing: 1.5, marginBottom: 10, textTransform: "uppercase" }}>Word by word</div>
              {result.breakdown.map((w, i) => (
                <div key={i} style={{ display: "flex", gap: 12, padding: "12px 14px", borderRadius: 12, background: C.paper, border: `1px solid ${C.mist}`, marginBottom: 8, alignItems: "flex-start" }}>
                  <div style={{ minWidth: 80 }}>
                    <div style={{ fontFamily: FONT_DISPLAY, fontSize: 20, color: C.ai }}>{w.word}</div>
                    <div style={{ fontSize: 11, fontStyle: "italic", opacity: .6 }}>{w.romaji}</div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: C.sumi, fontFamily: FONT_BODY }}>{w.meaning}</div>
                    {w.note && <div style={{ fontSize: 12.5, color: C.aiSoft, marginTop: 3, fontFamily: FONT_BODY }}>{w.note}</div>}
                  </div>
                  <SpeakBtn text={w.word} size={30} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  TAB 5 — SETTINGS (API keys + provider fallback order)
// ─────────────────────────────────────────────────────────────
function SettingsTab({ settings, setSettings, userEmail, mistakes, setMistakes }) {
  const [show, setShow] = useState({}); // toggle key visibility per provider
  const [saved, setSaved] = useState(false);

  function setKey(name, value) {
    setSettings((s) => ({ ...s, keys: { ...s.keys, [name]: value } }));
    setSaved(false);
  }
  function move(name, dir) {
    setSettings((s) => {
      const order = [...s.order];
      const i = order.indexOf(name);
      const j = i + dir;
      if (j < 0 || j >= order.length) return s;
      [order[i], order[j]] = [order[j], order[i]];
      return { ...s, order };
    });
    setSaved(false);
  }
  function save() {
    setActiveSettings(settings);
    saveProfile({ settings, last_active: todayStr() });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const ordered = settings.order.map((n) => PROVIDERS.find((p) => p.name === n)).filter(Boolean);
  const activeCount = settings.order.filter((n) => (settings.keys[n] || "").trim()).length;

  return (
    <div>
      <div style={{
        display: "flex", alignItems: "center", gap: 12, padding: 14, borderRadius: 14,
        background: C.ai, color: C.kinari, marginBottom: 20,
      }}>
        <div style={{
          width: 38, height: 38, borderRadius: "50%", background: C.shu, color: C.paper, flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, fontWeight: 700, fontFamily: FONT_DISPLAY,
        }}>{(userEmail || "?").slice(0, 1).toUpperCase()}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, opacity: .65, fontFamily: FONT_BODY, textTransform: "uppercase", letterSpacing: 1 }}>Signed in as</div>
          <div style={{ fontSize: 14, fontWeight: 600, fontFamily: FONT_BODY, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{userEmail || "—"}</div>
        </div>
        <button onClick={() => signOut()} style={{
          padding: "9px 14px", borderRadius: 9, border: `1.5px solid ${C.kinari}`, background: "transparent",
          color: C.kinari, cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: FONT_BODY, flexShrink: 0,
        }}>Sign out</button>
      </div>

      <p style={{ fontFamily: FONT_BODY, fontSize: 14, color: C.aiSoft, lineHeight: 1.6, marginTop: 0 }}>
        Add a key for any provider below. The app uses them <b>top to bottom</b> — if the
        first runs out of free quota, it automatically falls back to the next one that has a key.
      </p>

      {!supabase && (
        <div style={{ fontSize: 13, color: C.shu, fontFamily: FONT_BODY, marginBottom: 12 }}>
          Supabase isn't configured, so keys won't sync across devices (they'll still work this session).
        </div>
      )}

      <div style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.aiSoft, letterSpacing: 1.5, textTransform: "uppercase", margin: "18px 0 10px" }}>
        Fallback order
      </div>

      {ordered.map((p, i) => {
        const key = settings.keys[p.name] || "";
        const has = key.trim().length > 0;
        return (
          <div key={p.name} style={{
            padding: 14, borderRadius: 14, background: C.paper, marginBottom: 10,
            border: `1.5px solid ${has ? C.ai : C.mist}`,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <div style={{
                width: 24, height: 24, borderRadius: 6, background: has ? C.shu : C.mist, color: C.paper,
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700,
                fontFamily: FONT_DISPLAY, flexShrink: 0,
              }}>{i + 1}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 14, color: C.ai }}>
                  {p.label} {p.free && <span style={{ fontSize: 10, color: C.shu, fontWeight: 700 }}>FREE</span>}
                </div>
                <div style={{ fontSize: 11.5, color: C.aiSoft, opacity: .8 }}>{p.hint}</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <button onClick={() => move(p.name, -1)} disabled={i === 0} title="Move up" style={arrowBtn(i === 0)}>▲</button>
                <button onClick={() => move(p.name, 1)} disabled={i === ordered.length - 1} title="Move down" style={arrowBtn(i === ordered.length - 1)}>▼</button>
              </div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                type={show[p.name] ? "text" : "password"}
                value={key}
                onChange={(e) => setKey(p.name, e.target.value)}
                placeholder={`Paste your ${p.label} key…`}
                style={{
                  flex: 1, padding: "10px 12px", borderRadius: 9, fontSize: 13, border: `1.5px solid ${C.mist}`,
                  background: C.kinari, outline: "none", fontFamily: "monospace", color: C.sumi,
                }}
              />
              <button onClick={() => setShow((s) => ({ ...s, [p.name]: !s[p.name] }))} style={{
                padding: "0 12px", borderRadius: 9, border: `1.5px solid ${C.mist}`, background: C.kinari,
                cursor: "pointer", fontSize: 12, color: C.aiSoft, fontFamily: FONT_BODY,
              }}>{show[p.name] ? "Hide" : "Show"}</button>
            </div>
          </div>
        );
      })}

      <button onClick={save} style={{
        width: "100%", marginTop: 8, padding: "14px", borderRadius: 12, border: "none", cursor: "pointer",
        background: saved ? C.gold : C.shu, color: C.paper, fontWeight: 700, fontSize: 15, fontFamily: FONT_BODY,
      }}>{saved ? "✓ Saved" : "Save keys"}</button>

      <div style={{ fontSize: 12, color: C.aiSoft, opacity: .8, marginTop: 14, lineHeight: 1.6, fontFamily: FONT_BODY }}>
        {activeCount === 0
          ? "No keys yet — add at least one to start chatting."
          : `${activeCount} provider${activeCount > 1 ? "s" : ""} ready. ` + (activeCount > 1 ? "Fallback is active." : "Add another for automatic fallback.")}
      </div>

      <div style={{ fontSize: 11.5, color: C.aiSoft, opacity: .65, marginTop: 16, lineHeight: 1.6, fontFamily: FONT_BODY, paddingTop: 14, borderTop: `1px solid ${C.mist}` }}>
        Keys are stored in your own synced profile and sent only to the providers you enable. Treat them like passwords — anyone with access to this browser can view them here.
      </div>

      <MistakesSection mistakes={mistakes} setMistakes={setMistakes} />
    </div>
  );
}

function MistakesSection({ mistakes, setMistakes }) {
  function clearAll() {
    if (!window.confirm("Clear your whole mistake history? This can't be undone.")) return;
    setMistakes([]);
    saveProfile({ mistakes: [] });
  }
  // Count repeated mistake notes to surface patterns.
  const counts = {};
  for (const m of mistakes) {
    const key = (m.note || "").trim();
    if (key) counts[key] = (counts[key] || 0) + 1;
  }
  const topPatterns = Object.entries(counts).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 5);

  return (
    <div style={{ marginTop: 26, paddingTop: 18, borderTop: `1px solid ${C.mist}` }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.aiSoft, letterSpacing: 1.5, textTransform: "uppercase", flex: 1 }}>
          ✎ Mistake tracker
        </div>
        {mistakes.length > 0 && (
          <button onClick={clearAll} style={{ border: "none", background: "transparent", color: C.shu, cursor: "pointer", fontSize: 12, fontFamily: FONT_BODY, fontWeight: 600 }}>Clear</button>
        )}
      </div>

      {mistakes.length === 0 && (
        <div style={{ fontSize: 13.5, color: C.aiSoft, fontFamily: FONT_BODY, lineHeight: 1.5 }}>
          No mistakes logged yet. As you chat with the tutor, every correction is saved here so you can spot patterns and improve.
        </div>
      )}

      {topPatterns.length > 0 && (
        <div style={{ background: "#fdeee9", border: `1.5px solid ${C.shuSoft}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.shu, fontFamily: FONT_BODY, marginBottom: 8 }}>Mistakes you repeat most</div>
          {topPatterns.map(([note, n], i) => (
            <div key={i} style={{ fontSize: 13, color: C.sumi, fontFamily: FONT_BODY, marginTop: 4, display: "flex", gap: 8 }}>
              <span style={{ fontWeight: 700, color: C.shu, minWidth: 24 }}>{n}×</span>
              <span>{note}</span>
            </div>
          ))}
        </div>
      )}

      {mistakes.slice(0, 40).map((m, i) => (
        <div key={i} style={{ padding: "11px 13px", borderRadius: 11, background: C.paper, border: `1px solid ${C.mist}`, marginBottom: 7 }}>
          <div style={{ fontSize: 13.5, color: C.sumi, fontFamily: FONT_BODY }}>
            <span style={{ textDecoration: "line-through", opacity: .55 }}>{m.original}</span>{" → "}
            <span style={{ fontFamily: FONT_DISPLAY, fontSize: 16, color: C.ai }}>{m.fixed}</span>
            {m.romaji && <span style={{ fontStyle: "italic", opacity: .7 }}>  ({m.romaji})</span>}
          </div>
          {m.note && <div style={{ fontSize: 12.5, marginTop: 4, color: C.aiSoft, fontFamily: FONT_BODY }}>{m.note}</div>}
          {m.at && <div style={{ fontSize: 10.5, marginTop: 4, color: C.aiSoft, opacity: .55, fontFamily: FONT_BODY }}>{new Date(m.at).toLocaleDateString()}</div>}
        </div>
      ))}
      {mistakes.length > 40 && (
        <div style={{ fontSize: 12, color: C.aiSoft, opacity: .7, textAlign: "center", marginTop: 6, fontFamily: FONT_BODY }}>Showing 40 most recent of {mistakes.length}.</div>
      )}
    </div>
  );
}
const arrowBtn = (disabled) => ({
  width: 22, height: 18, borderRadius: 5, border: "none", cursor: disabled ? "default" : "pointer",
  background: disabled ? "transparent" : C.mist, color: disabled ? C.mist : C.ai, fontSize: 9, lineHeight: 1,
  display: "flex", alignItems: "center", justifyContent: "center",
});
const iconBtn = {
  border: "none", background: "transparent", color: C.aiSoft, cursor: "pointer", fontSize: 15,
  opacity: .55, padding: "4px 6px", flexShrink: 0,
};

// ─────────────────────────────────────────────────────────────
//  TAB — DICTIONARY (free Jisho lookup via /api/dictionary)
// ─────────────────────────────────────────────────────────────
function DictionaryTab({ learned, toggleLearned }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);

  async function search() {
    if (!q.trim() || busy) return;
    setBusy(true); setResults(null);
    try {
      const r = await fetch("/api/dictionary?q=" + encodeURIComponent(q.trim()));
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "lookup failed");
      setResults(data.results || []);
    } catch (e) {
      setResults([]);
    }
    setBusy(false);
  }

  return (
    <div>
      <p style={{ fontFamily: FONT_BODY, fontSize: 14, color: C.aiSoft, lineHeight: 1.5, marginTop: 0 }}>
        Search any word in English or Japanese. Tap ＋ to save a word to your vocab.
      </p>
      <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="e.g. cat, 食べる, water…"
          style={{ flex: 1, padding: "12px 16px", borderRadius: 999, fontSize: 15, border: `1.5px solid ${C.mist}`, background: C.paper, outline: "none", fontFamily: FONT_DISPLAY, color: C.sumi }} />
        <button onClick={search} disabled={busy} style={{ padding: "12px 20px", borderRadius: 999, border: "none", cursor: "pointer", background: C.shu, color: C.paper, fontWeight: 700, fontSize: 14, fontFamily: FONT_BODY, opacity: busy ? .6 : 1 }}>{busy ? "…" : "Search"}</button>
      </div>

      {results && results.length === 0 && (
        <div style={{ fontSize: 14, color: C.aiSoft, fontFamily: FONT_BODY, textAlign: "center", marginTop: 30 }}>No results found. Try another spelling.</div>
      )}
      {results && results.map((r, i) => {
        const en = r.senses?.[0]?.meanings?.[0] || "";
        const card = [r.word || r.reading, r.reading, r.senses?.[0]?.meanings?.slice(0, 3).join(", ") || ""];
        const saved = learned.some((x) => x[0] === card[0]);
        return (
          <div key={i} style={{ padding: 14, borderRadius: 14, background: C.paper, border: `1px solid ${C.mist}`, marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontFamily: FONT_DISPLAY, fontSize: 24, color: C.ai }}>{r.word || r.reading}</span>
                  {r.word && r.reading && r.word !== r.reading && <span style={{ fontSize: 13, color: C.aiSoft, fontFamily: FONT_DISPLAY }}>{r.reading}</span>}
                  {r.isCommon && <span style={{ fontSize: 9, fontWeight: 700, color: "#2e6b3a", background: "#eef6ee", padding: "2px 6px", borderRadius: 5 }}>COMMON</span>}
                  {r.jlpt?.length > 0 && <span style={{ fontSize: 9, fontWeight: 700, color: C.shu, background: "#fdeee9", padding: "2px 6px", borderRadius: 5 }}>{r.jlpt[0].replace("jlpt-", "").toUpperCase()}</span>}
                </div>
              </div>
              <SpeakBtn text={r.word || r.reading} size={34} />
              <button onClick={() => toggleLearned(card)} title={saved ? "Saved" : "Save to vocab"} style={{
                width: 34, height: 34, borderRadius: "50%", border: "none", cursor: "pointer", flexShrink: 0,
                background: saved ? C.gold : C.mist, color: saved ? C.paper : C.ai, fontSize: 18, fontWeight: 700,
              }}>{saved ? "✓" : "＋"}</button>
            </div>
            <div style={{ marginTop: 8 }}>
              {r.senses.map((s, j) => (
                <div key={j} style={{ fontSize: 13.5, color: C.sumi, fontFamily: FONT_BODY, marginTop: 3 }}>
                  <span style={{ color: C.aiSoft, opacity: .7 }}>{j + 1}. </span>
                  {s.meanings.join("; ")}
                  {s.partsOfSpeech?.length > 0 && <span style={{ fontSize: 11, color: C.aiSoft, opacity: .6, fontStyle: "italic" }}>  ({s.partsOfSpeech.join(", ")})</span>}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  MODALS — streak calendar & learned-words list
// ─────────────────────────────────────────────────────────────
function Modal({ title, onClose, children }) {
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(22,24,29,.55)", display: "flex",
      alignItems: "flex-end", justifyContent: "center", zIndex: 50,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "100%", maxWidth: 560, maxHeight: "85vh", background: C.kinari, borderRadius: "20px 20px 0 0",
        padding: 22, overflowY: "auto", boxShadow: "0 -8px 40px rgba(0,0,0,.3)",
      }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontFamily: FONT_DISPLAY, fontSize: 22, color: C.ai, flex: 1 }}>{title}</h2>
          <button onClick={onClose} style={{ border: "none", background: C.mist, color: C.ai, cursor: "pointer", width: 32, height: 32, borderRadius: "50%", fontSize: 16 }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function StreakModal({ streak, activeDays, onClose }) {
  const set = new Set(activeDays || []);
  const today = new Date();
  // Build last 3 months of day cells.
  const months = [];
  for (let m = 2; m >= 0; m--) {
    const d = new Date(today.getFullYear(), today.getMonth() - m, 1);
    const year = d.getFullYear(), month = d.getMonth();
    const first = new Date(year, month, 1).getDay();
    const days = new Date(year, month + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < first; i++) cells.push(null);
    for (let day = 1; day <= days; day++) {
      const iso = new Date(year, month, day).toISOString().slice(0, 10);
      cells.push({ day, active: set.has(iso), isToday: iso === today.toISOString().slice(0, 10) });
    }
    months.push({ label: d.toLocaleString("default", { month: "long", year: "numeric" }), cells });
  }
  return (
    <Modal title={`🔥 ${streak}-day streak`} onClose={onClose}>
      <p style={{ fontFamily: FONT_BODY, fontSize: 13.5, color: C.aiSoft, marginTop: 0, lineHeight: 1.5 }}>
        Days you practised are marked. Keep the chain going every day to grow your streak.
      </p>
      {months.map((mo, i) => (
        <div key={i} style={{ marginBottom: 18 }}>
          <div style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, color: C.ai, marginBottom: 8 }}>{mo.label}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
            {["S","M","T","W","T","F","S"].map((d, j) => (
              <div key={"h"+j} style={{ textAlign: "center", fontSize: 10, color: C.aiSoft, opacity: .6, fontFamily: FONT_BODY }}>{d}</div>
            ))}
            {mo.cells.map((c, j) => (
              <div key={j} style={{
                aspectRatio: "1", borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, fontFamily: FONT_BODY,
                background: c ? (c.active ? C.shu : C.paper) : "transparent",
                color: c ? (c.active ? C.paper : C.aiSoft) : "transparent",
                border: c?.isToday ? `2px solid ${C.ai}` : (c ? `1px solid ${C.mist}` : "none"),
                fontWeight: c?.active ? 700 : 400,
              }}>{c ? c.day : ""}</div>
            ))}
          </div>
        </div>
      ))}
    </Modal>
  );
}

function WordsModal({ learned, onClose }) {
  return (
    <Modal title={`📚 ${learned.length} words learned`} onClose={onClose}>
      {learned.length === 0 && (
        <p style={{ fontFamily: FONT_BODY, fontSize: 14, color: C.aiSoft }}>
          No saved words yet. Mark words as learned in the Vocab tab, or save them from the Dictionary.
        </p>
      )}
      {learned.map((w, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 12px", borderRadius: 11, background: C.paper, border: `1px solid ${C.mist}`, marginBottom: 7 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 19, color: C.ai }}>{w[0]}
              {w[1] && <span style={{ fontSize: 12, fontStyle: "italic", color: C.aiSoft, marginLeft: 8 }}>{w[1]}</span>}
            </div>
            {w[2] && <div style={{ fontSize: 13, color: C.sumi, fontFamily: FONT_BODY }}>{w[2]}</div>}
          </div>
          <SpeakBtn text={w[0]} size={32} />
        </div>
      ))}
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────
//  AUTH SCREEN (email + password)
// ─────────────────────────────────────────────────────────────
function AuthScreen() {
  const [mode, setMode] = useState("signin"); // "signin" | "signup"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function submit() {
    setMsg(null);
    if (!email.trim() || !password) { setMsg({ type: "err", text: "Enter your email and password." }); return; }
    if (password.length < 6) { setMsg({ type: "err", text: "Password must be at least 6 characters." }); return; }
    setBusy(true);
    if (mode === "signup") {
      const { error } = await signUp(email.trim(), password);
      if (error) setMsg({ type: "err", text: error });
      else setMsg({ type: "ok", text: "Account created. Check your email if confirmation is required, then sign in." });
    } else {
      const { error } = await signIn(email.trim(), password);
      if (error) setMsg({ type: "err", text: error });
      // success: onAuthChange in App will swap to the app automatically.
    }
    setBusy(false);
  }

  return (
    <div style={{ minHeight: "100vh", background: C.ai, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ display: "inline-flex", marginBottom: 14 }}><Seal label="日" /></div>
          <h1 style={{ margin: 0, fontFamily: FONT_DISPLAY, fontSize: 34, color: C.kinari, letterSpacing: 2 }}>日本語 Tutor</h1>
          <p style={{ color: C.kinari, opacity: .65, fontSize: 14, fontFamily: FONT_BODY, marginTop: 8 }}>
            {mode === "signin" ? "Sign in to sync your progress everywhere." : "Create an account to get started."}
          </p>
        </div>

        <div style={{ background: C.paper, borderRadius: 18, padding: 22 }}>
          <input
            type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="Email" autoComplete="email"
            style={authInput}
          />
          <input
            type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="Password" autoComplete={mode === "signup" ? "new-password" : "current-password"}
            style={{ ...authInput, marginTop: 10 }}
          />

          {msg && (
            <div style={{
              marginTop: 12, padding: "10px 12px", borderRadius: 9, fontSize: 13, fontFamily: FONT_BODY,
              background: msg.type === "err" ? "#fdeee9" : "#eef6ee",
              color: msg.type === "err" ? C.shu : "#2e6b3a",
              border: `1px solid ${msg.type === "err" ? C.shuSoft : "#9ccfa3"}`,
            }}>{msg.text}</div>
          )}

          <button onClick={submit} disabled={busy} style={{
            width: "100%", marginTop: 14, padding: "14px", borderRadius: 11, border: "none", cursor: "pointer",
            background: C.shu, color: C.paper, fontWeight: 700, fontSize: 15, fontFamily: FONT_BODY, opacity: busy ? .6 : 1,
          }}>{busy ? "…" : mode === "signin" ? "Sign in" : "Create account"}</button>

          <div style={{ textAlign: "center", marginTop: 16, fontSize: 13, color: C.aiSoft, fontFamily: FONT_BODY }}>
            {mode === "signin" ? "New here? " : "Already have an account? "}
            <button onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setMsg(null); }} style={{
              border: "none", background: "transparent", color: C.shu, cursor: "pointer", fontWeight: 700,
              fontFamily: FONT_BODY, fontSize: 13, padding: 0,
            }}>{mode === "signin" ? "Create one" : "Sign in"}</button>
          </div>
        </div>

        {!supabase && (
          <p style={{ color: C.kinari, opacity: .7, fontSize: 12.5, fontFamily: FONT_BODY, textAlign: "center", marginTop: 16, lineHeight: 1.6 }}>
            Database isn't configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Vercel to enable accounts.
          </p>
        )}
      </div>
    </div>
  );
}
const authInput = {
  width: "100%", padding: "13px 14px", borderRadius: 10, fontSize: 15, border: `1.5px solid ${C.mist}`,
  background: C.kinari, outline: "none", fontFamily: FONT_BODY, color: C.sumi, boxSizing: "border-box",
};

// ─────────────────────────────────────────────────────────────
//  ROOT
// ─────────────────────────────────────────────────────────────
const TABS = [
  { k: "chat", jp: "会話", en: "Chat" },
  { k: "alpha", jp: "文字", en: "Alphabet" },
  { k: "vocab", jp: "単語", en: "Vocab" },
  { k: "dict", jp: "辞書", en: "Dictionary" },
  { k: "trans", jp: "翻訳", en: "Translate" },
  { k: "settings", jp: "設定", en: "Settings" },
];

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = still checking
  const [userKey, setUserKey] = useState(0); // bump to remount MainApp on user switch

  useEffect(() => {
    let prevUser = null;
    getSession().then((s) => {
      setSession(s);
      prevUser = s?.user?.id || null;
      setUserId(prevUser);
    });
    const unsub = onAuthChange((s) => {
      const newUser = s?.user?.id || null;
      setUserId(newUser);
      setSession(s);
      // If the user actually changed, remount MainApp so no stale data lingers.
      if (newUser !== prevUser) { prevUser = newUser; setUserKey((k) => k + 1); }
    });
    return unsub;
  }, []);

  if (session === undefined) {
    // Brief loading state while we check for an existing session.
    return <div style={{ minHeight: "100vh", background: C.ai }} />;
  }
  if (!session) return <AuthScreen />;
  return <MainApp key={userKey} userEmail={session.user?.email} />;
}

function MainApp({ userEmail }) {
  const [tab, setTab] = useState("chat");
  const [learned, setLearned] = useState([]);      // array of [jp, romaji, en]
  const [streak, setStreak] = useState(0);
  const [activeDays, setActiveDays] = useState([]); // ["YYYY-MM-DD", ...]
  const [mistakes, setMistakes] = useState([]);     // [{original,fixed,romaji,note,at}]
  const [settings, setSettings] = useState(defaultSettings);
  const [modal, setModal] = useState(null);         // "streak" | "words" | null

  // load + streak on mount
  useEffect(() => {
    setActiveSettings(defaultSettings); // start clean for this user
    (async () => {
      const p = await loadProfile();
      const today = todayStr();
      let nextStreak = 1;
      let nextLearned = [];
      let nextActive = [];
      if (p) {
        // Migrate old format (array of strings) → array of [jp,romaji,en].
        nextLearned = (p.learned || []).map((x) => Array.isArray(x) ? x : [x, "", ""]);
        nextActive = p.active_days || [];
        setMistakes(p.mistakes || []);
        if (p.settings && p.settings.keys) {
          const merged = {
            keys: { ...defaultSettings.keys, ...p.settings.keys },
            order: p.settings.order && p.settings.order.length === 3 ? p.settings.order : defaultSettings.order,
          };
          setSettings(merged);
          setActiveSettings(merged);
        }
        if (p.last_active === today) nextStreak = p.streak || 1;
        else {
          const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
          nextStreak = p.last_active === yesterday ? (p.streak || 0) + 1 : 1;
        }
      }
      if (!nextActive.includes(today)) nextActive = [...nextActive, today];
      setLearned(nextLearned); setStreak(nextStreak); setActiveDays(nextActive);
      saveProfile({ learned: nextLearned, streak: nextStreak, last_active: today, active_days: nextActive });
      window.speechSynthesis?.getVoices();
    })();
  }, []);

  // card is [jp, romaji, en]; toggle by matching the jp string.
  function toggleLearned(card) {
    setLearned((prev) => {
      const jp = card[0];
      const has = prev.some((x) => x[0] === jp);
      const next = has ? prev.filter((x) => x[0] !== jp) : [...prev, card];
      saveProfile({ learned: next, streak, last_active: todayStr(), active_days: activeDays });
      return next;
    });
  }

  // record a correction permanently when the tutor flags a mistake.
  function logMistake(m) {
    setMistakes((prev) => {
      const next = [{ ...m, at: new Date().toISOString() }, ...prev].slice(0, 500);
      saveProfile({ mistakes: next });
      return next;
    });
  }

  return (
    <div style={{ fontFamily: FONT_BODY, background: C.kinari, minHeight: "100vh", color: C.sumi, display: "flex", justifyContent: "center" }}>
      <style>{`
        @keyframes pulse { 0%,100%{transform:scale(1);box-shadow:0 0 0 0 rgba(212,69,47,.5)} 50%{transform:scale(1.06);box-shadow:0 0 0 10px rgba(212,69,47,0)} }
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        body { margin: 0; }
        @media (prefers-reduced-motion: reduce){ *{animation:none!important} }
        ::-webkit-scrollbar{width:8px} ::-webkit-scrollbar-thumb{background:${C.mist};border-radius:4px}
      `}</style>
      <div style={{ width: "100%", maxWidth: 560, display: "flex", flexDirection: "column", height: "100vh" }}>
        <header style={{ padding: "20px 20px 14px", display: "flex", alignItems: "center", gap: 14 }}>
          <Seal label="日" />
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0, fontFamily: FONT_DISPLAY, fontSize: 26, color: C.ai, letterSpacing: 1, lineHeight: 1 }}>
              日本語 <span style={{ fontSize: 14, fontFamily: FONT_BODY, color: C.aiSoft, fontWeight: 400 }}>Tutor</span>
            </h1>
            <div style={{ fontSize: 12, color: C.aiSoft, opacity: .8, marginTop: 4 }}>Beginner · speak, read & translate</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Stat icon="🔥" value={streak} label="streak" onClick={() => setModal("streak")} />
            <Stat icon="📚" value={learned.length} label="words" onClick={() => setModal("words")} />
          </div>
        </header>
        <main style={{ flex: 1, overflowY: "auto", padding: "4px 20px 16px", minHeight: 0 }}>
          {tab === "chat" && <div style={{ height: "100%" }}><ChatTab logMistake={logMistake} /></div>}
          {tab === "alpha" && <AlphabetTab />}
          {tab === "vocab" && <VocabTab learned={learned} toggleLearned={toggleLearned} />}
          {tab === "dict" && <DictionaryTab learned={learned} toggleLearned={toggleLearned} />}
          {tab === "trans" && <TranslateTab />}
          {tab === "settings" && <SettingsTab settings={settings} setSettings={setSettings} userEmail={userEmail} mistakes={mistakes} setMistakes={setMistakes} />}
        </main>
        <nav style={{ display: "flex", borderTop: `1px solid ${C.mist}`, background: C.paper, paddingBottom: "env(safe-area-inset-bottom)", overflowX: "auto" }}>
          {TABS.map((t) => (
            <button key={t.k} onClick={() => setTab(t.k)} style={{
              flex: "1 0 auto", minWidth: 58, padding: "12px 2px 14px", border: "none", cursor: "pointer", background: "transparent",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
              borderTop: `3px solid ${tab === t.k ? C.shu : "transparent"}`,
              color: tab === t.k ? C.ai : C.aiSoft, opacity: tab === t.k ? 1 : .55,
            }}>
              <span style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 600 }}>{t.jp}</span>
              <span style={{ fontSize: 10, fontFamily: FONT_BODY, letterSpacing: .3 }}>{t.en}</span>
            </button>
          ))}
        </nav>
      </div>

      {modal === "streak" && <StreakModal streak={streak} activeDays={activeDays} onClose={() => setModal(null)} />}
      {modal === "words" && <WordsModal learned={learned} onClose={() => setModal(null)} />}
    </div>
  );
}

function Stat({ icon, value, label, onClick }) {
  return (
    <button onClick={onClick} style={{
      textAlign: "center", background: C.paper, borderRadius: 10, padding: "6px 12px",
      border: `1px solid ${C.mist}`, minWidth: 52, cursor: onClick ? "pointer" : "default", fontFamily: FONT_BODY,
    }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: C.ai, fontFamily: FONT_DISPLAY }}>{icon} {value}</div>
      <div style={{ fontSize: 9.5, color: C.aiSoft, letterSpacing: .5, textTransform: "uppercase" }}>{label}</div>
    </button>
  );
}
