const { Kafka, Partitioners, CompressionTypes } = require('kafkajs');
const { Worker, isMainThread, parentPort, threadId } = require('worker_threads');
const dataSchema = require('../../schema/avroSchema');
const os = require('os');


// Shared Kafka configuration
const kafkaConfig = {
  clientId: `dataStorm-producer-${process.pid}-${threadId}`, // Unique client IDs
  brokers: ['localhost:9092'],
  retry: {
    retries: 0, // Add retry mechanism
    initialRetryTime: 50,
    maxRetryTime: 1000
  },
  producer: {
    // transactionTimeout: 30000,
    // // compression: CompressionTypes.LZ4, maxInFlightRequests: 100, // Parallel requests
    // compression: null,         // No compression for raw speed
    // idempotent: true, // Ensure exactly-once semantics
    createPartitioner: Partitioners.LegacyPartitioner,
    transactionTimeout: 30000,
    compression: null,         // No compression for raw speed
    maxInFlightRequests: 1000,  // Significantly higher concurrency
    idempotent: false,         // No idempotence checks for performance
    allowAutoTopicCreation: false,
    batchSize: 32 * 1024 * 1024,
    lingerMs: 2,               // No linger time
    acks: 0,                   // Fire and forget mode
    // bufferMemory: Math.min(6 * 1024 * 1024 * 1024, Math.floor(os.totalmem() * 0.7)) // Aggressive memory usage
    bufferMemory: Math.min(8 * 1024 * 1024 * 1024, Math.floor(os.totalmem() * 0.8)), // More aggressive memory
    socketTimeout: 60000,      // Longer socket timeout
    connectionTimeout: 30000    // Longer connection timeout
  }
};

// Batch configuration
const BATCH_SIZE = 10000;
// const BATCH_INTERVAL_MS = 100; // 100ms cooldown between batches
const BATCH_INTERVAL_MS = 5; // aggresive pacing


// Serialization cache
const recordCache = new Array(BATCH_SIZE).fill(null); // Pre-allocate array

// Optimized batch generation
const generateBatch = () => {
  const now = new Date().toISOString();

  return recordCache.map(() => ({
    value: dataSchema.toBuffer({
      id: Math.floor(Math.random() * 100000),
      timestamp: now, // Reuse timestamp for entire batch
      value: Math.random() * 100
    })
  }));
};

// Worker Logic
if (!isMainThread) {
  const producer = new Kafka(kafkaConfig).producer({
    // createPartitioner: Partitioners.LegacyPartitioner,
    // allowAutoTopicCreation: false,
    // batchSize: 16 * 1024 * 1024, // 16MB batches for higher throughput
    // lingerMs: 50,
    // // bufferMemory: 4 * 1024 * 1024 * 1024,  // 4GB
    // bufferMemory: Math.min(6 * 1024 * 1024 * 1024, Math.floor(os.totalmem() * 0.7)), // Aggressive memory usage
    // acks: 0,
  });

  const runProducer = async () => {
    await producer.connect();
    parentPort.postMessage({ type: 'status', status: 'connected' });

    while (true) {
      try {
        const batch = generateBatch();
        const startTime = Date.now();
        await producer.send({
          topic: 'dataStorm-topic',
          messages: batch,
        });
        const duration = Date.now() - startTime;
        parentPort.postMessage(`${BATCH_SIZE} in ${duration}ms`);  // Include timing data        
        // Prevent event loop starvation
        await new Promise(resolve =>
          setTimeout(resolve, BATCH_INTERVAL_MS)
        );
      } catch (err) {
        console.error(`Worker error: ${err.message}`);
        // Add recovery logic here
      }
    }
  };

  runProducer().catch(err => {
    console.error(`Fatal worker error: ${err.message}`);
    process.exit(1);
  });
}

// Main Thread
if (isMainThread) {
  // const WORKER_COUNT = require('os').cpus().length; // Dynamic worker count
  const WORKER_COUNT = Math.max(4, os.cpus().length * 3)

  const workers = new Set();

  console.log(`Main process started. Spawning ${WORKER_COUNT} workers`);

  // Worker management
  const spawnWorker = (id) => {
    const worker = new Worker(__filename);

    worker
      .on('message', (msg) =>
        console.log(`[W${id}] ${msg}`)  // Change log prefix to [WX]
      )
      .on('error', (err) =>
        console.error(`[Worker ${id}] Error: ${err.message}`))
      .on('exit', (code) => {
        console.log(`[Worker ${id}] Exited with code ${code}`);
        workers.delete(worker);
        if (code !== 0) spawnWorker(id); // Auto-restart
      });

    workers.add(worker);
  };

  // Start workers
  for (let i = 0; i < WORKER_COUNT; i++) {
    spawnWorker(i + 1);
  }

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\nGracefully shutting down...');
    for (const worker of workers) {
      await worker.terminate();
    }
    process.exit();
  });
}