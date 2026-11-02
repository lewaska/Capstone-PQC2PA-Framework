use std::{fs, io::Cursor, path::Path};

use anyhow::{bail, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use c2pa::{jumbf_io, Context as C2paContext, Reader};
use coset::{cbor::value::Value as CborValue, CoseSign1, Label, TaggedCborSerializable};
use serde::Serialize;
use serde_json::Value as JsonValue;

#[derive(Debug, Serialize)]
struct TimestampEvidence {
    kind: String,
    token_base64: String,
}

#[derive(Debug, Serialize)]
struct ExtractedAssertion {
    label: String,
    representation: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<JsonValue>,

    #[serde(skip_serializing_if = "Option::is_none")]
    payload_base64: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    payload_length: Option<usize>,
}

#[derive(Debug, Serialize)]
struct ClassicExtraction {
    active_manifest: String,
    signature_base64: String,
    cose_sign1_base64: String,
    timestamp: Option<TimestampEvidence>,

    /*
     * Reader의 일반 표시용 active manifest.
     */
    manifest: JsonValue,

    /*
     * 원본 Claim의 의미 데이터.
     * PQC Claim은 이 데이터를 기반으로 새로 구성한다.
     */
    claim: JsonValue,

    /*
     * created_assertions 순서대로 추출한 assertion 데이터.
     */
    assertions: Vec<ExtractedAssertion>,

    validation_results: JsonValue,
}

pub fn extract_classic(input: &Path, output: &Path) -> Result<()> {
    if !input.is_file() {
        bail!("입력 이미지가 없습니다: {}", input.display());
    }

    let reader = Reader::from_context(C2paContext::new())
        .with_file(input)
        .with_context(|| format!("C2PA 이미지를 읽지 못했습니다: {}", input.display()))?;

    let active = reader
        .active_manifest()
        .context("active manifest를 찾지 못했습니다.")?;

    let active_manifest = active
        .label()
        .context("active manifest label이 없습니다.")?
        .to_owned();

    let active_signature = active
        .signature()
        .context("active manifest의 signature 필드가 없습니다.")?
        .to_vec();

    let manifest =
        serde_json::to_value(active).context("active manifest를 JSON으로 변환하지 못했습니다.")?;

    let validation_results = serde_json::to_value(reader.validation_results())
        .context("검증 결과를 JSON으로 변환하지 못했습니다.")?;

    /*
     * detailed_json에는 hard binding을 포함한 assertion store와
     * Claim의 created_assertions 순서가 들어 있다.
     */
    let (claim, assertions) = extract_claim_and_assertions(&reader, &active_manifest)?;

    /*
     * Reader JSON에는 sigTst2 원본 토큰이 없으므로 JUMBF 내부의
     * active COSE_Sign1을 찾아 unprotected header를 직접 읽는다.
     */
    let jumbf = jumbf_io::load_jumbf_from_file(input)
        .with_context(|| format!("JUMBF store를 읽지 못했습니다: {}", input.display()))?;

    let (cose_bytes, cose_sign1) = find_active_cose_sign1(&jumbf, &active_signature)?;

    let timestamp = extract_timestamp(&cose_sign1)?;

    let result = ClassicExtraction {
        active_manifest,
        signature_base64: STANDARD.encode(&active_signature),
        cose_sign1_base64: STANDARD.encode(&cose_bytes),
        timestamp,
        manifest,
        claim,
        assertions,
        validation_results,
    };

    if let Some(parent) = output.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).with_context(|| {
                format!("출력 디렉터리를 만들지 못했습니다: {}", parent.display())
            })?;
        }
    }

    let json = serde_json::to_vec_pretty(&result)
        .context("추출 결과를 JSON으로 직렬화하지 못했습니다.")?;

    fs::write(output, json)
        .with_context(|| format!("결과 파일을 쓰지 못했습니다: {}", output.display()))?;

    println!("ACTIVE_MANIFEST={}", result.active_manifest);
    println!("ASSERTIONS={}", result.assertions.len());
    println!(
        "TIMESTAMP={}",
        result
            .timestamp
            .as_ref()
            .map(|value| value.kind.as_str())
            .unwrap_or("NONE")
    );
    println!("OUTPUT={}", output.display());

    Ok(())
}

fn extract_claim_and_assertions(
    reader: &Reader,
    active_manifest: &str,
) -> Result<(JsonValue, Vec<ExtractedAssertion>)> {
    let detailed: JsonValue = serde_json::from_str(&reader.detailed_json())
        .context("Reader detailed_json을 해석하지 못했습니다.")?;

    let manifest_report = detailed
        .get("manifests")
        .and_then(JsonValue::as_object)
        .and_then(|manifests| manifests.get(active_manifest))
        .with_context(|| {
            format!(
                "detailed_json에서 active manifest를 찾지 못했습니다: \
                 {active_manifest}"
            )
        })?;

    let claim = manifest_report
        .get("claim")
        .context("detailed_json에 Claim이 없습니다.")?
        .clone();

    let assertion_store = manifest_report
        .get("assertion_store")
        .and_then(JsonValue::as_object)
        .context("detailed_json에 assertion_store가 없습니다.")?;

    let created_assertions = claim
        .get("created_assertions")
        .and_then(JsonValue::as_array)
        .context("Claim에 created_assertions가 없습니다.")?;

    let mut assertions = Vec::with_capacity(created_assertions.len());

    for assertion_reference in created_assertions {
        let url = assertion_reference
            .get("url")
            .and_then(JsonValue::as_str)
            .context("created_assertions 항목에 url이 없습니다.")?;

        let label = url
            .rsplit('/')
            .next()
            .filter(|value| !value.is_empty())
            .context("assertion URL에서 label을 찾지 못했습니다.")?
            .to_owned();

        let stored_value = assertion_store.get(&label).with_context(|| {
            format!(
                "assertion_store에서 assertion을 찾지 못했습니다: \
                     {label}"
            )
        })?;

        /*
         * Binary assertion은 detailed_json에서
         * "<omitted> len = N"으로 표시된다.
         *
         * 이 경우 resource_to_stream을 이용해 원본 바이트를 가져온다.
         */
        let is_omitted_binary = stored_value
            .as_str()
            .map(|value| value.starts_with("<omitted>"))
            .unwrap_or(false);

        if is_omitted_binary {
            let mut stream = Cursor::new(Vec::<u8>::new());

            let reported_length = reader
                .resource_to_stream(url, &mut stream)
                .with_context(|| format!("binary assertion을 읽지 못했습니다: {label}"))?;

            let payload = stream.into_inner();

            if reported_length != payload.len() {
                bail!(
                    "binary assertion 길이가 일치하지 않습니다: \
                     {label}, reported={reported_length}, \
                     actual={}",
                    payload.len()
                );
            }

            assertions.push(ExtractedAssertion {
                label,
                representation: "binary".to_owned(),
                data: None,
                payload_base64: Some(STANDARD.encode(&payload)),
                payload_length: Some(payload.len()),
            });
        } else {
            assertions.push(ExtractedAssertion {
                label,
                representation: "structured".to_owned(),
                data: Some(stored_value.clone()),
                payload_base64: None,
                payload_length: None,
            });
        }
    }

    Ok((claim, assertions))
}

fn find_active_cose_sign1(jumbf: &[u8], active_signature: &[u8]) -> Result<(Vec<u8>, CoseSign1)> {
    for offset in 0..jumbf.len() {
        /*
         * Canonical CBOR에서 COSE_Sign1 tag 18은 0xD2이다.
         */
        if jumbf[offset] != 0xD2 {
            continue;
        }

        let mut remaining = &jumbf[offset..];
        let original_length = remaining.len();

        let decoded: Result<CborValue, _> = coset::cbor::from_reader(&mut remaining);

        if decoded.is_err() {
            continue;
        }

        let consumed = original_length - remaining.len();

        if consumed == 0 || offset + consumed > jumbf.len() {
            continue;
        }

        let candidate = &jumbf[offset..offset + consumed];

        let sign1 = match CoseSign1::from_tagged_slice(candidate) {
            Ok(value) => value,
            Err(_) => continue,
        };

        /*
         * JUMBF에 여러 COSE가 있을 수 있으므로 active manifest의
         * signature 필드와 일치하는 COSE만 선택한다.
         */
        if sign1.signature == active_signature {
            return Ok((candidate.to_vec(), sign1));
        }
    }

    bail!("active manifest에 대응하는 COSE_Sign1을 찾지 못했습니다.")
}

fn extract_timestamp(sign1: &CoseSign1) -> Result<Option<TimestampEvidence>> {
    let timestamp_header = sign1
        .unprotected
        .rest
        .iter()
        .find_map(|(label, value)| match label {
            Label::Text(text) if text == "sigTst2" => Some(("sigTst2", value)),
            Label::Text(text) if text == "sigTst" => Some(("sigTst", value)),
            _ => None,
        });

    let Some((kind, container_value)) = timestamp_header else {
        return Ok(None);
    };

    let container = match container_value {
        CborValue::Map(value) => value,
        _ => bail!("{kind} header가 CBOR map이 아닙니다."),
    };

    let tokens_value = map_value(container, "tstTokens")
        .with_context(|| format!("{kind} header에 tstTokens가 없습니다."))?;

    let tokens = match tokens_value {
        CborValue::Array(value) => value,
        _ => bail!("{kind}.tstTokens가 배열이 아닙니다."),
    };

    if tokens.len() != 1 {
        bail!(
            "{kind}.tstTokens에는 토큰이 정확히 하나 있어야 합니다: {}",
            tokens.len()
        );
    }

    let token_map = match &tokens[0] {
        CborValue::Map(value) => value,
        _ => bail!("{kind}.tstTokens[0]이 CBOR map이 아닙니다."),
    };

    let token_value = map_value(token_map, "val")
        .with_context(|| format!("{kind}.tstTokens[0].val이 없습니다."))?;

    let token = match token_value {
        CborValue::Bytes(value) => value,
        _ => {
            bail!("{kind}.tstTokens[0].val이 byte string이 아닙니다.")
        }
    };

    Ok(Some(TimestampEvidence {
        kind: kind.to_owned(),
        token_base64: STANDARD.encode(token),
    }))
}

fn map_value<'a>(values: &'a [(CborValue, CborValue)], target: &str) -> Option<&'a CborValue> {
    values.iter().find_map(|(key, value)| match key {
        CborValue::Text(text) if text == target => Some(value),
        _ => None,
    })
}
