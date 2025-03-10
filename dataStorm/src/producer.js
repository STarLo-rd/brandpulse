const { Kafka, Partitioners } = require("kafkajs");
const { Worker, isMainThread, parentPort, threadId } = require("worker_threads");
const os = require("os");
const { generateTweetPool, adjustBatchSentiment } = require("./tweetGenerator");
require("dotenv").config();

// Silence partitioner warning
process.env.KAFKAJS_NO_PARTITIONER_WARNING = "1";

// Configuration from .env or CLI args (CLI overrides .env)
const MODE = process.argv[2] || process.env.MODE || "fixed";
const SENTIMENT_DISTRIBUTION = {
  positive: parseFloat(process.argv[3] || process.env.SENTIMENT_POSITIVE || 0.33),
  negative: parseFloat(process.argv[4] || process.env.SENTIMENT_NEGATIVE || 0.33),
  neutral: parseFloat(process.argv[5] || process.env.SENTIMENT_NEUTRAL || 0.34),
};
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || 8000, 10);
const BATCH_INTERVAL_MS = parseInt(process.env.BATCH_INTERVAL_MS || 1, 10);
const VOLATILITY_FACTOR = parseFloat(process.env.VOLATILITY_FACTOR || 0.8);
const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || "localhost:9092").split(",");

// Kafka configuration
const kafkaConfig = {
  clientId: `dataStorm-producer-${process.pid}-${threadId}`,
  brokers: KAFKA_BROKERS,
  retry: {
    retries: 0,
    initialRetryTime: 50,
    maxRetryTime: 1000,
  },
  producer: {
    transactionTimeout: 30000,
    compression: null,
    maxInFlightRequests: 1000,
    idempotent: false,
    createPartitioner: Partitioners.LegacyPartitioner,
    allowAutoTopicCreation: false,
    batchSize: 32 * 1024 * 1024,
    lingerMs: 1,
    acks: 0,
    bufferMemory: Math.min(8 * 1024 * 1024 * 1024, Math.floor(os.totalmem() * 0.9)),
    socketTimeout: 60000,
    connectionTimeout: 30000,
  },
};

// Pre-generate tweet pool
const preSerializedTweets = generateTweetPool({
  size: 1000,
  brand: "SuperCoffee",
  sentimentDistribution: SENTIMENT_DISTRIBUTION,
  mode: MODE === "fixed" ? "fixed" : "volatile",
});

const generateBatch = () => {
  const baseBatch = Array(BATCH_SIZE)
    .fill(null)
    .map(() => {
      const { value } = preSerializedTweets[Math.floor(Math.random() * preSerializedTweets.length)];
      return { value: Buffer.from(value) };
    });

  if (MODE === "volatile") {
    return adjustBatchSentiment(baseBatch, VOLATILITY_FACTOR);
  }
  return baseBatch;
};

// Worker Logic
if (!isMainThread) {
  const producer = new Kafka(kafkaConfig).producer();

  const runProducer = async () => {
    await producer.connect();
    parentPort.postMessage({ type: "status", status: "connected" });

    while (true) {
      try {
        const batch = generateBatch();
        const startTime = Date.now();
        await producer.send({
          topic: "tweets",
          messages: batch,
        });
        const duration = Date.now() - startTime;
        parentPort.postMessage(`${BATCH_SIZE} in ${duration}ms`);
        await new Promise((resolve) => setTimeout(resolve, BATCH_INTERVAL_MS));
      } catch (err) {
        console.error(`Worker error: ${err.message}`);
      }
    }
  };

  runProducer().catch((err) => {
    console.error(`Fatal worker error: ${err.message}`);
    process.exit(1);
  });
}

// Main Thread
if (isMainThread) {
  const WORKER_COUNT = Math.min(4, os.cpus().length * 2);
  const workers = new Set();
  console.log("mode", MODE)

  console.log(`Main process started. Spawning ${WORKER_COUNT} workers`);
  if (MODE === "fixed") {
    console.log(
      `Mode: Fixed | Sentiment distribution: Positive=${(SENTIMENT_DISTRIBUTION.positive * 100).toFixed(0)}%, Negative=${(SENTIMENT_DISTRIBUTION.negative * 100).toFixed(0)}%, Neutral=${(SENTIMENT_DISTRIBUTION.neutral * 100).toFixed(0)}%`
    );
  } else {
    console.log(`Mode: Volatile | Volatility Factor: ${VOLATILITY_FACTOR} | Sentiment distribution will vary highly per batch`);
  }

  const spawnWorker = (id) => {
    const worker = new Worker(__filename);
    worker
      .on("message", (msg) => console.log(`[W${id}] ${msg}`))
      .on("error", (err) => console.error(`[Worker ${id}] Error: ${err.message}`))
      .on("exit", (code) => {
        console.log(`[Worker ${id}] Exited with code ${code}`);
        workers.delete(worker);
        if (code !== 0) spawnWorker(id);
      });
    workers.add(worker);
  };

  for (let i = 0; i < WORKER_COUNT; i++) {
    spawnWorker(i + 1);
  }

  process.on("SIGINT", async () => {
    console.log("\nGracefully shutting down...");
    for (const worker of workers) {
      await worker.terminate();
    }
    process.exit();
  });
}