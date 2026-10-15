#!/usr/bin/env python3
"""Fail-closed inventory checks. Native runner provenance and reviewer trust are external.

The baseline bytes and expected SHA-256 MUST come from a protected workflow/ref,
not candidate-controlled settings. This tool does not prove a report is truthful,
inspect assertion semantics, sign approvals, or implement a test runner.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any


def check_inventory(baseline: dict[str, Any], candidate: dict[str, Any], report: dict[str, Any], expected_sha: str) -> list[str]:
    errors: list[str] = []
    required = baseline.get('test_obligations', [])
    if not required:
        errors.append('Trusted baseline is empty: bootstrap requires separate maintainer approval, not a product pass')
    for label, obj in [('candidate registry', candidate), ('execution report', report)]:
        if obj.get('candidate_sha') != expected_sha or not expected_sha:
            errors.append(f'{label}: candidate SHA mismatch/missing')
    if report.get('configuration_digest') != candidate.get('configuration_digest') or not candidate.get('configuration_digest'):
        errors.append('Configuration digest mismatch/missing')
    if not report.get('native_report_sha256') or not report.get('command'):
        errors.append('Missing native report hash or actual runner command')
    results = report.get('tests', [])
    if not results:
        errors.append('Zero executed test records')
    if report.get('exit_code') != 0:
        errors.append('Native runner did not exit successfully')
    expected_count = len(results)
    if report.get('executed_count') != expected_count:
        errors.append('Executed count disagrees with result records')
    def unique_index(items: list[dict[str, Any]], label: str) -> dict[str, dict[str, Any]]:
        idx = {}
        for item in items:
            key = item.get('id')
            if not key or key in idx:
                errors.append(f'{label}: missing/duplicate stable ID {key}')
            idx[key] = item
        return idx
    ri = unique_index(results, 'runner results')
    ci = unique_index(candidate.get('test_obligations', []), 'candidate tests')
    capabilities = unique_index(candidate.get('capabilities', []), 'candidate capabilities')
    native_ids = [x.get('runner_case_id') for x in results]
    if any(not x for x in native_ids) or len(native_ids) != len(set(native_ids)):
        errors.append('Missing/reused native runner-case identity; one fabricated pass cannot stand for multiple cases')
    for item in required:
        tid = item['id']
        current = ci.get(tid)
        result = ri.get(tid)
        if not current:
            errors.append(f'{tid}: accepted test missing/reidentified')
        else:
            for field in ('contract_digest','oracle_digest','test_source_digest'):
                if not item.get(field) or current.get(field) != item.get(field):
                    errors.append(f'{tid}: protected {field} changed/missing; independent review and trusted rebaseline required')
        if not result or result.get('status') != 'passed':
            errors.append(f'{tid}: missing, skipped, todo, quarantined or failed mandatory execution')
    for cap in baseline.get('capabilities', []):
        cur = capabilities.get(cap['id'])
        if not cur or cur.get('enabled') is not True or cur.get('contract_digest') != cap.get('contract_digest'):
            errors.append(f'{cap["id"]}: accepted capability removed, disabled or changed')
    if report.get('failed_count') != 0 or report.get('skipped_required_count') != 0:
        errors.append('Failures or skipped mandatory cases remain')
    return errors


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--baseline', type=Path, required=True)
    ap.add_argument('--baseline-sha256', required=True, help='Protected-workflow value, never untrusted PR input')
    ap.add_argument('--candidate-registry', type=Path, required=True)
    ap.add_argument('--report', type=Path, required=True)
    ap.add_argument('--candidate-sha', required=True)
    args = ap.parse_args()
    try:
        data = args.baseline.read_bytes()
        if hashlib.sha256(data).hexdigest() != args.baseline_sha256:
            raise ValueError('Protected baseline bytes do not match the expected SHA-256')
        errors = check_inventory(json.loads(data),json.loads(args.candidate_registry.read_text(encoding="utf-8")),
                                 json.loads(args.report.read_text(encoding="utf-8")),args.candidate_sha)
    except (OSError, ValueError, KeyError, TypeError) as exc:
        errors = [str(exc)]
    print(json.dumps({'result':'fail' if errors else 'pass','check_type':'regression_inventory_only',
                     'errors':errors,'limitations':'Does not authenticate runner reports/reviewers or prove assertion quality; requires protected workflow integration and independent review.'},indent=2))
    return 1 if errors else 0

if __name__ == '__main__':
    raise SystemExit(main())
