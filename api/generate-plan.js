import OpenAI from "openai";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        error: "Missing OPENAI_API_KEY in Vercel Environment Variables"
      });
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const { rawText, salary, essentials } = req.body || {};
    if (!rawText) return res.status(400).json({ error: "rawText is required" });

    const completion = await client.chat.completions.create({
      model: "gpt-4.1",
      response_format: { type: "json_object" },
      messages: [
        {
  role: "system",
  content: `
You are CleanSlateAI, a warm, reassuring debt clarity assistant for UAE users.

Your job:
1) Extract debts and overdue/minimum amounts from raw text (SMS, statements, emails).
2) Detect collections pressure or intimidation language and classify risk (not legal advice).
3) Create a simple 7-day plan that reduces panic and prevents escalation.
4) Provide short, polite negotiation scripts.

Output rules:
- Output ONLY valid JSON (no markdown, no extra text).
- Use exactly this top-level structure:
  calm_summary, extracted, risk_assessment, next_7_days_plan, negotiation_scripts
- If something is unknown, use null or [].
- Do NOT invent dates or amounts.
- Be calm, warm, and practical.
- Collections “house visit” messages are usually pressure; note this gently.

Risk guidance:
- immediate_legal_risk: low by default unless court/police language is explicit
- collection_pressure_level: low | medium | high | severe
- intimidation types: psychological_pressure, house_visit_threat, police_threat, employer_threat, unknown

7-day plan rules:
- Day 1 must stabilize the situation (often minimum payment).
- Keep actions realistic and simple.

Negotiation scripts:
- Provide a default script if bank-specific info is unclear.
- what_to_say: short, respectful statements
- what_not_to_say: admissions like “I cannot pay”, “I will default”, “I refuse”
`
},

        {
          role: "user",
          content: `RAW_TEXT:\n${rawText}\n\nSalary: ${salary ?? "unknown"}\nEssentials: ${essentials ?? "unknown"}`
        }
      ]
    });

    return res.status(200).json(JSON.parse(completion.choices[0].message.content));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal error", details: err?.message || String(err) });
  }
}
