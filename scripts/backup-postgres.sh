#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
compose_file="${COMPOSE_FILE:-${repo_root}/docker-compose.yml}"

if [[ ! -f "${compose_file}" ]]; then
  echo "Compose file not found: ${compose_file}" >&2
  exit 1
fi

backup_dir="${BACKUP_DIR:-${repo_root}/backups/postgres}"
service_name="${POSTGRES_SERVICE:-postgres}"
db_name="${POSTGRES_DB:-voca}"
db_user="${POSTGRES_USER:-voca}"
retention_days="${BACKUP_RETENTION_DAYS:-14}"
timestamp="$(date '+%Y-%m-%d_%H-%M-%S')"

compose_cmd=(
  docker compose
  --project-directory "${repo_root}"
  -f "${compose_file}"
)

if ! "${compose_cmd[@]}" ps --status running --services | grep -Fxq "${service_name}"; then
  echo "Service '${service_name}' is not running. Start it first with 'docker compose up -d ${service_name}'." >&2
  exit 1
fi

mkdir -p "${backup_dir}"

data_backup="${backup_dir}/${db_name}_${timestamp}.sql.gz"
globals_backup="${backup_dir}/${db_name}_globals_${timestamp}.sql.gz"

echo "Creating database backup: ${data_backup}"
"${compose_cmd[@]}" exec -T "${service_name}" pg_dump -U "${db_user}" -d "${db_name}" | gzip > "${data_backup}"

echo "Creating globals backup: ${globals_backup}"
"${compose_cmd[@]}" exec -T "${service_name}" pg_dumpall -U "${db_user}" --globals-only | gzip > "${globals_backup}"

echo "Pruning backups older than ${retention_days} days from ${backup_dir}"
find "${backup_dir}" -type f -name '*.sql.gz' -mtime "+${retention_days}" -delete

echo "Backup completed."
