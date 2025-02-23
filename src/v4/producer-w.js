const { Kafka, Partitioners, CompressionTypes } = require("kafkajs");
const {
  Worker,
  isMainThread,
  parentPort,
  threadId,
} = require("worker_threads");
const dataSchema = require("../../schema/avroSchema");

// 1. Kafka Configuration
const kafkaConfig = {
  clientId: `producer-${process.pid}-${threadId}`,
  brokers: ['localhost:9092', 'localhost:9093', 'localhost:9094'],
//   brokers: ["10.0.0.1:9092", "10.0.0.2:9093", "10.0.0.3:9094"],
  retry: { retries: 2 },
  producer: {
    compression: CompressionTypes.LZ4, // 30% faster than Snappy
    maxInFlightRequests: 25, // Parallel requests
    idempotent: true,
    batchSize: 1024 * 1024, // 1MB batches
    lingerMs: 50, // Natural batching window
  },
};

// 2. Pre-Generated Data (Critical Optimization)
const BATCH_SIZE = 30000; // 30k per batch

// Alternative: Single timestamp for entire pre-generated batch
const BATCH_TIMESTAMP = new Date().toISOString();

const PRE_GENERATED_RECORDS = Array(BATCH_SIZE)
  .fill(null)
  .map(() => ({
    value: dataSchema.toBuffer({
      id: Math.floor(Math.random() * 1000000),
      timestamp: BATCH_TIMESTAMP, // Reuse same ISO string
      value: Math.random() * 100,
    }),
  }));

// 3. Batch Generation (Zero-Cost)
const generateBatch = () => PRE_GENERATED_RECORDS;

// Worker Logic
if (!isMainThread) {
  const producer = new Kafka(kafkaConfig).producer({
    createPartitioner: Partitioners.LegacyPartitioner,
    allowAutoTopicCreation: true,
    transactionTimeout: 30000,
  });

  const runProducer = async () => {
    await producer.connect();

    while (true) {
      try {
        const batchStart = Date.now();
        await producer.send({
          topic: "dataStorm-topic",
          messages: generateBatch(),
        });

        // Precise timing report
        parentPort.postMessage(
          `SENT ${BATCH_SIZE} ${batchStart} ${Date.now()}`
        );
      } catch (err) {
        console.error(`[FATAL] Worker error: ${err.message}`);
        process.exit(1);
      }
    }
  };

  runProducer();
}

// Main Thread
if (isMainThread) {
  const WORKER_COUNT = 16; // CPU cores × 2 (for hyperthreading)
  const workers = new Set();

  console.log(
    `🚀 Launching ${WORKER_COUNT} workers for ${
      BATCH_SIZE * WORKER_COUNT
    } msg/cycle`
  );

  const spawnWorker = (id) => {
    const worker = new Worker(__filename);

    worker
      .on("message", (msg) => {
        const [_, count, start, end] =
          msg.match(/SENT (\d+) (\d+) (\d+)/) || [];
        if (count) console.log(`[W${id}] ${count} in ${end - start}ms`);
      })
      .on("exit", (code) => {
        console.log(`Worker ${id} died, restarting...`);
        workers.delete(worker);
        spawnWorker(id);
      });

    workers.add(worker);
  };

  // Start worker army
  Array.from({ length: WORKER_COUNT }).forEach((_, i) => spawnWorker(i + 1));

  process.on("SIGINT", async () => {
    console.log("\n🛑 Stopping all workers...");
    await Promise.all([...workers].map((w) => w.terminate()));
    process.exit();
  });
}
