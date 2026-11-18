import hashlib
import pytest
from app.services.pqc_source import Box, PqcSourceError
from app.services.pqc_jumbf import hash_superbox, resolve_uri


def test_hash_excludes_superbox_header_but_includes_all_content():
    payload = b'description-and-content'
    box = Box(b'jumb', b'header' + payload, payload)
    assert hash_superbox(box, 'sha3-256') == hashlib.sha3_256(payload).digest()
    assert hash_superbox(box, 'sha256') == hashlib.sha256(payload).digest()


@pytest.mark.parametrize('uri', ['https://example.org', 'self#jumbf=../secret', 'self#jumbf=/elsewhere/a', 'self#jumbf='])
def test_rejects_external_and_invalid_paths(uri):
    box = Box(b'jumb', b'', b'')
    with pytest.raises(PqcSourceError):
        resolve_uri(box, box, uri)
