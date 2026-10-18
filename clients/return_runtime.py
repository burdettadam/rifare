#!/usr/bin/env python3
"""Independent Python state machine for Rifare's local return worker contract.

This implementation uses urllib and explicit state transitions. It imports no
TypeScript runtime, shared decision helper or private case checkpoint. The only
cross-process authority is the server's case-scoped opaque work grant.
"""
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

ALLOWED = frozenset(("approved-preview.execute", "resolution.dispatch", "resolution.reconcile"))


class RejectRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("REDIRECT_DENIED")


class HttpCase:
    def __init__(self, value):
        if not isinstance(value, dict) or set(value) - {"base_url", "grant_token", "mode", "max_actions"}:
            raise ValueError("INVALID_INPUT")
        self.base = value["base_url"]
        url = urllib.parse.urlsplit(self.base)
        if url.scheme != "http" or url.hostname != "127.0.0.1" or not url.port or url.path or url.query or url.fragment or url.username or url.password or self.base != "http://127.0.0.1:" + str(url.port):
            raise ValueError("LOCAL_ENDPOINT_REQUIRED")
        self.token = value["grant_token"]
        if not isinstance(self.token, str) or not re.fullmatch(r"wrk_[A-Za-z0-9_-]{43}", self.token):
            raise ValueError("INVALID_INPUT")
        self.mode, self.limit = value.get("mode", "advance"), value.get("max_actions", 8)
        if self.mode not in ("inspect", "advance") or type(self.limit) is not int or not 0 <= self.limit <= 20:
            raise ValueError("INVALID_INPUT")
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), RejectRedirect())

    def post(self, path, value):
        request = urllib.request.Request(self.base + path, data=json.dumps(value, allow_nan=False).encode("utf-8"),
                                        headers={"Authorization": "Bearer " + self.token, "Content-Type": "application/json"}, method="POST")
        with self.opener.open(request, timeout=10) as reply:
            if reply.status != 200:
                raise ValueError("HTTP_DENIED")
            body = reply.read(300001)
            if len(body) > 300000:
                raise ValueError("RESPONSE_LIMIT")
            return json.loads(body)


class Machine:
    def __init__(self, config):
        self.http = HttpCase(config)
        self.state = "claim"
        self.context = None
        self.lease = None
        self.pins = None
        self.trace = []
        self.lookups = set()
        self.action = None
        self.arguments = None
        self.reason = None

    def stop(self, reason):
        self.reason, self.state = reason, "stopped"

    def claim(self):
        self.lease = self.http.post("/v1/worker/claim", {"lease_ms": 30000})
        self.state = "load"

    def load(self):
        self.context = self.http.post("/v1/worker/return-context", {"generation": self.lease["generation"]})
        self.state = "validate"

    def validate(self):
        c, lease = self.context, self.lease
        e = c["envelope"]
        if c["contract"] != {"id": "rifare-common-return-worker", "version": "1.0.0", "qualification": "local_fixture_only"} or c["execution_authorized"] is not False:
            raise ValueError("CONTEXT_MISMATCH")
        expected = {"case_id": lease["case_id"], "resource_id": lease["resource_id"], "generation": lease["generation"],
                    "configuration_digest": lease["configuration_digest"], "audience": self.http.base + "/v1/worker"}
        if any(e.get(key) != value for key, value in expected.items()):
            raise ValueError("CONTEXT_MISMATCH")
        if type(c["observed_at"]) is not int or any(not isinstance(c[key], list) for key in ("blockers", "previews", "operations", "receipts", "allowed_actions")):
            raise ValueError("CONTEXT_MISMATCH")
        if not set(c["allowed_actions"]).issubset(ALLOWED) or not isinstance(c["effective_skill"]["files"]["SKILL.md"], str):
            raise ValueError("CONTEXT_MISMATCH")
        current = {"case_id": e["case_id"], "configuration_digest": e["configuration_digest"], "skill_digest": c["effective_skill"]["digest"],
                   "policy_digest": c["configuration"]["policy"]["digest"], "profile_digest": c["configuration"]["profile"]["sha256"]}
        if any(not re.fullmatch(r"[a-f0-9]{64}", current[key]) for key in ("configuration_digest", "skill_digest", "policy_digest", "profile_digest")):
            raise ValueError("CONTEXT_MISMATCH")
        if self.pins is not None and current != self.pins:
            raise ValueError("CONTEXT_CHANGED")
        self.pins = current
        if self.http.mode == "inspect":
            self.stop("inspection_only")
        elif len(self.trace) >= self.http.limit:
            self.stop("action_limit")
        else:
            self.state = "resolve_uncertainty"

    def resolve_uncertainty(self):
        if not self.context["blockers"]:
            self.state = "find_approval"
            return
        blocker = self.context["blockers"][0]
        matches = [op for op in self.context["operations"] if op["id"] == blocker["id"]]
        if not matches or "resolution.reconcile" not in self.context["allowed_actions"]:
            self.stop("reconciliation_requires_authorized_worker")
        elif matches[0]["id"] in self.lookups:
            self.stop("unknown_outcome")
        else:
            self.select("resolution.reconcile", {"operation_id": matches[0]["id"]})

    def find_approval(self):
        for preview in self.context["previews"]:
            approval = preview["approval"]
            if preview["receipt_id"] is not None or preview["configuration_digest"] != self.pins["configuration_digest"] or preview["policy_digest"] != self.pins["policy_digest"]:
                continue
            if approval and approval["authority_current"] and not approval["revoked"] and approval["uses"] == 0 and approval["max_uses"] == 1 and min(preview["expires_at"], approval["expires_at"]) > self.context["observed_at"]:
                self.select("approved-preview.execute", {"preview_id": preview["id"], "preview_digest": preview["digest"], "approval_id": approval["id"]})
                return
        self.state = "find_effect"

    def find_effect(self):
        for operation in self.context["operations"]:
            if operation["state"] == "authorized":
                self.select("resolution.dispatch", {"operation_id": operation["id"]})
                return
        for operation in self.context["operations"]:
            if operation["state"] in ("accepted", "manual_external_settlement_pending") and operation["id"] not in self.lookups:
                self.select("resolution.reconcile", {"operation_id": operation["id"]})
                return
        if any(p["receipt_id"] is None for p in self.context["previews"]):
            self.stop("approval_or_repreview_required")
        elif any(op["state"] in ("accepted", "manual_external_settlement_pending") for op in self.context["operations"]):
            self.stop("source_pending")
        else:
            self.stop("no_pending_action")

    def select(self, action, arguments):
        if action not in self.context["allowed_actions"]:
            self.stop("current_authority_required")
            return
        self.action, self.arguments, self.state = action, arguments, "invoke"

    def invoke(self):
        result = self.http.post("/v1/worker/return-action", {"generation": self.lease["generation"], "envelope": self.context["envelope"],
                                                          "action": self.action, "arguments": self.arguments})
        entry = {"action": self.action, **self.arguments}
        if "receipt" in result:
            entry.update(receipt_id=result["receipt"]["id"], replayed=result["replayed"])
        else:
            entry["state"] = result["operation"]["state"]
        self.trace.append(entry)
        if self.action == "resolution.reconcile":
            self.lookups.add(self.arguments["operation_id"])
        self.state = "load"

    def run(self):
        # Each action has at most six control transitions. No scheduler or
        # polling loop is installed; pending source facts cause a bounded exit.
        transitions = {name: getattr(self, name) for name in ("claim", "load", "validate", "resolve_uncertainty", "find_approval", "find_effect", "invoke")}
        while self.state != "stopped":
            transitions[self.state]()
        return {"schema_version": 1, "runtime_id": "rifare-python-state-machine-v1", "generation": self.lease["generation"], **self.pins,
                "stop_reason": self.reason, "actions": self.trace, "state": {key: self.context[key] for key in ("return_request", "previews", "receipts", "operations", "blockers")},
                "execution_performed": bool(self.trace), "provider_thread_used": False, "qualification": "local_fixture_only"}


if __name__ == "__main__":
    try:
        raw = sys.stdin.buffer.read(10001)
        if len(raw) > 10000:
            raise ValueError("INPUT_LIMIT")
        print(json.dumps(Machine(json.loads(raw)).run(), allow_nan=False))
    except Exception:
        print(json.dumps({"error": "RETURN_RUNTIME_FAILED"}), file=sys.stderr)
        sys.exit(1)
