
# BrandPulse: Real-Time Social Media Monitoring at Scale

Welcome to **BrandPulse**, my Minimum Viable Product (MVP) that processes over **700,000 social media posts per second** to deliver instant brand sentiment insights. Built from the ground up with Node.js, Kafka, and InfluxDB, this system simulates a flood of "SuperCoffee" tweets, proving I can design scalable, high-performance pipelines that turn raw data into actionable intelligence—live. Whether it’s catching a PR crisis or spotting a viral trend, BrandPulse is built to handle the chaos of social media at scale.

**[Explore the Full Docs](https://starlo-rd.github.io/docs/brandpulse/)** - Dive into implementation details, demos, and lessons learned.

---

## What It Does

BrandPulse tackles the challenge of delayed brand monitoring by providing a real-time window into how people feel about a brand—positive, negative, or neutral. It’s not just a tech demo; it’s a proof of concept for processing massive data streams with speed and precision. Key features include:

- **Protect Revenue**: Detect negative sentiment spikes (e.g., a crisis) in seconds, not hours.
- **Boost Sales**: Spot positive trends instantly to amplify them while they’re hot.
- **Scale Big**: Handle 700K+ tweets/sec—way beyond typical brand volumes—without breaking a sweat.

---

## Use Cases

BrandPulse isn’t just a cool toy—it’s built to solve real problems brands face daily, and it shines in both demo scenarios and potential real-world applications.

### Demo Scenarios (What You’ll See)
I designed BrandPulse to flex its muscles at 700K+ tweets/sec using "SuperCoffee" as the test brand. Here’s what it can do in action:

- **Crisis Detection**: Imagine a sudden wave of “SuperCoffee sucks #fail” tweets. The dashboard shifts from 80% positive to 60% negative in seconds, flashing an alert. It’s fast enough to catch a PR disaster before it snowballs—proof of real-time power at insane scale.
- **Opportunity Spotting**: Picture “SuperCoffee is life #energize” trending hard. The sentiment pie swings to 90% positive, giving marketing a green light to amplify it. BrandPulse catches the buzz instantly, not a day late.
- **Scalability Flex**: I crank it to 700K+ tweets/sec—overkill for any real brand—and the system keeps humming, updating live with zero lag. It’s my way of showing this thing can take on anything.

### Real-World Applications (Where It’d Shine)
Hook BrandPulse to live APIs (Twitter, Instagram, YouTube), and it’s a game-changer:

- **Crisis Management**: A YouTube review slams SuperCoffee’s new blend, sparking 10K tweets in an hour. BrandPulse flags the negative spike across platforms instantly—PR jumps in before it’s headline news.
- **Campaign Tracking**: SuperCoffee drops #SuperEnergize on Instagram. Tweets and comments roll in—BrandPulse shows 75% positive vibes in real time. Marketing doubles down with ads while the iron’s hot.
- **Competitor Edge**: RivalCoffee botches a recall; “RivalCoffee’s junk!” trends negative. BrandPulse catches it live, letting SuperCoffee swoop in with a timely counter-move—social media chess at its finest.

---

## Technical Architecture

Here’s the engine under BrandPulse’s hood—a lean, mean pipeline that processes 700K+ tweets/sec and turns them into live insights without skipping a beat.

### The Big Picture
BrandPulse is a four-part system: it generates massive tweet streams, moves them fast, ingests them efficiently, and displays them live. It’s built to scale, stay snappy, and handle absurd volumes. Check the flow:

```
+----------------+      +----------------+      +----------------+      +----------------+
| Node.js Workers| -->  | Kafka          | -->  | Node.js Consumer| -->  | InfluxDB       |
| (Data Gen)     |      | (tweets topic) |      | (Data Ingestion)|      | (Storage)      |
+----------------+      +----------------+      +----------------+      +----------------+
       ^                         |                           |
       |                         |                           |
       |                  +----------------+                 |
       +----------------- | Web App         | <---------------+
                          | (Express + Chart.js) |
                          +----------------+
```

### The Components
1. **Data Generation (Node.js Workers)**  
   - **What**: Generates 700K+ "SuperCoffee" tweets/sec—each with ID, timestamp, text, and sentiment.
   - **How**: Node.js worker threads (8+ or CPU-matched) pump out batches of 15K tweets every 5ms. Two sentiment modes: *Fixed* (e.g., 50/30/20 split) or *Volatile* (wild swings, 80% positive one batch, 10% the next).
   - **Why**: Workers max out cores; Node.js excels at I/O-heavy tasks. Sentiment modes add realism—details in [tweetgenerator](https://github.com/STarLo-rd/brandpulse/tree/main/src/tweetgenerator).
   - **Output**: Avro-serialized tweets hit Kafka’s "tweets" topic.

2. **Data Streaming (Kafka)**  
   - **What**: Streams the tweet flood reliably to the consumer.
   - **How**: Kafka’s "tweets" topic with 32 partitions handles 700K+ posts/sec. Tuned producer settings: `acks: 0`, `batchSize: 32MB`, `lingerMs: 2`, `maxInFlightRequests: 1000`.
   - **Why**: Kafka’s built for high-throughput streaming—partitions spread the load for scale.

3. **Data Ingestion (Node.js Consumer + InfluxDB)**  
   - **What**: Pulls tweets from Kafka, aggregates sentiment, and stores it in InfluxDB.
   - **How**: A consumer with 4+ workers reads batches, decodes Avro, and batches 1K points for InfluxDB every 5s. Stores as `tweets` measurement with `sentiment` tags and `count` fields.
   - **Why**: InfluxDB’s time-series power tracks sentiment over time; batching keeps writes fast at 700K/sec.

4. **Web Application (Express + Chart.js)**  
   - **What**: Displays live sentiment trends on a dashboard.
   - **How**: Express serves a page querying InfluxDB every 5s (`range: -1h`, `aggregateWindow: 1s`). Chart.js plots positive, negative, neutral lines—alerts trigger at 50%+ negative.
   - **Why**: Lean server, real-time visuals—Chart.js makes it pop without bloat.

---

## Getting Started

### Prerequisites
- **Node.js**: v16+ (v18.x recommended).
- **Kafka**: Broker at `localhost:9092`, "tweets" topic with 32 partitions.
- **InfluxDB**: v2.x, "brandpulse" bucket, read/write token.
- **Browser**: Chrome/Firefox for the dashboard.

### Installation
1. **Clone the Repo**:
   ```bash
   git clone https://github.com/STarLo-rd/brandpulse.git
   cd brandpulse
   ```
2. **Check the readme of dataStorm, dataHandler and dashboard to get started**:


### Running BrandPulse
1. **Start Kafka & InfluxDB**: Ensure both are up and configured.
2. **Launch Producer**:
   ```bash
   cd dataStorm/
   node src/producer.js
   ```
   - Generates 700K+ tweets/sec.
3. **Run Consumer**:
   ```bash
   cd dataHandler
   node src/consumer.js
   ```
   - Processes and writes to InfluxDB.
4. **Fire Up Dashboard**:
   ```bash
   cd dashboard && npm start
   ```
   - Open `http://localhost:3000` to see it live.

---

## Performance Highlights

From a real run (via `monitor.js`):
```
BrandPulse Tweet Generation Metrics
[▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░] 34.32%
├─ Total Tweets: 17,160,000 / 50,000,000
├─ Throughput (current): 707,200 tweets/sec
├─ Throughput (avg): 571,886 tweets/sec
├─ Elapsed: 00:00:30
└─ Errors: 0
```
- **Peak**: 707K+ tweets/sec.
- **Average**: ~571K tweets/sec sustained.
- **End-to-End**: Dashboard updates in <5s, no lag.

---

## Configuration

- **Producer**: Tweak `BATCH_SIZE` (15K), `BATCH_INTERVAL_MS` (5ms), or sentiment mode in [tweetgenerator](https://github.com/STarLo-rd/brandpulse/tree/main/src/tweetgenerator).
- **Consumer**: Adjust `INFLUX_BATCH_SIZE` (1K) or `FLUSH_INTERVAL_MS` (5s) in `consumer.js`.
- **Dashboard**: Change refresh rate (`5000ms`) or query range (`-1h`) in `dashboard.js`.

---

## Troubleshooting

- **No Data**: Verify Kafka topic (`tweets`), producer running, and InfluxDB bucket (`brandpulse`).
- **Lag**: Reduce batch sizes or refresh intervals.
- **Errors**: Check logs in `producer.js`, `consumer.js`, or `dashboard.js`.

---

## Contributing

Want to level it up? Fork it, tweak it, PR it. Ideas I’d love:
- Multi-broker Kafka support.
- Sentiment filters on the dashboard.
- API integration (e.g., Twitter).

---

## License

MIT License—open-source and free. Check [LICENSE](LICENSE) for details.

---

## Learn More

Full docs at [https://starlo-rd.github.io/docs/brandpulse/](https://starlo-rd.github.io/docs/brandpulse/). Key stops:
- [Implementation](https://starlo-rd.github.io/docs/brandpulse/implementation.html)
- [Demo](https://starlo-rd.github.io/docs/brandpulse/demo.html)
- [Lessons Learned](https://starlo-rd.github.io/docs/brandpulse/implementation/lessons-learned.html)

---

## Final Note

BrandPulse is my proof—I can build a system that tames 700K+ tweets/sec and turns them into insights faster than you can blink. It’s scalable, it’s real-time, and it’s ready to roll. Fire it up, watch the dashboard dance, and let me know what you think!
