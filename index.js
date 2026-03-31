const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/", (req, res) => {
  res.json({ message: "Smart Recipe Express backend is running." });
});

function cleanModelOutput(text) {
  if (!text || typeof text !== "string") return "";

  return text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function extractFirstJsonObject(text) {
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return text;
  }

  return text.slice(firstBrace, lastBrace + 1);
}

function basicRepairJson(text) {
  if (!text || typeof text !== "string") return text;

  let repaired = text;

  repaired = repaired.replace(/[\u201C\u201D]/g, '"');
  repaired = repaired.replace(/[\u2018\u2019]/g, "'");
  repaired = repaired.replace(/,\s*}/g, "}");
  repaired = repaired.replace(/,\s*]/g, "]");
  repaired = repaired.replace(/\\n\\t/g, " ");
  repaired = repaired.replace(/\r/g, " ");
  repaired = repaired.replace(/\n/g, " ");
  repaired = repaired.replace(/\t/g, " ");
  repaired = repaired.replace(/\s+/g, " ").trim();

  return repaired;
}

function normalizeAnalysis(analysis) {
  const safeRecipeTitle =
    analysis &&
    typeof analysis.recipeTitle === "string" &&
    analysis.recipeTitle.trim()
      ? analysis.recipeTitle.trim()
      : "Recipe";

  const rawSteps = Array.isArray(analysis && analysis.steps)
    ? analysis.steps
    : [];

  const steps = rawSteps.map((step, index) => ({
    stepNumber:
      Number(step && step.stepNumber) > 0
        ? Number(step.stepNumber)
        : index + 1,
    title:
      typeof (step && step.title) === "string" && step.title.trim()
        ? step.title.trim()
        : `Step ${index + 1}`,
    instruction:
      typeof (step && step.instruction) === "string" && step.instruction.trim()
        ? step.instruction.trim()
        : "No instruction",
    durationSeconds:
      Number(step && step.durationSeconds) > 0
        ? Number(step.durationSeconds)
        : 10,
    type:
      typeof (step && step.type) === "string" && step.type.trim()
        ? step.type.trim()
        : "cook"
  }));

  const totalEstimatedSeconds = steps.reduce(
    (sum, step) => sum + step.durationSeconds,
    0
  );

  return {
    recipeTitle: safeRecipeTitle,
    totalEstimatedSeconds,
    steps
  };
}

app.post("/analyzeRecipeTimer", async (req, res) => {
  try {
    const { title, ingredients, instructions } = req.body;

    if (!title || !ingredients || !instructions) {
      return res.status(400).json({
        error: "title, ingredients, and instructions are required"
      });
    }

    const ingredientsText = Array.isArray(ingredients)
      ? ingredients.join(", ")
      : String(ingredients);

    const safeInstructions =
      String(instructions).length > 3500
        ? String(instructions).slice(0, 3500)
        : String(instructions);

    const prompt = `
Return ONLY one valid JSON object.
Do not include markdown, code fences, comments, notes, or explanation text.

Use exactly this schema:
{
  "recipeTitle": "string",
  "totalEstimatedSeconds": number,
  "steps": [
    {
      "stepNumber": number,
      "title": "string",
      "instruction": "string",
      "durationSeconds": number,
      "type": "prep|cook|serve"
    }
  ]
}

Rules:
- Keep all fields present.
- stepNumber starts from 1 and increases by 1.
- durationSeconds must be a positive integer.
- totalEstimatedSeconds must equal the sum of all step durationSeconds.
- instruction must be short, clear, and valid JSON string text.
- Each step should summarize one cooking action.
- Do not return any extra keys.

Recipe title: ${title}
Ingredients: ${ingredientsText}
Instructions: ${safeInstructions}
`;

    const timeoutPromise = (ms) =>
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("DeepSeek request timed out")), ms);
      });

    const response = await Promise.race([
      fetch("https://api.deepseek.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [
            {
              role: "system",
              content:
                "You are a recipe time estimation assistant. Return only one valid JSON object. No markdown. No explanation."
            },
            {
              role: "user",
              content: prompt
            }
          ],
          temperature: 0.1,
          max_tokens: 900,
          response_format: { type: "json_object" }
        })
      }),
      timeoutPromise(120000)
    ]);

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: "DeepSeek API request failed",
        details: data
      });
    }

    const content = data && data.choices && data.choices && data.choices.message
      ? data.choices.message.content
      : null;

    if (!content) {
      return res.status(500).json({
        error: "No content returned from DeepSeek",
        details: data
      });
    }

    const cleanedContent = cleanModelOutput(content);
    const extractedJson = extractFirstJsonObject(cleanedContent);

    let analysis;

    try {
      analysis = JSON.parse(extractedJson);
    } catch (firstParseError) {
      try {
        const repairedJson = basicRepairJson(extractedJson);
        analysis = JSON.parse(repairedJson);
      } catch (secondParseError) {
        console.error("Raw AI content:", content);
        console.error("Cleaned AI content:", cleanedContent);
        console.error("Extracted JSON:", extractedJson);
        console.error("First parse error:", firstParseError.message);
        console.error("Second parse error:", secondParseError.message);

        return res.status(500).json({
          error: "Failed to parse DeepSeek JSON response",
          firstParseMessage: firstParseError.message,
          secondParseMessage: secondParseError.message,
          rawContent: content,
          cleanedContent,
          extractedJson
        });
      }
    }

    const normalized = normalizeAnalysis(analysis);

    if (!normalized.steps.length) {
      return res.status(500).json({
        error: "DeepSeek returned no valid steps",
        parsed: analysis
      });
    }

    return res.json(normalized);
  } catch (error) {
    console.error("Server error:", error);

    return res.status(500).json({
      error: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});