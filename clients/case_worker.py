#!/usr/bin/env python3
"""Independent local worker: claim, verify context, propose, recover recorded result.

Input is one JSON object on stdin. Tokens are never command arguments or output.
This client does not approve or execute the proposal and does not use a model.
"""
import json
import sys
import urllib.request
import urllib.parse

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('REDIRECT_DENIED')

def run(config):
    base = config['base_url']
    parsed = urllib.parse.urlsplit(base)
    if parsed.scheme != 'http' or parsed.hostname != '127.0.0.1' or not parsed.port or parsed.path or parsed.query or parsed.fragment or parsed.username:
        raise ValueError('LOCAL_ENDPOINT_REQUIRED')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    def request(path, data=None):
        raw = None if data is None else json.dumps(data, allow_nan=False).encode()
        req = urllib.request.Request(base + path, data=raw, headers={
            'authorization': 'Bearer ' + config['grant_token'], 'content-type': 'application/json'}, method='GET' if raw is None else 'POST')
        with opener.open(req, timeout=10) as response:
            value = response.read(300001)
            if len(value)>300000: raise ValueError('RESPONSE_LIMIT')
            return json.loads(value)
    lease = request('/v1/worker/claim', {'lease_ms': 10000})
    context = request('/v1/worker/context', {'generation': lease['generation']})
    identity = context['envelope']
    if identity['audience'] != base + '/v1/worker' or identity['generation'] != lease['generation'] or identity['configuration_digest'] != lease['configuration_digest']:
        raise ValueError('CONTEXT_MISMATCH')
    result = request('/v1/worker/proposals', {'generation': lease['generation'], 'envelope': identity,
        'request_key': 'independent-proposal', 'proposal': {'action': 'diagnostic.resolution.set', 'arguments': {'resolution': config.get('resolution','refund')}}})
    stored = request('/v1/worker/results/' + urllib.parse.quote(result['id'], safe=''))
    if stored['submission'] != result: raise ValueError('RESULT_MISMATCH')
    return {'submission_id': result['id'], 'decision': result['decision'], 'generation': lease['generation'],
            'provider_thread_used': False, 'execution_performed': False}

if __name__ == '__main__':
    try:
        data = sys.stdin.read(10001)
        if len(data)>10000: raise ValueError('INPUT_LIMIT')
        print(json.dumps(run(json.loads(data))))
    except Exception:
        print(json.dumps({'error':'WORKER_REQUEST_FAILED'}), file=sys.stderr)
        sys.exit(1)
