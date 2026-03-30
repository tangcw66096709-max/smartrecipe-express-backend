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

    return res.json({
      recipeTitle: title,
      totalEstimatedSeconds: 900,
      steps: [
        {
          stepNumber: 1,
          title: "Prepare ingredients",
          instruction: "Prepare and organize all ingredients.",
          durationSeconds: 180,
          type: "prep"
        },
        {
          stepNumber: 2,
          title: "Cook main ingredients",
          instruction: instructions,
          durationSeconds: 600,
          type: "cook"
        },
        {
          stepNumber: 3,
          title: "Serve",
          instruction: "Plate the dish and serve.",
          durationSeconds: 120,
          type: "serve"
        }
      ]
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});