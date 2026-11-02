"""C2PA ISCC soft-binding fingerprint generation.

The public result from this module is shared by the classic and PQC manifest
builders. Do not calculate the two manifest fingerprints independently.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import iscc_core as ic
import iscc_sdk as idk


SOFT_BINDING_ALGORITHM = "io.iscc.v0"
SOFT_BINDING_LABEL = "c2pa.soft-binding"
ISCC_UNIT_BITS = 256


class FingerprintGenerationError(Exception):
    """An asset could not be converted into an ISCC soft binding."""


@dataclass(frozen=True, slots=True)
class SoftBindingFingerprint:
    """Canonical ISCC-SEQ used by both manifests and the DB lookup."""

    units: tuple[str, ...]
    value: bytes
    algorithm: str = SOFT_BINDING_ALGORITHM

    @property
    def value_base64(self) -> str:
        """RFC 4648 base64 value used by the resolution API and DB."""

        return base64.b64encode(self.value).decode("ascii")

    @property
    def display(self) -> str:
        """Human-readable form of the complete ISCC-SEQ."""

        return "ISCC:" + ic.encode_base32(self.value)

    def assertion_definition(self) -> dict[str, Any]:
        """Return a c2pa-rs/c2pa-python manifest assertion definition.

        The integer list is the JSON representation accepted by c2pa-rs.
        Current c2pa-rs versions serialize it as the CBOR byte string required
        by IEP-0020; older readers may expose the value as an integer list.
        """

        return {
            "label": SOFT_BINDING_LABEL,
            "created": True,
            "data": {
                "alg": self.algorithm,
                "blocks": [
                    {
                        "scope": {},
                        "value": list(self.value),
                    }
                ],
            },
        }

    def as_dict(self) -> dict[str, Any]:
        """Return the API/DB representation without losing canonical bytes."""

        return {
            "algorithm": self.algorithm,
            "units": list(self.units),
            "value_base64": self.value_base64,
            "display": self.display,
            "assertion": self.assertion_definition(),
        }


def generate_image_fingerprint(image_path: Path) -> SoftBindingFingerprint:
    """Generate an IEP-0020 ISCC soft binding for the final image rendition.

    The sequence contains 256-bit Image-, Data- and Instance-Code units. The
    semantic unit is intentionally disabled so the backend does not require a
    machine-learning model and every deployment derives the same baseline.
    """

    path = Path(image_path)
    if not path.is_file():
        raise FingerprintGenerationError(f"이미지 파일이 없습니다: {path}")

    try:
        image_unit = idk.code_image(
            path,
            bits=ISCC_UNIT_BITS,
            extract_meta=False,
            create_thumb=False,
        ).iscc
        data_unit = idk.code_data(path, bits=ISCC_UNIT_BITS).iscc
        instance_unit = idk.code_instance(path, bits=ISCC_UNIT_BITS).iscc

        units = (image_unit, data_unit, instance_unit)
        if not all(isinstance(unit, str) and unit for unit in units):
            raise ValueError("ISCC SDK가 완전한 unit을 반환하지 않았습니다.")

        value = ic.encode_seq(units)
        if tuple(ic.decode_seq(value)) != units:
            raise ValueError("생성한 ISCC-SEQ를 다시 해석할 수 없습니다.")

        return SoftBindingFingerprint(units=units, value=value)
    except FingerprintGenerationError:
        raise
    except Exception as exc:
        raise FingerprintGenerationError(
            "이미지의 ISCC 소프트바인딩 핑거프린트를 생성하지 못했습니다."
        ) from exc
