const { spawn } = require('child_process');

// Simplified monitoring logic
let totalMessages = 0;
let messagesPerSecond = new Map();

const producer = spawn('node', ['src/v4/producer-w.js'], {
  stdio: ['inherit', 'pipe', 'pipe']
});

producer.stdout.on('data', chunk => {
  const lines = chunk.toString().split('\n');
  lines.forEach(line => {
    const match = line.match(/\[W\d+\] (\d+) in \d+ms/);
    if (match) {
      const count = parseInt(match[1]);
      const currentSecond = Math.floor(Date.now() / 1000);
      messagesPerSecond.set(
        currentSecond, 
        (messagesPerSecond.get(currentSecond) || 0) + count
      );
      totalMessages += count;
    }
  });
});

// Regular status updates
setInterval(() => {
  const currentSecond = Math.floor(Date.now() / 1000);
  const count = messagesPerSecond.get(currentSecond - 1) || 0;
  
  console.log(
    `⏱️  Second ${currentSecond-1}: ${count.toLocaleString()} messages | ` +
    `Total: ${totalMessages.toLocaleString()}`
  );
  
  // Cleanup old data
  const oldKeys = Array.from(messagesPerSecond.keys()).filter(k => k < currentSecond - 10);
  oldKeys.forEach(k => messagesPerSecond.delete(k));
}, 1000);

producer.stderr.on('data', data => {
  console.error(`[PRODUCER ERROR] ${data}`);
});

producer.on('exit', code => {
  console.log(`Producer exited with code ${code}`);
  process.exit(code);
});
