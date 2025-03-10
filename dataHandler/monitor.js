import { spawn } from 'child_process';
import chalk from 'chalk';
import readline from 'readline';

// Metrics configuration
const METRICS_WINDOW = 5; // Seconds for rolling throughput average

// Progress tracking
let metrics = {
  startTime: Date.now(),
  totalMessages: 0,
  messagesPerSecond: new Map(),
  throughputHistory: [],
  errorCount: 0,
  workersActive: 0
};

// Clear console and create interface
readline.cursorTo(process.stdout, 0, 0);
readline.clearScreenDown(process.stdout);

// Visualization helpers
const progressBar = (percent) => {
  const width = 30;
  const filled = Math.round(width * percent / 100);
  return `[${'▓'.repeat(filled)}${'░'.repeat(width - filled)}]`;
};

const formatNumber = (num) => {
  return num.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  });
};

// Start consumer process
const consumer = spawn('node', ['src/consumer.js'], {
  stdio: ['inherit', 'pipe', 'pipe']
});

// Process stdout lines
consumer.stdout.on('data', chunk => {
  const lines = chunk.toString().split('\n');
  lines.forEach(line => {
    const match = line.match(/Processed (\d+) messages in (\d+)ms from partition (\d+)/);
    if (match) {
      const count = parseInt(match[1]);
      const duration = parseInt(match[2]);
      
      metrics.totalMessages += count;
      const currentSecond = Math.floor(Date.now() / 1000);
      
      metrics.messagesPerSecond.set(
        currentSecond,
        (metrics.messagesPerSecond.get(currentSecond) || 0) + count
      );
      
      // Track throughput for rolling average
      metrics.throughputHistory.push({
        timestamp: Date.now(),
        count: count,
        duration: duration
      });
    } else if (line.match(/Error processing message:/)) {
      metrics.errorCount++;
    }
  });
});

// Process stderr
consumer.stderr.on('data', data => {
  const message = data.toString().trim();
  if (message) {
    console.error(chalk.red(`[ERROR] ${message}`));
  }
});

// Metrics display
const displayMetrics = () => {
  const now = Date.now();
  const elapsed = (now - metrics.startTime) / 1000;
  const currentSecond = Math.floor(now / 1000);
  
  // Calculate current throughput
  const windowStart = currentSecond - METRICS_WINDOW;
  let windowCount = 0;
  
  for (let [second, count] of metrics.messagesPerSecond.entries()) {
    if (second >= windowStart && second <= currentSecond) {
      windowCount += count;
    }
  }
  
  const rollingThroughput = windowCount / METRICS_WINDOW;
  const avgThroughput = metrics.totalMessages / elapsed;
  const eta = Infinity; // No target for ingestion

  // Build status lines
  const statusLines = [
    `${chalk.red('BrandPulse Data Ingestion Metrics')}`,
    `├─ Total Messages Processed: ${chalk.cyan(formatNumber(metrics.totalMessages))}`,
    `├─ Throughput (current): ${chalk.green(formatNumber(rollingThroughput))} msg/sec`,
    `├─ Throughput (avg): ${chalk.cyan(formatNumber(avgThroughput))} msg/sec`,
    `├─ Elapsed: ${formatTime(elapsed)}`,
    `├─ Errors: ${chalk[metrics.errorCount > 0 ? 'red' : 'green'](metrics.errorCount)}`,
  ];

  // Update display
  readline.cursorTo(process.stdout, 0, 0);
  readline.clearScreenDown(process.stdout);
  process.stdout.write(statusLines.join('\n'));
};

// Helper function to format time
function formatTime(seconds) {
  if (seconds === Infinity) return '--:--:--';
  const pad = (n) => n.toString().padStart(2, '0');
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
}

// Update metrics every second
setInterval(displayMetrics, 1000);

// Handle exit
consumer.on('exit', (code) => {
  displayMetrics();
  console.log(`\n${chalk.yellow('Consumer process exited with code')} ${code}`);

  if (code === 0) {
    console.log(chalk.green('\nSuccessfully completed data ingestion.'));
  } else {
    console.log(chalk.red('\nFailed to complete data ingestion.'));
  }
  
  process.exit(code);
});