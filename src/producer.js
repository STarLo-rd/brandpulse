const { Kafka, Partitioners } = require('kafkajs');
const dataSchema = require('../schema/avroSchema');

// Kafka configuration with legacy partitioner to silence the warning (optional)
const kafka = new Kafka({
  clientId: 'dataStorm-producer',
  brokers: ['localhost:9092'],
});
const producer = kafka.producer({
  createPartitioner: Partitioners.LegacyPartitioner,
});


// Function to generate a batch of 100K records
//didn't able to handle that 100k so now moving into 50k
const generateBatch = () => {
  return Array.from({ length: 20000 }, () => {
    const record = {
      id: Math.floor(Math.random() * 100000),
      timestamp: new Date().toISOString(),
      value: Math.random() * 100
    };
    return { value: dataSchema.toBuffer(record) }; // Serialize with Avro
  });
};

// Kafka Producer Function
const runProducer = async () => {
  await producer.connect();

  while (true) {
    const batch = generateBatch();
    await producer.send({
      topic: 'dataStorm-topic',
      messages: batch,
    });
    console.log(`✅ Sent 20K records to Kafka`);
  }
};

// Start producing data
runProducer().catch(console.error);
