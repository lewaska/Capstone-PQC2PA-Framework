# PQ-C2PA Dual-Manifest Profile

Status: architecture draft. Byte-level rules will be fixed before the PQC
builder and verifier are implemented.

## 1. Purpose

The system keeps the conventional C2PA provenance path and creates a separate
PQC manifest. It does not replace or remove the source manifest store.

The two generated manifests share the same image fingerprint:

- a standard C2PA update manifest signed with the conventional algorithm; and
- a PQC manifest using SHA3-256 and ML-DSA-65.

Both manifest artifacts are stored as one pair in the database.

## 2. Standard C2PA branch

- Validate the source with the official C2PA SDK.
- Create an update manifest.
- Add one `parentOf` ingredient referencing the source active manifest.
- Add a `c2pa.soft-binding` assertion containing the shared fingerprint.
- Sign with the configured conventional C2PA credential.
- Validate with the configured SDK trust anchors.

## 3. PQC branch

- Read transferable assertion data from the validated source.
- Add the same fingerprint used by the standard update manifest.
- Use SHA3-256 for the PQC claim and assertion reference profile.
- Sign the PQC claim with ML-DSA-65.
- Add and independently verify an RFC 3161 timestamp.
- Validate the structure, assertion references, signature, certificate path,
  timestamp token, and TSA certificate path with the project verifier.

## 4. Storage and verification

The database stores the standard and PQC manifest bytes, their digests, the
shared fingerprint, validation status, and issuance metadata as one logical
record.

On a later upload, the server recomputes the fingerprint, resolves the stored
pair, validates both manifests, and compares their shared provenance data.

The target detections are:

- conventional manifest or metadata tampering;
- forged or rewritten conventional provenance;
- invalid PQC signatures or timestamps; and
- missing or stripped embedded manifests when a stored fingerprint match is
  available.

## 5. Supported files and cryptography

- Initial asset formats: JPEG and PNG
- PQC hash: SHA3-256
- PQC claim signature: ML-DSA-65
- Key formats: PKCS#8 and SubjectPublicKeyInfo
- Cryptographic provider: OpenSSL 3.5 or later

## 6. Pending byte-level decisions

- Fingerprint algorithm and exact assertion value encoding
- Transferable assertion policy
- PQC claim field set and deterministic CBOR rules
- JUMBF layout and manifest identifier
- COSE protected headers and certificate-chain representation
- RFC 3161 message-imprint construction
- Cross-manifest semantic comparison rules
- Database record and retention policy
