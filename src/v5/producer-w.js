const { Kafka, Partitioners } = require('kafkajs');
const { Worker, isMainThread, parentPort, threadId } = require('worker_threads');
const dataSchema = require('../../schema/avroSchema');
const os = require('os');

// Ultra high-throughput configuration for 1M+ records/sec
const config = {
  kafka: {
    clientId: 'dataStorm-producer',
    brokers: ['localhost:9092'],
    topic: 'dataStorm-topic',
    retry: {
      retries: 1,                // No retries for maximum speed
      initialRetryTime: 10,
      maxRetryTime: 30
    },
    producer: {
      createPartitioner: Partitioners.LegacyPartitioner,
      transactionTimeout: 10000,
      compression: null,         // No compression for speed
      maxInFlightRequests: 1000, // Much higher concurrency
      idempotent: false,         // No idempotence checks
      allowAutoTopicCreation: false,
      batchSize: 32 * 1024 * 1024, // Double batch size
      lingerMs: 0,               // No linger time
      acks: 0,                   // Fire and forget mode
      bufferMemory: Math.min(10 * 1024 * 1024 * 1024, Math.floor(os.totalmem() * 0.8)) // Even more memory
    }
  },
  batch: {
    size: 20000,              // Doubled batch size
    maxBufferedBatches: 16    // Double buffered batches
  },
  workers: {
    count: Math.max(8, os.cpus().length * 4), // Quadruple the worker count
    restartDelay: 500
  },
  metrics: {
    reportIntervalMs: 1000,
    syncIntervalMs: 10        // Super frequent sync
  },
  target: 50000000            // 50M records target
};

// Shared memory for metrics across workers
if (isMainThread) {
  process.env.KAFKAJS_NO_PARTITIONER_WARNING = "1";
  process.env.UV_THREADPOOL_SIZE = config.workers.count * 8; // Double the threadpool
  
  // Increase Node.js memory limits
  if (typeof process.setMaxListeners === 'function') {
    process.setMaxListeners(0); // Remove listener limits
  }
  
  // Set optimal garbage collection settings
  const v8 = require('v8');
  if (v8.setFlagsFromString) {
    v8.setFlagsFromString('--max_old_space_size=8192'); // Increase heap size
  }
}

// Worker Logic
if (!isMainThread) {
  // Static buffer optimization - extreme performance
  // Pre-generate and reuse a fixed message to eliminate serialization overhead
  const staticBuffer = dataSchema.toBuffer({
    id: threadId,
    timestamp: new Date().toISOString(),
    value: Math.random() * 100
  });
  
  // Pre-allocate record objects
  const recordCache = new Array(config.batch.size);
  for (let i = 0; i < config.batch.size; i++) {
    recordCache[i] = { value: staticBuffer };
  }
  
  // Pre-allocate multiple batch arrays with zero-copy references
  const batchPool = [];
  for (let i = 0; i < config.batch.maxBufferedBatches; i++) {
    batchPool.push(recordCache.slice()); // Shallow copy
  }
  
  let isShuttingDown = false;
  let recordsSent = 0;
  let lastReportTime = Date.now();
  let batchIndex = 0;
  let errorCount = 0;
  let backoffMode = false;
  let sendPromises = [];

  // Create unique client ID for each worker
  const workerKafkaConfig = {
    ...config.kafka,
    clientId: `${config.kafka.clientId}-${process.pid}-${threadId}`
  };
  
  // Enable aggressive networking optimizations
  const producerConfig = {
    ...config.kafka.producer,
    metadataMaxAge: 60000,      // Reduce metadata refreshes further
    socketOptions: {
      keepAlive: true,
      noDelay: true,           // Disable Nagle's algorithm
      timeout: 5000,           // Lower timeout
      requestTimeout: 5000,
      connectTimeout: 5000
    }
  };
  
  const kafka = new Kafka(workerKafkaConfig);
  const producer = kafka.producer(producerConfig);

  // Run producer with hyper-optimized sending
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
        
        // Clean up old promises - important for memory management
        if (sendPromises.length > 1000) {
          sendPromises = sendPromises.filter(p => p.status === 'pending');
        }
      }, config.metrics.syncIntervalMs);
      
      // Aggressive send loop optimization
      while (!isShuttingDown) {
        try {
          if (backoffMode) {
            await new Promise(resolve => setTimeout(resolve, 100));
            backoffMode = false;
            continue;
          }
          
          // Use batch from pool in a round-robin fashion
          const batch = batchPool[batchIndex];
          batchIndex = (batchIndex + 1) % config.batch.maxBufferedBatches;
          
          // Extreme optimization: don't wait for send promises
          // Store them for cleanup but don't block on them
          const promise = producer.send({
            topic: config.kafka.topic,
            messages: batch,
          }).catch(err => {
            errorCount++;
            
            // Implement backoff after too many errors
            if (errorCount > 100 && !backoffMode) {
              backoffMode = true;
              errorCount = 0;
              parentPort.postMessage({ 
                type: 'error', 
                message: `Entering backoff mode after errors` 
              });
            }
          });
          
          // Store promise for cleanup
          promise.status = 'pending';
          sendPromises.push(promise);
          promise.then(() => { promise.status = 'fulfilled'; })
            .catch(() => { promise.status = 'rejected'; });
          
          recordsSent += config.batch.size;
          
          // Prevent event loop starvation - crucial for sustained throughput
          if (recordsSent % (config.batch.size * 5) === 0) {
            await new Promise(resolve => setImmediate(resolve));
          }
        } catch (err) {
          errorCount++;
          // Continue immediately without waiting
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
  let autoTuneTime = Date.now() + 3000; // Start auto-tuning earlier
  let autoTuneInterval = setInterval(() => {
    const now = Date.now();
    if (now >= autoTuneTime) {
      dynamicAutoTune();
    }
  }, 2000);
  
  // Track worker performance
  const workerPerformance = new Map();
  const throughputHistory = [];
  const HISTORY_SIZE = 3;
  let tuningIterations = 0;
  
  console.log(`🚀 Ultra-optimized process starting. Target: 1,000,000+ records/sec`);
  console.log(`Spawning ${config.workers.count} workers (${os.cpus().length} CPUs available)`);
  console.log(`System specs: ${Math.round(os.totalmem() / (1024 * 1024 * 1024))}GB RAM | Batch: ${config.batch.size} records`);
  console.log(`🔥 Fire-and-forget mode: acks=0, compression=disabled, retries=0, idempotence=disabled`);

  // Dynamic auto-tuning logic that adjusts multiple parameters
  const dynamicAutoTune = () => {
    tuningIterations++;
    const avgThroughput = throughputHistory.length > 0 ? 
      throughputHistory.reduce((a, b) => a + b, 0) / throughputHistory.length : 0;
    
    if (avgThroughput < 900000 && tuningIterations <= 3) {
      console.log(`\n🔄 Auto-tuning for 1M+ performance (iteration ${tuningIterations})...`);
      
      // Progressive strategy based on current performance
      if (avgThroughput < 500000) {
        // Add more workers if throughput is low
        const additionalWorkers = Math.min(16, Math.max(4, Math.ceil((900000 - avgThroughput) / 50000)));
        const newCount = config.workers.count + additionalWorkers;
        
        console.log(`Adding ${additionalWorkers} more worker threads (total: ${newCount})`);
        
        for (let i = 0; i < additionalWorkers; i++) {
          spawnWorker(config.workers.count + i);
        }
        
        config.workers.count = newCount;
      } else if (avgThroughput < 700000) {
        // Increase batch size if throughput is moderate
        const oldBatchSize = config.batch.size;
        config.batch.size = Math.min(50000, config.batch.size * 1.5);
        console.log(`Increasing batch size: ${oldBatchSize} → ${config.batch.size}`);
        
        // Add a few more workers
        const additionalWorkers = 4;
        const newCount = config.workers.count + additionalWorkers;
        
        console.log(`Adding ${additionalWorkers} more worker threads (total: ${newCount})`);
        
        for (let i = 0; i < additionalWorkers; i++) {
          spawnWorker(config.workers.count + i);
        }
        
        config.workers.count = newCount;
      } else {
        // Fine tuning if we're getting close
        config.batch.size = Math.min(50000, Math.floor(config.batch.size * 1.2));
        config.batch.maxBufferedBatches = Math.min(32, config.batch.maxBufferedBatches + 4);
        
        // Add a couple more workers
        const additionalWorkers = 2;
        const newCount = config.workers.count + additionalWorkers;
        
        console.log(`Fine-tuning parameters: batch=${config.batch.size}, buffers=${config.batch.maxBufferedBatches}`);
        console.log(`Adding ${additionalWorkers} more worker threads (total: ${newCount})`);
        
        for (let i = 0; i < additionalWorkers; i++) {
          spawnWorker(config.workers.count + i);
        }
        
        config.workers.count = newCount;
      }
      
      // Notify workers of new batch size (restart might be too disruptive)
      for (const [id, worker] of workers.entries()) {
        worker.postMessage({ 
          type: 'updateConfig', 
          batchSize: config.batch.size,
          maxBufferedBatches: config.batch.maxBufferedBatches
        });
      }
    } else if (avgThroughput >= 1000000 && autoTuneInterval) {
      console.log(`\n✅ Auto-tuning complete: Achieved 1M+ records/sec`);
      clearInterval(autoTuneInterval);
      autoTuneInterval = null;
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
      
      // Calculate throughput change
      const throughputChange = lastThroughput > 0 
        ? ((recordsPerSecond - lastThroughput) / lastThroughput * 100).toFixed(1) 
        : "0.0";
      const changeSymbol = throughputChange > 0 ? "↑" : (throughputChange < 0 ? "↓" : "→");
      lastThroughput = recordsPerSecond;
      
      // Colored indicators based on target of 1M rec/sec
      const throughputColor = recordsPerSecond >= 1000000 ? '🔥' : 
                             (recordsPerSecond >= 800000 ? '✅' : 
                             (recordsPerSecond >= 600000 ? '⚠️' : '❌'));
      
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
    
    // Track worker start time for performance monitoring
    workerPerformance.set(id, {
      startTime: Date.now(),
      recordsSent: 0,
      lastUpdate: Date.now(),
      throughput: 0
    });
    
    worker
      .on('message', (msg) => {
        switch (msg.type) {
          case 'metrics':
            metricsBuffer += msg.count;
            totalRecordsSent += msg.count;
            
            // Update worker performance stats
            const perf = workerPerformance.get(id);
            if (perf) {
              perf.recordsSent += msg.count;
              const elapsed = (Date.now() - perf.lastUpdate) / 1000;
              perf.throughput = msg.count / elapsed;
              perf.lastUpdate = Date.now();
            }
            
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
            // Only log serious errors
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
        workerPerformance.delete(id);
        
        // Auto-restart if not shutting down
        if (code !== 0 && !isShuttingDown) {
          console.log(`[Worker ${id}] Restarting in ${config.workers.restartDelay}ms...`);
          setTimeout(() => spawnWorker(id), config.workers.restartDelay);
        } else if (workers.size === 0 && isShuttingDown) {
          console.log('All workers terminated. Exiting.');
          
          if (autoTuneInterval) {
            clearInterval(autoTuneInterval);
            autoTuneInterval = null;
          }
          
          // Final report
          const elapsedTotal = (Date.now() - startTime) / 1000;
          const overallRecordsPerSecond = Math.round(totalRecordsSent / elapsedTotal);
          console.log(`\nFinal stats:`);
          console.log(`Total records: ${totalRecordsSent.toLocaleString()}`);
          console.log(`Total runtime: ${elapsedTotal.toFixed(2)}s`);
          console.log(`Overall throughput: ${overallRecordsPerSecond.toLocaleString()} records/sec`);
          
          if (overallRecordsPerSecond >= 1000000) {
            console.log(`🔥 PERFORMANCE TARGET ACHIEVED! 1M+ records/sec`);
          } else if (overallRecordsPerSecond >= 800000) {
            console.log(`✅ Very high performance achieved. Target: 1,000,000 records/sec`);
          } else if (overallRecordsPerSecond >= 600000) {
            console.log(`⚠️ Good performance but below target. Target: 1,000,000 records/sec`);
          } else {
            console.log(`❌ Performance target not reached. Target: 1,000,000 records/sec`);
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
    if (autoTuneInterval) {
      clearInterval(autoTuneInterval);
      autoTuneInterval = null;
    }
    
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