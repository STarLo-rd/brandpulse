const { Kafka } = require('kafkajs');
const { Worker, isMainThread, parentPort, threadId } = require('worker_threads');
const tweetSchema = require('../../schema/tweetSchema');
const os = require('os');
const { InfluxDB, Point } = require('@influxdata/influxdb-client');
const { Queue, Worker: BullWorker } = require('bullmq');

// InfluxDB configuration
const INFLUX_URL = 'http://localhost:8086';
const INFLUX_TOKEN = 'OS0t8w6jBnwwL-HIWgU1lWniUARhRc85gLtFqTbhZiEqVNPvludyzs1vswBDAsegbfWk1pJGpk3dY1LKK_2zDQ==';
const INFLUX_ORG = '6914ea40681fbe1d';
const INFLUX_BUCKET = 'brandpulse';

// Kafka configuration
const kafkaConfig = {
  clientId: `brandpulse-consumer-${process.pid}-${threadId || 0}`,
  brokers: ['localhost:9092'],
  retry: { retries: 10, initialRetryTime: 50, maxRetryTime: 1000 },
};

const CONSUMER_GROUP = 'brandpulse-consumer-group';
const TOPIC = 'tweets';
const INFLUX_BATCH_SIZE = 10000; // Increased batch size for better throughput
const WORKER_COUNT = Math.min(4, Math.min(os.cpus().length, 6)); // Balance between workers

// Redis connection options
const REDIS_CONFIG = { 
  host: 'localhost', 
  port: 6379,
  maxRetriesPerRequest: 3,
  connectTimeout: 10000
};

// Worker Logic
if (!isMainThread) {
  // Create a local queue for each worker to minimize IPC overhead
  let pointBuffer = [];
  let totalProcessed = 0;
  
  const consumer = new Kafka(kafkaConfig).consumer({
    groupId: `${CONSUMER_GROUP}-${threadId}`, // Use unique consumer group per worker
    sessionTimeout: 60000,
    heartbeatInterval: 10000,
    maxBytesPerPartition: 10 * 1024 * 1024, // 10MB per partition
    maxBytes: 50 * 1024 * 1024, // 50MB total fetch
    maxPollInterval: 300000,
    fetchMaxWaitMs: 100,
    // Using default partition assignment strategy for improved performance
  });

  // Direct connection to InfluxDB for each worker - reduces Redis dependency
  const influxClient = new InfluxDB({ url: INFLUX_URL, token: INFLUX_TOKEN });
  const writeApi = influxClient.getWriteApi(INFLUX_ORG, INFLUX_BUCKET, 'ns', {
    writeOptions: {
      batchSize: INFLUX_BATCH_SIZE,
      flushInterval: 1000, // 1 second
      maxRetries: 5,
      retryJitter: 200,
      defaultTags: {
        worker: `worker-${threadId}`
      }
    },
  });

  const processMessage = (message) => {
    try {
      const decodedValue = tweetSchema.fromBuffer(message.value);
      const point = new Point('tweets')
        .tag('brand', 'SuperCoffee')
        .tag('sentiment', decodedValue.sentiment)
        .stringField('text', decodedValue.text.substring(0, 255))
        .intField('count', 1);
      
      return point;
    } catch (err) {
      parentPort.postMessage({ type: 'error', message: `Message parsing error: ${err.message}` });
      return null;
    }
  };

  const runConsumer = async () => {
    await consumer.connect();
    await consumer.subscribe({ topic: TOPIC, fromBeginning: false });
    
    parentPort.postMessage({ type: 'info', message: `Worker ${threadId} connected and subscribed to ${TOPIC}` });

    let flushInterval = setInterval(async () => {
      if (pointBuffer.length > 0) {
        const pointCount = pointBuffer.length;
        try {
          for (const point of pointBuffer) {
            writeApi.writePoint(point);
          }
          await writeApi.flush();
          parentPort.postMessage({ 
            type: 'info', 
            message: `Flushed ${pointCount} points to InfluxDB` 
          });
        } catch (err) {
          parentPort.postMessage({ 
            type: 'error', 
            message: `Flush error: ${err.message}` 
          });
        }
        pointBuffer = [];
      }
    }, 1000); // Flush every second if needed

    await consumer.run({
      autoCommit: true,
      autoCommitInterval: 5000,
      autoCommitThreshold: INFLUX_BATCH_SIZE,
      eachBatchAutoResolve: true,
      eachBatch: async ({ batch, resolveOffset, heartbeat, isRunning, isStale }) => {
        if (!isRunning() || isStale()) return;
        
        const { messages, partition, topic } = batch;
        if (messages.length === 0) return;

        const startTime = Date.now();
        
        // Process in parallel but use a simple approach to reduce overhead
        const points = messages
          .map(processMessage)
          .filter(Boolean); // Remove null values
        
        pointBuffer.push(...points);
        totalProcessed += points.length;

        // If buffer exceeds threshold, write to InfluxDB immediately
        if (pointBuffer.length >= INFLUX_BATCH_SIZE) {
          try {
            for (const point of pointBuffer) {
              writeApi.writePoint(point);
            }
            await writeApi.flush();
            parentPort.postMessage({ 
              type: 'info', 
              message: `Batch flushed ${pointBuffer.length} points to InfluxDB` 
            });
            pointBuffer = [];
          } catch (err) {
            parentPort.postMessage({ 
              type: 'error', 
              message: `Batch flush error: ${err.message}` 
            });
            // We don't clear buffer here to retry on next iteration
          }
        }

        // Commit offset for the last message
        const lastOffset = messages[messages.length - 1].offset;
        resolveOffset(lastOffset);
        await heartbeat();

        const duration = Date.now() - startTime;
        const rate = Math.round((messages.length / duration) * 1000);
        
        parentPort.postMessage({
          type: 'batchProcessed',
          message: `Processed ${messages.length} msgs in ${duration}ms (${rate}/s)`,
          totalProcessed,
          rate
        });
      },
    });
    
    return async () => {
      clearInterval(flushInterval);
      // Ensure any remaining points are written
      if (pointBuffer.length > 0) {
        try {
          for (const point of pointBuffer) {
            writeApi.writePoint(point);
          }
          await writeApi.flush();
          parentPort.postMessage({ type: 'info', message: `Final flush: ${pointBuffer.length} points` });
        } catch (err) {
          parentPort.postMessage({ type: 'error', message: `Final flush error: ${err.message}` });
        }
      }
      await consumer.disconnect();
      await writeApi.close();
    };
  };

  let cleanup = null;
  
  runConsumer()
    .then((cleanupFn) => {
      cleanup = cleanupFn;
    })
    .catch((err) => {
      parentPort.postMessage({ type: 'fatal', message: `Fatal error: ${err.message}` });
      process.exit(1);
    });

  // Handle shutdown gracefully
  parentPort.on('message', async (msg) => {
    if (msg.type === 'shutdown') {
      parentPort.postMessage({ type: 'info', message: 'Worker shutting down...' });
      if (cleanup) await cleanup();
      parentPort.postMessage({ type: 'info', message: 'Worker cleanup complete' });
      process.exit(0);
    }
  });
}

// Main Thread
if (isMainThread) {
  console.log(`Starting BrandPulse Kafka → InfluxDB pipeline with ${WORKER_COUNT} workers`);
  
  // Create a dedicated queue for coordinating workers
  const coordinationQueue = new Queue('worker-coordination', { 
    connection: REDIS_CONFIG,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000
      }
    }
  });
  
  // Create and manage workers
  const workers = new Map();
  let totalProcessed = 0;
  let lastReport = Date.now();
  let processingRates = [];
  
  const reportStats = () => {
    const now = Date.now();
    const elapsed = (now - lastReport) / 1000;
    
    if (elapsed > 0) {
      const avgRate = processingRates.length > 0 
        ? processingRates.reduce((sum, rate) => sum + rate, 0) / processingRates.length 
        : 0;
        
      console.log(`--- STATS REPORT ---`);
      console.log(`Total processed: ${totalProcessed.toLocaleString()} messages`);
      console.log(`Current rate: ${Math.round(avgRate).toLocaleString()} messages/sec`);
      console.log(`Active workers: ${workers.size}`);
      console.log(`-------------------`);
      
      // Reset stats for next interval
      processingRates = [];
      lastReport = now;
    }
  };
  
  const statsInterval = setInterval(reportStats, 10000);
  
  const spawnWorker = (id) => {
    console.log(`Spawning worker ${id}...`);
    
    const worker = new Worker(__filename);
    
    worker.on('message', (msg) => {
      if (msg.type === 'batchProcessed') {
        totalProcessed += msg.totalProcessed || 0;
        if (msg.rate) processingRates.push(msg.rate);
      }
      
      if (msg.type === 'error' || msg.type === 'fatal') {
        console.error(`[Worker ${id}] ${msg.message}`);
      } else if (msg.type) {
        console.log(`[Worker ${id}] ${msg.type}: ${msg.message || JSON.stringify(msg)}`);
      }
    });
    
    worker.on('error', (err) => {
      console.error(`[Worker ${id}] Error: ${err.message}`);
      workers.delete(id);
      setTimeout(() => spawnWorker(id), 5000); // Restart after delay
    });
    
    worker.on('exit', (code) => {
      console.log(`[Worker ${id}] Exited with code ${code}`);
      workers.delete(id);
      
      if (code !== 0 && !shutdownRequested) {
        setTimeout(() => spawnWorker(id), 5000); // Restart after delay
      }
    });
    
    workers.set(id, worker);
  };
  
  // Start all workers
  for (let i = 1; i <= WORKER_COUNT; i++) {
    spawnWorker(i);
  }
  
  // Create a monitoring worker with BullMQ
  const monitorWorker = new BullWorker('worker-coordination', async (job) => {
    const { command, workerId } = job.data;
    
    if (command === 'restart' && workerId) {
      console.log(`Command received to restart worker ${workerId}`);
      const worker = workers.get(workerId);
      if (worker) {
        worker.terminate();
        // Worker will be restarted by the exit handler
      }
      return { success: true, message: `Worker ${workerId} restart initiated` };
    }
    
    return { success: false, message: 'Unknown command' };
  }, { 
    connection: REDIS_CONFIG,
    concurrency: 1
  });
  
  let shutdownRequested = false;
  
  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    shutdownRequested = true;
    console.log('\nShutdown requested. Gracefully stopping workers...');
    
    clearInterval(statsInterval);
    
    // Signal all workers to shut down gracefully
    for (const [id, worker] of workers.entries()) {
      console.log(`Sending shutdown signal to worker ${id}...`);
      worker.postMessage({ type: 'shutdown' });
    }
    
    // Allow workers some time to clean up
    console.log('Waiting for workers to complete cleanup...');
    setTimeout(async () => {
      // Force terminate any remaining workers
      for (const [id, worker] of workers.entries()) {
        console.log(`Forcing termination of worker ${id}...`);
        worker.terminate();
      }
      
      // Close the monitor worker
      await monitorWorker.close();
      await coordinationQueue.close();
      
      console.log('All resources cleaned up. Exiting.');
      process.exit(0);
    }, 30000); // 30 seconds max wait time
  });
  
  console.log('System initialized and running. Press Ctrl+C to exit.');
}