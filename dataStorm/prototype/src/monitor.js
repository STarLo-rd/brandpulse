import { spawn } from 'child_process';
import chalk from 'chalk';
import readline from 'readline';

// Total target configuration
const TARGET_MESSAGES = 50000000;

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

// Start producer process
const producer = spawn('node', ['src/v3/producer-w.js'], {
  stdio: ['inherit', 'pipe', 'pipe']
});

// Process stdout lines
producer.stdout.on('data', chunk => {
  const lines = chunk.toString().split('\n');
  lines.forEach(line => {
    const match = line.match(/\[W(\d+)\] (\d+) in (\d+)ms/);
    if (match) {
      const count = parseInt(match[2]);
      const duration = parseInt(match[3]);
      
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
    }
  });
});

// Process stderr
producer.stderr.on('data', data => {
  metrics.errorCount++;
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
  const percentComplete = (metrics.totalMessages / TARGET_MESSAGES) * 100;
  const eta = percentComplete > 0 
    ? (TARGET_MESSAGES - metrics.totalMessages) / (metrics.totalMessages / elapsed)
    : Infinity;

  // Build status lines
  const statusLines = [
    `${chalk.red('DataStorm Producer Metrics')}`,
    `${progressBar(percentComplete)} ${percentComplete.toFixed(2)}%`,
    `├─ Total: ${chalk.cyan(formatNumber(metrics.totalMessages))} / ${formatNumber(TARGET_MESSAGES)}`,
    `├─ Throughput (current): ${chalk.green(formatNumber(rollingThroughput))} msg/sec`,
    `├─ Throughput (avg): ${chalk.cyan(formatNumber(avgThroughput))} msg/sec`,
    `├─ Elapsed: ${formatTime(elapsed)}`,
    `├─ Remaining: ${formatTime(eta)}`,
    `└─ Errors: ${chalk[metrics.errorCount > 0 ? 'red' : 'green'](metrics.errorCount)}`,
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
producer.on('exit', (code) => {
  displayMetrics();
  console.log(`\n${chalk.yellow('Producer process exited with code')} ${code}`);
  
  if (metrics.totalMessages >= TARGET_MESSAGES) {
    console.log(chalk.green('\n🎉 Target of 50 million messages reached!'));
  } else {
    console.log(chalk.red('\n❌ Failed to reach target messages'));
  }
  
  process.exit(code);
});