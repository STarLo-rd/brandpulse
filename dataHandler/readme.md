# BrandPulse Data Handler

Welcome to the **Data Handler** for BrandPulse—a key piece of my real-time tweet processing pipeline. This component takes tweet data streamed from Kafka, processes it with sentiment aggregation, and writes it efficiently to InfluxDB for storage and visualization. Built to handle high-throughput data (over 700,000 tweets/sec), it’s optimized for scale, speed, and reliability. This README covers everything you need to get it running, understand its role, and tweak it for your needs.

---

## Overview

The Data Handler is the workhorse that bridges Kafka and InfluxDB in BrandPulse. It:
- **Reads**: Pulls tweet batches from Kafka’s "tweets" topic (32 partitions).
- **Processes**: Aggregates sentiment counts (positive, negative, neutral) per second.
- **Writes**: Stores the results in InfluxDB with nanosecond precision to avoid overwrites.

I designed it to keep up with my producer’s output—8,000-tweet batches every millisecond across 4 workers—while ensuring the dashboard gets fresh data fast. It’s lean, parallelized, and tuned to perfection.

---

## Features

- **High Throughput**: Handles 700k+ tweets/sec with optimized batching and flushing.
- **Sentiment Aggregation**: Sums tweet counts by sentiment per second, reducing write load.
- **InfluxDB Integration**: Writes time-series data with nanosecond timestamps for uniqueness.
- **Parallel Processing**: Leverages multiple worker threads for maximum efficiency.
- **Real-Time Ready**: Flushes data every 5 seconds or 5,000 points for near-instant updates.

---

## Prerequisites

To run the Data Handler, you’ll need:

### Software
- **Node.js**: v16.x or higher (I used v18.x for development).
- **Kafka**: A running Kafka broker (e.g., `localhost:9092`) with the "tweets" topic set up:
  ```bash
  bin/kafka-topics.sh --create --bootstrap-server localhost:9092 --replication-factor 1 --partitions 32 --topic tweets
  ```
- **InfluxDB**: v2.x (required for time-series storage and querying).
  - **Bucket**: "brandpulse" (default name, configurable).
  - **Organization**: Your InfluxDB org (e.g., "my-org").
  - **Token**: An API token with write access to the "brandpulse" bucket.

### Dependencies
Install these via npm:
```bash
npm install kafka-node @influxdata/influxdb-client crypto
```
- `kafka-node`: For consuming messages from Kafka.
- `@influxdata/influxdb-client`: Official InfluxDB client for Node.js.
- `crypto`: For generating unique IDs (if needed).

---

## Installation

1. **Clone the Repo**:
   ```bash
   git clone https://github.com/STarLo-rd/brandpulse.git
   cd brandpulse/dataHandler
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Set Up Environment**:
   Create a `.env` file in the root directory with these variables:
   ```
   KAFKA_BROKER=localhost:9092
   INFLUXDB_URL=http://localhost:8086
   INFLUXDB_TOKEN=your-influxdb-token-here
   INFLUXDB_ORG=my-org
   INFLUXDB_BUCKET=brandpulse
   ```
   - Replace values with your Kafka and InfluxDB setup details.

4. **Verify InfluxDB**:
   - Ensure InfluxDB is running and accessible at `INFLUXDB_URL`.
   - Create the "brandpulse" bucket via the InfluxDB UI or CLI:
     ```bash
     influx bucket create -n brandpulse -o my-org -t your-influxdb-token-here
     ```

---

## Usage

### Running the Data Handler
Start the data handler with:
```bash
node src/consumer.js
```
- It connects to Kafka, listens to the "tweets" topic, processes incoming batches, and writes to InfluxDB.
- Requires the producer (`producer.js`) to be running to generate data.

### Configuration
Tweak these in `consumer.js` if needed:
- **Batch Size**: `INFLUX_BATCH_SIZE = 5000` (points before flush).
- **Flush Interval**: `FLUSH_INTERVAL_MS = 5000` (5 seconds).
- **Worker Count**: Defaults to 4 (matches producer setup).

### Example Workflow
1. Start Kafka and InfluxDB.
2. Run `node src/producer.js` to generate tweets.
3. Launch `node src/consumer.js` to process and store them.
4. Query InfluxDB or check the dashboard (see [Demo](#demo)).

---

## How It Works

### Core Logic
1. **Kafka Consumption**:
   - Connects to `localhost:9092`, subscribes to "tweets" with 32 partitions.
   - Reads batches (e.g., 8,000 tweets) using `kafka-node` consumer groups.

2. **Sentiment Aggregation**:
   - Parses each tweet’s sentiment (positive, negative, neutral).
   - Sums counts per second (e.g., 20k positive, 10k negative).

3. **InfluxDB Writes**:
   - Uses `@influxdata/influxdb-client` to write points.
   - Measurement: "tweets".
   - Field: "count" (always 1 per tweet, summed later).
   - Tag: "sentiment" (positive/negative/neutral).
   - Timestamp: Nanosecond precision (e.g., `Date.now() * 1000000 + offset`).

4. **Optimization**:
   - Batches writes at 5k points or 5s to balance speed and freshness.
   - Adds nanosecond offsets to prevent overwrites (InfluxDB’s unique ID rule).

### Sample Data Point
```json
{
  measurement: "tweets",
  tags: { sentiment: "positive" },
  fields: { count: 1 },
  timestamp: 1677654321000000000 // nanoseconds
}
```

---

## Querying the Data

Use this Flux query in InfluxDB to see aggregated sentiment trends:
```flux
from(bucket: "brandpulse")
  |> range(start: -1h)
  |> filter(fn: (r) => r._measurement == "tweets")
  |> filter(fn: (r) => r._field == "count")
  |> aggregateWindow(every: 1s, fn: sum)
  |> group(columns: ["sentiment"])
```
- Sums tweet counts per sentiment per second.
- Powers the dashboard with live trends.

---

## Performance

- **Throughput**: Handles 700k+ tweets/sec (e.g., 710,400 tweets/sec peak from `monitor.js`).
- **Latency**: Data hits InfluxDB within 5s, thanks to flush tuning.
- **Scalability**: 32 Kafka partitions and parallel workers keep it humming.

See `monitor.js` output for proof:
```
BrandPulse Tweet Generation Metrics
[▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░] 34.32%
├─ Total Tweets: 17,160,000 / 50,000,000
├─ Throughput (current): 707,200 tweets/sec
├─ Throughput (avg): 571,886 tweets/sec
├─ Elapsed: 00:00:30
├─ Remaining: 00:00:57
└─ Errors: 0
```

---

## Troubleshooting

- **No Data in InfluxDB**: Check Kafka connection (`KAFKA_BROKER`) and ensure `producer.js` is running.
- **Writes Slow**: Reduce `INFLUX_BATCH_SIZE` or `FLUSH_INTERVAL_MS`.
- **Overwrites**: Verify nanosecond timestamp logic—points must be unique (measurement + tags + timestamp).
- **Errors**: Logs are in `consumer.js`—enable verbose output with `console.log`.

---

## Contributing

Got ideas? Fork the repo, tweak the code, and send a pull request. I’d love to see:
- Faster write strategies.
- Additional aggregations (e.g., per-minute sums).
- Dashboard enhancements.

---

## License

This project is open-source under the MIT License. Use it, tweak it, share it—just give me a shoutout if it helps!

---

## Learn More

Check the full BrandPulse docs: [https://starlo-rd.github.io/docs/brandpulse/](https://starlo-rd.github.io/docs/brandpulse/).  
Dive into:
- [Implementation Details](https://starlo-rd.github.io/docs/brandpulse/implementation.html)
- [Issues Faced](https://starlo-rd.github.io/docs/brandpulse/implementation/issues-faced.html)
- [Demo](https://starlo-rd.github.io/docs/brandpulse/demo.html)

---

## Final Note

The Data Handler is my pride and joy in BrandPulse—proof I can tame a data torrent and make it sing. It’s built to scale, tuned to perform, and ready for you to explore. Let me know how it goes!


```sh
 docker build -t brandpulse-consumer:latest .
[+] Building 8.3s (10/10) FINISHED                                                                                                                                   docker:default
 => [internal] load build definition from Dockerfile                                                                                                                           0.0s
 => => transferring dockerfile: 562B                                                                                                                                           0.0s
 => [internal] load metadata for docker.io/library/node:18-alpine                                                                                                              1.8s
 => [internal] load .dockerignore                                                                                                                                              0.0s
 => => transferring context: 2B                                                                                                                                                0.0s
 => [1/5] FROM docker.io/library/node:18-alpine@sha256:e0340f26173b41066d68e3fe9bfbdb6571ab3cad0a4272919a52e36f4ae56925                                                        0.0s
 => [internal] load build context                                                                                                                                              0.4s
 => => transferring context: 25.07MB                                                                                                                                           0.3s
 => CACHED [2/5] WORKDIR /app                                                                                                                                                  0.0s
 => [3/5] COPY package*.json ./                                                                                                                                                0.1s
 => [4/5] RUN npm ci --only=production                                                                                                                                         5.4s
 => [5/5] COPY . .                                                                                                                                                             0.3s
 => exporting to image                                                                                                                                                         0.2s
 => => exporting layers                                                                                                                                                        0.2s
 => => writing image sha256:3bb84ffae378e8c8807cd25b57d91bfa238e68118d49de2dc4101b3660856242                                                                                   0.0s
 => => naming to docker.io/library/brandpulse-consumer:latest            
 ```