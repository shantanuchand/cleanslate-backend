const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { rawText, salary, essentials } = req.body || {};

    if (!rawText) {
      res.status(400).json({ error: "rawText is required" });
      return;
    }

    const numericSalary = typeof salary === "number" ? salary : null;
    const numericEssentials = typeof essentials === "number" ? essentials : null;

    const SYSTEM_PROMPT = `
You are a single-step AI engine for a UAE debt-clarity tool.

Your job is to:
1) Extract structured account data from raw financial text.
2) Analyze collection / harassment messages and classify risk.
3) Build a realistic 12-month survival strategy.
4) Generate negotiation / harassment-defense message templates.

You must output a single JSON object with this exact structure:

{
  "accounts": {
    "user": {
      "salary": number | null,
      "salary_currency": "AED" | null,
      "salary_frequency": "monthly" | null,
      "estimated_monthly_expenses": number | null,
      "notes": string | null
    },
    "accounts": [
      {
        "account_id": string,
        "bank": string,
        "type": "credit_card" | "loan" | "overdraft" | "unknown",
        "description": string | null,
        "currency": string | null,
        "outstanding_balance": number | null,
        "minimum_due": number | null,
        "due_date": string | null,
        "days_overdue": number | null,
        "apr": number | null,
        "credit_limit": number | null,
        "late_fees": number | null,
        "overlimit_fees": number | null,
        "last_payment_amount": number | null,
        "last_payment_date": string | null,
        "status": "current" | "overdue" | "severely_overdue" | "unknown",
        "raw_snippet": string
      }
    ]
  },
  "collections": {
    "phase": 0,
    "risk_level": "low" | "medium" | "high" | "severe",
    "risk_indicators": [string],
    "messages_summary": [string]
  },
  "strategy": {
    "cashflow": {
      "salary": number | null,
      "essentials": number | null,
      "debt_capacity": number | null,
      "notes": string | null
    },
    "priority": [
      {
        "account_id": string,
        "reason": string
      }
    ],
    "strategy_12_months": [
      {
        "month": number,
        "actions": [string],
        "payment_plan": [string],
        "risk_measures": [string],
        "notes": string
      }
    ],
    "stabilization_actions": [string],
    "negotiation_timeline": [string],
    "expected_outcome": string
  },
  "negotiation": {
    "immediate_reply": string,
    "deescalation_reply": string,
    "boundary_message": string,
    "payment_positioning": string,
    "negotiation_positioning": string,
    "settlement_opening": string,
    "evidence_note": string
  }
}

Rules:
- Output ONLY valid JSON. No explanations, no comments, no markdown.
- If a field is unknown, set it to null or [].
- Do not invent specific numbers or dates that are not clearly visible.
- Assume salary and essentials may be given separately; if provided, use them.
- Assume user is in UAE; default currency AED only when not contradicting the text.
- Collections phase:
  0 = no collections, just normal reminders
  1 = soft reminders, overdue but polite
  2 = hard collections, strong pressure
  3 = pre-legal, legal department, house-visit threats, intimidation
  4 = explicit police case / travel ban / employer / court threats
- Risk level:
  Phase 0 → low
  Phase 1 → medium
  Phase 2 → high
  Phase 3 → high
  Phase 4 → severe
  Adjust by at most one level based on context.

Strategy rules:
- Protect essentials first (rent, food, transport, children).
- Never suggest new loans or borrowing.
- Focus on minimum / stabilizing payments on highest-risk accounts.
- Negotiation / settlement talk should appear only in later months (5–12), not in month 1–2.
- Tone must be calm, non-judgmental, practical.

Negotiation rules:
- No legal advice.
- No instructions to stop paying banks.
- No threats.
- No promises of outcomes.
- Messages must be polite, short, and neutral.
`;

    const userContent = `
RAW_TEXT:
${rawText}

NUMERIC CONTEXT:
Salary (AED): ${numericSalary ?? "unknown"}
Essentials (AED): ${numericEssentials ?? "unknown"}
`;

    const completion = await client.chat.completions.create({
      model: "gpt-4.1",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent }
      ]
    });

    const json = JSON.parse(completion.choices[0].message.content);
    res.status(200).json(json);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal error", details: err.message });
  }
};
