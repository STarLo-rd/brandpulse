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


```sh
docker build -t brandpulse-producer:latest .
[+] Building 5.2s (10/10) FINISHED                                                                                                                                   docker:default
 => [internal] load build definition from Dockerfile                                                                                                                           0.0s
 => => transferring dockerfile: 250B                                                                                                                                           0.0s
 => [internal] load metadata for docker.io/library/node:18-alpine                                                                                                              4.7s
 => [internal] load .dockerignore                                                                                                                                              0.0s
 => => transferring context: 2B                                                                                                                                                0.0s
 => [1/5] FROM docker.io/library/node:18-alpine@sha256:e0340f26173b41066d68e3fe9bfbdb6571ab3cad0a4272919a52e36f4ae56925                                                        0.0s
 => [internal] load build context                                                                                                                                              0.1s
 => => transferring context: 148.72kB                                                                                                                                          0.1s
 => CACHED [2/5] WORKDIR /app                                                                                                                                                  0.0s
 => CACHED [3/5] COPY package*.json ./                                                                                                                                         0.0s
 => CACHED [4/5] RUN npm install                                                                                                                                               0.0s
 => [5/5] COPY . .                                                                                                                                                             0.3s
 => exporting to image                                                                                                                                                         0.1s
 => => exporting layers                                                                                                                                                        0.1s
 => => writing image sha256:4492741f2dcdd2cce03bd98bd300e979dd46d8b7111ede7bd6fe07d7e7183f2b                                                                                   0.0s
 => => naming to docker.io/library/brandpulse-producer:latest  
 ```


```sh 
 docker build -f Dockerfile.influxdb -t brandpulse-influxdb:latest .
[+] Building 72.8s (5/5) FINISHED                                                                                                                                    docker:default
 => [internal] load build definition from Dockerfile.influxdb                                                                                                                  0.0s
 => => transferring dockerfile: 441B                                                                                                                                           0.0s
 => [internal] load metadata for docker.io/library/influxdb:2.7                                                                                                                4.6s
 => [internal] load .dockerignore                                                                                                                                              0.0s
 => => transferring context: 2B                                                                                                                                                0.0s
 => [1/1] FROM docker.io/library/influxdb:2.7@sha256:e20505e98b485b5d764937ded954ef12d7f0888e5c36c4955747ef850c2b9f8b                                                         68.1s
 => => resolve docker.io/library/influxdb:2.7@sha256:e20505e98b485b5d764937ded954ef12d7f0888e5c36c4955747ef850c2b9f8b                                                          0.0s
 => => sha256:97ce44028268811e9c2bd9a9b2ecafe1094b78da92cb5cc1494483d9a608f438 8.55kB / 8.55kB                                                                                 0.0s
 => => sha256:e20505e98b485b5d764937ded954ef12d7f0888e5c36c4955747ef850c2b9f8b 2.64kB / 2.64kB                                                                                 0.0s
 => => sha256:d8d6c83f326297a91a9eee8673bf3d04e22e99648438a77e6bcafdc1efd9d468 2.88kB / 2.88kB                                                                                 0.0s
 => => sha256:6e909acdb790c5a1989d9cfc795fda5a246ad6664bb27b5c688e2b734b2c5fad 28.20MB / 28.20MB                                                                              18.2s
 => => sha256:fd316d5ef10c214c9fa2bf70909355a758ab34d24523f5ba89401e4f68bbdc34 9.79MB / 9.79MB                                                                                 7.1s
 => => sha256:be6c6bf9a35c6ee499d319e10b95afdc98db6cd2c928e8971c47eabdbba03dd4 5.82MB / 5.82MB                                                                                 5.0s
 => => sha256:68da9976e85a31639f95495cb2cb6737cb438f2ba1d816975b2e0081e3ad2652 3.23kB / 3.23kB                                                                                 7.1s
 => => sha256:d8a0c055350c9e3da4efc3157e622fc7b67f573a8a833dfc8dfe941e6527a57c 1.01MB / 1.01MB                                                                                 8.2s
 => => sha256:ed361e5279187a517c687a6a86f835e203d5c47a2328e265f5c35c32b6c22433 100.31MB / 100.31MB                                                                            67.0s
 => => sha256:dab1f1c7b5339e2f20673bbc693e6486f4bf0578ced5239166cf2d6669007f98 23.55MB / 23.55MB                                                                              31.9s
 => => extracting sha256:6e909acdb790c5a1989d9cfc795fda5a246ad6664bb27b5c688e2b734b2c5fad                                                                                      0.5s
 => => sha256:2cda0db1fd06d6b782ea22b7a1e17cc4e797a9b3d97d2a7a30995e68f723e4af 209B / 209B                                                                                    20.0s
 => => extracting sha256:fd316d5ef10c214c9fa2bf70909355a758ab34d24523f5ba89401e4f68bbdc34                                                                                      0.1s
 => => extracting sha256:be6c6bf9a35c6ee499d319e10b95afdc98db6cd2c928e8971c47eabdbba03dd4                                                                                      0.0s
 => => extracting sha256:68da9976e85a31639f95495cb2cb6737cb438f2ba1d816975b2e0081e3ad2652                                                                                      0.0s
 => => extracting sha256:d8a0c055350c9e3da4efc3157e622fc7b67f573a8a833dfc8dfe941e6527a57c                                                                                      0.0s
 => => sha256:13b27393061229fb1d3e2599446a928b56fd34bcc035e9d4124b619d9b7881c1 233B / 233B                                                                                    21.5s
 => => sha256:b187d1b203dcfb9c790f5309fc6914de2f40c61d979da55802206799b29bc290 6.29kB / 6.29kB                                                                                22.6s
 => => extracting sha256:ed361e5279187a517c687a6a86f835e203d5c47a2328e265f5c35c32b6c22433                                                                                      0.7s
 => => extracting sha256:dab1f1c7b5339e2f20673bbc693e6486f4bf0578ced5239166cf2d6669007f98                                                                                      0.2s
 => => extracting sha256:2cda0db1fd06d6b782ea22b7a1e17cc4e797a9b3d97d2a7a30995e68f723e4af                                                                                      0.0s
 => => extracting sha256:13b27393061229fb1d3e2599446a928b56fd34bcc035e9d4124b619d9b7881c1                                                                                      0.0s
 => => extracting sha256:b187d1b203dcfb9c790f5309fc6914de2f40c61d979da55802206799b29bc290                                                                                      0.0s
 => exporting to image                                                                                                                                                         0.1s
 => => exporting layers                                                                                                                                                        0.0s
 => => writing image sha256:0e256deeeac31ee5ecece663c04a5e24c1f7ed8754a24b94579f520bc99a1c23                                                                                   0.0s
 => => naming to docker.io/library/brandpulse-influxdb:latest             
```


```sh
sensitive data (ENV "DOCKER_INFLUXDB_INIT_ADMIN_TOKEN") (line 8)
laptop-obs-228@laptop-obs-228:~/studies/systemDesign/brandpulse$ docker-compose -f docker-compose.yml up -d
WARN[0000] /home/laptop-obs-228/studies/systemDesign/brandpulse/docker-compose.yml: the attribute `version` is obsolete, it will be ignored, please remove it to avoid potential confusion 
[+] Running 2/2
 ✔ Container brandpulse-zookeeper-1  Running                                                                                                                                   0.0s 
 ✔ Container brandpulse-kafka-1      Running    
```