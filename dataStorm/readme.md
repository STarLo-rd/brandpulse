# DataStorm - High-Throughput Kafka Data Generator

Welcome to **DataStorm**, my powerhouse Kafka producer built to unleash a torrent of fake tweet data at blistering speeds. Designed to stress-test data pipelines, DataStorm pumps out millions of tweets per second, complete with sentiment labels, into Kafka’s "tweets" topic. Whether you’re benchmarking a system or simulating a social media firehose, this tool’s got the muscle to deliver.

**[Explore the Full BrandPulse Docs](https://starlo-rd.github.io/docs/brandpulse/)** - Check out the bigger picture, including implementation details and demo runs.

---

## Overview

DataStorm (`producer.js`) is the beating heart of my BrandPulse project’s data generation layer. It’s a Node.js script that leverages Kafka to generate tweet-like messages at scale, optimized for raw throughput. With multiple workers, massive batches, and a relentless 1ms interval, it’s engineered to push the limits—think 32,000,000 tweets per second in theory, and over 700,000/sec in practice on modest hardware.

---

## Features

- **High-Performance Design**: No compression, high buffer memory—built for speed over everything else.
- **Multi-Threaded Workers**: Spins up at least 8 or 4 workers (or matches CPU cores if higher) to maximize parallel generation.
- **Predefined Tweets**: Uses 6 fixed tweet templates—2 positive, 2 negative, 2 neutral—for a balanced ~33.3% sentiment split per batch.
- **Massive Batches**: Each worker churns out 8,000 tweets per batch, randomly sampled from the templates.
- **Blazing Intervals**: Batches fire every 1ms, targeting up to 8,000,000 tweets/sec per worker.
- **Shared Timestamps**: All 8,000 tweets in a batch get the same `Date.now()` timestamp, syncing them for downstream processing.

---

## Why DataStorm?

I created DataStorm to simulate the chaos of real-world social media streams—fast, unpredictable, and massive. It’s not just about generating data; it’s about testing how systems hold up under pressure. Paired with my consumer (`datahandler`) and dashboard, it’s the first piece of a pipeline that handles over 700k tweets/sec end-to-end.

---

## Getting Started

### Prerequisites
- **Node.js**: v16+ (for worker threads and performance).
- **Kafka**: A running Kafka broker (e.g., `localhost:9092`).
- **Hardware**: Multi-core CPU recommended for peak performance.

### Setup
1. **Clone the Repo**:
   ```bash
   git clone https://github.com/STarLo-rd/brandpulse.git
   cd brandpulse
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Set Up Kafka Topic**:
   Create the "tweets" topic with 32 partitions for optimal distribution:
   ```bash
   bin/kafka-topics.sh --create --bootstrap-server localhost:9092 --replication-factor 1 --partitions 32 --topic tweets
   ```

4. **Run DataStorm**:
   ```bash
   node src/producer.js
   ```
   - Workers kick in (default: 8 or CPU cores).
   - Batches of 8,000 tweets hit Kafka every 1ms.
   - Monitor progress with `monitor.js` (see [BrandPulse Docs](https://starlo-rd.github.io/docs/brandpulse/implementation/)) for real-time stats.

---

## How It Works

- **Worker Threads**: I use Node.js worker threads to parallelize generation. Each worker operates independently, targeting the "tweets" topic.
- **Tweet Generation**: From a pool of 6 predefined tweets (e.g., "Love this day!" [+], "This sucks!" [-]), I randomly pick 8,000 per batch, aiming for a 33.3% split across sentiments.
- **Kafka Push**: Batches are Avro-serialized and sent every 1ms, with no delay beyond that tiny window.
- **Performance**: With 8 workers, that’s 32,000 tweets every 1ms—or 32M/sec in theory. Real runs hit 700k+/sec, limited by serialization and hardware.

Check the [implementation details](https://starlo-rd.github.io/docs/brandpulse/implementation/) for the nitty-gritty.

---

## Sample Output

Here’s what `monitor.js` showed during a run:
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
That’s DataStorm in full flight—over half a million tweets/sec on average, peaking at 707k/sec.

---

## Configuration

Tweak these in `producer.js` to suit your needs:
- **Worker Count**: Adjust `numWorkers` (default: `Math.max(4, os.cpus().length)`).
- **Batch Size**: Set `BATCH_SIZE` (default: 8,000).
- **Batch Interval**: Change `BATCH_INTERVAL_MS` (default: 1ms).
- **Kafka Settings**: Update `kafka.producer` options (e.g., buffer memory) in the script.

---

## Next Steps

- Pair DataStorm with `datahandler` (consumer) and my dashboard for the full BrandPulse experience—see [the docs](https://starlo-rd.github.io/docs/brandpulse/demo/).
- Push the limits: Crank up workers or batch sizes and watch it scale (or break!).

---

## Contributing

Found a bottleneck? Got a tweak? Open an issue or PR on [GitHub](https://github.com/STarLo-rd/brandpulse). I’d love to see how others can turbocharge DataStorm.

---

## License

MIT License—use it, tweak it, share it. See [LICENSE](LICENSE) for details.

---

## Acknowledgments

- Kafka for its relentless scalability.
- Node.js for making parallel workers a breeze.
- My coffee for keeping me sane through the optimization grind.

---

**DataStorm**: Where tweets meet speed. Dive into the storm at [https://starlo-rd.github.io/docs/brandpulse/](https://starlo-rd.github.io/docs/brandpulse/).
