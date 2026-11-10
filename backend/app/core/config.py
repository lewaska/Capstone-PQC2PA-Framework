from pathlib import Path
import os

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


PROJECT_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=PROJECT_ROOT / "backend" / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    openssl_bin: str = (
        r"C:\Program Files\FireDaemon OpenSSL 3.5\bin\openssl.exe"
        if os.name == "nt" else "openssl"
    )

    mldsa_private_key_path: Path = (
        PROJECT_ROOT
        / "secrets"
        / "pki"
        / "claim-signer"
        / "claim-signer-private.pem"
    )
    mldsa_leaf_certificate_path: Path = (
        PROJECT_ROOT
        / "certs"
        / "public"
        / "claim-signer-cert.pem"
    )
    mldsa_root_certificate_path: Path = (
        PROJECT_ROOT
        / "certs"
        / "public"
        / "root-ca-cert.pem"
    )
    mldsa_private_key_passphrase: SecretStr | None = None
    openai_api_key: SecretStr | None = None
    openai_model: str | None = None

    es256_private_key_path: Path = (
        PROJECT_ROOT
        / "secrets"
        / "pki"
        / "c2pa-es256-claim"
        / "c2pa-es256-claim-private.pem"
    )
    es256_certificate_chain_path: Path = (
        PROJECT_ROOT
        / "certs"
        / "public"
        / "c2pa-es256-chain.pem"
    )
    c2pa_trust_anchor_path: Path = (
        PROJECT_ROOT
        / "certs"
        / "public"
        / "c2pa-es256-root-cert.pem"
    )

    tsa_private_key_path: Path = (
        PROJECT_ROOT
        / "secrets"
        / "pki"
        / "tsa-es256"
        / "tsa-es256-private.pem"
    )
    tsa_certificate_path: Path = (
        PROJECT_ROOT
        / "certs"
        / "public"
        / "tsa-es256-cert.pem"
    )
    tsa_root_certificate_path: Path = (
        PROJECT_ROOT
        / "certs"
        / "public"
        / "c2pa-es256-root-cert.pem"
    )
    tsa_serial_file_path: Path = (
        PROJECT_ROOT
        / "secrets"
        / "pki"
        / "tsa-es256"
        / "tsa-es256-serial"
    )
    tsa_config_path: Path = (
        PROJECT_ROOT
        / "scripts"
        / "pki"
        / "tsa-service.cnf"
    )
    tsa_private_key_passphrase: SecretStr | None = None

    pqc2pa_cli_path: Path = (
        PROJECT_ROOT
        / "native"
        / "pqc2pa-cli"
        / "target"
        / "debug"
        / ("pqc2pa-cli.exe" if os.name == "nt" else "pqc2pa-cli")
    )

    conversion_storage_path: Path = (
        PROJECT_ROOT / "runtime" / "conversions"
    )
settings = Settings()
