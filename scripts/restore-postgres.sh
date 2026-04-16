#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  ./scripts/restore-postgres.sh [options]

Options:
  --backup FILE          Path to the database backup (.sql.gz). Defaults to the latest backup in backups/postgres.
  --globals-backup FILE  Optional globals backup (.sql.gz). Use only for a fresh cluster that does not already have the target role.
  --reset-db             Required. Drop and recreate the target database before restoring.
  --yes                  Skip the confirmation prompt required with --reset-db.
  --help                 Show this message.

Environment overrides:
  COMPOSE_FILE           Compose file path. Default: <repo>/docker-compose.yml
  BACKUP_DIR             Backup directory. Default: <repo>/backups/postgres
  POSTGRES_SERVICE       Compose service name. Default: postgres
  POSTGRES_DB            Database name. Default: voca
  POSTGRES_USER          Database user. Default: voca
EOF
}

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
compose_file="${COMPOSE_FILE:-${repo_root}/docker-compose.yml}"
backup_dir="${BACKUP_DIR:-${repo_root}/backups/postgres}"
service_name="${POSTGRES_SERVICE:-postgres}"
db_name="${POSTGRES_DB:-voca}"
db_user="${POSTGRES_USER:-voca}"

backup_file=""
globals_backup_file=""
reset_db="false"
skip_confirmation="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backup)
      backup_file="${2:-}"
      shift 2
      ;;
    --globals-backup)
      globals_backup_file="${2:-}"
      shift 2
      ;;
    --reset-db)
      reset_db="true"
      shift
      ;;
    --yes)
      skip_confirmation="true"
      shift
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ ! -f "${compose_file}" ]]; then
  echo "Compose file not found: ${compose_file}" >&2
  exit 1
fi

if [[ ! -d "${backup_dir}" ]]; then
  echo "Backup directory not found: ${backup_dir}" >&2
  exit 1
fi

if [[ "${reset_db}" != "true" ]]; then
  echo "Refusing to restore without --reset-db. This script only restores into a freshly recreated database." >&2
  usage >&2
  exit 1
fi

compose_cmd=(
  docker compose
  --project-directory "${repo_root}"
  -f "${compose_file}"
)

if ! "${compose_cmd[@]}" ps --status running --services | grep -Fxq "${service_name}"; then
  echo "Service '${service_name}' is not running. Start it first with 'docker compose up -d ${service_name}'." >&2
  exit 1
fi

if [[ -z "${backup_file}" ]]; then
  backup_file="$(find "${backup_dir}" -maxdepth 1 -type f -name '*.sql.gz' ! -name '*_globals_*.sql.gz' | sort | tail -n 1)"
fi

if [[ -z "${backup_file}" ]]; then
  echo "No database backup found in ${backup_dir}" >&2
  exit 1
fi

if [[ ! -f "${backup_file}" ]]; then
  echo "Backup file not found: ${backup_file}" >&2
  exit 1
fi

if [[ "${reset_db}" == "true" && "${skip_confirmation}" != "true" ]]; then
  echo "This will drop and recreate database '${db_name}' in service '${service_name}'."
  read -r -p "Type 'restore' to continue: " confirmation
  if [[ "${confirmation}" != "restore" ]]; then
    echo "Restore cancelled."
    exit 1
  fi
fi

if [[ -n "${globals_backup_file}" ]]; then
  if [[ ! -f "${globals_backup_file}" ]]; then
    echo "Globals backup file not found: ${globals_backup_file}" >&2
    exit 1
  fi
  echo "Restoring globals from ${globals_backup_file}"
  gunzip -c "${globals_backup_file}" | "${compose_cmd[@]}" exec -T "${service_name}" psql -v ON_ERROR_STOP=1 -U "${db_user}" postgres
fi

if [[ "${reset_db}" == "true" ]]; then
  echo "Dropping database ${db_name}"
  "${compose_cmd[@]}" exec -T "${service_name}" dropdb --if-exists -U "${db_user}" "${db_name}"
  echo "Creating database ${db_name}"
  "${compose_cmd[@]}" exec -T "${service_name}" createdb -U "${db_user}" "${db_name}"
fi

echo "Restoring database from ${backup_file}"
gunzip -c "${backup_file}" | "${compose_cmd[@]}" exec -T "${service_name}" psql -v ON_ERROR_STOP=1 -U "${db_user}" -d "${db_name}"

echo "Restore completed."
