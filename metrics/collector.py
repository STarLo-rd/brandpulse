import psutil
import time
import sys
import os

def main():
    if len(sys.argv) < 3:
        print("Usage: python collector.py <version> <output_csv>")
        sys.exit(1)
    
    version = sys.argv[1]
    output_file = sys.argv[2]
    start_time = time.time()
    
    # Create headers if file doesn't exist
    if not os.path.exists(output_file):
        with open(output_file, 'w') as f:
            f.write("timestamp,cpu_percent,mem_percent,net_sent_mb\n")
    
    try:
        net_start = psutil.net_io_counters().bytes_sent
        while True:
            # Collect metrics
            cpu = psutil.cpu_percent(interval=1)
            mem = psutil.virtual_memory().percent
            net = (psutil.net_io_counters().bytes_sent - net_start) / 1024 / 1024
            
            # Write to CSV
            with open(output_file, 'a') as f:
                f.write(f"{time.time()},{cpu},{mem},{net:.2f}\n")
                
            # Reset network counter every iteration
            net_start = psutil.net_io_counters().bytes_sent
            
    except KeyboardInterrupt:
        print(f"\nMetrics collection stopped for {version}")

if __name__ == "__main__":
    main()