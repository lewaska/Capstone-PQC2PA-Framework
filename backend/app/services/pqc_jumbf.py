"""C2PA 2.3 section 8.4 URI resolution and JUMBF hashing primitives.

SHA3-256 is the explicit project algorithm extension. No wrapper-map hashing.
"""
import hashlib
import struct
from app.services.pqc_source import Box, PqcSourceError, child_map

UUID_SUFFIX = bytes.fromhex("00110010800000aa00389b71")


def content_box(kind: bytes, payload: bytes) -> bytes:
    if len(kind) != 4 or len(payload) + 8 >= 2**32:
        raise PqcSourceError("Invalid or oversized ISO box")
    return struct.pack(">I4s", len(payload) + 8, kind) + payload


def superbox(label: str, content_type: bytes, children: list[bytes]) -> bytes:
    if not label or "\x00" in label or "/" in label or len(content_type) != 4:
        raise PqcSourceError("Invalid JUMBF label or content type")
    description = content_type + UUID_SUFFIX + b"\x03" + label.encode("utf-8") + b"\x00"
    return content_box(b"jumb", content_box(b"jumd", description) + b"".join(children))


def require_type(box: Box, content_type: bytes) -> None:
    from app.services.pqc_source import boxes
    children = boxes(box.payload)
    if (box.kind != b"jumb" or not children or children[0].kind != b"jumd"
            or children[0].payload[:16] != content_type + UUID_SUFFIX):
        raise PqcSourceError("Unexpected JUMBF content UUID")


def hash_superbox(box: Box, algorithm: str) -> bytes:
    if box.kind != b"jumb":
        raise PqcSourceError("Hashed URI target must be a JUMBF superbox")
    algorithms = {"sha256": "sha256", "sha384": "sha384", "sha512": "sha512",
                  "sha3-256": "sha3_256"}
    if algorithm not in algorithms:
        raise PqcSourceError("Unsupported hashed URI algorithm")
    # Section 8.4.2.3: description and content boxes, excluding superbox header.
    return hashlib.new(algorithms[algorithm], box.payload).digest()


def resolve_uri(store: Box, manifest: Box, uri: str) -> Box:
    if not isinstance(uri, str) or not uri.startswith("self#jumbf="):
        raise PqcSourceError("Only internal JUMBF URIs are supported")
    path = uri[len("self#jumbf="):]
    if not path or ".." in path or "%" in path or "\\" in path:
        raise PqcSourceError("Invalid JUMBF URI")
    if path.startswith("/"):
        parts = path.split("/")
        if len(parts) < 3 or parts[1] != "c2pa":
            raise PqcSourceError("URI outside Manifest Store")
        current, parts = store, parts[2:]
    else:
        current, parts = manifest, path.split("/")
    for label in parts:
        if not label:
            raise PqcSourceError("Empty JUMBF path component")
        children = child_map(current)
        if label not in children:
            raise PqcSourceError("JUMBF URI target missing")
        current = children[label]
    return current


def verify_reference(store: Box, manifest: Box, reference: dict, default_alg: str) -> Box:
    if not isinstance(reference, dict) or not isinstance(reference.get("hash"), bytes):
        raise PqcSourceError("Malformed hashed URI")
    target = resolve_uri(store, manifest, reference.get("url"))
    if hash_superbox(target, reference.get("alg", default_alg)) != reference["hash"]:
        raise PqcSourceError("assertion.hashedURI.mismatch")
    return target
