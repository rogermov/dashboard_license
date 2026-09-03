output "public_ip" {
  description = "IP público fixo da instância (Elastic IP)."
  value       = aws_eip.app.public_ip
}

output "app_url" {
  description = "URL para acessar o dashboard depois do deploy."
  value       = "http://${aws_eip.app.public_ip}"
}

output "ssh_command" {
  description = "Comando para conectar via SSH."
  value       = "ssh -i ${var.project_name}-key.pem ubuntu@${aws_eip.app.public_ip}"
}

output "private_key_path" {
  description = "Caminho local da chave privada gerada (permissão 0600)."
  value       = local_sensitive_file.private_key.filename
}

output "s3_backup_bucket" {
  description = "Bucket S3 usado para backup do SQLite."
  value       = aws_s3_bucket.backups.bucket
}

output "instance_id" {
  value = aws_instance.app.id
}

output "aws_region" {
  value = var.aws_region
}
