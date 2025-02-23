#!/bin/bash

# Configuration
VERSIONS=("v0" "v1" "v2" "v3")
DURATION=10
KAFKA_CONTAINER="kafka"
RESULTS_DIR="results"
TOPIC_NAME="dataStorm-topic"

# Kafka paths
KAFKA_BIN="/usr/bin"
BOOTSTRAP_SERVER="localhost:9092"

# Initialize
mkdir -p $RESULTS_DIR
echo "version,throughput_msg_per_sec,total_messages,test_duration_sec,cpu_avg,mem_avg" > $RESULTS_DIR/report.csv

# Create topic
docker exec $KAFKA_CONTAINER sh -c \
"$KAFKA_BIN/kafka-topics.sh --create --topic $TOPIC_NAME \
--partitions 4 --replication-factor 1 \
--if-not-exists \
--bootstrap-server $BOOTSTRAP_SERVER"

for version in "${VERSIONS[@]}"; do
    echo "=== Testing $version ==="
    
    # Reset topic offsets
    docker exec $KAFKA_CONTAINER sh -c \
    "$KAFKA_BIN/kafka-topics.sh --delete --topic $TOPIC_NAME \
    --bootstrap-server $BOOTSTRAP_SERVER" > /dev/null 2>&1
    
    docker exec $KAFKA_CONTAINER sh -c \
    "$KAFKA_BIN/kafka-topics.sh --create --topic $TOPIC_NAME \
    --partitions 4 --replication-factor 1 \
    --bootstrap-server $BOOTSTRAP_SERVER" > /dev/null 2>&1

    # Start metrics
    python metrics/collector.py $version $RESULTS_DIR/$version-metrics.csv &
    METRICS_PID=$!
    
    # Start producer
    start_time=$(date +%s%3N)
    VERSION=$version node index.js > $RESULTS_DIR/$version.log 2>&1 &
    PRODUCER_PID=$!
    
    sleep $DURATION
    
    # Stop processes
    kill $PRODUCER_PID 2>/dev/null
    sleep 2  # Allow message flushing
    
    # Get precise end time
    end_time=$(date +%s%3N)
    kill $METRICS_PID 2>/dev/null
    
    # Calculate elapsed time
    elapsed=$(echo "scale=2; ($end_time - $start_time)/1000" | bc)
    
    # Get message count
    total_messages=$(docker exec $KAFKA_CONTAINER sh -c \
    "$KAFKA_BIN/kafka-run-class.sh kafka.tools.GetOffsetShell \
    --topic $TOPIC_NAME --time -1 \
    --bootstrap-server $BOOTSTRAP_SERVER" | \
    awk -F':' '{sum+=$3} END {print sum}')
    
    # Calculate throughput
    throughput=$(echo "scale=2; $total_messages/$elapsed" | bc)
    
    # Get averages
    cpu_avg=$(awk -F',' 'NR>1 {sum+=$2} END {print sum/(NR-1)}' $RESULTS_DIR/$version-metrics.csv)
    mem_avg=$(awk -F',' 'NR>1 {sum+=$3} END {print sum/(NR-1)}' $RESULTS_DIR/$version-metrics.csv)
    
    # Save results
    echo "$version,$throughput,$total_messages,$elapsed,$cpu_avg,$mem_avg" >> $RESULTS_DIR/report.csv
    
    echo "Completed $version: $total_messages messages in ${elapsed}s ($throughput msg/s)"
done

python metrics/analyzer.py $RESULTS_DIR