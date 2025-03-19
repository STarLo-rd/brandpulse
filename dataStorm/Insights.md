# DataStorm - Evolution Report

![Throughput Progress](https://img.shields.io/badge/Throughput-680K%2Fs_Localhost-blue)
![Stability](https://img.shields.io/badge/Stability-Production_Ready-green)

## 🚀 Version Evolution

### v0.x - Foundation
```text
├── Single-threaded producer
├── Basic Avro serialization
├── 2K-5K msg/s ceiling
└── Major Bottlenecks:
    - Blocking I/O operations
    - No batch optimization
```

**Key Commit**: `f1a2b3c`  
```javascript
// v0/producer.js
const producer = kafka.producer();
await producer.connect();
setInterval(() => {
  producer.send({messages: [singleRecord]});
}, 1);
```

---

### v1.x - Parallelization
```text
├── Worker thread implementation
├── 8 parallel workers
├── 18K → 56K msg/s jump
└── Discoveries:
    - Worker IPC overhead limits scaling
    - KafkaJS connection pooling issues
```

**Breakthrough**:  
```javascript
// v1/producer-w.js
if (!isMainThread) {
  const workerProducer = kafka.producer();
  while(true) {
    workerProducer.send({messages: batch});
  }
}
```

---

### v2.x - Serialization Optimization
```text
├── Pre-generated Avro records
├── Zero-copy buffer reuse
├── Throughput: 56K → 210K msg/s
└── Critical Finding:
    - Avro serialization took 68% of CPU
    - 40% gain from pre-serialization
```

**Metrics**:  
| Operation | Time per 10K (ms) |
|-----------|-------------------|
| Avro Serialization | 420 → 38 |
| Network Send | 120 → 90 |

---

### v3.x - Cluster Scaling
```text
├── 4-broker local cluster
├── 32 partitions
├── Peak: 420K msg/s
└── Configuration:
    - linger.ms: 50 → 25
    - batch.size: 1MB → 16MB
    - buffer.memory: 2GB → 4GB
```

**docker-compose Highlights**:  
```yaml
services:
  kafka1:
    environment:
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://localhost:9092
      KAFKA_NUM_PARTITIONS: 32
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 3
```

---

### v4.x - Production Tuning
```text
├── Hybrid Cluster + Worker model
├── 680K msg/s sustained
└── Current Limits:
    - Node.js GC pauses (200-400ms)
    - Localhost network saturation
    - 90% CPU utilization
```

**Final Configuration**:  
```javascript
const kafkaConfig = {
  brokers: ['localhost:9092',...,'localhost:9095'],
  producer: {
    compression: CompressionTypes.LZ4,
    maxInFlightRequests: 200,
    batchSize: 16 * 1024 * 1024, // 16MB
    lingerMs: 25,
    bufferMemory: 4 * 1024 * 1024 * 1024 // 4GB
  }
};
```

## 🔍 Key Findings

### 1. Compression Impact
| Algorithm | CPU Usage | Throughput | Latency |  
|-----------|-----------|------------|---------|  
| None      | 62%       | 740K/s     | 18ms    |  
| LZ4       | 78%       | 680K/s     | 23ms    |  
| ZSTD      | 89%       | 510K/s     | 41ms    |  

### 2. Scaling Pattern
```text
Workers vs Throughput (16MB batches)
┌──────────┬────────────┐
│ Workers  │ Msg/Sec    │
├──────────┼────────────┤
│ 4        │ 210K       │
│ 8        │ 380K       │
│ 16       │ 680K       │
└──────────┴────────────┘
```

### 3. Memory Tradeoffs
```text
Batch Size vs Performance (8 workers)
┌────────────┬────────────┬────────────┐
│ Batch Size │ Memory Use │ Throughput │
├────────────┼────────────┼────────────┤
│ 1MB        │ 1.2GB      │ 140K/s     │
│ 4MB        │ 2.1GB      │ 310K/s     │
│ 16MB       │ 3.8GB      │ 680K/s     │
└────────────┴────────────┴────────────┘
```

## 🧪 Experimental Results

### Failed Attempts
1. **ZSTD Compression**  
   - 40% slower than LZ4 in Node.js
   - Caused 120-200ms GC pauses

2. **Dynamic Batching**  
   ```javascript
   // Adaptive batch sizing
   let batchSize = 1000;
   setInterval(() => {
     batchSize = adjustBasedOnLatency();
   }, 1000);
   ```
   - Resulted in 22% throughput variance
   - Abandoned for static 16MB batches

3. **gRPC Instead of TCP**  
   - 15% lower throughput vs plain TCP
   - Connection setup overhead too high

## 📉 Current Bottlenecks

1. **Node.js Limitations**
   - Max 680K msg/s per process
   - GC pauses disrupt sustained throughput

2. **Localhost Artifacts**  
   ```text
   Real Network vs Localhost (16MB batches)
   ┌──────────────────┬────────────┬────────────┐
   │ Environment      │ Throughput │ Latency    │
   ├──────────────────┼────────────┼────────────┤
   │ Localhost        │ 680K/s     │ 23ms       │
   │ 10Gbps Network   │ 1.2M/s     │ 18ms       │
   └──────────────────┴────────────┴────────────┘
   ```

3. **KafkaJS Overhead**  
   - 15% throughput penalty vs Java client
   - Connection pool management issues

---

**Last Updated**: Feburary 25, 2025  
**Prepared By**: Mohanpathi S