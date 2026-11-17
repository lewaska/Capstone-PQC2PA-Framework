#!/usr/bin/env bash
set -euo pipefail

# Team HAETAE reference implementation 1.2.0, MIT licensed.
# https://kpqc.cryptolab.co.kr/haetae
archive_url='https://drive.usercontent.google.com/download?id=1pW6YS1wZ1gm8Neb8pY5EyYTkkdRIDmJ6&export=download&confirm=t'
expected_sha256='e54f8f962eefadbb2929bca292797bc7ca18769fb9a273c10204f3887fd83e84'
target_dir="$(cd "$(dirname "$0")" && pwd)"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
curl --fail --location --silent --show-error "$archive_url" -o "$work_dir/HAETAE.zip"
printf '%s  %s\n' "$expected_sha256" "$work_dir/HAETAE.zip" | sha256sum --check --status
python3 - "$work_dir/HAETAE.zip" "$work_dir/src" <<'PY'
import pathlib, sys, zipfile
archive, root = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
with zipfile.ZipFile(archive) as z:
    for info in z.infolist():
        name = info.filename
        prefix = 'HAETAE-1.2.0/reference_implementation/'
        if not name.startswith(prefix) or name.endswith('/') or '/._' in name:
            continue
        relative = pathlib.PurePosixPath(name[len(prefix):])
        if '..' in relative.parts:
            raise ValueError(name)
        destination = root.joinpath(*relative.parts)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(z.read(info))
PY
cd "$work_dir/src"
gcc -O2 -std=c11 -fPIC -shared -DHAETAE_CONFIG_MODE=HAETAE_MODE3 -Iinclude \
    src/decompose.c src/encoding.c src/fft.c src/fixpoint.c src/ntt.c \
    src/packing.c src/poly.c src/polyvec.c src/polymat.c src/polyfix.c \
    src/reduce.c src/sampler.c src/sign.c src/randombytes.c \
    src/fips202.c src/symmetric-shake.c -lm -o "$target_dir/libhaetae3.so"
echo "Built $target_dir/libhaetae3.so from verified HAETAE 1.2.0 source"
