from pathlib import Path

import pytest

from app.services.pqc2pa import PROFILE, PqcBuildError, decode_p1_cbor, encode, verify_p1


@pytest.mark.parametrize('raw', [b'\xa0\x00', b'\xa2\x61a\x01\x61a\x02'])
def test_rejects_trailing_bytes_and_duplicate_keys(raw):
    with pytest.raises(PqcBuildError):
        decode_p1_cbor(raw)


@pytest.mark.parametrize('claim', [[], {'profile': 'wrong'}, {'profile': PROFILE, 'hash_algorithm': 'sha256'}])
def test_invalid_claim_fails_before_crypto_or_asset_access(claim):
    artifact = encode({'profile': PROFILE, 'claim': encode(claim), 'assertions': []})
    with pytest.raises(PqcBuildError):
        verify_p1(artifact, Path('does-not-exist.png'))
