# DataStorm - High-Throughput Kafka Data Generator

![Kafka Node.js Badge](https://img.shields.io/badge/Stack-Apache_Kafka%20%2B%20Node.js-green)

## 📌 Project Overview
Real-time data generation system for stress-testing Kafka clusters with configurable payloads and throughput targets.

**Current Milestone**: `v4.2`  
**Target Throughput**: 1M messages/second  
**Achieved Throughput**: 600K+ messages/s (Localhost)

```text
Project Structure
├── src/
│   ├── v0/        # Initial prototype
│   ├── v1/        # Worker threads
│   ├── v2/        # Serialization optimization 
│   ├── v3/        # Multi-broker support
│   └── v4/        # Cluster mode
├── schemas/       # Avro data definitions
└── benchmarks/    # Performance reports
```

## 📈 Development Progress Log

### Version History

| Version | Key Changes                                   | Throughput | Duration  | Stability |
|---------|-----------------------------------------------|------------|-----------|-----------|
| v0.1    | Single-thread producer                        | 2K/s       | 10min     | ⚠️ Low    |
| v1.2    | Worker thread implementation                  | 18K/s      | 30min     | ✅ Stable |
| v2.1    | Avro pre-serialization                        | 56K/s      | 2hr       | ✅ Stable |
| v3.3    | Multi-broker local cluster                    | 210K/s     | 6hr       | 🟡 Medium |
| v4.0    | Worker clustering + 16MB batches              | 420K/s     | Ongoing   | 🟡 Medium |

[detailed information](./changelog.md)
### Key Breakthroughs
```text
2025-02-15: Crossed 100K/s barrier using worker thread pooling
2025-02-17: Implemented zero-copy serialization (40% gain)
2025-02-21: Localhost 4-broker cluster setup stabilized
2025-02-25: LZ4 compression outperformed ZSTD in Node.js
```

### Benchmark Results (v4.2)
```bash
# Test Conditions
- 4 Kafka brokers (localhost)
- 16 logical cores
- 32GB RAM
- Node.js 18.14

# Throughput Peaks
✅ 420,392 msg/s (16MB batches)
✅ 38.7 MB/s sustained
⚠️  GC pauses: 200-400ms every 45s
```

