"""HAETAE-3 detached signatures using the official 1.2.0 C reference library.

The library must be built from the pinned upstream archive. Secret keys are
encrypted at rest with an independently configured AES-256-GCM key.
"""
from __future__ import annotations

import base64
import ctypes
import os
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.core.config import settings

PUBLIC_BYTES = 1472
SECRET_BYTES = 2112
SIGNATURE_BYTES = 2349
CONTEXT = b"PQ-C2PA-P1-HAETAE3-v1"
_AAD = b"HAETAE3-P1-PRIVATE-KEY-v1"


def _library():
    lib = ctypes.CDLL(str(settings.haetae_library_path))
    ptr = ctypes.c_void_p
    lib.cryptolab_haetae_mode3_keypair.argtypes = [ptr, ptr]
    lib.cryptolab_haetae_mode3_keypair.restype = ctypes.c_int
    lib.cryptolab_haetae_mode3_signature.argtypes = [
        ptr, ctypes.POINTER(ctypes.c_size_t), ptr, ctypes.c_size_t,
        ptr, ctypes.c_size_t, ptr,
    ]
    lib.cryptolab_haetae_mode3_signature.restype = ctypes.c_int
    lib.cryptolab_haetae_mode3_verify.argtypes = [
        ptr, ctypes.c_size_t, ptr, ctypes.c_size_t, ptr, ctypes.c_size_t, ptr,
    ]
    lib.cryptolab_haetae_mode3_verify.restype = ctypes.c_int
    return lib


def _encryption_key() -> bytes:
    configured = settings.haetae_key_encryption_key
    if configured is None:
        raise ValueError("HAETAE_KEY_ENCRYPTION_KEY is not configured")
    key = base64.b64decode(configured.get_secret_value(), validate=True)
    if len(key) != 32:
        raise ValueError("HAETAE_KEY_ENCRYPTION_KEY must contain 32 bytes")
    return key


def generate_keypair(public_path: Path, private_path: Path) -> None:
    """Run once during provisioning; never replace an existing signer key."""
    if public_path.exists() or private_path.exists():
        raise FileExistsError("HAETAE signer key already exists")
    public = ctypes.create_string_buffer(PUBLIC_BYTES)
    secret = ctypes.create_string_buffer(SECRET_BYTES)
    if _library().cryptolab_haetae_mode3_keypair(public, secret) != 0:
        raise ValueError("HAETAE key generation failed")
    nonce = os.urandom(12)
    encrypted = nonce + AESGCM(_encryption_key()).encrypt(nonce, secret.raw, _AAD)
    public_path.parent.mkdir(parents=True, exist_ok=True)
    private_path.parent.mkdir(parents=True, exist_ok=True)
    with private_path.open("xb") as stream:
        stream.write(encrypted)
    with public_path.open("xb") as stream:
        stream.write(public.raw)
    private_path.chmod(0o600)


def public_key() -> bytes:
    key = settings.haetae_public_key_path.read_bytes()
    if len(key) != PUBLIC_BYTES:
        raise ValueError("Invalid pinned HAETAE-3 public key")
    return key


def sign(message: bytes) -> bytes:
    raw = settings.haetae_private_key_path.read_bytes()
    if len(raw) < 29:
        raise ValueError("Invalid encrypted HAETAE signer key")
    secret = AESGCM(_encryption_key()).decrypt(raw[:12], raw[12:], _AAD)
    if len(secret) != SECRET_BYTES:
        raise ValueError("Invalid HAETAE signer key length")
    signature = ctypes.create_string_buffer(SIGNATURE_BYTES)
    length = ctypes.c_size_t()
    result = _library().cryptolab_haetae_mode3_signature(
        signature, ctypes.byref(length), ctypes.c_char_p(message), len(message),
        ctypes.c_char_p(CONTEXT), len(CONTEXT), ctypes.c_char_p(secret),
    )
    if result != 0 or length.value != SIGNATURE_BYTES:
        raise ValueError("HAETAE-3 signing failed")
    return signature.raw


def verify(message: bytes, signature: bytes) -> bool:
    if len(signature) != SIGNATURE_BYTES:
        return False
    result = _library().cryptolab_haetae_mode3_verify(
        ctypes.c_char_p(signature), len(signature), ctypes.c_char_p(message),
        len(message), ctypes.c_char_p(CONTEXT), len(CONTEXT),
        ctypes.c_char_p(public_key()),
    )
    return result == 0
