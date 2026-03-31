const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ message: "Smart Recipe Express backend is running." });
});

app.post("/analyzeRecipeTimer", async (req, res) => {
  try {
    const { title, ingredients, instructions } = req.body;

    if (!title || !ingredients || !instructions) {
      return res.status(400).json({
        error: "title, ingredients, and instructions are required"
      });
    }

    const prompt = `
Analyze this recipe and return ONLY valid JSON.

Required JSON format:
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
Ingredients: ${Array.isArray(ingredients) ? ingredients.join(", ") : ingredients}
Instructions: ${instructions}
`;

    const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          {
            role: "system",
            content: "You are a recipe time estimation assistant. Return only valid JSON with no markdown."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.2,
        max_tokens: 1000
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: "DeepSeek API request failed",
        details: data
      });
    }

    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return res.status(500).json({
        error: "No content returned from DeepSeek",
        details: data
      });
    }

    const cleanedContent = content
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/, "");

    let analysis;
    try {
      analysis = JSON.parse(cleanedContent);
    } catch (parseError) {
      return res.status(500).json({
        error: "Failed to parse DeepSeek JSON response",
        rawContent: content
      });
    }

    return res.json(analysis);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});