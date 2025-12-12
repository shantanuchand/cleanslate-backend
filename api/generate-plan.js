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

Return ONLY valid JSON. No markdown. No extra keys.

You MUST output exactly this top-level structure and types:

{
  "calm_summary": {
    "status": "stable_but_attention_required|urgent_but_manageable",
    "plain_english": string,
    "what_to_do_first": string,
    "why_this_matters": string
  },
  "extracted": {
    "salary": number|null,
    "essentials": number|null,
    "disposable_income": number|null,
    "debts": [
      {
        "account_name": string,
        "type": "credit_card|loan|unknown",
        "currency": string|null,
        "minimum_due": number|null,
        "total_due": number|null,
        "due_date": string|null,
        "raw_snippet": string|null
      }
    ],
    "collection_messages": [
      {
        "text": string,
        "source": string|null,
        "risk_tag": "info|pressure|intimidation|legal_claim",
        "note": string
      }
    ]
  },
  "risk_assessment": {
    "immediate_legal_risk": "low|medium|high",
    "collection_pressure_level": "low|medium|high|severe",
    "detected_intimidation": [
      {
        "text": string,
        "classification": "psychological_pressure|house_visit_threat|police_threat|employer_threat|unknown",
        "note": string
      }
    ],
    "stability_score_0_to_100": number|null
  },
  "next_7_days_plan": [
    { "day": 1, "action": string, "reason": string, "estimated_cost": number|null }
  ],
  "negotiation_scripts": {
    "default": {
      "when_to_contact": string,
      "what_to_say": [string],
      "what_not_to_say": [string],
      "follow_up_window_days": number
    }
  }
}

Rules:
- Do NOT change types (objects must stay objects; arrays must stay arrays of objects).
- If unknown, use null or [].
- Do NOT invent dates or amounts.
- If salary and essentials are provided, compute disposable_income = salary - essentials.
- Classify “house visit” as intimidation/pressure (not automatically legal).
- Tone: warm, steady, reduces panic. No legal advice.
`

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
