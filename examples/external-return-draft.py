#!/usr/bin/env python3
"""Local-only Rifare draft client. Reads a private session file; never prints tokens."""
import argparse,json,urllib.request,urllib.parse
from pathlib import Path

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url',required=True);parser.add_argument('--session-file',required=True)
    parser.add_argument('--case',required=True);parser.add_argument('--resolution',choices=['refund','exchange'],default='refund')
    parser.add_argument('--resume',action='store_true');args=parser.parse_args()
    u=urllib.parse.urlsplit(args.url)
    if u.scheme!='http' or u.hostname!='127.0.0.1' or not u.port or u.path not in ('','/') or u.query or u.fragment or u.username:
        raise SystemExit('Only an explicit loopback diagnostic URL is supported.')
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*args,**kwargs): return None
    value=json.loads(Path(args.session_file).read_text())['operator']
    data={'case_id':args.case}
    if not args.resume:data.update(request_key='draft-'+args.case,resolution=args.resolution)
    req=urllib.request.Request(args.url.rstrip('/')+'/v1/return-drafts/'+('resume' if args.resume else 'prepare'),data=json.dumps(data).encode(),headers={'Authorization':'Bearer '+value,'Content-Type':'application/json'})
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
    with opener.open(req,timeout=5) as response: result=json.load(response)
    if result.get('financial_effect') is not False:raise SystemExit('Unexpected draft result.')
    print(json.dumps(result,sort_keys=True))
if __name__=='__main__':main()
