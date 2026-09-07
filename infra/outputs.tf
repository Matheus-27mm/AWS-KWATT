output "api_url" {
  value = module.api.api_url
}

output "iot_endpoint" {
  value       = module.iot.endpoint
  description = "Host MQTT (porta 8883) para o gateway e o simulador."
}

output "iot_policy_name" {
  value = module.iot.policy_name
}

output "iot_thing_type" {
  value = module.iot.thing_type_name
}

output "table_name" {
  value = module.processing.table_name
}

output "readings_queue_url" {
  value = module.processing.queue_url
}

output "lake_bucket" {
  value = module.storage.lake_bucket
}

output "glue_database" {
  value = module.storage.glue_database
}

output "athena_workgroup" {
  value = module.storage.athena_workgroup
}

output "sns_topic_arn" {
  value = module.processing.sns_topic_arn
}
