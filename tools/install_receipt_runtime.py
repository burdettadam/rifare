#!/usr/bin/env python3
"""Install ADR-0068's locked optional JOSE package outside first-party sources."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile

import check_distribution as distribution

# These files are from the exact official archive pinned by RECEIPT_JOSE_LOCK.
# npm validates that archive's integrity; retain and additionally check its terms.
INSTALLED_FILE_PINS = {
    'package.json': 'b513306bd125bc8ffbc519d68a59bfdbc7e03d4e9a360c04cec132799669e3bf',
    'LICENSE.md': '8078b0829d6c3e9ecde2f003e1966e4cad3efc6e7a640efbab0313cc166b1af1',
}
NESTED_MODULES = (
    'packages/node_modules',
    'packages/adapters/node_modules',
    'packages/adapters/delegated-receipts/node_modules',
)
MAX_ENTRIES = 1000
MAX_FILE_BYTES = 2 * 1024 * 1024
MAX_TOTAL_BYTES = 16 * 1024 * 1024


def require(condition: bool, message: str) -> None:
    distribution.require(condition, f'receipt runtime install: {message}')


def exists(path: Path) -> bool:
    """Unlike Path.exists, include dangling symlinks in refusal checks."""
    return os.path.lexists(path)


def directory(path: Path) -> None:
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode),
            'expected a real directory')


def check_layout(root: Path) -> None:
    # A nested install both shadows root resolution and enters the unchanged
    # first-party privacy observer. Never remove an existing install implicitly.
    for relative in NESTED_MODULES:
        require(not exists(root / relative),
                f'nested node_modules must be removed by its owner: {relative}')
    modules = root / 'node_modules'
    if exists(modules):
        directory(modules)
    destination = modules / 'jose'
    if exists(destination):
        directory(destination)


def manifests(root: Path) -> dict[str, bytes]:
    distribution.validate_smoke_command_manifests(root)
    validated = distribution.validate_optional_receipt_runtime(root)
    require(validated == set(distribution.RECEIPT_RUNTIME_MANIFESTS),
            'reviewed receipt manifests are required')
    result = {}
    for relative, digest in distribution.RECEIPT_RUNTIME_MANIFESTS.items():
        data = distribution.read_regular(root, relative)
        require(distribution.sha256(data) == digest, 'receipt manifest changed while reading')
        result[Path(relative).name] = data
    return result


def package_tree(package: Path) -> list[tuple[str, str, str]]:
    """Compare only ordinary installed bytes in this stable, owned checkout."""
    directory(package)
    entries = []
    total_bytes = 0

    def walk(current: Path) -> None:
        nonlocal total_bytes
        for path in sorted(current.iterdir()):
            relative = path.relative_to(package).as_posix()
            info = path.lstat()
            require(not stat.S_ISLNK(info.st_mode), 'unsafe installed entry')
            require(len(entries) < MAX_ENTRIES, 'installed tree exceeds entry bound')
            if stat.S_ISDIR(info.st_mode):
                entries.append((relative, 'directory', ''))
                walk(path)
                continue
            require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1,
                    'unsafe installed entry')
            require(info.st_size <= MAX_FILE_BYTES, 'installed file exceeds size bound')
            total_bytes += info.st_size
            require(total_bytes <= MAX_TOTAL_BYTES, 'installed tree exceeds size bound')
            contents = distribution.read_regular(package, relative)
            require(len(contents) == info.st_size, 'installed file changed while reading')
            entries.append((relative, 'file', distribution.sha256(contents)))

    walk(package)
    return sorted(entries)


def staged_package(prefix: Path, expected: dict[str, bytes]) -> list[tuple[str, str, str]]:
    for name, data in expected.items():
        require(distribution.read_regular(prefix, name) == data, 'staged manifest changed')
    modules = prefix / 'node_modules'
    directory(modules)
    require({p.name for p in modules.iterdir()} == {'jose', '.package-lock.json'},
            'staged dependency graph changed')
    hidden_lock = distribution.decode_json(distribution.read_regular(modules, '.package-lock.json'))
    require(hidden_lock == {
        'name': 'rifare-delegated-receipts', 'version': '0.0.0',
        'lockfileVersion': 3, 'requires': True,
        'packages': {'node_modules/jose': distribution.RECEIPT_JOSE_LOCK},
    }, 'staged dependency graph changed')
    package = modules / 'jose'
    tree = package_tree(package)
    file_hashes = {path: digest for path, kind, digest in tree if kind == 'file'}
    for name, digest in INSTALLED_FILE_PINS.items():
        require(file_hashes.get(name) == digest, f'installed package or notice changed: {name}')
    return tree


def install(root: Path, *, offline: bool = False) -> dict:
    """Use npm's locked installation, then atomically move only its JOSE tree.

    Operate on an owned, stable checkout, with no concurrent package manager or
    filesystem writer. This helper does not attempt to sandbox npm or a hostile
    local filesystem. A root npm ci later prunes this optional installation.
    """
    root = root.absolute()
    directory(root)
    expected = manifests(root)
    check_layout(root)
    modules = root / 'node_modules'
    modules.mkdir(exist_ok=True)
    destination = modules / 'jose'
    with tempfile.TemporaryDirectory(prefix='.rifare-receipt-', dir=modules) as temporary:
        prefix = Path(temporary)
        for name, data in expected.items():
            (prefix / name).write_bytes(data)
        command = [
            shutil.which('npm') or 'npm', 'ci', '--prefix', str(prefix), '--ignore-scripts',
            '--no-audit', '--no-fund', '--install-strategy=hoisted',
            '--global=false', '--package-lock=true', '--workspaces=false',
        ]
        if offline:
            command.append('--offline')
        try:
            subprocess.run(command, cwd=prefix, stdin=subprocess.DEVNULL,
                           capture_output=True, text=True, check=True, timeout=60)
        except (subprocess.SubprocessError, OSError) as error:
            raise ValueError('receipt runtime install: npm ci did not complete; '
                             'no package was promoted') from error
        tree = staged_package(prefix, expected)
        require(manifests(root) == expected, 'source manifests changed during install')
        check_layout(root)
        if exists(destination):
            require(package_tree(destination) == tree,
                    'existing JOSE differs; remove it explicitly before installing')
            status = 'already_present'
        else:
            # Same-filesystem rename: no partial package becomes importable.
            (prefix / 'node_modules/jose').rename(destination)
            status = 'installed'
    return {
        'status': status,
        'version': distribution.RECEIPT_JOSE_LOCK['version'],
        'integrity': distribution.RECEIPT_JOSE_LOCK['integrity'],
        'destination': 'node_modules/jose',
        'files': sum(kind == 'file' for _, kind, _ in tree),
        'tree_sha256': distribution.sha256(json.dumps(tree, separators=(',', ':')).encode()),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--offline', action='store_true', help='require the locked archive in npm cache')
    args = parser.parse_args()
    try:
        report = install(args.root, offline=args.offline)
    except (ValueError, OSError) as error:
        print(str(error), file=sys.stderr)
        return 1
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
