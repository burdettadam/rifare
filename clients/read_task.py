#!/usr/bin/env python3
"""Independent standard-library HTTP client for a Rifare read task.

Set RIFARE_BEARER in the process environment; never put it in command arguments.
This local diagnostic client deliberately refuses non-loopback endpoints.
"""
import argparse
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('redirect refused')


def run(base_url: str, task_id: str) -> dict:
    url = urllib.parse.urlsplit(base_url)
    if (url.scheme != 'http' or url.hostname not in ('127.0.0.1', 'localhost')
            or not url.port or url.path not in ('', '/') or url.query or url.fragment or url.username):
        raise ValueError('a loopback HTTP endpoint is required')
    if re.fullmatch(r'[A-Za-z0-9_-]{1,96}', task_id) is None:
        raise ValueError('invalid task ID')
    bearer = os.environ.get('RIFARE_BEARER', '')
    if re.fullmatch(r'[A-Za-z0-9_-]{43}', bearer) is None:
        raise ValueError('RIFARE_BEARER is required')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def read(path: str):
        request = urllib.request.Request(base_url.rstrip('/') + path,
                                         headers={'Authorization': 'Bearer ' + bearer})
        with opener.open(request, timeout=5) as response:
            if response.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                raise ValueError('unexpected response type')
            payload = response.read(1024 * 1024 + 1)
            if len(payload) > 1024 * 1024:
                raise ValueError('response too large')
            return json.loads(payload)

    contract = read('/v1/read-contract')
    if contract.get('openapi') != '3.1.0' or '/v1/read-tasks/{task_id}' not in contract.get('paths', {}):
        raise ValueError('unsupported contract')
    task = read('/v1/read-tasks/' + task_id)
    if task.get('id') != task_id or task.get('agent_runtime_required') is not False:
        raise ValueError('invalid portable task')
    return task


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', required=True)
    parser.add_argument('--task-id', required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(run(args.base_url, args.task_id), sort_keys=True))
        return 0
    except (ValueError, OSError, urllib.error.URLError):
        print(json.dumps({'error': 'READ_FAILED'}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
