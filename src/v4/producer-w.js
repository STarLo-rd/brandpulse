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
  brokers: ['localhost:9092','localhost:9093','localhost:9094','localhost:9095'],
  retry: { retries: 2 },
  producer: {
    // compression: CompressionTypes.LZ4, // 30% faster than Snappy
    // compression: CompressionTypes.ZSTD, // Better than LZ4
    compression: CompressionTypes.LZ4, // ZSTD too slow for Node.js
    maxInFlightRequests: 200, // Parallel requests
    idempotent: true,
    // batchSize: 1024 * 1024, // 1MB batches
    // batchSize: 8 * 1024 * 1024, // 8MB batches
    batchSize: 16 * 1024 * 1024, // 16MB batches for higher throughput
    // lingerMs: 150, // From 100ms
    lingerMs: 50,
    // bufferMemory: 2 * 1024 * 1024 * 1024, // 2GB
    bufferMemory: 4 * 1024 * 1024 * 1024,  // 4GB
    acks: 1 // Faster than all replicas
  },
};

// 2. Pre-Generated Data (Critical Optimization)
const BATCH_SIZE = 100000; // 150k per batch
// const BATCH_SIZE = 250000; // Increased from 100K

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
  // const WORKER_COUNT = 4; // CPU cores × 2 (for hyperthreading)
  const WORKER_COUNT = require('os').cpus().length; 
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
