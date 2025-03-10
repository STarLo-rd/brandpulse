const { Kafka } = require('kafkajs');
const { Worker, isMainThread, parentPort, threadId } = require('worker_threads');
const dataSchema = require('./schema/avroSchema');
const os = require('os');
const { InfluxDB, Point } = require('@influxdata/influxdb-client');

// InfluxDB configuration
const INFLUX_URL = 'http://localhost:8086';
const INFLUX_TOKEN = 'OS0t8w6jBnwwL-HIWgU1lWniUARhRc85gLtFqTbhZiEqVNPvludyzs1vswBDAsegbfWk1pJGpk3dY1LKK_2zDQ==';
const INFLUX_ORG = '6914ea40681fbe1d';
const INFLUX_BUCKET = 'datastorm';

// Shared Kafka configuration
const kafkaConfig = {
  clientId: `dataStorm-consumer-${process.pid}-${threadId}`,
  brokers: ['localhost:9092'],
  retry: {
    retries: 5,
    initialRetryTime: 100,
    maxRetryTime: 3000
  }
};

// Consumer group configuration
const CONSUMER_GROUP = 'datastorm-consumer-group';
const TOPIC = 'dataStorm-topic';

// Batch size for InfluxDB writes
const INFLUX_BATCH_SIZE = 1000;

// Worker Logic
if (!isMainThread) {
  const consumer = new Kafka(kafkaConfig).consumer({
    groupId: CONSUMER_GROUP,
    sessionTimeout: 30000,
    heartbeatInterval: 3000,
    maxBytesPerPartition: 10 * 1024 * 1024, // 10MB per partition
    maxBytes: 100 * 1024 * 1024, // 100MB total
  });

  // Initialize InfluxDB client
  const influxClient = new InfluxDB({ url: INFLUX_URL, token: INFLUX_TOKEN });
  const writeApi = influxClient.getWriteApi(INFLUX_ORG, INFLUX_BUCKET, 'ns');
  
  // Buffer for batch writes to InfluxDB
  let pointBuffer = [];
  
  // Function to flush points to InfluxDB
  const flushPointsToInflux = async () => {
    if (pointBuffer.length === 0) return;
    
    try {
      await writeApi.writePoints(pointBuffer);
      await writeApi.flush();
      parentPort.postMessage(`Flushed ${pointBuffer.length} points to InfluxDB`);
      pointBuffer = [];
    } catch (error) {
      parentPort.postMessage(`InfluxDB write error: ${error.message}`);
      // Keep the points in buffer to retry on next flush
    }
  };

  const runConsumer = async () => {
    await consumer.connect();
    parentPort.postMessage({ type: 'status', status: 'connected' });
    
    await consumer.subscribe({ topic: TOPIC, fromBeginning: false });
    
    await consumer.run({
      autoCommit: true,
      autoCommitInterval: 5000,
      autoCommitThreshold: 100,
      eachBatchAutoResolve: true,
      eachBatch: async ({ batch, resolveOffset, heartbeat, isRunning, isStale }) => {
        const { topic, partition, messages } = batch;
        
        if (messages.length === 0) return;
        
        const startTime = Date.now();
        
        for (const message of messages) {
          try {
            // Decode the Avro message
            const decodedValue = dataSchema.fromBuffer(message.value);
            
            // Create InfluxDB point
            const point = new Point('datastorm_metrics')
              .tag('id', decodedValue.id.toString())
              .floatField('value', decodedValue.value)
              .timestamp(new Date(decodedValue.timestamp));
            
            pointBuffer.push(point);
            
            // Log every 1000th message for monitoring
            if (message.offset % 1000 === 0) {
              console.log(`Processed message: ${JSON.stringify(decodedValue)}`);
            }
            
            // Mark message as processed
            resolveOffset(message.offset);
          } catch (err) {
            parentPort.postMessage(`Error processing message: ${err.message}`);
          }
          
          // Send heartbeat every 100 messages to prevent timeouts
          if (parseInt(message.offset) % 100 === 0) {
            await heartbeat();
          }
        }
        
        // Flush to InfluxDB when buffer reaches threshold
        if (pointBuffer.length >= INFLUX_BATCH_SIZE) {
          await flushPointsToInflux();
        }
        
        const duration = Date.now() - startTime;
        parentPort.postMessage(`Processed ${messages.length} messages in ${duration}ms from partition ${partition}`);
      }
    });
  };

  // Set up periodic flush to ensure data gets written even with low volume
  const flushInterval = setInterval(flushPointsToInflux, 10000);

  // Set up error handling and graceful shutdown
  process.on('SIGTERM', async () => {
    clearInterval(flushInterval);
    await flushPointsToInflux();
    await writeApi.close();
    await consumer.disconnect();
  });

  runConsumer().catch(err => {
    parentPort.postMessage(`Fatal consumer error: ${err.message}`);
    process.exit(1);
  });
}

// Main Thread
if (isMainThread) {
  // Use one worker per CPU core, but don't overdo it for InfluxDB connections
  const WORKER_COUNT = Math.min(os.cpus().length, 8);
  
  const workers = new Set();

  console.log(`Main consumer process started. Spawning ${WORKER_COUNT} workers`);

  // Worker management
  const spawnWorker = (id) => {
    const worker = new Worker(__filename);

    worker
      .on('message', (msg) => console.log(`[Consumer-W${id}] ${typeof msg === 'object' ? JSON.stringify(msg) : msg}`))
      .on('error', (err) => console.error(`[Consumer-W${id}] Error: ${err.message}`))
      .on('exit', (code) => {
        console.log(`[Consumer-W${id}] Exited with code ${code}`);
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
    console.log('\nGracefully shutting down consumer...');
    for (const worker of workers) {
      await worker.terminate();
    }
    process.exit(0);
  });
}