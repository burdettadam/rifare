#!/usr/bin/env python3
"""Independent deterministic read orchestrator; no built-in runner or model SDK.

Supply RIFARE_BEARER (REST) or RIFARE_MCP_TOKEN (MCP) in this process only.
This example proves protocol-level portability, not live LLM qualification.
"""
import argparse
import hashlib
import json
import os
import re
import sys
import urllib.parse
import urllib.request

PROTOCOL = '2025-11-25'


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('redirect refused')


def sha(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def run(base_url, task_id, transport='rest'):
    endpoint = urllib.parse.urlsplit(base_url)
    if (endpoint.scheme != 'http' or endpoint.hostname != '127.0.0.1' or not endpoint.port
            or endpoint.path not in ('', '/') or endpoint.query or endpoint.fragment or endpoint.username or endpoint.password):
        raise ValueError('only the local diagnostic endpoint is supported')
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,96}', task_id) or transport not in ('rest', 'mcp'):
        raise ValueError('invalid task/transport')
    credential = os.environ.get('RIFARE_MCP_TOKEN' if transport == 'mcp' else 'RIFARE_BEARER', '')
    if re.fullmatch(r'[A-Za-z0-9_-]{43}', credential) is None:
        raise ValueError('scoped credential required')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    trace = []
    counter = 0

    def request(path, data=None):
        headers = {'Authorization': 'Bearer ' + credential, 'Accept': 'application/json, text/event-stream',
                   'MCP-Protocol-Version': PROTOCOL}
        if data is not None:
            headers['Content-Type'] = 'application/json'
        req = urllib.request.Request(base_url.rstrip('/') + path, headers=headers,
                                     data=None if data is None else json.dumps(data).encode())
        with opener.open(req, timeout=5) as response:
            if response.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                raise ValueError('unexpected response type')
            raw = response.read(1024 * 1024 + 1)
            if len(raw) > 1024 * 1024:
                raise ValueError('response too large')
            return json.loads(raw)

    def rpc(method, params):
        nonlocal counter
        counter += 1
        result = request('/mcp', {'jsonrpc': '2.0', 'id': counter, 'method': method, 'params': params})
        if result.get('jsonrpc') != '2.0' or result.get('id') != counter or 'error' in result or 'result' not in result:
            raise ValueError('protocol failure')
        return result['result']

    if transport == 'mcp':
        init = rpc('initialize', {'protocolVersion': PROTOCOL, 'capabilities': {},
                                  'clientInfo': {'name': 'RifareIndependentPython', 'version': '1.0.0'}})
        if init.get('protocolVersion') != PROTOCOL:
            raise ValueError('unsupported protocol')
        tools = rpc('tools/list', {})['tools']
        if not {'read_task', 'order_status', 'skill_content'}.issubset({x['name'] for x in tools}):
            raise ValueError('required read tools unavailable')

    def action(name, arguments):
        trace.append(name)
        if transport == 'rest':
            if name == 'read_task':
                return request('/v1/read-tasks/' + task_id)
            action_name = {'order_status': 'order.status', 'skill_content': 'skill.read'}[name]
            return request('/v1/read-tasks/' + task_id + '/actions', {'action': action_name, 'arguments': arguments})
        result = rpc('tools/call', {'name': name, 'arguments': {'task_id': task_id, **arguments}})
        if result.get('isError') or not isinstance(result.get('structuredContent'), dict):
            raise ValueError('read denied')
        return result['structuredContent']

    task = action('read_task', {})
    if task.get('id') != task_id or task.get('type') != 'order-status-read' or task.get('agent_runtime_required') is not False:
        raise ValueError('nonportable task')
    skill = task['skill']
    if task['profile']['skill_digest'] != skill['bundle_digest']:
        raise ValueError('profile/skill mismatch')
    resources = skill['resources']
    if not isinstance(resources, list) or not 2 <= len(resources) <= 18:
        raise ValueError('invalid resources')
    files = {}
    for resource in resources:
        path = resource['path']
        if path in files or not re.fullmatch(r'[A-Za-z0-9_./-]{1,200}', path) or '..' in path.split('/') or path.startswith('/'):
            raise ValueError('invalid resource path')
        data = action('skill_content', {'skill_id': skill['id'], 'resource': path, 'bundle_digest': skill['bundle_digest']})
        if (data.get('skill_id') != skill['id'] or data.get('path') != path or data.get('bundle_digest') != skill['bundle_digest']
                or data.get('sha256') != resource['sha256'] or sha(data['content']) != resource['sha256']):
            raise ValueError('resource integrity mismatch')
        files[path] = data['content']
    material = json.dumps([[name, sha(files[name])] for name in sorted(files)], separators=(',', ':'), ensure_ascii=False)
    if sha(material) != skill['bundle_digest'] or 'SKILL.md' not in files:
        raise ValueError('bundle integrity mismatch')
    facts = action('order_status', {'order_id': task['order_id']})
    if not facts.get('order') or facts.get('status') not in ('fresh', 'fixture_snapshot'):
        raise ValueError('current facts unavailable')
    latest = action('read_task', {})
    if latest['profile'] != task['profile'] or latest['skill'] != skill or latest['facts'] != facts:
        raise ValueError('source context changed')
    # Independent projection from documented source facts; no shared runner implementation.
    order = facts['order']
    claims = [{'id': 'order.number', 'value': order['number']},
              {'id': 'order.fulfillment_status', 'value': order['fulfillment_status']},
              {'id': 'source.state', 'value': facts['status']}]
    for index, shipment in enumerate(order.get('shipments', [])):
        claims.append({'id': f'shipment.{index}.state', 'value': shipment.get('delivery_state', shipment.get('status'))})
    return {'task_id': task_id, 'status': 'grounded_read', 'claims': claims, 'source': facts['source'],
            'skill_digest': skill['bundle_digest'], 'profile_revision': task['profile']['revision'],
            'consumed_resources': sorted(files), 'actions': trace,
            'runtime': 'independent_python_deterministic', 'transport': transport,
            'model_calls': 0, 'production_qualified': False,
            'answer': '\n'.join(c['id'] + ': ' + str(c['value']) for c in claims)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', required=True)
    parser.add_argument('--task-id', required=True)
    parser.add_argument('--transport', choices=('rest', 'mcp'), default='rest')
    args = parser.parse_args()
    try:
        print(json.dumps(run(args.base_url, args.task_id, args.transport), ensure_ascii=False))
        return 0
    except (ValueError, KeyError, TypeError, OSError):
        print(json.dumps({'status': 'handoff', 'reason': 'READ_CONTRACT_FAILED', 'claims': []}))
        return 1


if __name__ == '__main__':
    sys.exit(main())
