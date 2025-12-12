import OpenAI from "openai";

const SYSTEM_PROMPT = `You are CleanSlateAI, a warm, reassuring debt clarity assistant.

Return ONLY valid JSON (no markdown, no extra keys). Use exactly this top-level structure:
calm_summary (object), extracted (object), risk_assessment (object), next_7_days_plan (array of objects), negotiation_scripts (object).

Rules:
- If unknown: use null or [].
- Do not invent dates or amounts.
- estimated_cost must be null unless explicitly stated in RAW_TEXT or user input.
- If salary and essentials are numbers: disposable_income = salary - essentials.
- "house visit" language is pressure/intimidation, not automatic legal action.
- Advice must be general and safety-focused (stay calm, use official channels, do not share OTP/PIN, keep records). No legal advice.

Stability score (0-100):
- If disposable_income >= 0 start 70 else start 45
- minus 10 if house_visit_threat exists
- minus 20 if police/court/legal notice language exists
- if minimum_due sum exists and disposable_income < sum(minimum_due) then minus 15
- clamp 0..100 and output must match calculation

Negotiation scripts:
- Always include negotiation_scripts.default
- Also include a script per creditor if detected
- what_not_to_say must be short phrases only`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: "Missing OPENAI_API_KEY in Vercel Environment Variables",
      });
    }

    const body = req.body || {};
    const rawText = body.rawText;
    const salary = body.salary;
    const essentials = body.essentials;

    if (!rawText) {
      return res.status(400).json({ error: "rawText is required" });
    }

    const client = new OpenAI({ apiKey });

    const userContent =
      `RAW_TEXT:\n${rawText}\n\n` +
      `salary: ${salary ?? "unknown"}\n` +
      `essentials: ${essentials ?? "unknown"}\n\n` +
      `Now produce the JSON with the required structure and types.`;

    const completion = await client.chat.completions.create({
      model: "gpt-4.1",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
    });

    const text = completion?.choices?.[0]?.message?.content;
    if (!text) {
      return res.status(500).json({ error: "Empty model response" });
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return res.status(500).json({
        error: "Model returned invalid JSON",
        details: e?.message || String(e),
        raw: text.slice(0, 2000),
      });
    }

    return res.status(200).json(parsed);
  } catch (err) {
    console.error("CleanSlateAI error:", err);
    return res.status(500).json({
      error: "Internal error",
      details: err?.message || String(err),
    });
  }
}
