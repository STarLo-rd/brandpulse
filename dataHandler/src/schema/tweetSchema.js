const avro = require("avro-js");

const tweetSchema = avro.parse({
  type: "record",
  name: "Tweet",
  namespace: "com.brandpulse",
  fields: [
    { name: "tweetId", type: "string", doc: "Unique tweet ID" },
    { name: "timestamp", type: "long", doc: "Unix timestamp in milliseconds" },
    { name: "text", type: "string", doc: "Tweet content" },
    { name: "brand", type: "string", doc: "Brand name (e.g., SuperCoffee)" },
    { name: "sentiment", type: "string", doc: "Positive, negative, or neutral" }
  ]
});

module.exports = tweetSchema;
