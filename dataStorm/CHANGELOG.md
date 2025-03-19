# Changelog

## [Unreleased]

### Added
- Host network mode detection for flexible Kafka broker configuration
- Environment variable `HOST_NETWORK_MODE` to toggle between local and containerized environments

### Changed
- Modified Kafka broker configuration to support both local development and containerized environments
- Updated default Kafka broker address in containerized environments to use `kafka:9092` service name
- Enhanced configuration flexibility to ensure the same codebase works across different deployment scenarios

### Technical Details
- **Problem**: When containerizing the DataStorm application, the Kafka broker address needed to be different:
  - Local development requires `localhost:9092`
  - Containerized environments require `kafka:9092` (service name)
  
- **Solution**: Implemented environment-aware broker configuration that:
  1. Defaults to `kafka:9092` in containerized environments
  2. Uses `localhost:9092` when `HOST_NETWORK_MODE=true`
  3. Always allows override via explicit `KAFKA_BROKERS` environment variable
  
- **Benefits**:
  - Zero configuration changes needed when switching between environments
  - Same codebase works everywhere without modification
  - Clear documentation of networking assumptions
  - Simplified debugging and development workflow 