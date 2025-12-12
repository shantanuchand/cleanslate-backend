import OpenAI from "openai";

const SYSTEM_PROMPT = `You are CleanSlateAI, a warm, reassuring debt clarity assistant for UAE users.

Return ONLY valid JSON (no markdown, no extra text).

You MUST output EXACTLY this top-level structure and types:

{
  "calm_summary": {
    "status": "stable_but_attention_required|urgent_but_manageable",
    "plain_english": "string",
    "what_to_do_first": "string",
    "why_this_matters": "string"
  },
  "extracted": {
    "salary": number|null,
    "essentials": number|null,
    "disposable_income": number|null,
    "debts": [
      {
        "account_name": "string",
        "type": "credit_card|loan|unknown",
        "currency": "string|null",
        "minimum_due": number|null,
        "total_due": number|null,
        "due_date": "string|null",
        "raw_snippet": "string|null"
      }
    ],
    "collection_messages": [
      {
        "text": "string",
        "source": "string|null",
        "risk_tag": "info|pressure|intimidation|legal_claim",
        "note": "string"
      }
    ]
  },
  "risk_assessment": {
    "immediate_legal_risk": "low|medium|high",
    "collection_pressure_level": "low|medium|high|severe",
    "detected_intimidation": [
      {
        "text": "string",
        "classification": "psychological_pressure|house_visit_threat|police_threat|employer_threat|unknown",
        "note": "string"
      }
    ],
    "stability_score_0_to_100": number|null
  },
  "next_7_days_plan": [
    { "day": number, "action": "string", "reason": "string", "estimated_cost": number|null }
  ],
  "negotiation_scripts": {
    "default": {
      "when_to_contact": "string",
      "what_to_say": ["string"],
      "what_not_to_say": ["string"],
      "follow_up_window_days": number
    }
  }
}

Hard rules:
- Do NOT add any other keys. Do NOT rename keys.
- Do NOT change types. Objects must remain objects. Arrays must remain arrays of objects.
- If unknown: use null or [].
- Do NOT invent dates or amounts.
- estimated_cost must be null unless the amount is explicitly present in RAW_TEXT or in the user-provided salary/essentials/minimum_due numbers.
- Keep tone warm, steady. No legal advice.

Plan priority:
- If a minimum_due exists and disposable_income allows, Day 1 MUST be paying that minimum due.

Safety wording:
- For pressure/house visits: keep advice general (stay calm, use official channels, do not share OTP/PIN, keep records). Avoid legal directives.

Stability score (0–100) MUST follow this exact calculation:
- If salary and essentials are numbers: disposable_income = salary - essentials.
- Start at 70 if disposable_income >= 0, else start at 45.
- Subtract 10 if any detected_intimidation.classification == "house_visit_threat".
- Subtract 20 if any detected_intimidation.classification == "police_threat" OR explicit court/legal notice language exists.
- If minimum_due values exist, sum them; subtract 15 if disposable_income < sum(minimum_dues).
- Clamp 0..100.
- Output MUST equal the computed value.

Negotiation scripts:
- negotiation_scripts MUST always include "default".
- If specific creditors are identified, include additional keys inside negotiation_scripts using the creditor account_name exactly,
  each value matching the same structure as default.`;

function toNumberOrNull(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function looksLikeThreatText(s) {
  if (!s) return false;
  const t = String(s).toLowerCase();
  return (
    t.includes("visit your house") ||
    t.includes("visit your home") ||
    t.includes("team will visit") ||
    t.includes("collection team will visit")
  );
}

// Post-process to enforce schema even if the model drifts
function normalizeOutput(obj, salary, essentials) {
  const safe = {};

  // calm_summary
  safe.calm_summary = {
    status: obj?.calm_summary?.status ?? "urgent_but_manageable",
    plain_english: String(obj?.calm_summary?.plain_english ?? "").slice(0, 1000),
    what_to_do_first: String(obj?.calm_summary?.what_to_do_first ?? "").slice(0, 600),
    why_this_matters: String(obj?.calm_summary?.why_this_matters ?? "").slice(0, 600),
  };

  // extracted
  const sal = toNumberOrNull(salary ?? obj?.extracted?.salary);
  const ess = toNumberOrNull(essentials ?? obj?.extracted?.essentials);
  const disp = (sal !== null && ess !== null) ? sal - ess : toNumberOrNull(obj?.extracted?.disposable_income);

  const debts = Array.isArray(obj?.extracted?.debts) ? obj.extracted.debts : [];
  const normDebts = debts.map((d) => ({
    account_name: String(d?.account_name ?? ""),
    type: (d?.type === "credit_card" || d?.type === "loan" || d?.type === "unknown") ? d.type : "unknown",
    currency: d?.currency === null || d?.currency === undefined ? null : String(d.currency),
    minimum_due: toNumberOrNull(d?.minimum_due),
    total_due: toNumberOrNull(d?.total_due),
    due_date: d?.due_date === null || d?.due_date === undefined ? null : String(d.due_date),
    raw_snippet: d?.raw_snippet === null || d?.raw_snippet === undefined ? null : String(d.raw_snippet),
  })).filter(d => d.account_name);

  const cms = Array.isArray(obj?.extracted?.collection_messages) ? obj.extracted.collection_messages : [];
  const normMsgs = cms.map((m) => ({
    text: String(m?.text ?? ""),
    source: m?.source === null || m?.source === undefined ? null : String(m.source),
    risk_tag: (m?.risk_tag === "info" || m?.risk_tag === "pressure" || m?.risk_tag === "intimidation" || m?.risk_tag === "legal_claim")
      ? m.risk_tag
      : "pressure",
    note: String(m?.note ?? ""),
  })).filter(m => m.text);

  safe.extracted = {
    salary: sal,
    essentials: ess,
    disposable_income: disp !== undefined ? toNumberOrNull(disp) : null,
    debts: normDebts,
    collection_messages: normMsgs,
  };

  // risk_assessment
  const ra = obj?.risk_assessment ?? {};
  const detected = Array.isArray(ra?.detected_intimidation) ? ra.detected_intimidation : [];
  const normDetected = detected.map((x) => ({
    text: String(x?.text ?? ""),
    classification:
      (x?.classification === "psychological_pressure" ||
        x?.classification === "house_visit_threat" ||
        x?.classification === "police_threat" ||
        x?.classification === "employer_threat" ||
        x?.classification === "unknown")
        ? x.classification
        : "unknown",
    note: String(x?.note ?? ""),
  })).filter(x => x.text);

  // If model forgot intimidation but message contains threat, add it
  const hasThreatMsg = normMsgs.some(m => looksLikeThreatText(m.text));
  const hasThreatDetected = normDetected.some(x => x.classification === "house_visit_threat");
  if (hasThreatMsg && !hasThreatDetected) {
    normDetected.push({
      text: normMsgs.find(m => looksLikeThreatText(m.text))?.text || "house visit mentioned",
      classification: "house_visit_threat",
      note: "House visit language is typically used as pressure; it does not automatically mean legal action.",
    });
  }

  const immediateLegal =
    (ra?.immediate_legal_risk === "low" || ra?.immediate_legal_risk === "medium" || ra?.immediate_legal_risk === "high")
      ? ra.immediate_legal_risk
      : "low";

  const pressure =
    (ra?.collection_pressure_level === "low" || ra?.collection_pressure_level === "medium" || ra?.collection_pressure_level === "high" || ra?.collection_pressure_level === "severe")
      ? ra.collection_pressure_level
      : (hasThreatMsg ? "high" : "medium");

  // Compute stability score strictly
  const disposable = toNumberOrNull(safe.extracted.disposable_income);
  let score = (disposable !== null && disposable >= 0) ? 70 : 45;

  const hasHouseThreat = normDetected.some(x => x.classification === "house_visit_threat");
  if (hasHouseThreat) score -= 10;

  const hasPoliceThreat = normDetected.some(x => x.classification === "police_threat");
  if (hasPoliceThreat) score -= 20;

  const minSum = normDebts.reduce((acc, d) => acc + (toNumberOrNull(d.minimum_due) ?? 0), 0);
  if (minSum > 0 && disposable !== null && disposable < minSum) score -= 15;

  score = clamp(score, 0, 100);

  safe.risk_assessment = {
    immediate_legal_risk: immediateLegal,
    collection_pressure_level: pressure,
    detected_intimidation: normDetected,
    stability_score_0_to_100: score,
  };

  // next_7_days_plan: prefer Day 1 = pay minimum if possible
  const plan = Array.isArray(obj?.next_7_days_plan) ? obj.next_7_days_plan : [];
  const normPlan = plan.map((p) => ({
    day: toNumberOrNull(p?.day) ?? null,
    action: String(p?.action ?? ""),
    reason: String(p?.reason ?? ""),
    estimated_cost: toNumberOrNull(p?.estimated_cost),
  })).filter(p => p.action);

  // Enforce days if missing
  const withDays = normPlan.map((p, idx) => ({
    ...p,
    day: p.day ?? (idx + 1),
  }));

  // Ensure Day 1 is minimum payment if possible
  const firstMinDebt = normDebts.find(d => d.minimum_due !== null);
  if (firstMinDebt && disposable !== null && disposable >= (firstMinDebt.minimum_due ?? 0)) {
    // Put a Day 1 payment action at the top
    const day1 = {
      day: 1,
      action: `Pay the minimum due for ${firstMinDebt.account_name}.`,
      reason: "This stabilizes the situation, reduces fees, and lowers collection pressure.",
      estimated_cost: firstMinDebt.minimum_due,
    };
    // Remove any existing day=1 item, then prepend
    const rest = withDays.filter(x => x.day !== 1);
    safe.next_7_days_plan = [day1, ...rest].slice(0, 7);
  } else {
    safe.next_7_days_plan = withDays.slice(0, 7);
  }

  // negotiation_scripts: default + creditor-specific
  const ns = obj?.negotiation_scripts ?? {};
  const def = ns?.default ?? {};
  const normDefault = {
    when_to_contact: String(def?.when_to_contact ?? "Within 1–2 days, using official bank channels."),
    what_to_say: Array.isArray(def?.what_to_say) ? def.what_to_say.map(String).slice(0, 6) : [],
    what_not_to_say: Array.isArray(def?.what_not_to_say) ? def.what_not_to_say.map(String).slice(0, 8) : ["I cannot pay", "I will default", "I refuse"],
    follow_up_window_days: toNumberOrNull(def?.follow_up_window_days) ?? 7,
  };

  if (normDefault.what_to_say.length === 0) {
    normDefault.what_to_say = [
      "Hello, I received your reminder and I want to resolve this responsibly.",
      "I can make a payment now and I’m requesting options for a simple payment plan or extra time.",
      "Please confirm the current outstanding amount and the best official channel to proceed.",
    ];
  }

  const scriptsOut = { default: normDefault };

  // add creditor-specific scripts if model provided them OR generate simple ones
  for (const d of normDebts) {
    const k = d.account_name;
    const existing = ns?.[k];
    if (existing && typeof existing === "object") {
      scriptsOut[k] = {
        when_to_contact: String(existing?.when_to_contact ?? "Within 1–3 days via official channels."),
        what_to_say: Array.isArray(existing?.what_to_say) ? existing.what_to_say.map(String).slice(0, 6) : normDefault.what_to_say,
        what_not_to_say: Array.isArray(existing?.what_not_to_say) ? existing.what_not_to_say.map(String).slice(0, 8) : normDefault.what_not_to_say,
        follow_up_window_days: toNumberOrNull(existing?.follow_up_window_days) ?? 7,
      };
    } else {
      const lines = [];
      lines.push("Hello, I acknowledge the payment reminder for my account.");
      if (d.minimum_due !== null) lines.push("I am making the minimum payment now and would like confirmation once it reflects.");
      lines.push("Please share any available options for a payment plan or a short extension.");
      scriptsOut[k] = {
        when_to_contact: "Within 1–2 days via official channels, ideally after any payment is made.",
        what_to_say: lines,
        what_not_to_say: normDefault.what_not_to_say,
        follow_up_window_days: 7,
      };
    }
  }

  safe.negotiation_scripts = scriptsOut;

  // If the model left calm_summary fields empty, fill with warm defaults
  if (!safe.calm_summary.plain_english) {
    safe.calm_summary.plain_english =
      "I can see you have overdue card payments and a pressure message. The good news is: you can stabilize this with one small step first, then a calm plan over the next few days.";
  }
  if (!safe.calm_summary.what_to_do_first) {
    safe.calm_summary.what_to_do_first =
      "Start by paying any known minimum due you can afford, then contact the bank through official channels to confirm the updated balance and options.";
  }
  if (!safe.calm_summary.why_this_matters) {
    safe.calm_summary.why_this_matters =
      "Paying the minimum and communicating early usually reduces fees, lowers pressure, and helps you regain control.";
  }

  return safe;
}

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

    const { rawText, salary, essentials } = req.body || {};
    if (!rawText) {
      return res.status(400).json({ error: "rawText is required" });
    }

    const client = new OpenAI({ apiKey });

    const userContent =
      `RAW_TEXT:\n${rawText}\n\n` +
      `salary: ${salary ?? "unknown"}\n` +
      `essentials: ${essentials ?? "unknown"}\n`;

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

    let rawJson;
    try {
      rawJson = JSON.parse(text);
    } catch (e) {
      return res.status(500).json({
        error: "Model returned invalid JSON",
        details: e?.message || String(e),
        raw: text.slice(0, 2000),
      });
    }

    const normalized = normalizeOutput(rawJson, salary, essentials);
    return res.status(200).json(normalized);
  } catch (err) {
    console.error("CleanSlateAI error:", err);
    return res.status(500).json({
      error: "Internal error",
      details: err?.message || String(err),
    });
  }
}
