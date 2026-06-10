import base64
import configparser
import hashlib
import io
import json
import os
import re
import shutil
import sqlite3
import subprocess
import tarfile
import tempfile
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt

from extensions import db
from models import BackupConfig, BackupRun, Image, MaintenanceState


IDENTITY_REMOTE_NAME = "fastimg-age-identity.json.enc"
RECOVERY_KIT_NAME = "fastimg-recovery-kit.enc"
BACKUP_PREFIX = "fastimg-backup"
AD = b"fastimg-backup-v1"
_scheduler_started = False
_scheduler_lock = threading.Lock()


class BackupError(RuntimeError):
    pass


def utcnow():
    return datetime.now(timezone.utc)


def _b64(data):
    return base64.b64encode(data).decode("ascii")


def _unb64(data):
    return base64.b64decode(data.encode("ascii"))


def _derive_key(password, salt):
    kdf = Scrypt(salt=salt, length=32, n=2 ** 14, r=8, p=1)
    return kdf.derive(password.encode("utf-8"))


def encrypt_secret(data, password):
    if not password:
        raise BackupError("Backup password is required")
    salt = os.urandom(16)
    nonce = os.urandom(12)
    key = _derive_key(password, salt)
    cipher = AESGCM(key)
    ciphertext = cipher.encrypt(nonce, data, AD)
    return json.dumps({
        "version": 1,
        "kdf": "scrypt",
        "salt": _b64(salt),
        "nonce": _b64(nonce),
        "ciphertext": _b64(ciphertext),
    }, separators=(",", ":"))


def decrypt_secret(blob, password):
    try:
        payload = json.loads(blob)
        key = _derive_key(password, _unb64(payload["salt"]))
        cipher = AESGCM(key)
        return cipher.decrypt(_unb64(payload["nonce"]), _unb64(payload["ciphertext"]), AD)
    except (KeyError, ValueError, InvalidTag) as exc:
        raise BackupError("Backup password is incorrect or encrypted data is corrupted") from exc


def config_dir(app):
    path = app.config.get("FASTIMG_CONFIG_DIR") or os.path.join(app.root_path, "config")
    os.makedirs(path, exist_ok=True)
    return path


def backup_config_dir(app):
    path = os.path.join(config_dir(app), "backup")
    os.makedirs(path, exist_ok=True)
    return path


def backup_work_dir(app):
    path = app.config.get("FASTIMG_BACKUP_WORK_DIR") or os.path.join(app.root_path, "data", "backup-work")
    os.makedirs(path, exist_ok=True)
    return path


def rclone_config_path(app):
    return (
        os.environ.get("RCLONE_CONFIG")
        or app.config.get("RCLONE_CONFIG_PATH")
        or os.path.join(config_dir(app), "rclone", "rclone.conf")
    )


def read_rclone_config(app):
    parser = configparser.RawConfigParser()
    parser.optionxform = str
    path = rclone_config_path(app)
    if os.path.exists(path):
        parser.read(path, encoding="utf-8")
    return parser


def write_rclone_config(app, parser):
    path = rclone_config_path(app)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        parser.write(f)
    return path


def db_file_from_uri(uri):
    if not uri.startswith("sqlite:///"):
        raise BackupError("Only SQLite DATABASE_URL is supported by backup v1")
    raw = uri.replace("sqlite:///", "", 1)
    if raw.startswith("/") or (len(raw) > 1 and raw[1] == ":"):
        return raw
    return os.path.abspath(raw)


def remote_join(remote_path, name):
    remote_path = (remote_path or "").strip()
    if not remote_path:
        raise BackupError("Remote path is not configured")
    if remote_path.endswith(":"):
        return f"{remote_path}{name}"
    return f"{remote_path.rstrip('/')}/{name}"


def run_cmd(args, app=None, input_data=None, timeout=600):
    env = os.environ.copy()
    if app:
        rc_path = rclone_config_path(app)
        if os.path.exists(rc_path):
            env["RCLONE_CONFIG"] = rc_path
    proc = subprocess.run(
        args,
        input=input_data,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
        timeout=timeout,
        check=False,
    )
    if proc.returncode != 0:
        stderr = proc.stderr.decode("utf-8", errors="replace").strip()
        stdout = proc.stdout.decode("utf-8", errors="replace").strip()
        detail = stderr or stdout or f"exit code {proc.returncode}"
        raise BackupError(f"Command failed: {' '.join(args)}\n{detail}")
    return proc


def _clamp_percent(value):
    try:
        return max(0, min(100, int(round(float(value)))))
    except (TypeError, ValueError):
        return 0


def set_run_progress(run, stage, percent=None, message=None, bytes_done=None, bytes_total=None):
    if not run:
        return
    run.progress_stage = stage
    if percent is not None:
        run.progress_percent = _clamp_percent(percent)
    if message is not None:
        run.progress_message = message
        run.log = message
    if bytes_done is not None:
        run.bytes_done = max(0, int(bytes_done))
    if bytes_total is not None:
        run.bytes_total = max(0, int(bytes_total))
    run.progress_updated_at = utcnow()
    db.session.commit()


def _tail_file(path, start_pos=0):
    if not path or not os.path.exists(path):
        return start_pos, ""
    with open(path, "rb") as f:
        f.seek(start_pos)
        chunk = f.read()
        return f.tell(), chunk.decode("utf-8", errors="replace")


def _parse_rclone_percent(text):
    if "Transferred:" not in text:
        return None
    matches = re.findall(r"(\d+(?:\.\d+)?)%", text)
    if not matches:
        return None
    try:
        return max(0.0, min(100.0, float(matches[-1])))
    except ValueError:
        return None


def _log_tail(path, limit=4000):
    if not path or not os.path.exists(path):
        return ""
    with open(path, "rb") as f:
        try:
            f.seek(-limit, os.SEEK_END)
        except OSError:
            f.seek(0)
        return f.read().decode("utf-8", errors="replace").strip()


def rclone_copyto_with_progress(app, source, dest, run, stage, start_percent, end_percent, total_bytes=None, timeout=3600):
    env = os.environ.copy()
    rc_path = rclone_config_path(app)
    if os.path.exists(rc_path):
        env["RCLONE_CONFIG"] = rc_path

    log_fd, log_path = tempfile.mkstemp(prefix="fastimg-rclone-", suffix=".log", dir=backup_work_dir(app))
    os.close(log_fd)
    args = [
        "rclone", "copyto", source, dest,
        "--stats", "1s",
        "--stats-one-line",
        "--stats-unit", "bytes",
        "--stats-log-level", "NOTICE",
        "--log-file", log_path,
    ]
    display_args = ["rclone", "copyto", source, dest]
    set_run_progress(run, stage, start_percent, "Uploading encrypted backup", bytes_done=0, bytes_total=total_bytes)

    proc = subprocess.Popen(
        args,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
    )
    started = time.monotonic()
    log_pos = 0
    last_reported = None

    try:
        while proc.poll() is None:
            if time.monotonic() - started > timeout:
                proc.kill()
                raise BackupError(f"Command failed: {' '.join(display_args)}\nTimed out after {timeout} seconds")

            log_pos, chunk = _tail_file(log_path, log_pos)
            percent = _parse_rclone_percent(chunk)
            if percent is not None and percent != last_reported:
                span = max(0, end_percent - start_percent)
                overall = start_percent + (span * percent / 100.0)
                done = int(total_bytes * percent / 100.0) if total_bytes else None
                message = f"Uploading encrypted backup ({percent:.0f}%)"
                set_run_progress(run, stage, overall, message, bytes_done=done, bytes_total=total_bytes)
                last_reported = percent
            time.sleep(0.75)

        log_pos, chunk = _tail_file(log_path, log_pos)
        percent = _parse_rclone_percent(chunk)
        if percent is not None:
            span = max(0, end_percent - start_percent)
            overall = start_percent + (span * percent / 100.0)
            done = int(total_bytes * percent / 100.0) if total_bytes else None
            set_run_progress(run, stage, overall, f"Uploading encrypted backup ({percent:.0f}%)", bytes_done=done, bytes_total=total_bytes)

        stdout, stderr = proc.communicate()
        if proc.returncode != 0:
            detail = (
                stderr.decode("utf-8", errors="replace").strip()
                or stdout.decode("utf-8", errors="replace").strip()
                or _log_tail(log_path)
                or f"exit code {proc.returncode}"
            )
            raise BackupError(f"Command failed: {' '.join(display_args)}\n{detail}")

        set_run_progress(run, stage, end_percent, "Encrypted backup uploaded", bytes_done=total_bytes, bytes_total=total_bytes)
    finally:
        try:
            os.remove(log_path)
        except OSError:
            pass


def rclone_obscure(app, value):
    require_tools("rclone")
    env = os.environ.copy()
    rc_path = rclone_config_path(app)
    if os.path.exists(rc_path):
        env["RCLONE_CONFIG"] = rc_path
    proc = subprocess.run(
        ["rclone", "obscure", value],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
        timeout=30,
        check=False,
    )
    if proc.returncode != 0:
        raise BackupError("Failed to encode secret for rclone config")
    return proc.stdout.decode("utf-8", errors="replace").strip()


def tool_status(app=None):
    tools = {}
    for tool in ("age", "age-keygen", "zstd", "rclone"):
        tools[tool] = bool(shutil.which(tool))
    if app:
        tools["rclone_config"] = os.path.exists(rclone_config_path(app))
    return tools


def _remote_path(remote_name, path):
    clean = (path or "").strip().strip("/")
    return f"{remote_name}:{clean}" if clean else f"{remote_name}:"


def _split_remote_path(remote_path, remote_name):
    prefix = f"{remote_name}:"
    if not (remote_path or "").startswith(prefix):
        return ""
    return (remote_path or "")[len(prefix):].strip("/")


def backup_provider_info(app, cfg=None):
    cfg = cfg or get_backup_config()
    remote_path = cfg.remote_path or ""
    info = {
        "mode": "custom",
        "remote_path": remote_path,
    }
    parser = read_rclone_config(app)

    if remote_path.startswith("fastimg-webdav:"):
        info["mode"] = "webdav"
        info["directory"] = _split_remote_path(remote_path, "fastimg-webdav")
        if parser.has_section("fastimg-webdav"):
            info.update({
                "url": parser.get("fastimg-webdav", "url", fallback=""),
                "username": parser.get("fastimg-webdav", "user", fallback=""),
                "vendor": parser.get("fastimg-webdav", "vendor", fallback="other"),
            })
    elif remote_path.startswith("fastimg-s3:"):
        info["mode"] = "s3"
        s3_path = _split_remote_path(remote_path, "fastimg-s3")
        bucket, _, directory = s3_path.partition("/")
        info.update({
            "bucket": bucket,
            "directory": directory,
        })
        if parser.has_section("fastimg-s3"):
            info.update({
                "provider": parser.get("fastimg-s3", "provider", fallback="Other"),
                "endpoint": parser.get("fastimg-s3", "endpoint", fallback=""),
                "region": parser.get("fastimg-s3", "region", fallback=""),
                "access_key_id": parser.get("fastimg-s3", "access_key_id", fallback=""),
                "force_path_style": parser.get("fastimg-s3", "force_path_style", fallback="true"),
            })

    return info


def configure_storage_provider(app, data):
    provider = (data.get("provider") or "").strip().lower()
    if provider not in {"webdav", "s3", "custom"}:
        raise BackupError("Unsupported backup storage provider")

    cfg = get_backup_config()

    if provider == "custom":
        remote_path = (data.get("remote_path") or "").strip()
        if not remote_path or ":" not in remote_path:
            raise BackupError("Custom rclone path must look like remote:path")
        cfg.remote_path = remote_path
        db.session.commit()
        return cfg

    require_tools("rclone")
    parser = read_rclone_config(app)

    if provider == "webdav":
        url = (data.get("url") or "").strip()
        username = (data.get("username") or "").strip()
        password = data.get("password") or ""
        directory = (data.get("directory") or "fastimg-backups").strip().strip("/")

        if not url.startswith(("http://", "https://")):
            raise BackupError("WebDAV URL must start with http:// or https://")
        if not username:
            raise BackupError("WebDAV username is required")
        if not password and not parser.has_option("fastimg-webdav", "pass"):
            raise BackupError("WebDAV password is required")

        if not parser.has_section("fastimg-webdav"):
            parser.add_section("fastimg-webdav")
        parser.set("fastimg-webdav", "type", "webdav")
        parser.set("fastimg-webdav", "url", url)
        parser.set("fastimg-webdav", "vendor", data.get("vendor") or "other")
        parser.set("fastimg-webdav", "user", username)
        if password:
            parser.set("fastimg-webdav", "pass", rclone_obscure(app, password))
        cfg.remote_path = _remote_path("fastimg-webdav", directory)

    if provider == "s3":
        endpoint = (data.get("endpoint") or "").strip()
        bucket = (data.get("bucket") or "").strip().strip("/")
        directory = (data.get("directory") or "fastimg-backups").strip().strip("/")
        access_key_id = (data.get("access_key_id") or "").strip()
        secret_access_key = data.get("secret_access_key") or ""
        region = (data.get("region") or "us-east-1").strip()
        s3_provider = (data.get("s3_provider") or "Other").strip()
        force_path_style = str(data.get("force_path_style", "true")).lower()

        if not bucket:
            raise BackupError("S3 bucket is required")
        if not access_key_id:
            raise BackupError("S3 access key is required")
        if not secret_access_key and not parser.has_option("fastimg-s3", "secret_access_key"):
            raise BackupError("S3 secret key is required")

        if not parser.has_section("fastimg-s3"):
            parser.add_section("fastimg-s3")
        parser.set("fastimg-s3", "type", "s3")
        parser.set("fastimg-s3", "provider", s3_provider)
        parser.set("fastimg-s3", "env_auth", "false")
        parser.set("fastimg-s3", "access_key_id", access_key_id)
        if secret_access_key:
            # rclone's S3 backend expects the raw secret here. Obscuring it breaks
            # AWS Signature V4 and causes SignatureDoesNotMatch on many S3-compatible services.
            parser.set("fastimg-s3", "secret_access_key", secret_access_key)
        parser.set("fastimg-s3", "region", region)
        parser.set("fastimg-s3", "force_path_style", "true" if force_path_style in {"true", "1", "yes", "on"} else "false")
        if endpoint:
            parser.set("fastimg-s3", "endpoint", endpoint)
        s3_path = bucket if not directory else f"{bucket}/{directory}"
        cfg.remote_path = _remote_path("fastimg-s3", s3_path)

    write_rclone_config(app, parser)
    db.session.commit()
    return cfg


def require_tools(*names):
    missing = [name for name in names if not shutil.which(name)]
    if missing:
        raise BackupError("Missing required tools: " + ", ".join(missing))


def get_backup_config():
    cfg = db.session.get(BackupConfig, 1)
    if not cfg:
        cfg = BackupConfig(id=1)
        db.session.add(cfg)
        db.session.commit()
    return cfg


def update_backup_config(data):
    cfg = get_backup_config()
    if "enabled" in data:
        cfg.enabled = bool(data.get("enabled"))
    if "remote_path" in data:
        cfg.remote_path = (data.get("remote_path") or "").strip()
    if "schedule_time" in data:
        value = (data.get("schedule_time") or "03:30").strip()
        if len(value) != 5 or value[2] != ":":
            raise BackupError("schedule_time must use HH:MM format")
        cfg.schedule_time = value
    if "timezone" in data:
        value = (data.get("timezone") or "Asia/Shanghai").strip()
        ZoneInfo(value)
        cfg.timezone = value
    if "retention_count" in data:
        cfg.retention_count = max(1, min(int(data.get("retention_count") or 7), 365))
    db.session.commit()
    return cfg


def _write_local_identity(app, encrypted_identity):
    identity_path = os.path.join(backup_config_dir(app), IDENTITY_REMOTE_NAME)
    with open(identity_path, "w", encoding="utf-8") as f:
        f.write(encrypted_identity)
    return identity_path


def _upload_identity_if_possible(app, cfg):
    if not cfg.remote_path or not cfg.encrypted_identity:
        return False
    require_tools("rclone")
    path = _write_local_identity(app, cfg.encrypted_identity)
    run_cmd(["rclone", "mkdir", cfg.remote_path], app=app, timeout=120)
    run_cmd(["rclone", "copyto", path, remote_join(cfg.remote_path, IDENTITY_REMOTE_NAME)], app=app, timeout=300)
    return True


def setup_backup_password(app, password):
    require_tools("age-keygen")
    cfg = get_backup_config()
    if cfg.encrypted_identity and cfg.encryption_recipient:
        decrypt_secret(cfg.encrypted_identity, password)
        _write_local_identity(app, cfg.encrypted_identity)
        _upload_identity_if_possible(app, cfg)
        return cfg

    proc = run_cmd(["age-keygen"], app=app, timeout=30)
    text = (
        proc.stdout.decode("utf-8", errors="replace")
        + "\n"
        + proc.stderr.decode("utf-8", errors="replace")
    )
    recipient = None
    identity_lines = []
    for line in text.splitlines():
        if line.lower().startswith("# public key:"):
            recipient = line.split(":", 1)[1].strip()
        if line.startswith("#") or line.startswith("AGE-SECRET-KEY-"):
            identity_lines.append(line)
    identity = "\n".join(identity_lines).strip() + "\n"
    if not recipient or "AGE-SECRET-KEY-" not in identity:
        raise BackupError("age-keygen did not return a usable identity")

    cfg.encryption_recipient = recipient
    cfg.encrypted_identity = encrypt_secret(identity.encode("utf-8"), password)
    db.session.commit()
    _write_local_identity(app, cfg.encrypted_identity)
    _upload_identity_if_possible(app, cfg)
    return cfg


def acquire_maintenance(mode, reason, owner):
    state = db.session.get(MaintenanceState, 1)
    if not state:
        state = MaintenanceState(id=1)
        db.session.add(state)
        db.session.flush()
    if state.active:
        raise BackupError(f"System is already in maintenance mode: {state.mode}")
    state.active = True
    state.mode = mode
    state.reason = reason
    state.owner = owner
    state.started_at = utcnow()
    db.session.commit()
    return state


def release_maintenance(owner=None):
    state = db.session.get(MaintenanceState, 1)
    if not state or not state.active:
        return
    if owner and state.owner and state.owner != owner:
        return
    state.active = False
    state.mode = None
    state.reason = None
    state.owner = None
    state.started_at = None
    db.session.commit()


def current_maintenance():
    state = db.session.get(MaintenanceState, 1)
    return state if state and state.active else None


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def sqlite_online_backup(src_db, dst_db):
    os.makedirs(os.path.dirname(dst_db), exist_ok=True)
    src = sqlite3.connect(src_db)
    dst = sqlite3.connect(dst_db)
    try:
        with dst:
            src.backup(dst)
    finally:
        dst.close()
        src.close()


def sanitize_snapshot_db(snapshot_db):
    conn = sqlite3.connect(snapshot_db)
    try:
        cur = conn.cursor()
        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='maintenance_state'")
        if cur.fetchone():
            cur.execute("""
                UPDATE maintenance_state
                SET active = 0, mode = NULL, reason = NULL, owner = NULL, started_at = NULL
                WHERE id = 1
            """)
        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='backup_run'")
        if cur.fetchone():
            cur.execute("""
                DELETE FROM backup_run
                WHERE status IN ('queued', 'running')
                   OR error = 'Interrupted by database snapshot restore'
            """)
        conn.commit()
    finally:
        conn.close()


def ensure_backup_run_progress_columns(db_path):
    conn = sqlite3.connect(db_path)
    try:
        cur = conn.cursor()
        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='backup_run'")
        if not cur.fetchone():
            return

        cur.execute("PRAGMA table_info(backup_run)")
        columns = {row[1] for row in cur.fetchall()}
        additions = {
            "progress_stage": "ALTER TABLE backup_run ADD COLUMN progress_stage VARCHAR(64) DEFAULT 'queued'",
            "progress_percent": "ALTER TABLE backup_run ADD COLUMN progress_percent INTEGER DEFAULT 0",
            "progress_message": "ALTER TABLE backup_run ADD COLUMN progress_message VARCHAR(256)",
            "bytes_done": "ALTER TABLE backup_run ADD COLUMN bytes_done BIGINT",
            "bytes_total": "ALTER TABLE backup_run ADD COLUMN bytes_total BIGINT",
            "progress_updated_at": "ALTER TABLE backup_run ADD COLUMN progress_updated_at DATETIME",
        }
        for column, statement in additions.items():
            if column not in columns:
                cur.execute(statement)
        conn.commit()
    finally:
        conn.close()


def build_manifest(app, snapshot_db):
    uploads_dir = app.config["UPLOAD_FOLDER"]
    images = Image.query.order_by(Image.id.asc()).all()
    files = []
    missing = []
    for img in images:
        path = os.path.join(uploads_dir, img.filename)
        if not os.path.isfile(path):
            missing.append(img.filename)
            continue
        files.append({
            "id": img.id,
            "filename": img.filename,
            "size": os.path.getsize(path),
            "sha256": sha256_file(path),
        })
    if missing:
        raise BackupError("Database references missing upload files: " + ", ".join(missing[:10]))
    return {
        "version": 1,
        "created_at": utcnow().isoformat(),
        "app": "FastImg",
        "database": {
            "path": "data/database.db",
            "sha256": sha256_file(snapshot_db),
        },
        "uploads": files,
        "counts": {
            "images": len(files),
        },
        "privacy": {
            "cloud_visible": ["backup package name", "backup package size", "upload time"],
            "cloud_hidden": ["photos", "database", "original filenames", "folder names", "manifest"],
        },
    }


def write_restore_info(path):
    with open(path, "w", encoding="utf-8") as f:
        f.write(
            "FastImg encrypted backup.\n"
            "Decrypt with the matching age identity. The identity is encrypted by your backup password.\n"
            "Cloud providers cannot read image contents, database records, original filenames, or folder names.\n"
        )


def tar_zstd_age(app, cfg, source_dir, manifest, output_path, progress_callback=None):
    require_tools("age", "zstd")
    manifest_path = os.path.join(source_dir, "manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    env_path = os.path.join(source_dir, "fastimg-env.json")
    env_snapshot = {
        "SECRET_KEY": app.config.get("SECRET_KEY"),
        "DATABASE_URL": app.config.get("SQLALCHEMY_DATABASE_URI"),
        "created_at": utcnow().isoformat(),
    }
    with open(env_path, "w", encoding="utf-8") as f:
        json.dump(env_snapshot, f, ensure_ascii=False, indent=2)

    restore_info = os.path.join(source_dir, "README-RESTORE.txt")
    write_restore_info(restore_info)

    zstd = subprocess.Popen(
        ["zstd", "-T0", "-q", "-c"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    age = subprocess.Popen(
        ["age", "-r", cfg.encryption_recipient, "-o", output_path],
        stdin=zstd.stdout,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    zstd.stdout.close()

    try:
        total_items = max(1, len(manifest["uploads"]) + 4)
        completed_items = 0
        last_progress_at = 0

        def bump_progress(message):
            nonlocal completed_items, last_progress_at
            completed_items += 1
            if not progress_callback:
                return
            now = time.monotonic()
            if now - last_progress_at >= 0.75 or completed_items >= total_items:
                progress_callback(completed_items / total_items, message)
                last_progress_at = now

        with tarfile.open(fileobj=zstd.stdin, mode="w|") as tar:
            tar.add(os.path.join(source_dir, "data", "database.db"), arcname="data/database.db")
            bump_progress("Packing database snapshot")
            tar.add(manifest_path, arcname="manifest.json")
            bump_progress("Packing backup manifest")
            tar.add(env_path, arcname="config/fastimg-env.json")
            bump_progress("Packing environment metadata")
            tar.add(restore_info, arcname="README-RESTORE.txt")
            bump_progress("Packing restore guide")
            uploads_dir = app.config["UPLOAD_FOLDER"]
            uploads_info = tarfile.TarInfo("uploads")
            uploads_info.type = tarfile.DIRTYPE
            uploads_info.mode = 0o755
            tar.addfile(uploads_info)
            for item in manifest["uploads"]:
                tar.add(os.path.join(uploads_dir, item["filename"]), arcname=f"uploads/{item['filename']}")
                bump_progress("Compressing and encrypting uploads")
    finally:
        if zstd.stdin:
            zstd.stdin.close()

    age_stdout, age_stderr = age.communicate()
    zstd_stderr = zstd.stderr.read() if zstd.stderr else b""
    zstd_rc = zstd.wait()
    if zstd_rc != 0:
        raise BackupError(zstd_stderr.decode("utf-8", errors="replace") or "zstd failed")
    if age.returncode != 0:
        detail = (age_stderr or age_stdout).decode("utf-8", errors="replace")
        raise BackupError(detail or "age encryption failed")


def create_backup_run(trigger="manual"):
    run = BackupRun(
        trigger=trigger,
        status="queued",
        progress_stage="queued",
        progress_percent=0,
        progress_message="Queued",
        started_at=utcnow(),
        progress_updated_at=utcnow(),
    )
    db.session.add(run)
    db.session.commit()
    return run


def start_backup_async(app, trigger="manual"):
    run = create_backup_run(trigger)
    thread = threading.Thread(target=execute_backup, args=(app, run.id), daemon=True)
    thread.start()
    return run


def execute_backup(app, run_id):
    owner = f"backup:{run_id}"
    work_root = None
    with app.app_context():
        run = db.session.get(BackupRun, run_id)
        try:
            cfg = get_backup_config()
            if not cfg.remote_path:
                raise BackupError("Remote path is not configured")
            if not cfg.encryption_recipient or not cfg.encrypted_identity:
                raise BackupError("Backup password has not been configured")
            require_tools("age", "zstd", "rclone")

            run.status = "running"
            run.started_at = utcnow()
            set_run_progress(run, "preparing", 3, "Preparing backup")
            acquire_maintenance("backup", "Creating encrypted backup snapshot", owner)
            encrypted_path = None
            try:
                work_root = tempfile.mkdtemp(prefix="fastimg-backup-", dir=backup_work_dir(app))
                source_dir = os.path.join(work_root, "source")
                os.makedirs(os.path.join(source_dir, "data"), exist_ok=True)
                snapshot_db = os.path.join(source_dir, "data", "database.db")
                db_file = db_file_from_uri(app.config["SQLALCHEMY_DATABASE_URI"])
                set_run_progress(run, "snapshot", 10, "Creating database snapshot")
                sqlite_online_backup(db_file, snapshot_db)
                set_run_progress(run, "snapshot", 15, "Sanitizing snapshot")
                sanitize_snapshot_db(snapshot_db)
                set_run_progress(run, "manifest", 22, "Building backup manifest")
                manifest = build_manifest(app, snapshot_db)

                stamp = datetime.now(ZoneInfo(cfg.timezone or "Asia/Shanghai")).strftime("%Y%m%d-%H%M%S")
                name = f"{BACKUP_PREFIX}-{stamp}-{run_id}.age"
                encrypted_path = os.path.join(work_root, name)
                run.backup_name = name

                def pack_progress(fraction, message):
                    set_run_progress(run, "encrypting", 30 + (fraction * 25), message)

                set_run_progress(run, "encrypting", 30, "Compressing and encrypting backup")
                tar_zstd_age(app, cfg, source_dir, manifest, encrypted_path, progress_callback=pack_progress)
            finally:
                release_maintenance(owner)

            encrypted_sha = sha256_file(encrypted_path)
            encrypted_size = os.path.getsize(encrypted_path)
            remote_dest = remote_join(cfg.remote_path, os.path.basename(encrypted_path))
            run.remote_path = remote_dest
            run.size_bytes = encrypted_size
            run.sha256 = encrypted_sha

            set_run_progress(run, "uploading_identity", 56, "Uploading recovery identity")
            _upload_identity_if_possible(app, cfg)
            set_run_progress(run, "creating_remote_dir", 59, "Preparing remote directory")
            run_cmd(["rclone", "mkdir", cfg.remote_path], app=app, timeout=120)
            rclone_copyto_with_progress(
                app,
                encrypted_path,
                remote_dest,
                run,
                "uploading_backup",
                60,
                94,
                total_bytes=encrypted_size,
                timeout=3600,
            )
            set_run_progress(run, "retention", 96, "Applying remote retention policy", bytes_done=encrypted_size, bytes_total=encrypted_size)
            apply_retention(app, cfg)

            run.status = "success"
            run.backup_name = os.path.basename(encrypted_path)
            run.finished_at = utcnow()
            set_run_progress(run, "done", 100, "Encrypted backup uploaded successfully", bytes_done=encrypted_size, bytes_total=encrypted_size)
            shutil.rmtree(work_root, ignore_errors=True)
        except Exception as exc:
            release_maintenance(owner)
            if run:
                run.status = "failed"
                run.error = str(exc)
                run.finished_at = utcnow()
                set_run_progress(run, "failed", run.progress_percent or 0, str(exc), bytes_done=run.bytes_done, bytes_total=run.bytes_total)
            if work_root:
                shutil.rmtree(work_root, ignore_errors=True)
            app.logger.exception("Backup failed")


def list_remote_backups(app, cfg=None, limit=None):
    cfg = cfg or get_backup_config()
    if not cfg.remote_path:
        return []
    require_tools("rclone")
    proc = run_cmd(["rclone", "lsjson", cfg.remote_path, "--files-only"], app=app, timeout=120)
    data = json.loads(proc.stdout.decode("utf-8") or "[]")
    result = []
    for item in data:
        name = item.get("Name") or item.get("Path")
        if not name:
            continue
        if name.endswith(".age") or name == IDENTITY_REMOTE_NAME or name == RECOVERY_KIT_NAME:
            result.append({
                "name": name,
                "size": item.get("Size"),
                "mod_time": item.get("ModTime"),
                "is_backup": name.startswith(BACKUP_PREFIX) and name.endswith(".age"),
                "remote_path": remote_join(cfg.remote_path, name),
            })
    result.sort(key=lambda x: x.get("name") or "", reverse=True)
    if limit:
        keep = max(1, int(limit))
        backups = [item for item in result if item["is_backup"]]
        support_files = [item for item in result if not item["is_backup"]]
        result = backups[:keep] + support_files
    return result


def apply_retention(app, cfg):
    keep = max(1, cfg.retention_count or 7)
    backups = [b for b in list_remote_backups(app, cfg) if b["is_backup"]]
    backups.sort(key=lambda x: x["name"], reverse=True)
    for old in backups[keep:]:
        run_cmd(["rclone", "deletefile", old["remote_path"]], app=app, timeout=120)


def test_remote(app):
    cfg = get_backup_config()
    if not cfg.remote_path:
        raise BackupError("Remote path is not configured")
    require_tools("rclone")
    run_cmd(["rclone", "mkdir", cfg.remote_path], app=app, timeout=120)
    proc = run_cmd(["rclone", "lsf", cfg.remote_path, "--max-depth", "1"], app=app, timeout=120)
    return proc.stdout.decode("utf-8", errors="replace")


def safe_extract_tar(tar_path, dest):
    dest_real = os.path.realpath(dest)
    with tarfile.open(tar_path, "r") as tar:
        for member in tar.getmembers():
            member_path = os.path.realpath(os.path.join(dest, member.name))
            if not member_path.startswith(dest_real + os.sep) and member_path != dest_real:
                raise BackupError("Unsafe path in backup archive")
        tar.extractall(dest)


def validate_extracted_backup(extract_dir):
    manifest_path = os.path.join(extract_dir, "manifest.json")
    db_path = os.path.join(extract_dir, "data", "database.db")
    uploads_dir = os.path.join(extract_dir, "uploads")
    if not os.path.isfile(manifest_path) or not os.path.isfile(db_path):
        raise BackupError("Backup package is missing manifest or database")
    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)
    if sha256_file(db_path) != manifest["database"]["sha256"]:
        raise BackupError("Database checksum mismatch")
    for item in manifest.get("uploads", []):
        path = os.path.join(uploads_dir, item["filename"])
        if not os.path.isfile(path):
            raise BackupError(f"Backup is missing upload file: {item['filename']}")
        if sha256_file(path) != item["sha256"]:
            raise BackupError(f"Upload checksum mismatch: {item['filename']}")

    conn = sqlite3.connect(db_path)
    try:
        cur = conn.cursor()
        cur.execute("SELECT filename FROM image")
        filenames = [row[0] for row in cur.fetchall()]
    finally:
        conn.close()
    missing = [name for name in filenames if not os.path.isfile(os.path.join(uploads_dir, name))]
    if missing:
        raise BackupError("Restored database references missing files: " + ", ".join(missing[:10]))
    return manifest


def _download_identity_blob(app, cfg):
    if cfg.encrypted_identity:
        return cfg.encrypted_identity
    proc = run_cmd(["rclone", "cat", remote_join(cfg.remote_path, IDENTITY_REMOTE_NAME)], app=app, timeout=120)
    return proc.stdout.decode("utf-8")


def start_restore_async(app, backup_name, password):
    run = BackupRun(
        trigger="restore",
        status="queued",
        progress_stage="queued",
        progress_percent=0,
        progress_message="Restore queued",
        backup_name=backup_name,
        started_at=utcnow(),
        progress_updated_at=utcnow(),
    )
    db.session.add(run)
    db.session.commit()
    thread = threading.Thread(target=execute_restore, args=(app, run.id, backup_name, password), daemon=True)
    thread.start()
    return run


def record_restore_result(app, backup_name, remote_path, status, message, error=None, started_at=None):
    db.session.remove()
    db.engine.dispose()
    db.create_all()
    ensure_backup_run_progress_columns(db_file_from_uri(app.config["SQLALCHEMY_DATABASE_URI"]))

    run = BackupRun(
        trigger="restore",
        status=status,
        backup_name=backup_name,
        remote_path=remote_path,
        progress_stage="done" if status == "success" else "failed",
        progress_percent=100 if status == "success" else 0,
        progress_message=message,
        error=error,
        log=message,
        started_at=started_at or utcnow(),
        finished_at=utcnow(),
        progress_updated_at=utcnow(),
    )
    db.session.add(run)
    db.session.commit()
    return run


def clear_directory_contents(path):
    os.makedirs(path, exist_ok=True)
    for entry in os.scandir(path):
        if entry.is_dir(follow_symlinks=False):
            shutil.rmtree(entry.path)
        else:
            os.unlink(entry.path)


def copy_directory_contents(src, dest):
    os.makedirs(dest, exist_ok=True)
    if not os.path.isdir(src):
        return
    for name in os.listdir(src):
        src_path = os.path.join(src, name)
        dest_path = os.path.join(dest, name)
        if os.path.isdir(src_path) and not os.path.islink(src_path):
            shutil.copytree(src_path, dest_path)
        else:
            shutil.copy2(src_path, dest_path)


def replace_directory_contents(src, dest):
    clear_directory_contents(dest)
    copy_directory_contents(src, dest)


def database_image_filenames(db_path):
    conn = sqlite3.connect(db_path)
    try:
        cur = conn.cursor()
        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='image'")
        if not cur.fetchone():
            return []
        cur.execute("SELECT filename FROM image")
        return [row[0] for row in cur.fetchall()]
    finally:
        conn.close()


def validate_uploads_available_for_db(db_path, uploads_dir):
    missing = [
        name for name in database_image_filenames(db_path)
        if not os.path.isfile(os.path.join(uploads_dir, name))
    ]
    if missing:
        raise BackupError("Restored uploads are missing files: " + ", ".join(missing[:10]))


def execute_restore(app, run_id, backup_name, password):
    owner = f"restore:{run_id}"
    work_root = None
    restored_db_applied = False
    restore_started_at = utcnow()
    restore_remote_path = None
    with app.app_context():
        run = db.session.get(BackupRun, run_id)
        try:
            require_tools("age", "zstd", "rclone")
            cfg = get_backup_config()
            if not cfg.remote_path:
                raise BackupError("Remote path is not configured")
            if not backup_name:
                backups = [b for b in list_remote_backups(app, cfg) if b["is_backup"]]
                if not backups:
                    raise BackupError("No remote backups found")
                backup_name = backups[0]["name"]
            if "/" in backup_name or "\\" in backup_name:
                raise BackupError("backup_name must be a file name from the configured remote")

            run.status = "running"
            run.backup_name = backup_name
            run.remote_path = remote_join(cfg.remote_path, backup_name)
            restore_remote_path = run.remote_path
            run.started_at = utcnow()
            restore_started_at = run.started_at
            set_run_progress(run, "preparing_restore", 5, "Preparing restore")

            work_root = tempfile.mkdtemp(prefix="fastimg-restore-", dir=backup_work_dir(app))
            backup_age = os.path.join(work_root, backup_name)
            identity_path = os.path.join(work_root, "identity.txt")
            tar_zst = os.path.join(work_root, "backup.tar.zst")
            tar_path = os.path.join(work_root, "backup.tar")
            extract_dir = os.path.join(work_root, "extract")
            os.makedirs(extract_dir, exist_ok=True)

            set_run_progress(run, "downloading_identity", 15, "Downloading recovery identity")
            identity_blob = _download_identity_blob(app, cfg)
            identity = decrypt_secret(identity_blob, password)
            with open(identity_path, "wb") as f:
                f.write(identity)

            set_run_progress(run, "downloading_backup", 25, "Downloading encrypted backup")
            run_cmd(["rclone", "copyto", run.remote_path, backup_age], app=app, timeout=3600)
            set_run_progress(run, "decrypting", 55, "Decrypting backup package")
            run_cmd(["age", "-d", "-i", identity_path, "-o", tar_zst, backup_age], app=app, timeout=3600)
            set_run_progress(run, "decompressing", 68, "Decompressing backup package")
            run_cmd(["zstd", "-d", "-f", tar_zst, "-o", tar_path], app=app, timeout=3600)
            safe_extract_tar(tar_path, extract_dir)
            set_run_progress(run, "validating", 78, "Validating backup package")
            validate_extracted_backup(extract_dir)

            set_run_progress(run, "restoring", 88, "Restoring files and database")
            acquire_maintenance("restore", "Restoring encrypted backup", owner)
            try:
                db.session.remove()
                db.engine.dispose()
                restore_into_app(app, extract_dir)
                restored_db_applied = True
            finally:
                if not restored_db_applied:
                    release_maintenance(owner)

            record_restore_result(
                app,
                backup_name,
                restore_remote_path,
                "success",
                "Restore completed. Application restart is recommended.",
                started_at=restore_started_at,
            )
            shutil.rmtree(work_root, ignore_errors=True)

            if os.environ.get("FASTIMG_AUTO_EXIT_AFTER_RESTORE", "false").lower() == "true":
                threading.Timer(2.0, lambda: os._exit(0)).start()
        except Exception as exc:
            if restored_db_applied:
                record_restore_result(
                    app,
                    backup_name,
                    restore_remote_path,
                    "failed",
                    str(exc),
                    error=str(exc),
                    started_at=restore_started_at,
                )
            else:
                release_maintenance(owner)
            if run and not restored_db_applied:
                run = db.session.get(BackupRun, run_id) or run
                run.status = "failed"
                run.error = str(exc)
                run.finished_at = utcnow()
                set_run_progress(run, "failed", run.progress_percent or 0, str(exc))
            if work_root:
                shutil.rmtree(work_root, ignore_errors=True)
            app.logger.exception("Restore failed")


def restore_into_app(app, extract_dir):
    db_file = db_file_from_uri(app.config["SQLALCHEMY_DATABASE_URI"])
    uploads_dir = app.config["UPLOAD_FOLDER"]
    restore_db = os.path.join(extract_dir, "data", "database.db")
    restore_uploads = os.path.join(extract_dir, "uploads")
    rollback_root = os.path.join(os.path.dirname(db_file), "rollback", utcnow().strftime("restore-%Y%m%d-%H%M%S"))
    rollback_data = os.path.join(rollback_root, "data")
    rollback_uploads = os.path.join(rollback_root, "uploads")
    os.makedirs(rollback_data, exist_ok=True)

    rollback_db = os.path.join(rollback_data, "database.db")
    if os.path.exists(db_file):
        shutil.copy2(db_file, rollback_db)
    if os.path.exists(uploads_dir):
        shutil.copytree(uploads_dir, rollback_uploads, dirs_exist_ok=True)

    try:
        os.makedirs(os.path.dirname(db_file), exist_ok=True)
        os.makedirs(uploads_dir, exist_ok=True)

        # Copy restored files before switching the DB. Do not pre-clear uploads:
        # a failed restore must not leave image rows pointing at missing files.
        if os.path.exists(restore_uploads):
            copy_directory_contents(restore_uploads, uploads_dir)
        validate_uploads_available_for_db(restore_db, uploads_dir)

        shutil.copy2(restore_db, db_file)
        ensure_backup_run_progress_columns(db_file)
        sanitize_snapshot_db(db_file)
    except Exception:
        if os.path.exists(rollback_db):
            shutil.copy2(rollback_db, db_file)
        if os.path.exists(rollback_uploads):
            replace_directory_contents(rollback_uploads, uploads_dir)
        raise

    env_snapshot = os.path.join(extract_dir, "config", "fastimg-env.json")
    if os.path.exists(env_snapshot):
        shutil.copy2(env_snapshot, os.path.join(backup_config_dir(app), "restored-fastimg-env.json"))


def export_recovery_kit(app, password):
    cfg = get_backup_config()
    if not cfg.encrypted_identity:
        raise BackupError("Backup password has not been configured")
    decrypt_secret(cfg.encrypted_identity, password)
    payload = io.BytesIO()
    with tarfile.open(fileobj=payload, mode="w") as tar:
        identity_data = cfg.encrypted_identity.encode("utf-8")
        info = tarfile.TarInfo(IDENTITY_REMOTE_NAME)
        info.size = len(identity_data)
        tar.addfile(info, io.BytesIO(identity_data))

        rc_path = rclone_config_path(app)
        if os.path.exists(rc_path):
            tar.add(rc_path, arcname="rclone.conf")

        instructions = (
            "FastImg recovery kit\n"
            "1. Keep this file offline.\n"
            "2. On a new server, configure rclone or restore rclone.conf from this kit.\n"
            "3. Run scripts/restore-from-remote.sh with FASTIMG_BACKUP_PASSWORD set.\n"
            f"Configured remote: {cfg.remote_path or '(not configured)'}\n"
        ).encode("utf-8")
        info = tarfile.TarInfo("RECOVERY.md")
        info.size = len(instructions)
        tar.addfile(info, io.BytesIO(instructions))
    encrypted = encrypt_secret(payload.getvalue(), password).encode("utf-8")
    return encrypted


def scheduler_loop(app):
    with app.app_context():
        app.logger.info("FastImg backup scheduler started")
    while True:
        time.sleep(60)
        try:
            with app.app_context():
                cfg = get_backup_config()
                if not cfg.enabled or not cfg.remote_path or not cfg.encrypted_identity:
                    continue
                tz = ZoneInfo(cfg.timezone or "Asia/Shanghai")
                now = datetime.now(tz)
                today = now.strftime("%Y-%m-%d")
                if cfg.last_scheduled_for == today:
                    continue
                target = cfg.schedule_time or "03:30"
                if now.strftime("%H:%M") >= target:
                    cfg.last_scheduled_for = today
                    db.session.commit()
                    start_backup_async(app, trigger="scheduled")
        except Exception:
            with app.app_context():
                app.logger.exception("Backup scheduler tick failed")


def start_backup_scheduler(app):
    global _scheduler_started
    if os.environ.get("FASTIMG_ENABLE_BACKUP_SCHEDULER", "true").lower() != "true":
        return
    with _scheduler_lock:
        if _scheduler_started:
            return
        _scheduler_started = True
        thread = threading.Thread(target=scheduler_loop, args=(app,), daemon=True)
        thread.start()
