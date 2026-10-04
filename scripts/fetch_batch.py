#!/usr/bin/env python3
import json, sys, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

def one(req):
    url=req.get("url")
    headers=req.get("headers") or {}
    method=(req.get("method") or "get").upper()
    try:
        r=urllib.request.Request(url,headers=headers,method=method)
        with urllib.request.urlopen(r,timeout=25) as resp:
            body=resp.read().decode("utf-8","replace")
            return {"status":resp.getcode(),"body":body,"headers":dict(resp.headers.items())}
    except urllib.error.HTTPError as e:
        try: body=e.read().decode("utf-8","replace")
        except Exception: body=""
        return {"status":e.code,"body":body,"headers":dict(e.headers.items()) if e.headers else {}}
    except Exception as e:
        return {"status":0,"body":"","headers":{},"error":str(e)}

reqs=json.load(sys.stdin)
out=[None]*len(reqs)
workers=min(20,max(1,len(reqs)))
with ThreadPoolExecutor(max_workers=workers) as ex:
    futs={ex.submit(one,r):i for i,r in enumerate(reqs)}
    for f in as_completed(futs):
        i=futs[f]
        try: out[i]=f.result()
        except Exception as e: out[i]={"status":0,"body":"","headers":{},"error":str(e)}
json.dump(out,sys.stdout)
