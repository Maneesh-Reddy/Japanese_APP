// Vercel Serverless Function — Japanese dictionary lookup via Jisho.org.
// Jisho's public API is free and needs no key, but doesn't allow browser
// (CORS) calls, so we proxy it here. Frontend calls /api/dictionary?q=word.

export default async function handler(req, res) {
  const q = (req.query.q || "").toString().trim();
  if (!q) return res.status(400).json({ error: "Missing search term" });

  try {
    const r = await fetch("https://jisho.org/api/v1/search/words?keyword=" + encodeURIComponent(q));
    if (!r.ok) return res.status(r.status).json({ error: "Dictionary lookup failed" });
    const data = await r.json();

    // Trim Jisho's verbose payload to just what the UI needs.
    const results = (data.data || []).slice(0, 20).map((entry) => {
      const jp = entry.japanese?.[0] || {};
      return {
        word: jp.word || jp.reading || "",
        reading: jp.reading || "",
        senses: (entry.senses || []).slice(0, 4).map((s) => ({
          meanings: s.english_definitions || [],
          partsOfSpeech: s.parts_of_speech || [],
        })),
        isCommon: !!entry.is_common,
        jlpt: entry.jlpt || [],
      };
    }).filter((e) => e.word || e.reading);

    return res.status(200).json({ results });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
