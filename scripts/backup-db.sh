#!/usr/bin/env bash
# backup-db.sh — PostgreSQL backup script
#
# Usage:
#   ./scripts/backup-db.sh
#
# Required environment variables (or set via .env.production):
#   POSTGRES_USER     — database user
#   POSTGRES_PASSWORD — database password
#   POSTGRES_DB       — database name
#   BACKUP_DIR        — directory to store backups (default: ./backups)
#
# Recommended: run via cron daily, e.g.
#   0 2 * * * /path/to/prediction-platform/scripts/backup-db.sh >> /var/log/db-backup.log 2>&1
#
# For production: pipe BACKUP_DIR to an S3 bucket or offsite storage.
#   After the pg_dump, run: aws s3 cp "$BACKUP_FILE" s3://your-bucket/backups/

set -euo pipefail

# Load .env.production if present
ENV_FILE="$(dirname "$0")/../.env.production"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

POSTGRES_USER="${POSTGRES_USER:?POSTGRES_USER is required}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
POSTGRES_DB="${POSTGRES_DB:?POSTGRES_DB is required}"
POSTGRES_HOST="${POSTGRES_HOST:-localhost}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
BACKUP_DIR="${BACKUP_DIR:-$(dirname "$0")/../backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="$BACKUP_DIR/${POSTGRES_DB}_${TIMESTAMP}.dump"

echo "[$(date -Iseconds)] Starting backup of $POSTGRES_DB to $BACKUP_FILE"

PGPASSWORD="$POSTGRES_PASSWORD" pg_dump \
  --host="$POSTGRES_HOST" \
  --port="$POSTGRES_PORT" \
  --username="$POSTGRES_USER" \
  --format=custom \
  --compress=9 \
  --file="$BACKUP_FILE" \
  "$POSTGRES_DB"

BACKUP_SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
echo "[$(date -Iseconds)] Backup complete: $BACKUP_FILE ($BACKUP_SIZE)"

# Remove backups older than RETENTION_DAYS
find "$BACKUP_DIR" -name "${POSTGRES_DB}_*.dump" -mtime "+${RETENTION_DAYS}" -delete
echo "[$(date -Iseconds)] Pruned backups older than ${RETENTION_DAYS} days"

# --- Optional: upload to S3 ---
# Uncomment and configure the lines below to push backups offsite.
#
# AWS_BUCKET="${AWS_BUCKET:?set AWS_BUCKET for S3 upload}"
# aws s3 cp "$BACKUP_FILE" "s3://${AWS_BUCKET}/backups/$(basename "$BACKUP_FILE")"
# echo "[$(date -Iseconds)] Uploaded to s3://${AWS_BUCKET}/backups/"
