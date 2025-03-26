
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
- [Implementation](https://starlo-rd.github.io/docs/brandpulse/implementation)
- [Demo](https://starlo-rd.github.io/docs/brandpulse/demo)
- [Lessons Learned](https://starlo-rd.github.io/docs/brandpulse/implementation/lessons-learned)

---

## Final Note

BrandPulse is my proof—I can build a system that tames 700K+ tweets/sec and turns them into insights faster than you can blink. It’s scalable, it’s real-time, and it’s ready to roll. Fire it up, watch the dashboard dance, and let me know what you think!


```sh
laptop-obs-228@laptop-obs-228:~/studies/systemDesign/brandpulse$ docker-compose -f docker-compose.yml up -d
WARN[0000] /home/laptop-obs-228/studies/systemDesign/brandpulse/docker-compose.yml: the attribute `version` is obsolete, it will be ignored, please remove it to avoid potential confusion 
[+] Running 13/19
 ⠴ zookeeper [⣿⣿⣀⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣤⣿] 279.3MB / 591.4MB Pulling                                                                                                                     140.6s 
 ⠴ kafka [⣀⠀] Pulling                                                                                                                                                        140.6s 
 ```


```sh
docker-compose -f docker-compose.yml up -d
WARN[0000] /home/laptop-obs-228/studies/systemDesign/brandpulse/docker-compose.yml: the attribute `version` is obsolete, it will be ignored, please remove it to avoid potential confusion 
[+] Running 19/19
 ✔ zookeeper Pulled                                                                                                                                                          332.4s 
 ✔ kafka Pulled                                                                                                                                                              332.4s 
[+] Running 3/3
 ✔ Network brandpulse_default        Created                                                                                                                                   0.5s 
 ✔ Container brandpulse-zookeeper-1  Started                                                                                                                                   2.6s 
 ✔ Container brandpulse-kafka-1      Started   
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


```sh
docker run -d --name influxdb -p 8086:8086 brandpulse-influxdb:latest
956e4f5a2f77512c8c551fd22754496eb0a092f1bc39817e8b282f12bd0ff208
```


```sh
docker exec -it influxdb influx bucket ls --org brandpulse
ID                      Name            Retention       Shard group duration    Organization ID         Schema Type
f841d93ed2c837ce        _monitoring     168h0m0s        24h0m0s                 79c02adbfe63ddfc        implicit
abe027f395b22d66        _tasks          72h0m0s         24h0m0s                 79c02adbfe63ddfc        implicit
a1ec5d7421a85734        brandpulse      infinite        168h0m0s                79c02adbfe63ddfc        implicit
```


```sh
docker run -d --network=host brandpulse-producer:latest
165db9b5c404ebd1a7ecdcf970236d44f07b9e47a3322ea27f03513497b8540b

docker run -d --network=host brandpulse-consumer:latest
220846dea62850f919e916ccea8f959d2cde5fa151837ea79b86b040b49c9e94

docker run -d -p 3000:3000 brandpulse-dashboard:latest
a1beeb8105dcfc0ec514cb6abf0760f3eb2728dd99256196731a7678e8761370
```


```sh
docker logs -f brandpulse-producer-1
[W3] 8000 in 159ms
[W4] 8000 in 132ms
[W2] 8000 in 190ms
[W1] 8000 in 162ms
[W3] 8000 in 144ms
[W4] 8000 in 161ms
[W2] 8000 in 134ms
[W1] 8000 in 169ms
[W3] 8000 in 165ms
[W4] 8000 in 134ms
[W2] 8000 in 159ms
[W1] 8000 in 188ms
[W4] 8000 in 129ms
[W2] 8000 in 117ms
[W3] 8000 in 168ms
[W4] 8000 in 138ms
[W1] 8000 in 156ms
[W2] 8000 in 163ms
[W3] 8000 in 194ms
[W4] 8000 in 170ms
[W1] 8000 in 173ms
[W2] 8000 in 196ms
[W3] 8000 in 163ms
[W4] 8000 in 161ms
[W1] 8000 in 166ms
[W2] 8000 in 174ms
[W3] 8000 in 168ms
[W4] 8000 in 168ms
[W1] 8000 in 187ms
[W2] 8000 in 178ms
[W3] 8000 in 187ms
[W4] 8000 in 214ms
[W1] 8000 in 203ms
```

```sh
docker images
REPOSITORY                    TAG       IMAGE ID       CREATED        SIZE
brandpulse-consumer           latest    f2c0caacc4ea   13 hours ago   182MB
brandpulse-dashboard          latest    c73621de1819   13 hours ago   144MB
<none>                        <none>    45fac0ac454f   14 hours ago   144MB
<none>                        <none>    3bb84ffae378   14 hours ago   182MB
brandpulse-producer           latest    4492741f2dcd   14 hours ago   135MB
brandpulse-datastorm          latest    5d871e1343ab   2 days ago     135MB
confluentinc/cp-kafka         latest    a2716a120846   4 weeks ago    1.1GB
confluentinc/cp-zookeeper     latest    725e1614cf4d   4 weeks ago    1.1GB
brandpulse-influxdb           latest    0e256deeeac3   2 months ago   406MB
gcr.io/k8s-minikube/kicbase   v0.0.46   e72c4cbe9b29   2 months ago   1.31GB
```



```sh
minikube start --cpus=4 --memory=8192
😄  minikube v1.35.0 on Ubuntu 22.04
✨  Using the docker driver based on existing profile
❗  You cannot change the memory size for an existing minikube cluster. Please first delete the cluster.
❗  You cannot change the CPUs for an existing minikube cluster. Please first delete the cluster.
👍  Starting "minikube" primary control-plane node in "minikube" cluster
🚜  Pulling base image v0.0.46 ...
🔄  Restarting existing docker container for "minikube" ...
🐳  Preparing Kubernetes v1.32.0 on Docker 27.4.1 ...
🔎  Verifying Kubernetes components...
    ▪ Using image gcr.io/k8s-minikube/storage-provisioner:v5
🌟  Enabled addons: storage-provisioner, default-storageclass
🏄  Done! kubectl is now configured to use "minikube" cluster and "default" namespace by default
```


```sh
kubectl apply -f .
configmap/brandpulse-config created
deployment.apps/consumer created
deployment.apps/dashboard created
service/dashboard created
deployment.apps/influxdb created
service/influxdb created
deployment.apps/kafka created
service/kafka created
deployment.apps/producer created
deployment.apps/zookeeper created
service/zookeeper created
```