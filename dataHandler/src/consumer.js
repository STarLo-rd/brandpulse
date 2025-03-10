const { Kafka } = require('kafkajs');
const { Worker, isMainThread, parentPort, threadId } = require('worker_threads');
const tweetSchema = require('./schema/tweetSchema'); // Ensure correct path
const os = require('os');
const { InfluxDB, Point } = require('@influxdata/influxdb-client');

// InfluxDB configuration
const INFLUX_URL = 'http://localhost:8086';
const INFLUX_TOKEN = 'OS0t8w6jBnwwL-HIWgU1lWniUARhRc85gLtFqTbhZiEqVNPvludyzs1vswBDAsegbfWk1pJGpk3dY1LKK_2zDQ==';
const INFLUX_ORG = '6914ea40681fbe1d';
const INFLUX_BUCKET = 'brandpulse';

// Kafka configuration
const kafkaConfig = {
  clientId: `brandpulse-consumer-${process.pid}-${threadId}`,
  brokers: ['localhost:9092'],
  retry: {
    retries: 10,
    initialRetryTime: 50,
    maxRetryTime: 1000,
  },
};

const CONSUMER_GROUP = 'brandpulse-consumer-group';
const TOPIC = 'tweets';
const INFLUX_BATCH_SIZE = 5000; // Larger batch size for high throughput
const FLUSH_INTERVAL_MS = 100; // Flush every 100ms for responsiveness
const WORKER_COUNT = Math.min(os.cpus().length, 4); // Scale workers beyond 4, adjust based on partitions

// Worker Logic
if (!isMainThread) {
  const consumer = new Kafka(kafkaConfig).consumer({
    groupId: CONSUMER_GROUP,
    sessionTimeout: 30000,
    heartbeatInterval: 10000, // Less frequent heartbeats
    maxBytesPerPartition: 3 * 1024 * 1024, // 2MB per partition
    maxBytes: 20 * 1024 * 1024, // 10MB total fetch size
    maxPollInterval: 300000,
    fetchMaxWaitMs: 100, // Faster fetches
  });

  const influxClient = new InfluxDB({ url: INFLUX_URL, token: INFLUX_TOKEN });
  const writeApi = influxClient.getWriteApi(INFLUX_ORG, INFLUX_BUCKET, 'ns', {
    defaultTags: { source: 'kafkaConsumer' },
    writeOptions: {
      batchSize: INFLUX_BATCH_SIZE,
      flushInterval: FLUSH_INTERVAL_MS,
      maxRetries: 10,
      maxRetryDelay: 5000,
      minRetryDelay: 500,
      retryJitter: 500,
    },
  });

  let pointBuffer = [];
  let totalFlushedPoints = 0;

  const flushPointsToInflux = async () => {
    if (pointBuffer.length === 0) return;

    try {
      const startTime = Date.now();
      writeApi.writePoints(pointBuffer);
      await writeApi.flush();
      const flushDuration = Date.now() - startTime;
      totalFlushedPoints += pointBuffer.length;

      parentPort.postMessage({
        type: 'influxFlush',
        message: `Flushed ${pointBuffer.length} points in ${flushDuration}ms`,
        totalFlushed: totalFlushedPoints,
      });

      pointBuffer = [];
    } catch (error) {
      parentPort.postMessage({
        type: 'error',
        message: `InfluxDB write error: ${error.message}`,
      });
      if (pointBuffer.length > INFLUX_BATCH_SIZE * 2) {
        pointBuffer = pointBuffer.slice(pointBuffer.length - INFLUX_BATCH_SIZE); // Keep newest points
      }
    }
  };

  const processMessagesInParallel = async (messages) => {
    const chunkSize = Math.ceil(messages.length / os.cpus().length);
    const chunks = [];
    for (let i = 0; i < messages.length; i += chunkSize) {
      chunks.push(messages.slice(i, i + chunkSize));
    }

    const points = await Promise.all(
      chunks.map(async (chunk) => {
        const chunkPoints = [];
        for (const message of chunk) {
          try {
            const decodedValue = tweetSchema.fromBuffer(message.value);
            const currentTime = new Date();
            currentTime.setMilliseconds(currentTime.getMilliseconds() + Math.random());

            const point = new Point('tweets')
              .tag('brand', 'SuperCoffee')
              .tag('sentiment', decodedValue.sentiment)
              .stringField('text', decodedValue.text.substring(0, 255))
              .intField('count', 1)
              .timestamp(currentTime);

            chunkPoints.push(point);
          } catch (err) {
            parentPort.postMessage(`Message processing error: ${err.message}`);
          }
        }
        return chunkPoints;
      })
    );

    return points.flat();
  };

  const runConsumer = async () => {
    try {
      await consumer.connect();
      await consumer.subscribe({ topic: TOPIC, fromBeginning: false });

      await consumer.run({
        autoCommit: true,
        autoCommitInterval: 10000, // Less frequent commits
        autoCommitThreshold: 1000, // Larger commit threshold
        eachBatchAutoResolve: true,
        eachBatch: async ({ batch, resolveOffset, heartbeat }) => {
          const { messages } = batch;

          if (messages.length === 0) return;

          const startTime = Date.now();
          const points = await processMessagesInParallel(messages);
          pointBuffer.push(...points);

          if (pointBuffer.length >= INFLUX_BATCH_SIZE) {
            await flushPointsToInflux();
          }

          resolveOffset(messages[messages.length - 1].offset);
          await heartbeat();

          const duration = Date.now() - startTime;
          parentPort.postMessage({
            type: 'batchProcessed',
            message: `Processed ${messages.length} messages in ${duration}ms`,
            bufferedPoints: pointBuffer.length,
          });
        },
      });
    } catch (err) {
      parentPort.postMessage({
        type: 'fatal',
        message: `Consumer error: ${err.message}`,
        stack: err.stack,
      });
    }
  };

  const flushInterval = setInterval(flushPointsToInflux, FLUSH_INTERVAL_MS);

  const healthCheckInterval = setInterval(() => {
    parentPort.postMessage({
      type: 'healthCheck',
      bufferedPoints: pointBuffer.length,
      totalFlushedPoints: totalFlushedPoints,
    });
  }, 10000);

  process.on('SIGTERM', async () => {
    clearInterval(flushInterval);
    clearInterval(healthCheckInterval);
    await flushPointsToInflux();
    await writeApi.close();
    await consumer.disconnect();
    process.exit(0);
  });

  runConsumer().catch((err) => {
    parentPort.postMessage({
      type: 'fatal',
      message: `Fatal error: ${err.message}`,
      stack: err.stack,
    });
    process.exit(1);
  });
}

// Main Thread
if (isMainThread) {
  console.log(`Spawning ${WORKER_COUNT} workers`);

  const workers = new Set();

  const spawnWorker = (id) => {
    const worker = new Worker(__filename);
    worker
      .on('message', (msg) => {
        if (msg.type === 'error' || msg.type === 'fatal') {
          console.error(`[W${id}] ${msg.message}`);
        } else {
          console.log(`[W${id}] ${msg.type}: ${msg.message || JSON.stringify(msg)}`);
        }
      })
      .on('error', (err) => console.error(`[W${id}] Error: ${err.message}`))
      .on('exit', (code) => {
        workers.delete(worker);
        if (code !== 0) spawnWorker(id);
      });
    workers.add(worker);
  };

  for (let i = 0; i < WORKER_COUNT; i++) {
    spawnWorker(i + 1);
  }

  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    for (const worker of workers) {
      worker.postMessage({ type: 'shutdown' });
      setTimeout(() => worker.terminate(), 10000);
    }
    setTimeout(() => process.exit(0), 15000);
  });
}