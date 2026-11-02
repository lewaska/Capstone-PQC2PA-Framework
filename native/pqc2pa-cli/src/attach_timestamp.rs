use anyhow::{anyhow, bail, Context, Result};
use c2pa::{jumbf_io, Context as C2paContext, Reader};
use coset::{
    cbor::value::Value as CborValue, sig_structure_data, CoseSign1, Label, SignatureContext,
    TaggedCborSerializable,
};
use std::{fs, path::Path};

pub fn write_timestamp_input(input: &Path, output: &Path) -> Result<()> {
    let (sign1, _, _) = load_active_cose(input)?;

    // sigTst2는 raw signature가 아니라 CBOR byte string으로
    // 직렬화한 signature를 CounterSignature 구조에 넣는다.
    let mut signature_cbor = Vec::new();
    coset::cbor::into_writer(
        &CborValue::Bytes(sign1.signature.clone()),
        &mut signature_cbor,
    )
    .context("signature를 CBOR byte string으로 만들지 못했습니다.")?;

    let timestamp_input = sig_structure_data(
        SignatureContext::CounterSignature,
        sign1.protected.clone(),
        None,
        &[],
        &signature_cbor,
    );

    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent)?;
    }

    fs::write(output, &timestamp_input).context("timestamp 입력 파일을 쓰지 못했습니다.")?;

    println!("TIMESTAMP_INPUT_BYTES={}", timestamp_input.len());
    println!("OUTPUT={}", output.display());

    Ok(())
}

pub fn attach_timestamp(input: &Path, output: &Path, token_path: &Path) -> Result<()> {
    if output.exists() {
        bail!("출력 파일이 이미 존재합니다: {}", output.display());
    }

    let token = fs::read(token_path)
        .with_context(|| format!("RFC 3161 token을 읽지 못했습니다: {}", token_path.display()))?;

    if token.is_empty() {
        bail!("RFC 3161 token이 비어 있습니다.");
    }

    let (mut sign1, cose_offset, original_cose_length) = load_active_cose(input)?;

    if sign1.unprotected.rest.iter().any(|(label, _)| {
        matches!(
            label,
            Label::Text(text)
                if text == "sigTst" || text == "sigTst2"
        )
    }) {
        bail!("입력 Classic Manifest에 timestamp가 이미 있습니다.");
    }

    // 이전 pad2는 제거하고 pad는 아래에서 다시 계산한다.
    sign1.unprotected.rest.retain(|(label, _)| {
        !matches!(
            label,
            Label::Text(text) if text == "pad" || text == "pad2"
        )
    });

    let timestamp_container = CborValue::Map(vec![(
        CborValue::Text("tstTokens".to_owned()),
        CborValue::Array(vec![CborValue::Map(vec![(
            CborValue::Text("val".to_owned()),
            CborValue::Bytes(token),
        )])]),
    )]);

    sign1
        .unprotected
        .rest
        .push((Label::Text("sigTst2".to_owned()), timestamp_container));

    // 기존 c2pa.signature box 크기를 유지하도록 padding을 재계산한다.
    let new_cose = encode_with_exact_size(&sign1, original_cose_length)?;

    let mut jumbf = jumbf_io::load_jumbf_from_file(input)
        .with_context(|| format!("JUMBF를 읽지 못했습니다: {}", input.display()))?;

    jumbf[cose_offset..cose_offset + original_cose_length].copy_from_slice(&new_cose);

    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent)?;
    }

    jumbf_io::save_jumbf_to_file(&jumbf, input, Some(output)).with_context(|| {
        format!(
            "timestamp가 포함된 이미지를 저장하지 못했습니다: {}",
            output.display()
        )
    })?;

    println!("TIMESTAMP=sigTst2");
    println!("COSE_BYTES={}", new_cose.len());
    println!("OUTPUT={}", output.display());

    Ok(())
}

fn load_active_cose(input: &Path) -> Result<(CoseSign1, usize, usize)> {
    if !input.is_file() {
        bail!("입력 이미지가 없습니다: {}", input.display());
    }

    let reader = Reader::from_context(C2paContext::new())
        .with_file(input)
        .with_context(|| format!("C2PA 이미지를 읽지 못했습니다: {}", input.display()))?;

    let active = reader
        .active_manifest()
        .context("active manifest를 찾지 못했습니다.")?;

    let active_signature = active
        .signature()
        .context("active manifest signature가 없습니다.")?;

    let jumbf = jumbf_io::load_jumbf_from_file(input).context("JUMBF store를 읽지 못했습니다.")?;

    for offset in 0..jumbf.len() {
        if jumbf[offset] != 0xD2 {
            continue;
        }

        let mut remaining = &jumbf[offset..];
        let original_remaining = remaining.len();

        let decoded: Result<CborValue, _> = coset::cbor::from_reader(&mut remaining);

        if decoded.is_err() {
            continue;
        }

        let consumed = original_remaining - remaining.len();

        if consumed == 0 || offset + consumed > jumbf.len() {
            continue;
        }

        let candidate = &jumbf[offset..offset + consumed];

        let sign1 = match CoseSign1::from_tagged_slice(candidate) {
            Ok(value) => value,
            Err(_) => continue,
        };

        if sign1.signature == active_signature {
            return Ok((sign1, offset, consumed));
        }
    }

    bail!("active manifest의 COSE_Sign1을 찾지 못했습니다.")
}

fn encode_with_exact_size(sign1: &CoseSign1, target_size: usize) -> Result<Vec<u8>> {
    let mut base = sign1.clone();

    base.unprotected.rest.retain(|(label, _)| {
        !matches!(
            label,
            Label::Text(text) if text == "pad" || text == "pad2"
        )
    });

    let unpadded = base
        .clone()
        .to_tagged_vec()
        .map_err(|error| anyhow!("COSE_Sign1 직렬화에 실패했습니다: {error:?}"))?;

    if unpadded.len() >= target_size {
        bail!(
            "기존 COSE 예약 공간이 부족합니다: required={}, available={}",
            unpadded.len(),
            target_size
        );
    }

    // CBOR byte string 길이 헤더 때문에 단순한 차이만으로는
    // 항상 정확한 크기를 만들 수 없으므로 pad2 크기도 함께 탐색한다.
    for pad2_length in 0usize..=32 {
        let mut candidate = base.clone();

        candidate
            .unprotected
            .rest
            .push((Label::Text("pad".to_owned()), CborValue::Bytes(Vec::new())));

        if pad2_length > 0 {
            candidate.unprotected.rest.push((
                Label::Text("pad2".to_owned()),
                CborValue::Bytes(vec![0; pad2_length]),
            ));
        }

        let empty_padding_length = candidate
            .clone()
            .to_tagged_vec()
            .map_err(|error| anyhow!("padding 계산용 COSE 직렬화에 실패했습니다: {error:?}"))?
            .len();

        if empty_padding_length > target_size {
            continue;
        }

        let estimate = target_size - empty_padding_length;
        let start = estimate.saturating_sub(32);
        let end = estimate + 32;

        for pad_length in start..=end {
            for (label, value) in &mut candidate.unprotected.rest {
                if matches!(
                    label,
                    Label::Text(text) if text == "pad"
                ) {
                    *value = CborValue::Bytes(vec![0; pad_length]);
                    break;
                }
            }

            let encoded = candidate
                .clone()
                .to_tagged_vec()
                .map_err(|error| anyhow!("COSE_Sign1 직렬화에 실패했습니다: {error:?}"))?;

            if encoded.len() == target_size {
                return Ok(encoded);
            }
        }
    }

    bail!(
        "COSE를 기존 크기 {}바이트에 맞추지 못했습니다.",
        target_size
    )
}
