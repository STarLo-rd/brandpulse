# Changelog

All notable changes to the DataHandler service will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Environment-aware service configuration system
- New environment variables for flexible deployment:
  - `HOST_NETWORK_MODE`: Toggle between local and containerized environments
  - `KAFKA_BROKERS`: Optional override for Kafka broker addresses
  - `INFLUX_PORT`: Optional override for InfluxDB port

### Changed
- Modified Kafka broker configuration to support both local and containerized environments
- Updated InfluxDB connection handling to use service names in containerized mode
- Enhanced configuration flexibility to support multiple deployment scenarios

### Technical Details

#### Problem Statement
When containerizing the DataHandler service, we faced two main challenges:
1. Service discovery: Different service addresses needed between local development and containerized environments
   - Local development uses `localhost:9092` for Kafka and `localhost:8086` for InfluxDB
   - Containerized environments need `kafka:9092` and `influxdb:8086` respectively
2. Configuration management: Need to maintain a single codebase that works across all environments

#### Solution
Implemented an environment-aware configuration system that:
1. Uses environment variables to determine the runtime context
2. Automatically selects appropriate service addresses based on deployment type
3. Provides override capabilities for custom configurations

#### Implementation Details
- Default service addresses:
  - Local mode (`HOST_NETWORK_MODE=true`):
    ```
    Kafka: localhost:9092
    InfluxDB: localhost:8086
    ```
  - Containerized mode:
    ```
    Kafka: kafka:9092
    InfluxDB: influxdb:8086
    ```
- Configuration precedence:
  1. Explicit environment variables (`KAFKA_BROKERS`, `INFLUX_URL`)
  2. Environment-based defaults
  3. Hardcoded fallback values

#### Benefits
- Zero configuration changes needed when switching between environments
- Same codebase works everywhere without modification
- Clear documentation of networking assumptions
- Simplified debugging and development workflow
- Flexible override options for custom deployment scenarios

#### Migration Notes
- Existing deployments using hardcoded addresses should set appropriate environment variables
- Local development environments should set `HOST_NETWORK_MODE=true`
- Container deployments require no additional configuration unless using non-standard service names 