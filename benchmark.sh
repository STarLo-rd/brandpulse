#!/bin/bash

# Configuration
VERSIONS=("v0" "v1" "v2" "v3")
DURATION=10  # Reduce to 10s for testing
KAFKA_CONTAINER="kafka"
RESULTS_DIR="results"

# Kafka paths for Confluent image
KAFKA_BIN="/usr/bin"
BOOTSTRAP_SERVER="localhost:9092"

# Initialize
mkdir -p $RESULTS_DIR
echo "version,throughput,latency_avg,cpu_avg,mem_avg" > $RESULTS_DIR/report.csv

# Create topic
docker exec $KAFKA_CONTAINER sh -c \
"$KAFKA_BIN/kafka-topics.sh --create --topic benchmark-topic \
--partitions 4 --replication-factor 1 \
--if-not-exists \
--bootstrap-server $BOOTSTRAP_SERVER"

for version in "${VERSIONS[@]}"; do
    echo "=== Testing $version ==="
    
    # Start metrics
    python metrics/collector.py $version $RESULTS_DIR/$version-metrics.csv &
    METRICS_PID=$!
    
    # Start producer dynamically with version
    start_time=$(date +%s%3N)
    VERSION=$version node index.js > $RESULTS_DIR/$version.log 2>&1 &
    PRODUCER_PID=$!
    
    sleep $DURATION
    
    # Stop processes
    kill $PRODUCER_PID 2>/dev/null
    kill $METRICS_PID 2>/dev/null
    
    # Get metrics
    end_time=$(date +%s%3N)
    elapsed=$(echo "scale=2; ($end_time - $start_time)/1000" | awk -F. '{print $1"."substr($2,1,2)}')
    
    # Get message count
    total_messages=$(docker exec $KAFKA_CONTAINER sh -c \
    "$KAFKA_BIN/kafka-run-class.sh kafka.tools.GetOffsetShell \
    --topic benchmark-topic --time -1 \
    --bootstrap-server $BOOTSTRAP_SERVER" | \
    awk -F':' '{sum+=$3} END {print sum}')
    
    throughput=$(awk "BEGIN {printf \"%.2f\", $total_messages/$elapsed}")
    
    # Get averages
    cpu_avg=$(awk -F',' 'NR>1 {sum+=$2} END {print sum/(NR-1)}' $RESULTS_DIR/$version-metrics.csv)
    mem_avg=$(awk -F',' 'NR>1 {sum+=$3} END {print sum/(NR-1)}' $RESULTS_DIR/$version-metrics.csv)
    
    # Save results
    echo "$version,$throughput,$elapsed,$cpu_avg,$mem_avg" >> $RESULTS_DIR/report.csv
done

python metrics/analyzer.py $RESULTS_DIR
