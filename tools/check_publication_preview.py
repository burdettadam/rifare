#!/usr/bin/env python3
"""Run the two advertised synthetic demos with a bounded, explicit contract.

This is development-preview evidence, not a full regression or release gate.
The existing test-process network hook rejects attempted JavaScript egress.
It is defense in depth, not an operating-system network sandbox.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess
import sys
import time


def expect(actual: object, expected: object, label: str) -> None:
    if type(actual) is not type(expected) or actual != expected:
        raise ValueError(f'{label}: expected {expected!r}, observed {actual!r}')


def section(document: dict, name: str) -> dict:
    value = document.get(name)
    if not isinstance(value, dict):
        raise ValueError(f'{name}: expected an object')
    return value


def validate_returns(result: dict) -> None:
    expect(result.get('evidence_kind'), 'synthetic_return_resolution', 'return profile')
    expect(result.get('outcomes'), [
        {'line': 'alpha', 'outcome': 'refund', 'original_paid_minor': '1940'},
        {'line': 'beta', 'outcome': 'store_credit', 'original_paid_minor': '960'},
        {'line': 'gamma', 'outcome': 'exchange', 'original_paid_minor': '1000'},
    ], 'original-unit allocations')
    expect(result.get('allocated_minor'), '3900', 'allocated original value')
    refund = section(result, 'refund')
    expect(refund.get('after_lost_response'), 'unknown', 'lost response')
    expect(refund.get('after_lookup'), 'accepted', 'original-operation lookup')
    expect(refund.get('after_explicit_fixture_settlement'), 'settled', 'separate settlement')
    expect(refund.get('send_attempts'), 1, 'refund send attempts')
    credit = section(result, 'credit')
    expect(credit.get('state'), 'issued', 'synthetic credit')
    expect(credit.get('qualification'), 'synthetic_only', 'credit qualification')
    expect(credit.get('cash_settlement'), False, 'credit is not cash settlement')
    exchange = section(result, 'exchange')
    expect(exchange.get('qualification'), 'synthetic_only', 'exchange qualification')
    expect(exchange.get('allowed'), False, 'unsupported exchange price difference')
    expect(exchange.get('reasons'), ['PRICE_DIFFERENCE_UNSUPPORTED'], 'exchange boundary')
    expect(exchange.get('stock_reserved'), False, 'exchange stock reservation')
    expect(exchange.get('commit_authorized'), False, 'exchange commitment')
    expect(result.get('remaining_obligation_minor'), '1000', 'unresolved original value')
    expect(result.get('external_calls'), 0, 'return external calls')
    expect(result.get('production_qualified'), False, 'return qualification')


def validate_support(result: dict) -> None:
    expect(result.get('profile'), 'synthetic_only', 'support profile')
    expect(result.get('return_approved'), True, 'local return approval')
    expect(result.get('refund_executed'), False, 'approval is not a refund')
    expect(result.get('message_before_reconciliation'), 'unknown', 'uncertain message')
    expect(result.get('message_after_reconciliation'), 'accepted', 'message lookup')
    expect(result.get('customer_delivery_confirmed'), False, 'acceptance is not delivery')
    expect(result.get('synthetic_source_messages'), 1, 'source message count')
    expect(result.get('late_agent_output_rejected'), True, 'stale agent output')
    expect(result.get('model_disabled_manual_status'), 'answered', 'manual support')
    expect(result.get('history_complete'), False, 'incomplete history remains visible')
    expect(result.get('external_calls'), 0, 'support external calls')
    tracking = result.get('tracking')
    if not isinstance(tracking, str) or 'The full order is not confirmed delivered.' not in tracking:
        raise ValueError('tracking must retain the incomplete-order boundary')


def run_demo(root: Path, node: str, script: str, deadline: float) -> dict:
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise ValueError('development-preview deadline exceeded')
    command = [node, '--experimental-strip-types', '--import',
               './tests/harness/network-deny.mts', script]
    process = subprocess.run(command, cwd=root, capture_output=True, text=True,
                             timeout=min(30.0, remaining), check=False)
    if process.returncode:
        detail = process.stderr.strip()[-2000:]
        raise ValueError(f'{script}: exit {process.returncode}\n{detail}')
    result = json.loads(process.stdout)
    if not isinstance(result, dict):
        raise ValueError(f'{script}: expected one JSON object')
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--node', default='node', help='Supported Node executable (default: node)')
    args = parser.parse_args()
    started = time.monotonic()
    checks = []
    try:
        for script, validator in [
            ('tools/demo-return-resolution.mts', validate_returns),
            ('tools/demo-support.mts', validate_support),
        ]:
            validator(run_demo(args.root.resolve(), args.node, script, started + 60))
            checks.append({'command': script, 'result': 'pass'})
        report = {'check': 'development_preview', 'result': 'pass', 'demos': checks,
                  'full_regression': False, 'production_qualified': False,
                  'elapsed_seconds': round(time.monotonic() - started, 3)}
        print(json.dumps(report, indent=2))
        return 0
    except (OSError, ValueError, subprocess.TimeoutExpired) as error:
        print(json.dumps({'check': 'development_preview', 'result': 'fail',
                          'demos': checks, 'error': str(error),
                          'full_regression': False, 'production_qualified': False}, indent=2))
        return 1


if __name__ == '__main__':
    sys.exit(main())
