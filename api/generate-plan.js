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
        { role: "system", content: "Return ONLY valid JSON." },
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
