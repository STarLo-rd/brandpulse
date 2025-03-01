const { Kafka, Partitioners, CompressionTypes } = require('kafkajs');
const { Worker, isMainThread, parentPort, threadId } = require('worker_threads');
const dataSchema = require('../../schema/avroSchema');
const os = require('os');

// Configuration module
const config = {
  kafka: {
    clientId: 'dataStorm-producer',
    brokers: ['localhost:9092'],
    topic: 'dataStorm-topic',
    retry: {
      retries: 5,
      initialRetryTime: 100,
      maxRetryTime: 30000
    },
    producer: {
      createPartitioner: Partitioners.LegacyPartitioner, // Fix warning
      transactionTimeout: 30000,
      compression: CompressionTypes.LZ4,
      maxInFlightRequests: 100,
      idempotent: true,
      allowAutoTopicCreation: false,
      batchSize: 20 * 1024 * 1024, // 20MB batches
      lingerMs: 5, // Very aggressive pacing
      acks: 1, // Optimize for throughput
      bufferMemory: Math.min(3 * 1024 * 1024 * 1024, Math.floor(os.totalmem() * 0.5)) // 3GB or 50% of memory
    }
  },
  batch: {
    size: 50000, // Larger batch size
    intervalMs: 0 // No delay between batches
  },
  workers: {
    count: Math.max(1, os.cpus().length), // Use all CPU cores
    restartDelay: 500
  },
  metrics: {
    reportIntervalMs: 1000, // Report metrics every second
    syncIntervalMs: 100 // Sync metrics between workers more frequently
  },
  target: 50000000 // 50M records target
};

// Shared memory for metrics across workers
if (isMainThread) {
  process.env.KAFKAJS_NO_PARTITIONER_WARNING = "1"; // Suppress KafkaJS warnings
}

// Worker Logic
if (!isMainThread) {
  // Pre-allocate buffer for messages
  const recordCache = new Array(config.batch.size);
  for (let i = 0; i < config.batch.size; i++) {
    recordCache[i] = { value: null };
  }
  
  let isShuttingDown = false;
  let recordsSent = 0;
  let lastReportTime = Date.now();

  // Create unique client ID for each worker
  const workerKafkaConfig = {
    ...config.kafka,
    clientId: `${config.kafka.clientId}-${process.pid}-${threadId}`
  };
  
  const producer = new Kafka(workerKafkaConfig).producer(config.kafka.producer);

  // Generate batch with reused objects
  const generateBatch = () => {
    const now = new Date().toISOString();
    const buffer = dataSchema.toBuffer({
      id: Math.floor(Math.random() * 100000),
      timestamp: now,
      value: Math.random() * 100
    });
    
    // Reuse objects
    for (let i = 0; i < config.batch.size; i++) {
      recordCache[i].value = buffer;
    }
    
    return recordCache;
  };

  const runProducer = async () => {
    try {
      await producer.connect();
      parentPort.postMessage({ type: 'status', status: 'connected' });
      
      // Report metrics periodically
      const reportInterval = setInterval(() => {
        const now = Date.now();
        const elapsed = (now - lastReportTime) / 1000;
        if (recordsSent > 0) {
          parentPort.postMessage({ 
            type: 'metrics', 
            count: recordsSent,
            elapsed: elapsed
          });
          recordsSent = 0;
          lastReportTime = now;
        }
      }, config.metrics.syncIntervalMs);
      
      while (!isShuttingDown) {
        try {
          const batch = generateBatch();
          await producer.send({
            topic: config.kafka.topic,
            messages: batch,
          });
          
          recordsSent += config.batch.size;
          
          // No delay between batches for maximum throughput
        } catch (err) {
          parentPort.postMessage({ 
            type: 'error', 
            message: `Batch send error: ${err.message}` 
          });
          
          // Brief delay on error
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
      
      clearInterval(reportInterval);
    } catch (err) {
      parentPort.postMessage({ 
        type: 'error', 
        message: `Producer error: ${err.message}` 
      });
      process.exit(1);
    }
  };

  // Handle graceful shutdown
  parentPort.on('message', (msg) => {
    if (msg.type === 'shutdown') {
      isShuttingDown = true;
      producer.disconnect()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
    }
  });

  runProducer().catch(err => {
    parentPort.postMessage({ 
      type: 'error', 
      message: `Fatal producer error: ${err.message}` 
    });
    process.exit(1);
  });
}

// Main Thread
if (isMainThread) {
  const workers = new Map();
  let totalRecordsSent = 0;
  let isShuttingDown = false;
  let startTime = Date.now();
  let lastReportTime = Date.now();
  let metricsBuffer = 0;

  console.log(`Main process started. Spawning ${config.workers.count} workers`);
  console.log(`System specs: ${os.cpus().length} CPUs, ${Math.round(os.totalmem() / (1024 * 1024 * 1024))}GB RAM`);
  console.log(`Target: ${config.target.toLocaleString()} records`);

  // Start metrics reporting
  const reportMetrics = () => {
    const now = Date.now();
    const elapsedTotal = (now - startTime) / 1000;
    const elapsedSince = (now - lastReportTime) / 1000;
    
    if (elapsedSince >= 1) { // Report once per second
      const recordsPerSecond = Math.round(metricsBuffer / elapsedSince);
      const overallRecordsPerSecond = Math.round(totalRecordsSent / elapsedTotal);
      const progress = (totalRecordsSent / config.target) * 100;
      
      console.log(`Throughput: ${recordsPerSecond.toLocaleString()} records/sec | ` +
                  `Total: ${totalRecordsSent.toLocaleString()} records | ` +
                  `Avg: ${overallRecordsPerSecond.toLocaleString()} records/sec | ` +
                  `Runtime: ${elapsedTotal.toFixed(2)}s | ` +
                  `Progress: ${progress.toFixed(2)}% of ${(config.target / 1000000).toFixed(1)}M`);
      
      metricsBuffer = 0;
      lastReportTime = now;
    }
    
    if (!isShuttingDown) {
      setTimeout(reportMetrics, 100); // Check more frequently than we report
    }
  };

  // Worker management
  const spawnWorker = (id) => {
    if (isShuttingDown) return;
    
    console.log(`Starting worker ${id}...`);
    const worker = new Worker(__filename);
    
    worker
      .on('message', (msg) => {
        switch (msg.type) {
          case 'metrics':
            metricsBuffer += msg.count;
            totalRecordsSent += msg.count;
            
            // Check if we've reached our target
            if (totalRecordsSent >= config.target && !isShuttingDown) {
              const elapsedTotal = (Date.now() - startTime) / 1000;
              const overallRecordsPerSecond = Math.round(totalRecordsSent / elapsedTotal);
              
              console.log(`\n✅ Target reached: ${totalRecordsSent.toLocaleString()} records sent`);
              console.log(`Total runtime: ${elapsedTotal.toFixed(2)}s`);
              console.log(`Overall throughput: ${overallRecordsPerSecond.toLocaleString()} records/sec`);
              
              initiateShutdown();
            }
            break;
          case 'status':
            console.log(`[Worker ${id}] Status: ${msg.status}`);
            break;
          case 'error':
            console.error(`[Worker ${id}] ${msg.message}`);
            break;
        }
      })
      .on('error', (err) => {
        console.error(`[Worker ${id}] Error: ${err.message}`);
      })
      .on('exit', (code) => {
        console.log(`[Worker ${id}] Exited with code ${code}`);
        workers.delete(id);
        
        // Auto-restart if not shutting down
        if (code !== 0 && !isShuttingDown) {
          console.log(`[Worker ${id}] Restarting in ${config.workers.restartDelay}ms...`);
          setTimeout(() => spawnWorker(id), config.workers.restartDelay);
        } else if (workers.size === 0 && isShuttingDown) {
          console.log('All workers terminated. Exiting.');
          
          // Final report
          const elapsedTotal = (Date.now() - startTime) / 1000;
          const overallRecordsPerSecond = Math.round(totalRecordsSent / elapsedTotal);
          console.log(`\nFinal stats:`);
          console.log(`Total records: ${totalRecordsSent.toLocaleString()}`);
          console.log(`Total runtime: ${elapsedTotal.toFixed(2)}s`);
          console.log(`Overall throughput: ${overallRecordsPerSecond.toLocaleString()} records/sec`);
          
          process.exit(0);
        }
      });

    workers.set(id, worker);
  };

  // Start workers and metrics reporting
  reportMetrics();
  for (let i = 0; i < config.workers.count; i++) {
    spawnWorker(i + 1);
  }

  // Graceful shutdown
  const initiateShutdown = () => {
    if (isShuttingDown) return;
    
    isShuttingDown = true;
    console.log('\nGracefully shutting down...');
    
    for (const [id, worker] of workers.entries()) {
      console.log(`Sending shutdown signal to worker ${id}...`);
      worker.postMessage({ type: 'shutdown' });
    }
    
    // Force exit after timeout if workers don't exit cleanly
    setTimeout(() => {
      console.log('Force exiting after timeout');
      process.exit(1);
    }, 10000);
  };

  // Handle SIGINT (Ctrl+C)
  process.on('SIGINT', initiateShutdown);
  process.on('SIGTERM', initiateShutdown);
}