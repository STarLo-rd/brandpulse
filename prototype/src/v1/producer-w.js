const { Kafka, Partitioners } = require('kafkajs');
const { Worker, isMainThread, parentPort } = require('worker_threads');
const dataSchema = require('../../schema/avroSchema');

const kafka = new Kafka({
  clientId: 'dataStorm-producer',
  brokers: ['localhost:9092', 'localhost:9093', 'localhost:9094', 'localhost:9095', 'localhost:9096', 'localhost:9097'], // Multiple brokers
});

// Function to generate a batch of messages
const generateBatch = (batchSize) => {
  return Array.from({ length: batchSize }, () => {
    const record = {
      id: Math.floor(Math.random() * 100000),
      timestamp: new Date().toISOString(),
      value: Math.random() * 100
    };
    return { value: dataSchema.toBuffer(record) }; // Serialize with Avro
  });
};

// Worker Logic
if (!isMainThread) {
  const producer = kafka.producer({
    createPartitioner: Partitioners.LegacyPartitioner,
  });

  const runProducer = async () => {
    await producer.connect();
    while (true) {
      const batch = generateBatch(20000); // Each worker sends 20K messages
      await producer.send({
        topic: 'dataStorm-topic',
        messages: batch,
      });
      parentPort.postMessage('✅ Sent 20K records');
    }
  };

  runProducer().catch(console.error);
}

// Main Thread - Spawning Worker Threads
if (isMainThread) {
  const WORKER_COUNT = 8; // Number of parallel workers
  console.log(`Master process is running... Spawning ${WORKER_COUNT} workers`);

  for (let i = 0; i < WORKER_COUNT; i++) {
    const worker = new Worker(__filename);
    worker.on('message', (msg) => console.log(`[Worker ${i + 1}] ${msg}`));
    worker.on('error', (err) => console.error(`[Worker ${i + 1}] Error:`, err));
  }
}
