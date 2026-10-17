"""Portable, model-free order-edit status reader. Credentials arrive on stdin only."""
import hashlib
import json
import sys
import urllib.error
import urllib.parse
import urllib.request


def read(config):
    if set(config) != {'url', 'token', 'case_id', 'skill_digest'}:
        raise ValueError('INVALID_INPUT')
    u = urllib.parse.urlsplit(config['url'])
    if u.scheme != 'http' or u.hostname != '127.0.0.1' or not u.port or u.path not in ('', '/') or u.username or u.password or u.query or u.fragment:
        raise ValueError('LOOPBACK_REQUIRED')
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args):
            raise ValueError('REDIRECT_DENIED')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    body = json.dumps({k: config[k] for k in ('case_id', 'skill_digest')}).encode()
    req = urllib.request.Request(config['url'].rstrip('/') + '/v1/edit-workflows/open', data=body, headers={'Authorization': 'Bearer '+config['token'], 'Content-Type':'application/json'}, method='POST')
    with opener.open(req, timeout=10) as response:
        raw = response.read(2_000_001)
    if len(raw) > 2_000_000:
        raise ValueError('RESPONSE_LIMIT')
    value = json.loads(raw)
    if value.get('pin', {}).get('skill_digest') != config['skill_digest'] or value.get('case_id') != config['case_id']:
        raise ValueError('CONTEXT_MISMATCH')
    resources = value['skill']['resources']
    if not resources or len({x['path'] for x in resources}) != len(resources):
        raise ValueError('RESOURCE_INVALID')
    for item in resources:
        if hashlib.sha256(item['content'].encode()).hexdigest() != item['sha256'] or item['authority'] != 'guidance_only':
            raise ValueError('SKILL_INTEGRITY')
    return {'case_id': value['case_id'], 'source_digest': value['source_digest'], 'skill_digest':config['skill_digest'],
            'operations':value['operations'], 'handoff_required':value['handoff_required'], 'execution_authorized':False,
            'qualification':value['qualification'], 'model_calls':0}

if __name__ == '__main__':
    try:
        print(json.dumps(read(json.load(sys.stdin))))
    except Exception as exc:
        print(json.dumps({'error': type(exc).__name__, 'execution_authorized':False}), file=sys.stderr)
        sys.exit(1)
