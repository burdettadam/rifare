#!/usr/bin/env python3
"""Independent deterministic support orchestration using public HTTP and pinned skills.

Read one JSON request from stdin; never pass a token in command-line arguments.
This diagnostic client permits loopback only and does not send customer messages.
"""
import hashlib
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("REDIRECT_DENIED")


def execute(config):
    required = {"url", "token", "case_id", "workflow", "skill_digest", "request_id"}
    if not isinstance(config, dict) or set(config) != required:
        raise ValueError("INVALID_INPUT")
    if not re.fullmatch(r"http://127\.0\.0\.1:[0-9]{1,5}", config["url"]):
        raise ValueError("LOOPBACK_REQUIRED")
    if config["workflow"] not in {"support-reply", "shipment-assistance"}:
        raise ValueError("UNSUPPORTED_WORKFLOW")
    if not re.fullmatch(r"[a-f0-9]{64}", config["skill_digest"]):
        raise ValueError("INVALID_SKILL")
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def post(action, data):
        req = urllib.request.Request(config["url"] + "/v1/support/" + action,
            data=json.dumps(data, separators=(",", ":")).encode(), method="POST",
            headers={"Content-Type": "application/json", "Authorization": "Bearer " + config["token"]})
        with opener.open(req, timeout=10) as response:
            raw = response.read(262145)
            if len(raw) > 262144:
                raise ValueError("RESPONSE_TOO_LARGE")
            return json.loads(raw)

    pin = {k: config[k] for k in ("case_id", "workflow", "skill_digest")}
    context = post("workflow-context", pin)
    if context["skill_digest"] != config["skill_digest"] or context["case_id"] != config["case_id"]:
        raise ValueError("CONTEXT_MISMATCH")
    resources = context["resources"]
    if not isinstance(resources, list) or not 2 <= len(resources) <= 18:
        raise ValueError("INVALID_RESOURCES")
    names = set()
    for reference in resources:
        path = reference["path"]
        if path in names or not re.fullmatch(r"[A-Za-z0-9_./-]{1,200}", path) or ".." in path:
            raise ValueError("INVALID_RESOURCES")
        names.add(path)
        item = post("workflow-resource", {**pin, "path": path})
        digest = hashlib.sha256(item["content"].encode()).hexdigest()
        if item["bundle_digest"] != config["skill_digest"] or digest != item["sha256"] or digest != reference["sha256"]:
            raise ValueError("SKILL_INTEGRITY")
    if not {"SKILL.md", "commerce-manifest.json"}.issubset(names):
        raise ValueError("INVALID_RESOURCES")
    tracking = context["tracking"]
    ready = tracking["status"] == "available" and bool(tracking["shipments"]) and all(
        row["status"] != "unknown" for row in tracking["shipments"])
    return post("workflow-answer", {**pin, "context_digest": context["context_digest"],
        "fact_ids": [row["id"] for row in context["facts"] if row["kind"] == "shipment"],
        "handling": "answer" if ready else "handoff", "request_id": config["request_id"]})


if __name__ == "__main__":
    try:
        payload = sys.stdin.buffer.read(65537)
        if len(payload) > 65536:
            raise ValueError("INPUT_TOO_LARGE")
        print(json.dumps(execute(json.loads(payload))))
    except Exception as exc:
        # Never print request bodies, bearer values, or provider response text.
        print(json.dumps({"error": type(exc).__name__}), file=sys.stderr)
        sys.exit(1)
