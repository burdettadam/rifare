#!/usr/bin/env python3
"""Independent local Rifare checkout caller; Python standard library only.

This diagnostic client captures historical evidence. It never authorizes a
purchase. Supply RIFARE_BEARER privately through the process environment; supply
a receipt through stdin, never a command argument. A failed request is never
retried automatically, even if its result was lost.
"""
import argparse
import http.client
import json
import math
import os
import re
import sys


MAX_RECEIPT = 100_000
MAX_RESPONSE = 262_144
TIMEOUT_SECONDS = 5
ID = re.compile(r"[A-Za-z0-9_-]{1,96}\Z")
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
    }[args.operation]
    payload = {name: getattr(args, name) for name in fields}
    if any(ID.fullmatch(value) is None for value in payload.values()):
        raise ClientError("INVALID_ARGUMENTS")
    if args.operation == "cancel":
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
        elif isinstance(current, str) and any(secret and secret in current for secret in secrets):
            raise ClientError("SECRET_REFLECTION_REFUSED")
        elif isinstance(current, float) and not math.isfinite(current):
            raise ClientError("RESPONSE_INVALID")


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
    if operation in ("contract", "recovery-contract"):
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
    body = None if args.operation in ("contract", "recovery-contract") else json.dumps(payload, separators=(",", ":")).encode("utf-8")
    headers = {"Authorization": "Bearer " + bearer, "Accept": "application/json", "Connection": "close"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    # HTTPConnection uses this literal host directly. It has no proxy discovery,
    # redirect handler, cookie jar, authentication fallback or application retry.
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=TIMEOUT_SECONDS)
    try:
        base_path = "/v1/delegated-checkout-recovery/" if args.operation in ("recovery-contract", "lookup") else "/v1/delegated-checkout/"
        operation_path = "contract" if args.operation == "recovery-contract" else args.operation
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
