#!/usr/bin/env python3
"""Independent local Rifare checkout caller; Python standard library only.

This diagnostic client captures historical evidence. It never authorizes a
purchase. Supply RIFARE_BEARER privately through the process environment; supply
a receipt through stdin, never a command argument. A failed request is never
retried automatically, even if its result was lost.
"""
import argparse
from datetime import datetime
import hashlib
import http.client
import json
import math
import os
import re
import sys
from urllib.parse import urlsplit


MAX_RECEIPT = 100_000
MAX_RESPONSE = 262_144
TIMEOUT_SECONDS = 5
ID = re.compile(r"[A-Za-z0-9_-]{1,96}\Z")
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\Z")
SHA256 = re.compile(r"sha256:[0-9a-f]{64}\Z")
MAX_SAFE_INTEGER = 9_007_199_254_740_991
COMMAND_PROFILE = "urn:marty:delegation-command:v1"
RESPONSE_PROFILE = "urn:marty:delegation-command-response:v1"
COMMAND_FLAGS = {
    "evidence_status": "historical_unverified_observation",
    "observation_origin": "local_unverified_input",
    "execution_authorized": False, "provider_authenticated": False,
    "receipt_signature_verified": False, "qualification": "candidate_contract_only",
}
ENVELOPE_FIELDS = {
    "profile", "qualification", "evidence_status", "execution_authorized",
    "operation", "result",
}
HTTP_ERRORS = {
    400: "INVALID_REQUEST", 403: "REQUEST_DENIED", 404: "NOT_FOUND",
    409: "CONFLICT", 413: "BODY_TOO_LARGE", 503: "UNAVAILABLE",
}


class ClientError(Exception):
    """Messages are fixed local codes, never request or response content."""


class Parser(argparse.ArgumentParser):
    def error(self, message):
        # argparse's default error includes unrecognized arguments verbatim.
        raise ClientError("INVALID_ARGUMENTS")


def arguments():
    parser = Parser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples (RIFARE_BEARER must already be set privately):\n"
            "  delegated_checkout.py --base-url http://127.0.0.1:8080 contract\n"
            "  delegated_checkout.py --base-url http://127.0.0.1:8080 preview "
            "--cart-id cart --shipping-quote-id shipping --fee-quote-id fee\n"
            "  delegated_checkout.py --base-url http://127.0.0.1:8080 prepare "
            "--preview-id preview --context-id context\n"
            "  delegated_checkout.py --base-url http://127.0.0.1:8080 lookup "
            "--preview-id original_preview --context-id original_context\n"
            "  delegated_checkout.py --base-url http://127.0.0.1:8080 receipt "
            "--intent-id intent < receipt.jws\n"
            "  delegated_checkout.py --base-url http://127.0.0.1:8080 cancel "
            "--intent-id intent --expected-revision 2\n"
            "Local IDs and context must come from the configured application. "
            "This client does not provision context, trust, keys or fixtures. "
            "After an uncertain preparation, explicitly look up its original "
            "references. Absence does not authorize replacement or automatic retry."
        ),
        allow_abbrev=False,
    )
    parser.add_argument("--base-url", required=True, help="exact http://127.0.0.1:PORT")
    subcommands = parser.add_subparsers(dest="operation", required=True)
    subcommands.add_parser("contract", help="read the local route contract", allow_abbrev=False)
    subcommands.add_parser("recovery-contract", help="read the separate original-preparation recovery contract", allow_abbrev=False)
    subcommands.add_parser("command-contract", help="read the separate original-command contract", allow_abbrev=False)
    for name, help_text in (
        ("command-start", "retain an explicit original START from a current native preview; never send"),
        ("command-status", "read this original command's retained unverified history"),
        ("command-recovery", "construct an unsent RECOVER_RESULT for this retained original"),
        ("command-cancel", "retire the exact current original-command revision"),
    ):
        command = subcommands.add_parser(name, help=help_text, allow_abbrev=False)
        command.add_argument("--command-id", required=True, help="original lowercase non-nil UUID; never generated")
        if name == "command-start":
            command.add_argument("--preview-id", required=True)
        if name == "command-cancel":
            command.add_argument("--expected-revision", required=True)
    preview = subcommands.add_parser("preview", help="prepare a synthetic frozen preview", allow_abbrev=False)
    for name in ("cart-id", "shipping-quote-id", "fee-quote-id"):
        preview.add_argument("--" + name, required=True)
    read_preview = subcommands.add_parser("preview-status", help="read an existing preview", allow_abbrev=False)
    read_preview.add_argument("--preview-id", required=True)
    prepare = subcommands.add_parser("prepare", help="retain a checkout intent", allow_abbrev=False)
    prepare.add_argument("--preview-id", required=True)
    prepare.add_argument("--context-id", required=True)
    lookup = subcommands.add_parser("lookup", help="look up existing history by original preparation references; never create or retry", allow_abbrev=False)
    lookup.add_argument("--preview-id", required=True)
    lookup.add_argument("--context-id", required=True)
    for name, help_text in (
        ("status", "read retained historical intent status"),
        ("receipt", "capture a compact JWS read from stdin"),
        ("cancel", "cancel the exact current intent revision"),
    ):
        command = subcommands.add_parser(name, help=help_text, allow_abbrev=False)
        command.add_argument("--intent-id", required=True)
        if name == "cancel":
            command.add_argument("--expected-revision", required=True)
    return parser.parse_args()


def endpoint(base_url):
    match = re.fullmatch(r"http://127\.0\.0\.1:([1-9][0-9]{0,4})", base_url)
    if match is None or not 1 <= int(match[1]) <= 65535:
        raise ClientError("LOOPBACK_REQUIRED")
    return int(match[1])


def read_receipt():
    # Permit one file-ending LF or CRLF without changing the signed token bytes.
    # Reading one extra byte establishes overflow without collecting the stream.
    raw = sys.stdin.buffer.read(MAX_RECEIPT + 3)
    if raw.endswith(b"\r\n"):
        raw = raw[:-2]
    elif raw.endswith(b"\n"):
        raw = raw[:-1]
    if len(raw) > MAX_RECEIPT:
        raise ClientError("RECEIPT_LIMIT")
    try:
        value = raw.decode("ascii")
    except UnicodeError:
        raise ClientError("RECEIPT_INVALID") from None
    if re.fullmatch(r"[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", value) is None:
        raise ClientError("RECEIPT_INVALID")
    return value


def request_body(args):
    fields = {
        "contract": (), "preview": ("cart_id", "shipping_quote_id", "fee_quote_id"),
        "recovery-contract": (), "lookup": ("preview_id", "context_id"),
        "preview-status": ("preview_id",), "prepare": ("preview_id", "context_id"),
        "status": ("intent_id",), "receipt": ("intent_id",), "cancel": ("intent_id",),
        "command-contract": (), "command-start": ("command_id", "preview_id"),
        "command-status": ("command_id",), "command-recovery": ("command_id",),
        "command-cancel": ("command_id",),
    }[args.operation]
    payload = {name: getattr(args, name) for name in fields}
    if any(ID.fullmatch(value) is None for value in payload.values()):
        raise ClientError("INVALID_ARGUMENTS")
    if "command_id" in payload and not command_uuid(payload["command_id"]):
        raise ClientError("INVALID_ARGUMENTS")
    if args.operation in ("cancel", "command-cancel"):
        revision = args.expected_revision
        if re.fullmatch(r"[1-9][0-9]{0,15}", revision) is None or int(revision) > 9_007_199_254_740_991:
            raise ClientError("INVALID_ARGUMENTS")
        payload["expected_revision"] = int(revision)
    if args.operation == "receipt":
        payload["compact_jws"] = read_receipt()
    return payload


def strict_object(pairs):
    result = {}
    for name, value in pairs:
        if name in result:
            raise ClientError("RESPONSE_INVALID")
        result[name] = value
    return result


def reject_constant(value):
    raise ClientError("RESPONSE_INVALID")


def inspect_values(value, secrets):
    # Bound traversal and reject reflected input before any output is printed.
    pending = [(value, 0)]
    visited = 0
    while pending:
        current, depth = pending.pop()
        visited += 1
        if visited > 20_000 or depth > 32:
            raise ClientError("RESPONSE_INVALID")
        if isinstance(current, dict):
            if "execution_authorized" in current and current["execution_authorized"] is not False:
                raise ClientError("EXECUTION_AUTHORITY_REFUSED")
            for name, child in current.items():
                pending.extend(((name, depth + 1), (child, depth + 1)))
        elif isinstance(current, list):
            pending.extend((child, depth + 1) for child in current)
        elif isinstance(current, str):
            if any(0xD800 <= ord(character) <= 0xDFFF for character in current):
                raise ClientError("RESPONSE_INVALID")
            if any(secret and secret in current for secret in secrets):
                raise ClientError("SECRET_REFLECTION_REFUSED")
        elif isinstance(current, float) and not math.isfinite(current):
            raise ClientError("RESPONSE_INVALID")


def command_uuid(value):
    return (isinstance(value, str) and UUID.fullmatch(value) is not None
            and value != "00000000-0000-0000-0000-000000000000")


def safe_integer(value, minimum=0):
    return type(value) is int and minimum <= value <= MAX_SAFE_INTEGER


def command_fields(value, expected):
    if not isinstance(value, dict) or set(value) != set(expected):
        raise ClientError("RESPONSE_INVALID")


def command_digest(value):
    return isinstance(value, str) and SHA256.fullmatch(value) is not None


def command_uri(value):
    # Validate the spelling before parsing; never rewrite or fetch this reference.
    if (not isinstance(value, str) or not 1 <= len(value) <= 1024
            or re.fullmatch(r"[\x21-\x7e]+", value) is None
            or re.search(r"[\\*]|%(?![0-9a-fA-F]{2})", value)):
        raise ClientError("RESPONSE_INVALID")
    match = re.fullmatch(r"([A-Za-z][A-Za-z0-9+.-]*):(.+)", value)
    if match is None or value.count("#") > 1:
        raise ClientError("RESPONSE_INVALID")
    try:
        parsed = urlsplit(value)
        if (re.fullmatch(r"[A-Za-z0-9\-._~!$&'()+,;=:@%/]*", parsed.path) is None
                or any(re.fullmatch(r"[A-Za-z0-9\-._~!$&'()+,;=:@%/?]*", part) is None
                       for part in (parsed.query, parsed.fragment))):
            raise ClientError("RESPONSE_INVALID")
        if match[2].startswith("//"):
            host_parts = parsed.netloc.split("@")
            if (len(host_parts) > 2 or (len(host_parts) == 2
                    and re.fullmatch(r"[A-Za-z0-9\-._~!$&'()+,;=:%]*", host_parts[0]) is None)):
                raise ClientError("RESPONSE_INVALID")
            host = host_parts[-1]
            host_pattern = (r"\[[^\[\]]+\](?::[0-9]*)?" if host.startswith("[")
                            else r"[A-Za-z0-9\-._~!$&'()+,;=%]+(?::[0-9]*)?")
            if re.fullmatch(host_pattern, host) is None:
                raise ClientError("RESPONSE_INVALID")
        if match[1].lower() in ("http", "https"):
            if not match[2].startswith("//") or not parsed.hostname:
                raise ClientError("RESPONSE_INVALID")
            parsed.port  # Reject an invalid HTTP port without normalizing the URI.
    except ValueError:
        raise ClientError("RESPONSE_INVALID") from None


def command_grant(value):
    command_fields(value, ("id", "revision", "terms_digest"))
    if (not command_uuid(value["id"]) or not safe_integer(value["revision"], 1)
            or not command_digest(value["terms_digest"])):
        raise ClientError("RESPONSE_INVALID")


def command_operation(value):
    command_fields(value, ("action", "resource_id", "audience", "request_profile", "request_digest"))
    for key in ("action", "resource_id", "audience", "request_profile"):
        command_uri(value[key])
    if not command_digest(value["request_digest"]):
        raise ClientError("RESPONSE_INVALID")


def command_time(value):
    match = (re.fullmatch(r"([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]{1,9}))?Z", value)
             if isinstance(value, str) else None)
    if match is None:
        raise ClientError("RESPONSE_INVALID")
    try:
        instant = datetime(*(int(match[index]) for index in range(1, 7)))
    except ValueError:
        raise ClientError("RESPONSE_INVALID") from None
    seconds = instant.toordinal() * 86400 + instant.hour * 3600 + instant.minute * 60 + instant.second
    return seconds * 1_000_000_000 + int((match[7] or "").ljust(9, "0"))


def command_times(start, end):
    # These are historical result times, not a current authorization window.
    if command_time(start) >= command_time(end):
        raise ClientError("RESPONSE_INVALID")


def command_canonical(value):
    # This closed protocol subset has fixed ASCII keys/strings and safe integer
    # revisions. It does not claim a general-purpose RFC 8785 implementation.
    return json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False, separators=(",", ":"))


def command_original(canonical_request, kind, original_id, digest):
    if not isinstance(canonical_request, str) or len(canonical_request.encode("utf-8")) > 65_536:
        raise ClientError("RESPONSE_INVALID")
    try:
        original = json.loads(canonical_request, object_pairs_hook=strict_object, parse_constant=reject_constant)
    except (ValueError, RecursionError):
        raise ClientError("RESPONSE_INVALID") from None
    if kind == "START_USE":
        command_fields(original, ("profile", "command", "command_id", "grant", "operation"))
        command_grant(original["grant"])
        command_operation(original["operation"])
    elif kind == "FINALIZE_USE":
        command_fields(original, ("profile", "command", "command_id", "challenge_id", "proof_submission_id"))
        if not command_uuid(original["challenge_id"]) or not command_uuid(original["proof_submission_id"]):
            raise ClientError("RESPONSE_INVALID")
    else:
        raise ClientError("RESPONSE_INVALID")
    if (original["profile"] != COMMAND_PROFILE or original["command"] != kind
            or original["command_id"] != original_id
            or command_canonical(original) != canonical_request
            or "sha256:" + hashlib.sha256(canonical_request.encode("utf-8")).hexdigest() != digest):
        raise ClientError("RESPONSE_BINDING_MISMATCH")
    return original


def command_observation(response, original, digest):
    command_fields(response, ("profile", "original_command_id", "command_digest", "recovered", "result"))
    if (response["profile"] != RESPONSE_PROFILE or type(response["recovered"]) is not bool
            or response["original_command_id"] != original["command_id"]
            or response["command_digest"] != digest):
        raise ClientError("RESPONSE_BINDING_MISMATCH")
    result = response["result"]
    if original["command"] == "START_USE":
        command_fields(result, ("kind", "challenge_id", "grant", "operation", "created_at", "expires_at"))
        command_grant(result["grant"])
        command_operation(result["operation"])
        if (result["kind"] != "CHALLENGE" or not command_uuid(result["challenge_id"])
                or result["grant"] != original["grant"] or result["operation"] != original["operation"]):
            raise ClientError("RESPONSE_BINDING_MISMATCH")
        command_times(result["created_at"], result["expires_at"])
    else:
        command_fields(result, ("kind", "challenge_id", "decision", "receipt_ref", "receipt_digest",
                                "recorded_at", "authorization_expires_at", "semantics"))
        if (result["kind"] != "FINAL_USE" or result["semantics"] != "EVIDENCE_ONLY"
                or result["challenge_id"] != original["challenge_id"]
                or result["decision"] not in ("PERMIT", "DENY") or not command_digest(result["receipt_digest"])):
            raise ClientError("RESPONSE_BINDING_MISMATCH")
        command_uri(result["receipt_ref"])
        command_times(result["recorded_at"], result["authorization_expires_at"])


def validate_command_result(result, operation, request):
    view_fields = {"claim_id", "original_command_id", "namespace_digest", "command_kind", "command_digest",
                   "created_at", "updated_at", "observed_at", "revision", "state", "retired", "minimized",
                   "canonical_request", "response"}
    recovery_fields = {"request", "canonical_json", "original_command_id", "command_digest"}
    command_fields(result, (recovery_fields if operation == "command-recovery" else view_fields) | set(COMMAND_FLAGS))
    for key, expected in COMMAND_FLAGS.items():
        if ((expected is False and result[key] is not False)
                or (expected is not False and result[key] != expected)):
            raise ClientError("RESPONSE_INVALID")
    if not command_uuid(result["original_command_id"]) or not command_digest(result["command_digest"]):
        raise ClientError("RESPONSE_INVALID")
    # RCG4BC4-CLIENT-ORIGINAL-UUID: bind the complete self-consistent result to
    # this caller's original. Remaining checks use the returned original only.
    if result["original_command_id"] != request["command_id"]:
        raise ClientError("RESPONSE_BINDING_MISMATCH")
    if operation == "command-recovery":
        recovery = result["request"]
        command_fields(recovery, ("profile", "command", "original_command_id", "expected_command_digest"))
        if (recovery["profile"] != COMMAND_PROFILE or recovery["command"] != "RECOVER_RESULT"
                or recovery["original_command_id"] != result["original_command_id"]
                or recovery["expected_command_digest"] != result["command_digest"]
                or result["canonical_json"] != command_canonical(recovery)):
            raise ClientError("RESPONSE_BINDING_MISMATCH")
        # This digest names the retained original; it is not the recovery hash.
        return
    if (not isinstance(result["claim_id"], str)
            or re.fullmatch(r"delegated_command_[a-f0-9]{40}", result["claim_id"]) is None
            or not isinstance(result["namespace_digest"], str)
            or re.fullmatch(r"[a-f0-9]{64}", result["namespace_digest"]) is None
            or result["command_kind"] not in ("START_USE", "FINALIZE_USE")
            or (operation == "command-start" and result["command_kind"] != "START_USE")
            or not all(safe_integer(result[key]) for key in ("created_at", "updated_at"))
            or result["updated_at"] < result["created_at"] or not safe_integer(result["revision"], 1)
            or result["state"] not in ("claimed", "observed", "cancelled")
            or type(result["retired"]) is not bool or type(result["minimized"]) is not bool):
        raise ClientError("RESPONSE_INVALID")
    observed = result["observed_at"] is not None
    if ((observed and (not safe_integer(result["observed_at"]) or result["revision"] < 2
                      or not result["created_at"] <= result["observed_at"] <= result["updated_at"]))
            or (result["state"] == "claimed" and observed) or (result["state"] == "observed" and not observed)
            or (result["state"] == "cancelled" and not result["retired"])
            or (result["minimized"] and not result["retired"]) or (result["retired"] and result["revision"] < 2)
            or (operation == "command-cancel" and (not result["retired"] or result["revision"] not in
                                                   (request["expected_revision"], request["expected_revision"] + 1)))
            or (result["revision"] == 1 and (result["state"] != "claimed" or result["retired"]
                                            or result["updated_at"] != result["created_at"]))):
        raise ClientError("RESPONSE_INVALID")
    # Retired history always masks personal content, including a retained hold.
    if result["retired"]:
        if result["canonical_request"] is not None or result["response"] is not None:
            raise ClientError("RESPONSE_INVALID")
        return
    original = command_original(result["canonical_request"], result["command_kind"],
                                result["original_command_id"], result["command_digest"])
    if observed != (result["response"] is not None):
        raise ClientError("RESPONSE_INVALID")
    if observed:
        command_observation(result["response"], original, result["command_digest"])


def validate_response(value, operation, request, bearer):
    if not isinstance(value, dict) or set(value) != ENVELOPE_FIELDS:
        raise ClientError("RESPONSE_INVALID")
    if value["execution_authorized"] is not False:
        raise ClientError("EXECUTION_AUTHORITY_REFUSED")
    if (value["profile"] != "commerce-sqlite-diagnostic"
            or value["qualification"] != "candidate_contract_only"
            or value["evidence_status"] != "historical_observation"
            or value["operation"] != operation
            or not isinstance(value["result"], dict)):
        raise ClientError("RESPONSE_INVALID")
    inspect_values(value, (bearer, request.get("compact_jws")))
    result = value["result"]
    if operation in ("contract", "recovery-contract", "command-contract"):
        expected = [
            ("GET", "/contract", "contract", []),
            ("POST", "/preview", "preview", ["cart_id", "shipping_quote_id", "fee_quote_id"]),
            ("POST", "/preview-status", "preview-status", ["preview_id"]),
            ("POST", "/prepare", "prepare", ["preview_id", "context_id"]),
            ("POST", "/status", "status", ["intent_id"]),
            ("POST", "/receipt", "receipt", ["intent_id", "compact_jws"]),
            ("POST", "/cancel", "cancel", ["intent_id", "expected_revision"]),
        ]
        base_path = "/v1/delegated-checkout"
        if operation == "recovery-contract":
            base_path = "/v1/delegated-checkout-recovery"
            expected = [
                ("GET", "/contract", "recovery-contract", []),
                ("POST", "/lookup", "lookup", ["preview_id", "context_id"]),
            ]
        if operation == "command-contract":
            base_path = "/v1/delegated-checkout-commands"
            expected = [
                ("GET", "/contract", "command-contract", []),
                ("POST", "/start", "command-start", ["command_id", "preview_id"]),
                ("POST", "/status", "command-status", ["command_id"]),
                ("POST", "/recovery", "command-recovery", ["command_id"]),
                ("POST", "/cancel", "command-cancel", ["command_id", "expected_revision"]),
            ]
        routes = result.get("routes")
        if (type(result.get("schema_version")) is not int or result["schema_version"] != 1
                or result.get("profile") != "commerce-sqlite-diagnostic"
                or result.get("qualification") != "candidate_contract_only"
                or result.get("base_path") != base_path
                or not isinstance(routes, list) or len(routes) != len(expected)):
            raise ClientError("RESPONSE_INVALID")
        for route, (method, path, name, fields) in zip(routes, expected):
            if (not isinstance(route, dict) or set(route) != {"method", "path", "operation", "body"}
                    or (route["method"], route["path"], route["operation"], route["body"]) != (method, path, name, fields)):
                raise ClientError("RESPONSE_INVALID")
    elif operation.startswith("command-"):
        validate_command_result(result, operation, request)
    elif operation in ("preview", "preview-status"):
        if (result.get("qualification") != "synthetic_only"
                or not isinstance(result.get("preview_id"), str)
                or ID.fullmatch(result["preview_id"]) is None
                or not isinstance(result.get("preview_digest"), str)
                or re.fullmatch(r"[a-f0-9]{64}", result["preview_digest"]) is None):
            raise ClientError("RESPONSE_INVALID")
        key = "cart_id" if operation == "preview" else "preview_id"
        if result.get(key) != request[key]:
            raise ClientError("RESPONSE_BINDING_MISMATCH")
    elif operation != "contract":
        if operation == "lookup":
            if (set(result) != {"original", "intent"}
                    or not isinstance(result["original"], dict)
                    or result["original"] != request
                    or not isinstance(result["intent"], dict)):
                raise ClientError("RESPONSE_BINDING_MISMATCH")
            result = result["intent"]
        if (result.get("execution_authorized") is not False
                or result.get("qualification") != "candidate_contract_only"
                or result.get("evidence_status") != "historical_observation"
                or not isinstance(result.get("intent_id"), str)
                or ID.fullmatch(result["intent_id"]) is None
                or type(result.get("revision")) is not int
                or not 1 <= result["revision"] <= 9_007_199_254_740_991
                or result.get("state") not in ("prepared", "evidence_verified", "cancelled", "expired")):
            raise ClientError("RESPONSE_INVALID")
        if "intent_id" in request and result["intent_id"] != request["intent_id"]:
            raise ClientError("RESPONSE_BINDING_MISMATCH")
    return value


def call(args):
    port = endpoint(args.base_url)
    bearer = os.environ.get("RIFARE_BEARER", "")
    if re.fullmatch(r"[A-Za-z0-9_-]{43}", bearer) is None:
        raise ClientError("CREDENTIAL_REQUIRED")
    payload = request_body(args)
    body = None if args.operation in ("contract", "recovery-contract", "command-contract") else json.dumps(payload, separators=(",", ":")).encode("utf-8")
    headers = {"Authorization": "Bearer " + bearer, "Accept": "application/json", "Connection": "close"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    # HTTPConnection uses this literal host directly. It has no proxy discovery,
    # redirect handler, cookie jar, authentication fallback or application retry.
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=TIMEOUT_SECONDS)
    try:
        base_path = "/v1/delegated-checkout-recovery/" if args.operation in ("recovery-contract", "lookup") else "/v1/delegated-checkout/"
        operation_path = "contract" if args.operation == "recovery-contract" else args.operation
        if args.operation.startswith("command-"):
            base_path = "/v1/delegated-checkout-commands/"
            operation_path = args.operation[len("command-"):]
        connection.request("GET" if body is None else "POST",
                           base_path + operation_path, body=body, headers=headers)
        response = connection.getresponse()
        if 300 <= response.status < 400:
            raise ClientError("REDIRECT_REFUSED")
        if response.status != 200:
            raise ClientError(HTTP_ERRORS.get(response.status, "REQUEST_FAILED"))
        media_type = response.getheader("Content-Type", "").split(";", 1)[0].strip().lower()
        length = response.getheader("Content-Length")
        if (media_type != "application/json"
                or response.getheader("Content-Encoding", "identity").lower() != "identity"
                or (length is not None and re.fullmatch(r"[0-9]{1,9}", length) is None)):
            raise ClientError("RESPONSE_INVALID")
        if length is not None and int(length) > MAX_RESPONSE:
            raise ClientError("RESPONSE_LIMIT")
        raw = response.read(MAX_RESPONSE + 1)
        if len(raw) > MAX_RESPONSE:
            raise ClientError("RESPONSE_LIMIT")
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=strict_object, parse_constant=reject_constant)
        return validate_response(value, args.operation, payload, bearer)
    finally:
        connection.close()


def main():
    try:
        result = call(arguments())
        print(json.dumps(result, ensure_ascii=True, allow_nan=False, separators=(",", ":")))
        return 0
    except ClientError as error:
        code = str(error)
    except (OSError, http.client.HTTPException, ValueError, RecursionError):
        code = "REQUEST_FAILED"
    print(json.dumps({"error": code, "execution_authorized": False}), file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
