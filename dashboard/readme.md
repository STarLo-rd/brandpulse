
# BrandPulse Dashboard

Welcome to the **BrandPulse Dashboard**—my real-time window into the torrent of tweet sentiment data processed by BrandPulse. This dashboard pulls live data from InfluxDB, plotting positive, negative, and neutral trends as tweets stream in at over 700,000 per second. It’s the visual heartbeat of my pipeline, and this README covers everything you need to set it up, run it, and see it in action.

---

## Overview

The Dashboard is the showcase of BrandPulse—a system I built to simulate, process, and analyze tweet data at scale. It connects to InfluxDB, fetches aggregated sentiment counts, and renders them as dynamic graphs. Whether I’m running in fixed mode with a steady sentiment split or volatile mode with wild swings, this dashboard keeps up, delivering insights in real time.

---

## Features

- **Live Visualization**: Updates every few seconds with the latest sentiment trends.
- **Sentiment Breakdown**: Graphs positive, negative, and neutral counts over time.
- **High-Volume Support**: Built to handle data from 700k+ tweets/sec.
- **Mode Flexibility**: Reflects both fixed and volatile sentiment distributions.
- **Clean Design**: Simple, focused, and data-driven—built with Chart.js.

---

## Prerequisites

To get the dashboard running, you’ll need:

### Software
- **Node.js**: v16.x or higher (I used v18.x for development).
- **InfluxDB**: v2.x (the data source).
  - **Bucket**: "brandpulse" (default, configurable).
  - **Organization**: Your InfluxDB org (e.g., "my-org").
  - **Token**: An API token with read access to "brandpulse".
- **Web Browser**: Chrome, Firefox, or any modern browser.

### Dependencies
Install these via npm:
```bash
npm install @influxdata/influxdb-client express chart.js
```
- `@influxdata/influxdb-client`: Queries InfluxDB.
- `express`: Serves the dashboard locally.
- `chart.js`: Powers the graphs.

### Data Pipeline
- The dashboard needs data from my Data Handler (`consumer.js`), which processes Kafka streams and writes to InfluxDB. Make sure those are running.

---

## Installation

1. **Clone the Repo**:
   ```bash
   git clone https://github.com/STarLo-rd/brandpulse.git
   cd brandpulse
   ```

2. **Navigate to Dashboard**:
   ```bash
   cd src/dashboard
   ```
   (Adjust if your folder structure differs—I assumed a `dashboard` subfolder.)

3. **Install Dependencies**:
   ```bash
   npm install
   ```

4. **Set Up Environment**:
   Create a `.env` file in the `dashboard` folder:
   ```
   INFLUXDB_URL=http://localhost:8086
   INFLUXDB_TOKEN=your-influxdb-token-here
   INFLUXDB_ORG=my-org
   INFLUXDB_BUCKET=brandpulse
   PORT=3000
   ```
   - Update with your InfluxDB credentials and preferred port.

5. **Verify InfluxDB**:
   - Confirm InfluxDB is up and the "brandpulse" bucket has data from `consumer.js`.

---

## Usage

### Running the Dashboard
Start it with:
```bash
npm start
```
- This runs:
  ```
  > datahandler@1.0.0 start
  > node dashboard.js
  ```
- Output:
  ```
  Dashboard running on http://localhost:3000
  ```
- Open `http://localhost:3000` in your browser to see the live dashboard.

### Runtime Behavior
- **Client Connections**: You’ll see logs like:
  ```
  Client connected: K-bp1BWC9qgOhrkSAAAB
  Client disconnected: K-bp1BWC9qgOhrkSAAAB
  Client connected: oFByx6fMCz_ti6OxAAAD
  ```
  - These show browser clients (e.g., your tab) connecting/disconnecting via WebSockets or polling.

### Full Workflow
1. Start Kafka and InfluxDB.
2. Run `node src/producer.js` to generate tweets.
3. Run `node src/consumer.js` to process and store data.
4. Launch `npm start` in the dashboard folder and hit `http://localhost:3000`.

### Configuration
Adjust these in `dashboard.js`:
- **Refresh Rate**: `REFRESH_INTERVAL_MS = 5000` (5s updates).
- **Query Range**: Default `-1h` (last hour of data).
- **Chart Styles**: Tweak colors or scales in the Chart.js config.

---

## How It Works

### Core Logic
1. **Data Retrieval**:
   - Connects to InfluxDB with `@influxdata/influxdb-client`.
   - Queries:
     ```flux
     from(bucket: "brandpulse")
       |> range(start: -1h)
       |> filter(fn: (r) => r._measurement == "tweets")
       |> filter(fn: (r) => r._field == "count")
       |> aggregateWindow(every: 1s, fn: sum)
       |> group(columns: ["sentiment"])
     ```
   - Fetches tweet counts per sentiment per second.

2. **Serving**:
   - `express` hosts a lightweight server at `http://localhost:3000`.
   - Delivers an HTML page with embedded Chart.js.

3. **Visualization**:
   - Plots three lines (positive, negative, neutral) on a time-based graph.
   - Updates every 5 seconds to stay live.

### Sample Data Point
```
Time: 2025-03-10T12:00:01Z
Positive: 25,000 tweets
Negative: 15,000 tweets
Neutral: 20,000 tweets
```
- Rendered as a smooth, multi-line chart.

---

## Screenshots

Check these out (stored in `/assets/`):
- **Fixed Mode**: Steady sentiment (e.g., 35/30/35 split).
  ![Fixed Mode Dashboard](/assets/dashboard-1.png)
- **Volatile Mode**: Crazy swings (e.g., 50% netural to 25/25 split).
  ![Volatile Mode Dashboard](/assets/volatile-mode-dashboard.png)

---

## Performance

- **Data Handling**: Scales to 10k+ points/sec (e.g., 707,200 tweets/sec from producer peaks).
- **Update Speed**: Refreshes in <1s post-InfluxDB flush (every 5s).
- **Metrics Tie-In**: Matches `monitor.js` runs:
  ```
  BrandPulse Tweet Generation Metrics
  [▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░] 34.32%
  ├─ Total Tweets: 17,160,000 / 50,000,000
  ├─ Throughput (current): 707,200 tweets/sec
  ├─ Throughput (avg): 571,886 tweets/sec
  ```

---

## Troubleshooting

- **No Graphs**: Ensure InfluxDB is connected (`INFLUXDB_URL`, `TOKEN`) and `consumer.js` is feeding data.
- **Lag**: Lower `REFRESH_INTERVAL_MS` or shorten the query range (e.g., `-10m`).
- **Connection Logs**: Normal to see `Client connected/disconnected`—check for errors beyond that.
- **Blank Page**: Verify `dashboard.js` is running (`http://localhost:3000`).

---

## Contributing

Want to make it better? Fork it, tweak it, and send a pull request. I’d love:
- Real-time zoom controls.
- Sentiment filters (e.g., show only positive).
- Dark mode vibes.

---

## License

MIT License—open-source and free. Use it, mod it, share it—just give me a shout if it rocks your world.

---

## Learn More

Dive into BrandPulse: [https://starlo-rd.github.io/docs/brandpulse/](https://starlo-rd.github.io/docs/brandpulse/).  
Key links:
- [Demo](https://starlo-rd.github.io/docs/brandpulse/demo.html)
- [Implementation](https://starlo-rd.github.io/docs/brandpulse/implementation.html)
- [Lessons Learned](https://starlo-rd.github.io/docs/brandpulse/implementation/lessons-learned.html)

---

## Final Note

The BrandPulse Dashboard is my victory lap—a real-time lens on a pipeline I pushed to 700k+ tweets/sec. It’s simple, it’s fast, and it tells the story of every tweet I’ve wrangled. Fire it up, watch the lines dance, and let me know how it hits you!