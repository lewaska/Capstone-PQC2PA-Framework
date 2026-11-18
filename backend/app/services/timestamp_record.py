"""Read RFC 3161 token metadata for the project evidence tables."""
from __future__ import annotations

import hashlib
import os
import re
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from tempfile import TemporaryDirectory

from app.core.config import settings
from app.services.rfc3161 import _tsa_environment


@dataclass(frozen=True)
class TimestampRecord:
    generation_time: datetime
    serial_hex: str
    policy_oid: str
    message_imprint_algorithm: str
    message_imprint: bytes


def read_timestamp_record(token: bytes, timestamped_payload: bytes) -> TimestampRecord:
    """Decode a token and reject a mismatch between its imprint and signed input."""
    with TemporaryDirectory(prefix="pqc2pa-ts-read-") as directory:
        path = Path(directory) / "token.tst"
        path.write_bytes(token)
        result = subprocess.run(
            [str(settings.openssl_bin), "ts", "-reply", "-token_in", "-in",
             str(path), "-text", "-config", str(settings.tsa_config_path)],
            capture_output=True, text=True, timeout=30, check=False,
            env={**os.environ, **_tsa_environment()},
        )
    if result.returncode != 0:
        raise ValueError("RFC 3161 token cannot be decoded")
    output = result.stdout

    def field(pattern: str) -> str:
        match = re.search(pattern, output, re.MULTILINE | re.IGNORECASE)
        if match is None:
            raise ValueError("RFC 3161 token is missing required metadata")
        return match.group(1).strip()

    algorithm = field(r"^Hash Algorithm:\s*(\S+)").lower()
    try:
        expected = hashlib.new(algorithm, timestamped_payload).digest()
    except ValueError as exc:
        raise ValueError("Unsupported RFC 3161 imprint algorithm") from exc
    raw_imprint = field(r"^Message data:\s*\n((?:\s*[0-9a-f]{4}\s*-.*\n?)+)")
    imprint = bytes.fromhex("".join(
        line.split("-", 1)[1].split("   ", 1)[0].replace("-", "")
        for line in raw_imprint.splitlines()
    ))
    if imprint != expected:
        raise ValueError("RFC 3161 message imprint differs from signed input")
    timestamp = parsedate_to_datetime(field(r"^Time stamp:\s*(.+)$"))
    if timestamp.tzinfo is None:
        timestamp = timestamp.replace(tzinfo=timezone.utc)
    serial = field(r"^Serial number:\s*(?:0x)?([0-9a-f]+)")
    return TimestampRecord(
        generation_time=timestamp.astimezone(timezone.utc),
        serial_hex=serial.lower(),
        policy_oid=field(r"^Policy OID:\s*(\S+)"),
        message_imprint_algorithm=algorithm,
        message_imprint=imprint,
    )
