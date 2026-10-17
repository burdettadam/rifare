#!/usr/bin/env python3
"""Independent, standard-library client. A JSON request (including session) arrives on stdin."""
import hashlib
import json
import sys
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler, ProxyHandler

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError('Redirects are not accepted')

def main():
    request = json.load(sys.stdin)
    if set(request) != {'url', 'token', 'request_id', 'workflow', 'skill_digest'}:
        raise ValueError('Unexpected client input')
    url = urlsplit(request['url'])
    if url.scheme != 'http' or url.hostname != '127.0.0.1' or not url.port or url.username or url.password or url.path not in ('', '/') or url.query or url.fragment:
        raise ValueError('This diagnostic client requires an explicit loopback endpoint')
    opener = build_opener(ProxyHandler({}), NoRedirect)
    def post(path, body):
        req = Request(request['url'].rstrip('/') + path, data=json.dumps(body).encode(), method='POST', headers={
            'Authorization': 'Bearer ' + request['token'], 'Content-Type': 'application/json'})
        with opener.open(req, timeout=10) as response:
            raw = response.read(262145)
            if len(raw) > 262144:
                raise ValueError('Response limit')
            return json.loads(raw)
    post('/v1/return-workflows/open', {key: request[key] for key in ('request_id', 'workflow', 'skill_digest')})
    value = post('/v1/return-workflows/status', {key: request[key] for key in ('request_id', 'workflow')})
    if value['request_id'] != request['request_id'] or value['pin']['skill_digest'] != request['skill_digest']:
        raise ValueError('Context mismatch')
    resources = value['skill']['resources']
    paths = set()
    pairs = []
    for item in resources:
        if item['path'] in paths or hashlib.sha256(item['content'].encode()).hexdigest() != item['sha256']:
            raise ValueError('Skill integrity failure')
        paths.add(item['path'])
        pairs.append([item['path'], item['sha256']])
    bundle_digest = hashlib.sha256(json.dumps(sorted(pairs), separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
    if bundle_digest != request['skill_digest']:
        raise ValueError('Skill bundle mismatch')
    source = {key: value[key] for key in ('request_id', 'case_id', 'case_revision', 'configuration_digest', 'source_version', 'stages')}
    source_digest = hashlib.sha256(json.dumps(source, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode()).hexdigest()
    if source_digest != value['source_digest']:
        raise ValueError('Source integrity failure')
    # Only structured source states are returned. No success is inferred from guidance or text.
    print(json.dumps({'request_id': value['request_id'], 'source_digest': value['source_digest'],
        'skill_digest': bundle_digest, 'configuration_digest': value['configuration_digest'],
        'stages': value['stages'], 'handoff_required': value['handoff_required'], 'reason': value['reason'],
        'model_required': False, 'prose_is_authority': False}))

if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(json.dumps({'error': type(exc).__name__, 'completed': False}), file=sys.stderr)
        sys.exit(1)
