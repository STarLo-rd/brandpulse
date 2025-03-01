const { Kafka, Partitioners, CompressionTypes  } = require('kafkajs');
const { Worker, isMainThread, parentPort, threadId } = require('worker_threads');
const dataSchema = require('../../schema/avroSchema');

// Shared Kafka configuration
const kafkaConfig = {
  clientId: `dataStorm-producer-${process.pid}-${threadId}`, // Unique client IDs
  brokers: ['localhost:9092'],
  retry: {
    retries: 2 // Add retry mechanism
  },
  producer: {
    transactionTimeout: 30000,
    compression: CompressionTypes.LZ4,    maxInFlightRequests: 100, // Parallel requests
    idempotent: true, // Ensure exactly-once semantics
  }
};

// Batch configuration
const BATCH_SIZE = 20000;
// const BATCH_INTERVAL_MS = 100; // 100ms cooldown between batches
const BATCH_INTERVAL_MS = 10; // aggresive pacing


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
    createPartitioner: Partitioners.LegacyPartitioner,
    allowAutoTopicCreation: false,
    batchSize: 16 * 1024 * 1024, // 16MB batches for higher throughput
    lingerMs: 50,
    bufferMemory: 4 * 1024 * 1024 * 1024,  // 4GB
    acks: 1 // Faster than all replicas
  });

  const runProducer = async () => {
    await producer.connect();
    
    while (true) {
      try {
        const batch = generateBatch();
        await producer.send({
          topic: 'dataStorm-topic',
          messages: batch,
        });
        parentPort.postMessage(`Sent ${BATCH_SIZE} records`);
        
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
  const WORKER_COUNT = require('os').cpus().length; // Dynamic worker count
   const workers = new Set();

  console.log(`Main process started. Spawning ${WORKER_COUNT} workers`);

  // Worker management
  const spawnWorker = (id) => {
    const worker = new Worker(__filename);
    
    worker
      .on('message', (msg) => 
        console.log(`[Worker ${id}] ${msg}`))
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