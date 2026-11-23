#!/usr/bin/env python3
"""Pin a separately obtained upstream vector for local tests; no network or redistribution."""
import argparse
import hashlib
import json
from pathlib import Path


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True,
                        help='Authorized local copy of the exact upstream decision-receipt-v1.json')
    args = parser.parse_args()
    manifest = json.loads((root / 'tests/fixtures/delegated-receipts/provider-source.v1.json').read_text())
    data = args.source.read_bytes()
    if len(data) > 100_000 or hashlib.sha256(data).hexdigest() != manifest['sha256']:
        raise SystemExit('RECEIPT_VECTOR_SOURCE_MISMATCH')
    destination = root / manifest['local_fixture']
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(data)
    print(json.dumps({'source_sha256': manifest['sha256'], 'local_fixture': str(destination),
                      'profile': 'draft', 'redistributed': False}))


if __name__ == '__main__':
    main()
