import argparse
import json
from pathlib import Path

from app.services.pqc2pa import build_p1


parser = argparse.ArgumentParser()
parser.add_argument("--input", required=True, type=Path)
parser.add_argument("--classic-output", required=True, type=Path)
parser.add_argument("--p1-output", required=True, type=Path,
                    help="Detached JUMBF Manifest Store output (use .c2pa, not .cbor)")
arguments = parser.parse_args()

result = build_p1(
    source_image=arguments.input,
    classic_output=arguments.classic_output,
    p1_output=arguments.p1_output,
)
print(json.dumps(result, ensure_ascii=False, indent=2))
