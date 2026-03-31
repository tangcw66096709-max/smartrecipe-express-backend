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

function normalizeAnalysis(analysis) {
  const rawSteps = Array.isArray(analysis && analysis.steps)
    ? analysis.steps
    : [];

  const normalizedSteps = rawSteps.map((step, index) => ({
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

  return {
    recipeTitle:
      typeof (analysis && analysis.recipeTitle) === "string" &&
      analysis.recipeTitle.trim()
        ? analysis.recipeTitle.trim()
        : "Recipe",
    totalEstimatedSeconds: normalizedSteps.reduce(
      (sum, step) => sum + step.durationSeconds,
      0
    ),
    steps: normalizedSteps
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

    const shortInstructions =
      String(instructions).length > 2500
        ? String(instructions).slice(0, 2500)
        : String(instructions);

    const prompt = `
Return ONLY valid JSON.
Do not include markdown, explanation, notes, or code fences.

JSON format:
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

Recipe title: ${title}
Ingredients: ${ingredientsText}
Instructions: ${shortInstructions}
`;

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("DeepSeek request timed out")), 90000);
    });

    const fetchPromise = fetch("https://api.deepseek.com/v1/chat/completions", {
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
              "You are a recipe time estimation assistant. Return only valid JSON."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.1,
        max_tokens: 800
      })
    });

    const response = await Promise.race([fetchPromise, timeoutPromise]);
    const data = await response.json();

    if (!response.ok) {
      console.error("DeepSeek API error:", data);
      return res.status(response.status).json({
        error: "DeepSeek API request failed",
        details: data
      });
    }

    const content =
      data &&
      data.choices &&
      data.choices &&
      data.choices.message &&
      data.choices.message.content
        ? data.choices.message.content
        : null;

    if (!content || !content.trim()) {
      console.error("No content from DeepSeek:", data);
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
    } catch (parseError) {
      console.error("Raw AI content:", content);
      console.error("Cleaned AI content:", cleanedContent);
      console.error("Extracted JSON:", extractedJson);
      console.error("JSON parse error:", parseError.message);

      return res.status(500).json({
        error: "Failed to parse DeepSeek JSON response",
        parseMessage: parseError.message,
        rawContent: content
      });
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