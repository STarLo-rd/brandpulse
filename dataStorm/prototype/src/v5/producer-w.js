const { Kafka, Partitioners } = require('kafkajs');
const { Worker, isMainThread, parentPort, threadId } = require('worker_threads');
const dataSchema = require('../../schema/avroSchema');
const os = require('os');

// Balanced high-throughput configuration for 1M+ records/sec with stability
const config = {
  kafka: {
    clientId: 'dataStorm-producer',
    brokers: ['localhost:9092'],
    topic: 'dataStorm-topic',
    retry: {
      retries: 2,                // Add minimal retries for stability
      initialRetryTime: 100,     // Increased from 10ms
      maxRetryTime: 500          // Increased from 30ms
    },
    producer: {
      createPartitioner: Partitioners.LegacyPartitioner,
      transactionTimeout: 10000,
      compression: null,         // No compression for speed
      maxInFlightRequests: 200,  // Reduced from 1000 to prevent overwhelming broker
      idempotent: false,         // No idempotence checks
      allowAutoTopicCreation: false,
      batchSize: 16 * 1024 * 1024, // Reduced batch size for better stability
      lingerMs: 5,               // Small linger time for better batching
      acks: 0,                   // Fire and forget mode
      bufferMemory: Math.min(8 * 1024 * 1024 * 1024, Math.floor(os.totalmem() * 0.7)) // Reduced memory usage slightly
    }
  },
  batch: {
    size: 15000,              // Reduced batch size for better stability
    maxBufferedBatches: 8     // Reduced buffered batches
  },
  workers: {
    count: Math.max(8, os.cpus().length * 2), // Reduced initial worker count
    maxCount: Math.max(16, os.cpus().length * 4), // Maximum worker count for auto-scaling
    restartDelay: 1000
  },
  metrics: {
    reportIntervalMs: 1000,
    syncIntervalMs: 20        // Slightly reduced frequency
  },
  target: 50000000,           // 50M records target
  stability: {
    connectionBackoffMs: 2000, // Time to wait after connection errors
    maxErrors: 50,             // Reduced error threshold before backoff
    backoffDurationMs: 5000    // Longer backoff when threshold reached
  }
};

// Shared memory for metrics across workers
if (isMainThread) {
  process.env.KAFKAJS_NO_PARTITIONER_WARNING = "1";
  process.env.UV_THREADPOOL_SIZE = config.workers.maxCount * 4; // Adjusted threadpool size
  
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
  // Dynamic buffer instead of static - allows for updates to schema
  let dataBuffer = null;
  
  // Pre-allocate record objects with configurable batch size
  let recordCache = [];
  let batchSize = config.batch.size;
  let maxBufferedBatches = config.batch.maxBufferedBatches;
  
  // Pre-allocate multiple batch arrays
  let batchPool = [];
  
  // Initialize cache and pools - refactored to a function to allow reconfiguration
  const initializeBuffers = (size, bufferedBatches) => {
    batchSize = size;
    maxBufferedBatches = bufferedBatches;
    
    // Generate a sample buffer
    dataBuffer = dataSchema.toBuffer({
      id: threadId,
      timestamp: new Date().toISOString(),
      value: Math.random() * 100
    });
    
    recordCache = new Array(batchSize);
    for (let i = 0; i < batchSize; i++) {
      recordCache[i] = { value: dataBuffer };
    }
    
    batchPool = [];
    for (let i = 0; i < maxBufferedBatches; i++) {
      batchPool.push(recordCache.slice()); // Shallow copy
    }
    
    parentPort.postMessage({ 
      type: 'status', 
      status: `Buffers initialized: batchSize=${batchSize}, buffers=${maxBufferedBatches}` 
    });
  };
  
  let isShuttingDown = false;
  let recordsSent = 0;
  let lastReportTime = Date.now();
  let batchIndex = 0;
  let errorCount = 0;
  let backoffMode = false;
  let backoffUntil = 0;
  let sendPromises = [];
  let reconnecting = false;

  // Create unique client ID for each worker
  const workerKafkaConfig = {
    ...config.kafka,
    clientId: `${config.kafka.clientId}-${process.pid}-${threadId}`
  };
  
  // Adjusted networking optimizations with more realistic timeouts
  const producerConfig = {
    ...config.kafka.producer,
    metadataMaxAge: 60000,      // Reduce metadata refreshes
    socketOptions: {
      keepAlive: true,
      noDelay: true,            // Disable Nagle's algorithm
      timeout: 10000,           // Increased timeout
      requestTimeout: 10000,    // Increased timeout
      connectTimeout: 15000     // Increased connection timeout
    }
  };
  
  let kafka = new Kafka(workerKafkaConfig);
  let producer = kafka.producer(producerConfig);
  
  // Initialize buffers
  initializeBuffers(config.batch.size, config.batch.maxBufferedBatches);

  // Improved reconnection handling
  const reconnect = async () => {
    if (reconnecting) return;
    
    reconnecting = true;
    try {
      // Clean disconnect first
      try {
        await producer.disconnect();
      } catch (e) {
        // Ignore disconnect errors
      }
      
      // Small delay before reconnecting
      await new Promise(resolve => setTimeout(resolve, config.stability.connectionBackoffMs));
      
      // Create new producer instance
      kafka = new Kafka(workerKafkaConfig);
      producer = kafka.producer(producerConfig);
      
      // Connect
      await producer.connect();
      reconnecting = false;
      
      parentPort.postMessage({ 
        type: 'status', 
        status: 'reconnected' 
      });
      
      // Reset error count after successful reconnection
      errorCount = 0;
    } catch (err) {
      parentPort.postMessage({ 
        type: 'error', 
        message: `Reconnection failed: ${err.message}` 
      });
      
      // Schedule another reconnection attempt
      setTimeout(reconnect, config.stability.connectionBackoffMs * 2);
    }
  };

  // Run producer with improved error handling
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
        if (sendPromises.length > 500) { // Reduced from 1000
          sendPromises = sendPromises.filter(p => p.status === 'pending');
        }
      }, config.metrics.syncIntervalMs);
      
      // Better optimized send loop with backoff
      while (!isShuttingDown) {
        try {
          const now = Date.now();
          
          // Honor backoff mode
          if (backoffMode && now < backoffUntil) {
            await new Promise(resolve => setTimeout(resolve, 100));
            continue;
          } else if (backoffMode && now >= backoffUntil) {
            backoffMode = false;
            parentPort.postMessage({ 
              type: 'status', 
              status: 'Resuming after backoff' 
            });
          }
          
          // Use batch from pool in a round-robin fashion
          const batch = batchPool[batchIndex];
          batchIndex = (batchIndex + 1) % maxBufferedBatches;
          
          // Refresh one random message in each batch to vary data
          const randomIndex = Math.floor(Math.random() * batchSize);
          batch[randomIndex] = { 
            value: dataSchema.toBuffer({
              id: threadId,
              timestamp: new Date().toISOString(),
              value: Math.random() * 100
            })
          };
          
          // Store promises for cleanup but don't block on them
          const promise = producer.send({
            topic: config.kafka.topic,
            messages: batch,
          }).catch(err => {
            errorCount++;
            
            // Implement smarter backoff after errors
            if (errorCount > config.stability.maxErrors && !backoffMode) {
              backoffMode = true;
              backoffUntil = Date.now() + config.stability.backoffDurationMs;
              
              parentPort.postMessage({ 
                type: 'error', 
                message: `Entering ${config.stability.backoffDurationMs}ms backoff after ${errorCount} errors` 
              });
              
              // Try to reconnect if we have connection errors
              if (err.message && (
                  err.message.includes('Connection error') || 
                  err.message.includes('Connection timeout') ||
                  err.message.includes('not connected') ||
                  err.message.includes('broker not available'))) {
                reconnect();
              }
            }
          });
          
          // Store promise for cleanup
          promise.status = 'pending';
          sendPromises.push(promise);
          promise.then(() => { promise.status = 'fulfilled'; })
            .catch(() => { promise.status = 'rejected'; });
          
          recordsSent += batchSize;
          
          // Prevent event loop starvation - crucial for sustained throughput
          if (recordsSent % (batchSize * 10) === 0) {
            await new Promise(resolve => setImmediate(resolve));
          }
        } catch (err) {
          errorCount++;
          
          // If we hit a critical error, try to reconnect
          if (err.message && (
              err.message.includes('Connection error') || 
              err.message.includes('Connection timeout') ||
              err.message.includes('not connected') ||
              err.message.includes('broker not available'))) {
            
            parentPort.postMessage({ 
              type: 'error', 
              message: `Critical connection error: ${err.message}` 
            });
            
            if (!reconnecting) {
              reconnect();
            }
          }
          
          // Add a small delay after errors
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }
      
      clearInterval(reportInterval);
    } catch (err) {
      parentPort.postMessage({ 
        type: 'error', 
        message: `Producer error: ${err.message}` 
      });
      
      // Try to reconnect
      if (!isShuttingDown) {
        reconnect();
      }
    }
  };

  // Handle messages from main thread
  parentPort.on('message', (msg) => {
    if (msg.type === 'shutdown') {
      isShuttingDown = true;
      producer.disconnect()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
    } else if (msg.type === 'updateConfig') {
      // Handle dynamic reconfiguration
      if (msg.batchSize && msg.maxBufferedBatches) {
        initializeBuffers(msg.batchSize, msg.maxBufferedBatches);
      }
    }
  });

  // Start producer with optimized error handling
  runProducer().catch(err => {
    parentPort.postMessage({ 
      type: 'error', 
      message: `Fatal producer error: ${err.message}` 
    });
    
    // Try to reconnect rather than exiting
    if (!isShuttingDown) {
      reconnect();
    }
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
  
  // Performance auto-tuning with more gradual ramp-up
  let autoTuneTime = Date.now() + 5000; // Start auto-tuning after 5 seconds
  let autoTuneInterval = setInterval(() => {
    const now = Date.now();
    if (now >= autoTuneTime) {
      dynamicAutoTune();
    }
  }, 3000); // Less frequent tuning
  
  // Track worker performance
  const workerPerformance = new Map();
  const throughputHistory = [];
  const HISTORY_SIZE = 5; // Increased history size for more stable measurements
  let tuningIterations = 0;
  
  console.log(`🚀 Optimized process starting. Target: 1,000,000+ records/sec with stability`);
  console.log(`Initial setup: ${config.workers.count} workers (${os.cpus().length} CPUs available)`);
  console.log(`System specs: ${Math.round(os.totalmem() / (1024 * 1024 * 1024))}GB RAM | Batch: ${config.batch.size} records`);
  console.log(`Config: acks=${config.kafka.producer.acks}, compression=${config.kafka.producer.compression ? 'enabled' : 'disabled'}, retries=${config.kafka.retry.retries}`);

  // More conservative auto-tuning logic
  const dynamicAutoTune = () => {
    tuningIterations++;
    
    // Calculate average throughput from history
    const avgThroughput = throughputHistory.length > 0 ? 
      throughputHistory.reduce((a, b) => a + b, 0) / throughputHistory.length : 0;
    
    // Count error indicators from worker performance
    let errorIndicators = 0;
    for (const [id, perf] of workerPerformance.entries()) {
      if (perf.errors > 10 || (perf.throughput === 0 && Date.now() - perf.lastUpdate > 2000)) {
        errorIndicators++;
      }
    }
    
    // Only tune if we're stable and below target
    const isStable = errorIndicators < Math.ceil(workers.size * 0.1); // Less than 10% of workers have issues
    
    console.log(`\n🔄 Auto-tuning iteration ${tuningIterations}... (Avg throughput: ${Math.round(avgThroughput).toLocaleString()} rec/sec, Stability: ${isStable ? 'Good' : 'Poor'})`);
    
    if (!isStable) {
      // If we're unstable, reduce pressure instead of increasing it
      if (workers.size > Math.max(4, os.cpus().length)) {
        const reduceBy = Math.ceil(workers.size * 0.2); // Reduce by 20%
        console.log(`System unstable, reducing worker count by ${reduceBy} (from ${workers.size})`);
        
        // Identify least performant workers to remove
        const workerStats = [];
        for (const [id, perf] of workerPerformance.entries()) {
          workerStats.push({ id, throughput: perf.throughput, errors: perf.errors });
        }
        
        // Sort by highest error count, then lowest throughput
        workerStats.sort((a, b) => {
          if (b.errors !== a.errors) return b.errors - a.errors;
          return a.throughput - b.throughput;
        });
        
        // Shutdown worst performers
        for (let i = 0; i < Math.min(reduceBy, workerStats.length); i++) {
          const id = workerStats[i].id;
          if (workers.has(id)) {
            console.log(`Shutting down underperforming worker ${id}`);
            workers.get(id).postMessage({ type: 'shutdown' });
          }
        }
        
        // Adjust batch size settings
        config.batch.size = Math.max(5000, Math.floor(config.batch.size * 0.9));
        config.batch.maxBufferedBatches = Math.max(4, Math.floor(config.batch.maxBufferedBatches * 0.9));
        console.log(`Reducing batch settings: size=${config.batch.size}, buffers=${config.batch.maxBufferedBatches}`);
      }
    } else if (avgThroughput < 900000 && tuningIterations <= 5 && workers.size < config.workers.maxCount) {
      // Progressive strategy based on current performance
      if (avgThroughput < 400000) {
        // Add workers conservatively if throughput is low
        const additionalWorkers = Math.min(8, Math.ceil((800000 - avgThroughput) / 100000));
        const newCount = Math.min(config.workers.maxCount, workers.size + additionalWorkers);
        
        console.log(`Adding ${newCount - workers.size} more worker threads (total will be: ${newCount})`);
        
        for (let i = 0; i < newCount - workers.size; i++) {
          spawnWorker(workers.size + 1);
        }
      } else if (avgThroughput < 700000) {
        // Fine tuning batch size first
        const oldBatchSize = config.batch.size;
        config.batch.size = Math.min(20000, Math.floor(config.batch.size * 1.2));
        console.log(`Increasing batch size: ${oldBatchSize} → ${config.batch.size}`);
        
        // Add a few more workers
        const additionalWorkers = 2;
        const newCount = Math.min(config.workers.maxCount, workers.size + additionalWorkers);
        
        if (newCount > workers.size) {
          console.log(`Adding ${additionalWorkers} more worker threads (total will be: ${newCount})`);
          
          for (let i = 0; i < newCount - workers.size; i++) {
            spawnWorker(workers.size + 1);
          }
        }
      } else {
        // Fine tuning if we're getting close
        config.batch.size = Math.min(25000, Math.floor(config.batch.size * 1.1));
        config.batch.maxBufferedBatches = Math.min(12, config.batch.maxBufferedBatches + 1);
        
        console.log(`Fine-tuning parameters: batch=${config.batch.size}, buffers=${config.batch.maxBufferedBatches}`);
        
        // Add just one more worker if we're close
        if (workers.size < config.workers.maxCount) {
          console.log(`Adding 1 more worker thread (total will be: ${workers.size + 1})`);
          spawnWorker(workers.size + 1);
        }
      }
      
      // Notify workers of new batch size
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

  // Enhanced metrics reporting with better error tracking
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
                             (recordsPerSecond >= 700000 ? '✅' : 
                             (recordsPerSecond >= 500000 ? '⚠️' : '❌'));
      
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

  // Worker management with better tracking
  const spawnWorker = (id) => {
    if (isShuttingDown) return;
    
    console.log(`Starting worker ${id}...`);
    const worker = new Worker(__filename);
    
    // Track worker start time for performance monitoring
    workerPerformance.set(id, {
      startTime: Date.now(),
      recordsSent: 0,
      lastUpdate: Date.now(),
      throughput: 0,
      errors: 0
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
              if (elapsed > 0) {
                perf.throughput = msg.count / elapsed;
              }
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
            // Track errors for worker performance
            const perfObj = workerPerformance.get(id);
            if (perfObj) {
              perfObj.errors++;
            }
            
            // Log errors - more verbose for debugging
            console.error(`[Worker ${id}] ${msg.message}`);
            break;
        }
      })
      .on('error', (err) => {
        console.error(`[Worker ${id}] Error: ${err.message}`);
        
        const perfObj = workerPerformance.get(id);
        if (perfObj) {
          perfObj.errors++;
        }
      })
      .on('exit', (code) => {
        console.log(`[Worker ${id}] Exited with code ${code}`);
        workers.delete(id);
        
        // Keep performance history for auto-tuning decisions
        if (code !== 0 && workerPerformance.has(id)) {
          const perfObj = workerPerformance.get(id);
          perfObj.throughput = 0;
          perfObj.errors += 5; // Penalize crashes
        }
        
        // Auto-restart if not shutting down after a delay
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
    }, 15000); // Increased timeout
  };

  // Handle SIGINT (Ctrl+C)
  process.on('SIGINT', initiateShutdown);
  process.on('SIGTERM', initiateShutdown);
}