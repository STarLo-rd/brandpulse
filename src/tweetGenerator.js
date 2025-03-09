const tweetSchema = require("./schema/tweetSchema");
const crypto = require("crypto");

// Predefined tweet templates
const tweetTemplates = [
  "{brand} is {positiveAdj}!",
  "I {positiveVerb} {brand}!",
  "{brand} tastes {negativeAdj}",
  "Just tried {brand}, feeling {neutralAdj}",
  "Why does {brand} have to be so {negativeAdj}?",
  "Drinking {brand} today, it’s {neutralAdj}",
];

// Sentiment-specific word banks
const wordBanks = {
  positiveAdj: ["awesome", "great", "fantastic", "delicious", "amazing"],
  positiveVerb: ["love", "enjoy", "adore", "appreciate"],
  negativeAdj: ["awful", "terrible", "gross", "disappointing", "bad"],
  neutralAdj: ["okay", "fine", "normal", "average", "meh"],
};

// Default sentiment distribution for fixed mode
// const DEFAULT_SENTIMENT_DISTRIBUTION = {
//   positive: 0.33,
//   negative: 0.33,
//   neutral: 0.34,
// };

// Function to generate a tweet pool
const generateTweetPool = ({
  size = 1000,
  brand = "SuperCoffee",
  sentimentDistribution, // Used only in fixed mode
  mode = "fixed", // "fixed" or "volatile"
} = {}) => {
  const pool = [];

  // Fixed mode: Normalize user-provided sentiment distribution
  let fixedSentiments;
  if (mode === "fixed") {
    const { positive, negative, neutral } = sentimentDistribution;
    const total = (positive || 0) + (negative || 0) + (neutral || 0);
    if (total === 0) throw new Error("Sentiment distribution percentages must sum to a non-zero value");

    fixedSentiments = {
      positive: (positive || 0) / total,
      negative: (negative || 0) / total,
      neutral: (neutral || 0) / total,
    };
  }

  for (let i = 0; i < size; i++) {
    let sentiment;
    if (mode === "fixed") {
      // Fixed mode: Use normalized user-defined percentages
      const rand = Math.random();
      sentiment =
        rand < fixedSentiments.positive
          ? "positive"
          : rand < fixedSentiments.positive + fixedSentiments.negative
          ? "negative"
          : "neutral";
    } else if (mode === "volatile") {
      // Volatile mode: Fully random sentiment with high variability
      const rand = Math.random();
      sentiment =
        rand < 0.33 ? "positive" : rand < 0.66 ? "negative" : "neutral";
      // Note: In volatile mode, we regenerate sentiment per batch later
    } else {
      throw new Error("Invalid mode. Use 'fixed' or 'volatile'.");
    }

    // Pick a random template
    const template = tweetTemplates[Math.floor(Math.random() * tweetTemplates.length)];
    let text = template.replace("{brand}", brand);

    // Replace placeholders based on sentiment
    if (template.includes("{positiveAdj}")) {
      text = text.replace(
        "{positiveAdj}",
        wordBanks.positiveAdj[Math.floor(Math.random() * wordBanks.positiveAdj.length)]
      );
    } else if (template.includes("{positiveVerb}")) {
      text = text.replace(
        "{positiveVerb}",
        wordBanks.positiveVerb[Math.floor(Math.random() * wordBanks.positiveVerb.length)]
      );
    } else if (template.includes("{negativeAdj}")) {
      text = text.replace(
        "{negativeAdj}",
        wordBanks.negativeAdj[Math.floor(Math.random() * wordBanks.negativeAdj.length)]
      );
    } else if (template.includes("{neutralAdj}")) {
      text = text.replace(
        "{neutralAdj}",
        wordBanks.neutralAdj[Math.floor(Math.random() * wordBanks.neutralAdj.length)]
      );
    }

    pool.push({
      value: tweetSchema.toBuffer({
        tweetId: crypto.randomUUID(),
        timestamp: Date.now(),
        text,
        brand,
        sentiment,
      }),
    });
  }

  return pool;
};

// Function to adjust sentiment distribution per batch in volatile mode
const adjustBatchSentiment = (batch, volatilityFactor = 0.8) => {
  // Volatility factor: Higher value = more extreme swings (0 to 1)
  const positiveWeight = Math.random() * volatilityFactor + (1 - volatilityFactor) * 0.33;
  const negativeWeight = Math.random() * (1 - positiveWeight) * volatilityFactor + (1 - volatilityFactor) * 0.33;
  const neutralWeight = 1 - positiveWeight - negativeWeight;

  return batch.map((message) => {
    const rand = Math.random();
    const sentiment =
      rand < positiveWeight
        ? "positive"
        : rand < positiveWeight + negativeWeight
        ? "negative"
        : "neutral";

    const template = tweetTemplates[Math.floor(Math.random() * tweetTemplates.length)];
    let text = template.replace("{brand}", "SuperCoffee");

    if (template.includes("{positiveAdj}")) {
      text = text.replace(
        "{positiveAdj}",
        wordBanks.positiveAdj[Math.floor(Math.random() * wordBanks.positiveAdj.length)]
      );
    } else if (template.includes("{positiveVerb}")) {
      text = text.replace(
        "{positiveVerb}",
        wordBanks.positiveVerb[Math.floor(Math.random() * wordBanks.positiveVerb.length)]
      );
    } else if (template.includes("{negativeAdj}")) {
      text = text.replace(
        "{negativeAdj}",
        wordBanks.negativeAdj[Math.floor(Math.random() * wordBanks.negativeAdj.length)]
      );
    } else if (template.includes("{neutralAdj}")) {
      text = text.replace(
        "{neutralAdj}",
        wordBanks.neutralAdj[Math.floor(Math.random() * wordBanks.neutralAdj.length)]
      );
    }

    return {
      value: tweetSchema.toBuffer({
        tweetId: crypto.randomUUID(),
        timestamp: Date.now(),
        text,
        brand: "SuperCoffee",
        sentiment,
      }),
    };
  });
};

module.exports = { generateTweetPool, adjustBatchSentiment };