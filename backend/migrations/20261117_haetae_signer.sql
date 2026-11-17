-- HAETAE P1 uses a pinned raw public key, not an X.509 certificate.
-- Classic signatures keep their existing signer certificate references.
ALTER TABLE pq_c2pa.signatures
    ALTER COLUMN signer_certificate_id DROP NOT NULL;
ALTER TABLE pq_c2pa.signatures
    ADD CONSTRAINT signatures_haetae_credential_check
    CHECK (algorithm <> 'HAETAE-3' OR
           (signer_certificate_id IS NULL AND key_reference LIKE 'haetae3:sha256:%'));

-- Retain the certificate-chain gate for Classic manifests. For the detached
-- project P1, require its HAETAE raw-key reference instead.
DO $migration$
DECLARE
    definition text;
    old_gate text := 'WHERE s.manifest_id=required.mid)';
    new_gate text := 'WHERE s.manifest_id=required.mid)
        AND NOT (required.mid=q.id AND EXISTS(
            SELECT 1 FROM signatures hs WHERE hs.manifest_id=q.id
            AND hs.algorithm=''HAETAE-3'' AND hs.signer_certificate_id IS NULL
            AND hs.key_reference LIKE ''haetae3:sha256:%''))';
BEGIN
    SELECT pg_get_functiondef('pq_c2pa.activate_registration(uuid,uuid,uuid)'::regprocedure)
    INTO definition;
    IF definition IS NULL OR strpos(definition, old_gate) = 0 THEN
        RAISE EXCEPTION 'activate_registration certificate gate was not found';
    END IF;
    EXECUTE replace(definition, old_gate, new_gate);
END
$migration$;
