#!/usr/bin/env sh
set -eu

REMOTE_PATH="${1:-}"
BACKUP_NAME="${2:-}"

if [ -z "$REMOTE_PATH" ]; then
  echo "Usage: FASTIMG_BACKUP_PASSWORD='...' $0 <rclone-remote:path> [backup-name]" >&2
  exit 2
fi

if [ -z "${FASTIMG_BACKUP_PASSWORD:-}" ]; then
  echo "FASTIMG_BACKUP_PASSWORD is required" >&2
  exit 2
fi

need_tool() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required tool: $1" >&2
    exit 3
  fi
}

need_tool rclone
need_tool age
need_tool zstd
need_tool tar
need_tool python3
need_tool docker

if ! python3 -c "import cryptography" >/dev/null 2>&1; then
  echo "Python package 'cryptography' is missing; trying to install it for the current user..."
  python3 -m pip install --user cryptography
fi

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
PROJECT_DIR="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
CONFIG_DIR="$PROJECT_DIR/config"
DATA_DIR="$PROJECT_DIR/data"
UPLOADS_DIR="$PROJECT_DIR/uploads"
RCLONE_CONF="$CONFIG_DIR/rclone/rclone.conf"

if [ -n "${FASTIMG_RECOVERY_KIT:-}" ]; then
  echo "Unpacking encrypted recovery kit..."
  mkdir -p "$CONFIG_DIR/recovery-kit" "$CONFIG_DIR/rclone"
  python3 "$SCRIPT_DIR/restore_from_remote.py" unpack-kit \
    --password "$FASTIMG_BACKUP_PASSWORD" \
    --input "$FASTIMG_RECOVERY_KIT" \
    --dest "$CONFIG_DIR/recovery-kit"
  if [ -f "$CONFIG_DIR/recovery-kit/rclone.conf" ] && [ ! -f "$RCLONE_CONF" ]; then
    cp "$CONFIG_DIR/recovery-kit/rclone.conf" "$RCLONE_CONF"
  fi
fi

if [ -z "${RCLONE_CONFIG:-}" ] && [ -f "$RCLONE_CONF" ]; then
  export RCLONE_CONFIG="$RCLONE_CONF"
fi

remote_join() {
  case "$1" in
    *:) printf "%s%s" "$1" "$2" ;;
    */) printf "%s%s" "$1" "$2" ;;
    *) printf "%s/%s" "$1" "$2" ;;
  esac
}

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

echo "Checking remote: $REMOTE_PATH"
rclone lsf "$REMOTE_PATH" --max-depth 1 >/dev/null

if [ -z "$BACKUP_NAME" ]; then
  BACKUP_NAME="$(rclone lsf "$REMOTE_PATH" --files-only | grep '^fastimg-backup-.*\.age$' | sort | tail -n 1 || true)"
fi

if [ -z "$BACKUP_NAME" ]; then
  echo "No fastimg-backup-*.age files found in $REMOTE_PATH" >&2
  exit 4
fi

IDENTITY_REMOTE="$(remote_join "$REMOTE_PATH" "fastimg-age-identity.json.enc")"
BACKUP_REMOTE="$(remote_join "$REMOTE_PATH" "$BACKUP_NAME")"

echo "Downloading encrypted identity..."
if ! rclone copyto "$IDENTITY_REMOTE" "$TMP_DIR/identity.enc"; then
  if [ -f "$CONFIG_DIR/recovery-kit/fastimg-age-identity.json.enc" ]; then
    echo "Remote identity missing; using encrypted identity from recovery kit."
    cp "$CONFIG_DIR/recovery-kit/fastimg-age-identity.json.enc" "$TMP_DIR/identity.enc"
  else
    echo "Failed to download encrypted identity and no recovery-kit identity was found." >&2
    exit 5
  fi
fi

echo "Downloading backup: $BACKUP_NAME"
rclone copyto "$BACKUP_REMOTE" "$TMP_DIR/backup.age"

echo "Decrypting backup identity..."
python3 "$SCRIPT_DIR/restore_from_remote.py" decrypt-identity \
  --password "$FASTIMG_BACKUP_PASSWORD" \
  --input "$TMP_DIR/identity.enc" \
  --output "$TMP_DIR/identity.txt"

echo "Decrypting backup package..."
age -d -i "$TMP_DIR/identity.txt" -o "$TMP_DIR/backup.tar.zst" "$TMP_DIR/backup.age"
zstd -d -f "$TMP_DIR/backup.tar.zst" -o "$TMP_DIR/backup.tar"

echo "Extracting and validating..."
mkdir -p "$TMP_DIR/extract"
python3 "$SCRIPT_DIR/restore_from_remote.py" extract-validate \
  --tar "$TMP_DIR/backup.tar" \
  --dest "$TMP_DIR/extract"

echo "Stopping existing FastImg container if docker compose is available..."
if docker compose version >/dev/null 2>&1 && [ -f "$PROJECT_DIR/docker-compose.yml" ]; then
  (cd "$PROJECT_DIR" && docker compose down) || true
fi

ROLLBACK_DIR="$DATA_DIR/rollback/restore-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$ROLLBACK_DIR"
if [ -f "$DATA_DIR/database.db" ]; then
  mkdir -p "$ROLLBACK_DIR/data"
  cp "$DATA_DIR/database.db" "$ROLLBACK_DIR/data/database.db"
fi
if [ -d "$UPLOADS_DIR" ]; then
  cp -R "$UPLOADS_DIR" "$ROLLBACK_DIR/uploads"
fi

echo "Replacing data/database.db and uploads/..."
mkdir -p "$DATA_DIR"
cp "$TMP_DIR/extract/data/database.db" "$DATA_DIR/database.db"
rm -rf "$UPLOADS_DIR"
mkdir -p "$UPLOADS_DIR"
if [ -d "$TMP_DIR/extract/uploads" ]; then
  cp -R "$TMP_DIR/extract/uploads/." "$UPLOADS_DIR/"
fi

python3 "$SCRIPT_DIR/restore_from_remote.py" write-env \
  --extract "$TMP_DIR/extract" \
  --env "$PROJECT_DIR/.env"

echo "Starting FastImg..."
if docker compose version >/dev/null 2>&1 && [ -f "$PROJECT_DIR/docker-compose.yml" ]; then
  (cd "$PROJECT_DIR" && docker compose up -d --build)
else
  echo "docker compose is not available or docker-compose.yml is missing; start FastImg manually." >&2
fi

echo "Restore completed from $BACKUP_NAME"
echo "Rollback copy, if needed: $ROLLBACK_DIR"
