const { InfluxDB } = require('@influxdata/influxdb-client');
const client = new InfluxDB({ url: 'http://localhost:8086', token: 'OS0t8w6jBnwwL-HIWgU1lWniUARhRc85gLtFqTbhZiEqVNPvludyzs1vswBDAsegbfWk1pJGpk3dY1LKK_2zDQ==' });
client.getBucketsApi().getBuckets().then(buckets => console.log(buckets)).catch(err => console.error(err));