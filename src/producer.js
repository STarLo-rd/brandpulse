const { Kafka, Partitioners, CompressionTypes } = require("kafkajs");
const { Worker, isMainThread, parentPort, threadId } = require("worker_threads");
const tweetSchema = require("./schema/tweetSchema");
const os = require("os");
const crypto = require("crypto");

// Pre-generate UUID pool
const uuidPool = Array.from({ length: 100000 }, () => crypto.randomUUID());

// Kafka configuration
const kafkaConfig = {
  clientId: `dataStorm-producer-${process.pid}-${threadId}`,
  brokers: ["localhost:9092"],
  retry: {
    retries: 0,
    initialRetryTime: 50,
    maxRetryTime: 1000,
  },
  producer: {
    createPartitioner: Partitioners.DefaultPartitioner,
    compression: CompressionTypes.LZ4,
    maxInFlightRequests: 1000,
    idempotent: false,
    allowAutoTopicCreation: false,
    batchSize: 32 * 1024 * 1024,
    lingerMs: 2,
    acks: 0,
    bufferMemory: Math.min(8 * 1024 * 1024 * 1024, Math.floor(os.totalmem() * 0.8)),
    socketTimeout: 60000,
    connectionTimeout: 30000,
  },
};

// Batch configuration
const BATCH_SIZE = 50000; // Increased batch size
const BATCH_INTERVAL_MS = 0; // No delay

// Pre-allocated array for batch
const recordCache = new Array(BATCH_SIZE).fill(null);

// Predefined tweets
const tweetTexts = [
  { text: "I love SuperCoffee!", sentiment: "positive" },
  { text: "SuperCoffee is awful", sentiment: "negative" },
  { text: "Just drank some SuperCoffee", sentiment: "neutral" },
  { text: "SuperCoffee is the best!", sentiment: "positive" },
  { text: "Hate this SuperCoffee brew", sentiment: "negative" },
  { text: "Trying SuperCoffee today", sentiment: "neutral" },
];

// Optimized batch generation
const generateBatch = () => {
  const now = Date.now();
  return recordCache.map(() => {
    const { text, sentiment } = tweetTexts[Math.floor(Math.random() * tweetTexts.length)];
    const tweet = {
      tweetId: uuidPool[Math.floor(Math.random() * uuidPool.length)],
      timestamp: now,
      text: text,
      brand: "SuperCoffee",
      sentiment: sentiment,
    };
    return { value: tweetSchema.toBuffer(tweet) };
  });
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
        if (BATCH_INTERVAL_MS > 0) {
          await new Promise((resolve) => setTimeout(resolve, BATCH_INTERVAL_MS));
        }
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
  const WORKER_COUNT = os.cpus().length; // Adjusted worker count

  const workers = new Set();

  console.log(`Main process started. Spawning ${WORKER_COUNT} workers`);

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