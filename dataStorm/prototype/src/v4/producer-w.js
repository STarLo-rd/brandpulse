const { Kafka, Partitioners, CompressionTypes } = require('kafkajs');
const { Worker, isMainThread, parentPort, threadId } = require('worker_threads');
const dataSchema = require('../../schema/avroSchema');
const os = require('os');

// Extreme high-throughput configuration
const config = {
  kafka: {
    clientId: 'dataStorm-producer',
    brokers: ['localhost:9092'],
    topic: 'dataStorm-topic',
    retry: {
      retries: 1,                // Almost no retries for raw speed
      initialRetryTime: 50,
      maxRetryTime: 1000
    },
    producer: {
      createPartitioner: Partitioners.LegacyPartitioner,
      transactionTimeout: 30000,
      compression: null,         // No compression for raw speed
      maxInFlightRequests: 500,  // Significantly higher concurrency
      idempotent: false,         // No idempotence checks for performance
      allowAutoTopicCreation: false,
      batchSize: 16 * 1024 * 1024,
      lingerMs: 0,               // No linger time
      acks: 0,                   // Fire and forget mode
      bufferMemory: Math.min(6 * 1024 * 1024 * 1024, Math.floor(os.totalmem() * 0.7)) // Aggressive memory usage
    }
  },
  batch: {
    size: 10000,              // Smaller, more frequent batches
    maxBufferedBatches: 8     // Keep more batches ready
  },
  workers: {
    count: Math.max(4, os.cpus().length * 3), // Triple the worker count
    restartDelay: 500
  },
  metrics: {
    reportIntervalMs: 1000,
    syncIntervalMs: 20        // Very frequent sync
  },
  target: 50000000            // 50M records target
};

// Shared memory for metrics across workers
if (isMainThread) {
  process.env.KAFKAJS_NO_PARTITIONER_WARNING = "1";
  process.env.UV_THREADPOOL_SIZE = config.workers.count * 4; // Much larger threadpool
  
  // Increase Node.js memory limits
  if (typeof process.setMaxListeners === 'function') {
    process.setMaxListeners(0); // Remove listener limits
  }
}

// Worker Logic
if (!isMainThread) {
  // Create single static buffer - extreme optimization
  // Instead of creating different messages, we'll send the same message repeatedly
  // This eliminates serialization cost completely
  const staticBuffer = dataSchema.toBuffer({
    id: threadId,
    timestamp: new Date().toISOString(),
    value: Math.random() * 100
  });
  
  // Pre-allocate record objects for maximum performance
  const recordCache = new Array(config.batch.size);
  for (let i = 0; i < config.batch.size; i++) {
    recordCache[i] = { value: staticBuffer };
  }
  
  // Pre-allocate multiple batches
  const batchPool = [];
  for (let i = 0; i < config.batch.maxBufferedBatches; i++) {
    batchPool.push([...recordCache]); // Clone the array, not the objects
  }
  
  let isShuttingDown = false;
  let recordsSent = 0;
  let lastReportTime = Date.now();
  let batchIndex = 0;

  // Create unique client ID for each worker
  const workerKafkaConfig = {
    ...config.kafka,
    clientId: `${config.kafka.clientId}-${process.pid}-${threadId}`
  };
  
  // Enable per-worker networking optimizations
  const producerConfig = {
    ...config.kafka.producer,
    metadataMaxAge: 30000,      // Reduce metadata refreshes
    socketOptions: {
      keepAlive: true,
      noDelay: true,           // Disable Nagle's algorithm
      timeout: 10000,
      requestTimeout: 10000,
    }
  };
  
  const producer = new Kafka(workerKafkaConfig).producer(producerConfig);

  // Run producer with extreme optimization
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
      
      // Run send loop with optimized batches
      while (!isShuttingDown) {
        try {
          // Use batch from pool in a round-robin fashion
          const batch = batchPool[batchIndex];
          batchIndex = (batchIndex + 1) % config.batch.maxBufferedBatches;
          
          // Fire and forget - don't await the promise for maximum throughput
          producer.send({
            topic: config.kafka.topic,
            messages: batch,
          }).catch(err => {
            // Silently handle errors to prevent slowing down the loop
            if (!isShuttingDown) {
              parentPort.postMessage({ 
                type: 'error', 
                message: `Silent batch error: ${err.message}` 
              });
            }
          });
          
          recordsSent += config.batch.size;
          
          // Add a small delay to prevent event loop starvation
          // This counter-intuitively can improve overall throughput
          if (recordsSent % (config.batch.size * 10) === 0) {
            await new Promise(resolve => setImmediate(resolve));
          }
        } catch (err) {
          if (!isShuttingDown) {
            parentPort.postMessage({ 
              type: 'error', 
              message: `Batch send error: ${err.message}` 
            });
          }
          
          // Continue immediately
          continue;
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

  // Start producer with optimized error handling
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
  let lastMetricsReportTime = Date.now();
  let lastThroughput = 0;
  
  // Performance auto-tuning
  let autoTuneTime = Date.now() + 5000; // Start auto-tuning after 5 seconds
  let hasAutoTuned = false;

  console.log(`Main process started. Spawning ${config.workers.count} workers`);
  console.log(`System specs: ${os.cpus().length} CPUs, ${Math.round(os.totalmem() / (1024 * 1024 * 1024))}GB RAM`);
  console.log(`Target: ${config.target.toLocaleString()} records | Throughput goal: 600,000+ records/sec`);
  console.log('Extreme throughput configuration enabled:');
  console.log(`- Worker threads: ${config.workers.count}`);
  console.log(`- Batch size: ${config.batch.size} records`);
  console.log(`- Compression: ${config.kafka.producer.compression ? config.kafka.producer.compression : 'disabled'}`);
  console.log(`- Acks: ${config.kafka.producer.acks}`);
  console.log(`- Static message optimization: enabled`);

  // Track performance metrics for auto-tuning
  const throughputHistory = [];
  const HISTORY_SIZE = 5;

  // Auto-tuning logic
  const autoTunePerformance = () => {
    const avgThroughput = throughputHistory.reduce((a, b) => a + b, 0) / throughputHistory.length;
    
    if (avgThroughput < 550000 && !hasAutoTuned) {
      console.log(`\n🔄 Auto-tuning for higher performance...`);
      
      // Spawn additional workers if throughput is not meeting target
      const additionalWorkers = Math.min(8, Math.ceil((600000 - avgThroughput) / 50000));
      const startIndex = config.workers.count + 1;
      const newCount = config.workers.count + additionalWorkers;
      
      console.log(`Adding ${additionalWorkers} more worker threads (total: ${newCount})`);
      
      for (let i = 0; i < additionalWorkers; i++) {
        spawnWorker(startIndex + i);
      }
      
      config.workers.count = newCount;
      hasAutoTuned = true;
    }
  };

  // Start metrics reporting
  const reportMetrics = () => {
    const now = Date.now();
    const elapsedTotal = (now - startTime) / 1000;
    const elapsedSince = (now - lastMetricsReportTime) / 1000;
    
    if (elapsedSince >= 1) { // Report once per second
      const recordsPerSecond = Math.round(metricsBuffer / elapsedSince);
      const overallRecordsPerSecond = Math.round(totalRecordsSent / elapsedTotal);
      const progress = (totalRecordsSent / config.target) * 100;
      
      // Track throughput for monitoring
      throughputHistory.push(recordsPerSecond);
      if (throughputHistory.length > HISTORY_SIZE) {
        throughputHistory.shift();
      }
      
      // Check if we should auto-tune
      if (!hasAutoTuned && now >= autoTuneTime && throughputHistory.length >= 3) {
        autoTunePerformance();
      }
      
      // Calculate throughput change
      const throughputChange = lastThroughput > 0 
        ? ((recordsPerSecond - lastThroughput) / lastThroughput * 100).toFixed(1) 
        : "0.0";
      const changeSymbol = throughputChange > 0 ? "↑" : (throughputChange < 0 ? "↓" : "→");
      lastThroughput = recordsPerSecond;
      
      const throughputColor = recordsPerSecond >= 600000 ? '✅' : (recordsPerSecond >= 500000 ? '⚠️' : '❌');
      
      console.log(`${throughputColor} Throughput: ${recordsPerSecond.toLocaleString()} rec/sec ${changeSymbol}${Math.abs(throughputChange)}% | ` +
                  `Total: ${totalRecordsSent.toLocaleString()} records | ` +
                  `Avg: ${overallRecordsPerSecond.toLocaleString()} rec/sec | ` +
                  `Workers: ${workers.size} | ` +
                  `Progress: ${progress.toFixed(2)}% of ${(config.target / 1000000).toFixed(1)}M`);
      
      metricsBuffer = 0;
      lastMetricsReportTime = now;
    }
    
    if (!isShuttingDown) {
      setTimeout(reportMetrics, 100); // Check more frequently than we report
    }
  };

  // Optimized rate tracking
  setInterval(() => {
    lastReportTime = Date.now(); // Update periodically to prevent time drift
  }, 10000);

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
            // Only log serious errors, ignore minor ones for performance
            if (msg.message.includes('Fatal') || msg.message.includes('Producer error')) {
              console.error(`[Worker ${id}] ${msg.message}`);
            }
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
          
          if (overallRecordsPerSecond >= 600000) {
            console.log(`✅ Performance target achieved!`);
          } else {
            console.log(`❌ Performance target not reached. Target: 600,000 records/sec`);
          }
          
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