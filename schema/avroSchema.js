const avro = require("avro-js");

const dataSchema = avro.parse({
  type: "record",
  name: "DataRecord",
  fields: [
    { name: "id", type: "int" },
    { name: "timestamp", type: "string" },
    { name: "value", type: "double" }
  ]
});

module.exports = dataSchema;
