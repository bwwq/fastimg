#!/usr/bin/env python3
import argparse
import base64
import hashlib
import json
import os
import sqlite3
import tarfile
from pathlib import Path

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt


AD = b"fastimg-backup-v1"


def unb64(value):
    return base64.b64decode(value.encode("ascii"))


def derive_key(password, salt):
    kdf = Scrypt(salt=salt, length=32, n=2 ** 14, r=8, p=1)
    return kdf.derive(password.encode("utf-8"))


def decrypt_secret(blob, password):
    try:
        payload = json.loads(blob)
        key = derive_key(password, unb64(payload["salt"]))
        cipher = AESGCM(key)
        return cipher.decrypt(unb64(payload["nonce"]), unb64(payload["ciphertext"]), AD)
    except (KeyError, ValueError, InvalidTag) as exc:
        raise SystemExit("Backup password is incorrect or encrypted identity is corrupted") from exc


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def safe_extract(tar_path, dest):
    dest_real = os.path.realpath(dest)
    with tarfile.open(tar_path, "r") as tar:
        for member in tar.getmembers():
            if member.issym() or member.islnk():
                raise SystemExit(f"Unsupported link entry in archive: {member.name}")
            member_path = os.path.realpath(os.path.join(dest, member.name))
            if not member_path.startswith(dest_real + os.sep) and member_path != dest_real:
                raise SystemExit(f"Unsafe path in archive: {member.name}")
        tar.extractall(dest)


def safe_extract_bytes(data, dest):
    dest_real = os.path.realpath(dest)
    import io
    with tarfile.open(fileobj=io.BytesIO(data), mode="r") as tar:
        for member in tar.getmembers():
            if member.issym() or member.islnk():
                raise SystemExit(f"Unsupported link entry in recovery kit: {member.name}")
            member_path = os.path.realpath(os.path.join(dest, member.name))
            if not member_path.startswith(dest_real + os.sep) and member_path != dest_real:
                raise SystemExit(f"Unsafe path in recovery kit: {member.name}")
        tar.extractall(dest)


def upload_file_path(uploads_dir, filename):
    if not filename or os.path.isabs(filename) or os.path.basename(filename) != filename:
        raise SystemExit(f"Unsafe upload filename in database: {filename}")
    return os.path.join(uploads_dir, filename)


def validate(dest):
    manifest_path = os.path.join(dest, "manifest.json")
    db_path = os.path.join(dest, "data", "database.db")
    uploads_dir = os.path.join(dest, "uploads")
    if not os.path.isfile(manifest_path) or not os.path.isfile(db_path):
        raise SystemExit("Backup is missing manifest.json or data/database.db")

    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    if sha256_file(db_path) != manifest["database"]["sha256"]:
        raise SystemExit("Database checksum mismatch")

    for item in manifest.get("uploads", []):
        path = upload_file_path(uploads_dir, item["filename"])
        if not os.path.isfile(path):
            raise SystemExit(f"Missing upload file: {item['filename']}")
        if sha256_file(path) != item["sha256"]:
            raise SystemExit(f"Upload checksum mismatch: {item['filename']}")

    conn = sqlite3.connect(db_path)
    try:
        cur = conn.cursor()
        cur.execute("SELECT filename FROM image")
        filenames = [row[0] for row in cur.fetchall()]
    finally:
        conn.close()

    missing = [name for name in filenames if not os.path.isfile(upload_file_path(uploads_dir, name))]
    if missing:
        raise SystemExit("Restored database references missing files: " + ", ".join(missing[:10]))


def validate_db_uploads(args):
    db_path = args.db
    uploads_dir = args.uploads
    if not os.path.isfile(db_path):
        raise SystemExit(f"Database not found: {db_path}")
    if not os.path.isdir(uploads_dir):
        raise SystemExit(f"Uploads directory not found: {uploads_dir}")

    conn = sqlite3.connect(db_path)
    try:
        cur = conn.cursor()
        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='image'")
        if not cur.fetchone():
            return
        cur.execute("SELECT filename FROM image")
        filenames = [row[0] for row in cur.fetchall()]
    finally:
        conn.close()

    missing = [name for name in filenames if not os.path.isfile(upload_file_path(uploads_dir, name))]
    if missing:
        raise SystemExit(
            f"Database references missing {len(missing)} upload file(s): " + ", ".join(missing[:10])
        )


def sanitize_db(args):
    db_path = args.db
    if not os.path.isfile(db_path):
        raise SystemExit(f"Database not found: {db_path}")

    conn = sqlite3.connect(db_path)
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


def decrypt_identity(args):
    with open(args.input, "r", encoding="utf-8") as f:
        blob = f.read()
    identity = decrypt_secret(blob, args.password)
    with open(args.output, "wb") as f:
        f.write(identity)


def extract_validate(args):
    os.makedirs(args.dest, exist_ok=True)
    safe_extract(args.tar, args.dest)
    validate(args.dest)


def write_env(args):
    env_snapshot = os.path.join(args.extract, "config", "fastimg-env.json")
    if not os.path.exists(env_snapshot):
        return

    with open(env_snapshot, "r", encoding="utf-8") as f:
        data = json.load(f)

    secret = data.get("SECRET_KEY")
    if not secret:
        return

    env_path = Path(args.env)
    existing = env_path.read_text(encoding="utf-8") if env_path.exists() else ""
    lines = [line for line in existing.splitlines() if not line.startswith("SECRET_KEY=")]
    lines.append(f"SECRET_KEY={secret}")
    env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def unpack_kit(args):
    with open(args.input, "r", encoding="utf-8") as f:
        blob = f.read()
    data = decrypt_secret(blob, args.password)
    os.makedirs(args.dest, exist_ok=True)
    safe_extract_bytes(data, args.dest)


def main():
    parser = argparse.ArgumentParser(description="FastImg disaster recovery helper")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("decrypt-identity")
    p.add_argument("--password", required=True)
    p.add_argument("--input", required=True)
    p.add_argument("--output", required=True)
    p.set_defaults(func=decrypt_identity)

    p = sub.add_parser("extract-validate")
    p.add_argument("--tar", required=True)
    p.add_argument("--dest", required=True)
    p.set_defaults(func=extract_validate)

    p = sub.add_parser("write-env")
    p.add_argument("--extract", required=True)
    p.add_argument("--env", required=True)
    p.set_defaults(func=write_env)

    p = sub.add_parser("validate-db-uploads")
    p.add_argument("--db", required=True)
    p.add_argument("--uploads", required=True)
    p.set_defaults(func=validate_db_uploads)

    p = sub.add_parser("sanitize-db")
    p.add_argument("--db", required=True)
    p.set_defaults(func=sanitize_db)

    p = sub.add_parser("unpack-kit")
    p.add_argument("--password", required=True)
    p.add_argument("--input", required=True)
    p.add_argument("--dest", required=True)
    p.set_defaults(func=unpack_kit)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
