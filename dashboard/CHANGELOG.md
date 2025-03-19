# Changelog

## [Unreleased]

### Added
- Environment-aware service configuration for InfluxDB connectivity
- New environment variables for flexible deployment:
  - `HOST_NETWORK_MODE`: Toggle between local and containerized environments
  - `INFLUX_PORT`: Optional override for InfluxDB port
  - `PORT`: Server port configuration

### Changed
- Modified InfluxDB connection handling to support both local and containerized environments
- Updated configuration to use service names in containerized mode
- Enhanced configuration flexibility to support multiple deployment scenarios

### Technical Details

#### Problem Statement
The dashboard service needed to be containerized while maintaining the ability to run in local development:
1. InfluxDB connectivity needed different addresses:
   - Local development: `localhost:8086`
   - Containerized environment: `influxdb:8086`
2. Configuration needed to be flexible enough to support both scenarios without code changes

#### Solution
Implemented an environment-aware configuration system that:
1. Uses `HOST_NETWORK_MODE` to determine the runtime context
2. Automatically selects appropriate service addresses
3. Maintains override capability through environment variables

#### Implementation Details
- Default service addresses:
  - Local mode (`HOST_NETWORK_MODE=true`):
    ```
    InfluxDB: localhost:8086
    ```
  - Containerized mode:
    ```
    InfluxDB: influxdb:8086
    ```
- Configuration precedence:
  1. Explicit `INFLUX_URL` if provided
  2. Constructed URL based on `HOST_NETWORK_MODE`
  3. Default fallback values

#### Benefits
- Works seamlessly in both local and containerized environments
- No code changes needed when switching environments
- Maintains backward compatibility
- Clear configuration override options
- Simplified deployment process

#### Migration Notes
- For local development: Set `HOST_NETWORK_MODE=true`
- For containerized deployment: No action needed (defaults to container mode)
- To override any defaults: Set appropriate environment variables 