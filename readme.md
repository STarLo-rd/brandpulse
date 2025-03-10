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



Workers: Assuming you’re still on os.cpus().length * 3 workers (e.g., 24 workers on an 8-core system), each worker is averaging ~23K-25K tweets/sec (550K ÷ 24).

BrandPulse Tweet Generation Metrics
[▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░] 18.78%
├─ Total Tweets: 9,392,000 / 50,000,000
├─ Throughput (current): 731,200 tweets/sec
├─ Throughput (avg): 552,081 tweets/sec
├─ Elapsed: 00:00:17
├─ Remaining: 00:01:13
└─ Errors: 0^C


Current Performance Snapshot
Throughput:
Current: 731,200 tweets/sec (peak).
Average: 552,081 tweets/sec (sustained).

Config Highlights:
Batch size: 8,000 tweets.
Interval: 1ms between batches.
Workers: Math.max(4, os.cpus().length * 2) (e.g., 16 on an 8-core machine).
Kafka: No compression, acks: 0, lingerMs: 1, aggressive memory usage.


Producer (producer.js):

    The producer is configured to generate fake tweets using the Kafka library, with settings optimized for high performance (e.g., no compression, high buffer memory).
    It uses multiple worker threads, with the number of workers set to at least 4 or the number of CPU cores, whichever is higher.
    Tweets are predefined with texts and sentiments: there are 6 predefined tweets, split evenly with 2 positive, 2 negative, and 2 neutral sentiments.
    Each worker generates batches of 8,000 tweets, selecting randomly from these 6 predefined tweets, resulting in an expected distribution of approximately 33.3% for each sentiment per batch.
    The batch interval is set to 1ms, meaning each worker sends a batch and waits 1ms before generating the next, leading to a potential generation rate of 8,000,000 tweets per second per worker.
    Timestamps for tweets within a batch are set to the time of batch generation (Date.now()), meaning all 8,000 tweets in a batch share the same timestamp.

Consumer (consumer.js):

    The consumer also uses multiple worker threads, with the number set to the minimum of CPU cores or 2, to process tweets from the Kafka topic "tweets."
    It is configured with a consumer group and settings for session timeout, heartbeat interval, and maximum bytes per partition, ensuring robust consumption.
    Each worker subscribes to the topic and processes batches of messages, decoding them using a tweet schema and creating InfluxDB points.
    Each tweet is written to InfluxDB as a point in the "tweets" measurement, with tags for brand ("SuperCoffee") and sentiment (positive, negative, or neutral), and fields including "text" (truncated to 255 characters) and "count" set to 1.
    Points are buffered and flushed to InfluxDB in batches of 5,000 points or every 5 seconds, whichever comes first, with options for retrying failed writes.



producer.js uses Kafka to send fake tweets with sentiment to a "tweets" topic, running in multiple worker threads.
consumer.js reads these tweets, decodes them, and writes data to InfluxDB, also using multiple worker threads.


The producer generates random tweets from a list, mixing positive, negative, and neutral sentiments.
There are 6 predefined tweets: 2 positive, 2 negative, and 2 neutral, so each has an equal chance in the batch.

The consumer adds a random millisecond variation to timestamps to prevent overwrites in InfluxDB.
All 8000 tweets in a batch have the same timestamp, so they fall into the same second when aggregated.


 from(bucket: "brandpulse")
  |> range(start: -1h)
  |> filter(fn: (r) => r._measurement == "tweets")
  |> group(columns: ["sentiment"])

vs 

    from(bucket: "brandpulse")
    |> range(start: -1h)
    |> filter(fn: (r) => r._measurement == "tweets")
    |> filter(fn: (r) => r._field == "count")
    |> aggregateWindow(every: 1s, fn: sum)
    |> group(columns: ["sentiment"])

This query fetches data from the "brandpulse" bucket for the last hour, filters for the "tweets" measurement and "count" field, aggregates the sum of "count" per second, and groups by sentiment.
Given each tweet has "count" = 1, the sum per second for each sentiment represents the number of tweets with that sentiment in that second.
With batches of 8,000 tweets generated every 1ms and potentially multiple batches per second (due to multiple workers and fast generation), the sums per second can be very large, explaining the user's observation of "tons of data."


problem faced-
buffer memory - flusing time
 You're only flushing when you reach INFLUX_BATCH_SIZE (10,000) points or every 10 seconds. If your buffer isn't filling up fast enough, data might be sitting in memory.

 Better Flush Management:

Reduced batch size from 10,000 to 5,000 for more frequent writes
Decreased flush interval from 10 seconds to 5 seconds
Added explicit write options for better control

Timestamp Handling: Your CSV shows data points with very precise timestamps (millisecond-level). InfluxDB might be overwriting points with the same timestamp if they share the same tag combination.

The issue was with how InfluxDB handles data points that have identical combinations of:

Measurement name
Tag set
Timestamp

In InfluxDB, these three elements together form a unique identifier for each data point. If you write multiple points with the same measurement, tags, and timestamp, InfluxDB doesn't append them - it overwrites the previous point with the new one.

Your fix of adding timestamp variation solved the immediate issue by ensuring each point had a unique identifier, allowing InfluxDB to store all the data points rather than overwriting them.



BATCH_INTERVAL_MS is set to 1ms, meaning there's a very short delay between sending batches, which supports high throughput.
I'm checking how quickly the producer generates batches, given the 1ms delay, which might result in timestamps being very close together.
JavaScript's Date.setMilliseconds only accepts integers between 0 and 999, so adding Math.random() might not work as intended for timestamp variation.
Adding Math.random() to the timestamp doesn't effectively vary it, since setMilliseconds truncates to integers.
The code's attempt to vary timestamps with Math.random() fails, as setMilliseconds doesn't handle fractional milliseconds.
All tweets from the same batch end up with the same timestamp in InfluxDB, since the consumer's timestamp variation doesn't work.



With 4 workers, each generating 8000 tweets every 1ms, that's 32,000,000 tweets per second, which seems unrealistically high for any system.





support two distinct modes for sentiment distribution in the tweet generation:

Fixed Values: The user can specify exact percentages for positive, negative, and neutral sentiments (e.g., 50% positive, 30% negative, 20% neutral), and the distribution strictly adheres to those values.
High Volatility Random: A mode where sentiment distribution is more random and fluctuates significantly, introducing high variability (e.g., one batch might be 80% positive, the next 10% positive, etc.).

Two Modes:
Fixed Mode: Uses userSentimentDistribution to enforce exact percentages across the entire tweet pool. The distribution remains consistent for all batches.
Volatile Mode: Introduces adjustBatchSentiment, which regenerates sentiment per batch with high variability. The volatilityFactor (set to 0.8) controls how extreme the swings are (closer to 1 = more volatile).

Mode Selection:
Added a MODE constant in index.js to switch between "fixed" and "volatile".
In fixed mode, generateTweetPool respects the user’s percentages.
In volatile mode, adjustBatchSentiment overrides the base pool’s sentiment distribution for each batch.
