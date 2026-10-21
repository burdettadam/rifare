# License scope and attribution

Copyright (c) 2026 Adam Burdett and the respective Rifare contributors.

The licensors offer their original Rifare material under the terms below, each
only to the extent of the rights they hold. No ownership of third-party material,
copyright in ineligible material, trademark permission, or commercial relicensing
authority is asserted.

## Default license

Except for the explicit exceptions below, original Rifare source in this
repository is licensed under **GNU Affero General Public License, version 3 only
(AGPL-3.0-only)**. The complete text is in [LICENSE](../LICENSE). This includes
the application surfaces, in-process commerce/agent/adapter implementation, and
database migrations.

## Apache-2.0 exceptions

Original Rifare material in the following paths is licensed under the
[Apache License, version 2.0](Apache-2.0.txt):

- `clients/`, `docs/`, `examples/`, `planning/`, `tests/`, `tools/`, and `work/`.
- `.github/`, `.vscode/`, and `.agents/rubrics/`.
- Public skill resources in `packages/commerce/skill-bundles/`.
- JSON protocol schemas in `packages/*/contracts/` and
  `packages/presentation/locale-contract.v1.json`.
- The root developer/documentation files `AGENTS.md`, `LICENSE-STATUS.md`,
  `Makefile`, `README.md`, `package.json`, `package-lock.json`, `.editorconfig`,
  `.env.example`, `.gitattributes`, `.gitignore`, `.node-version`, and `.npmrc`.
- Original notices and metadata in this directory; the reproduced license
  documents retain their own stated copying permissions.

This includes original brand artwork and recorded demonstration media under
`docs/`, only to the extent rights exist. It does not grant rights in a third-party
logo, model, font, recording, or dependency merely because one is later placed
there. Source inventory review remains required for additions.

The scope notice applies without requiring edits to every existing source file.
Copy this notice and the applicable license text with redistributed material;
retain existing attribution and modification notices. The rules are also listed
in [application.json](application.json). For a file with identified upstream
content, its applicable upstream terms remain in force.

## Retained upstream material

The inherited portions of `.agents/skills/work-goal/SKILL.md` and
`.agents/skills/worktree-flow/SKILL.md` retain the MIT license and copyright notice
in [THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md). Original Rifare additions
and modifications in those two files are Apache-2.0. The combined attribution
expression is `MIT AND Apache-2.0`; it does not replace MIT or claim ownership of
the inherited text. The retained notice file includes the complete MIT grant.

`LICENSE`, `Apache-2.0.txt`, and `.github/DCO.txt` are reproduced legal documents,
not newly authored Rifare software. Their own stated reproduction permissions
govern those documents. No modified license text is being substituted.

Downloaded tools, dependencies, models, runtimes, and service assets retain their
own licenses and are not bundled by this source notice. In particular, the
optional formatter and referenced GitHub Actions are development tools, not
licensed as original Rifare code. Keep their license/notice files when installing
or redistributing them.
