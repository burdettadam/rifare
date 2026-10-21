#!/usr/bin/env python3
"""Render the remaining backlog; retained contracts do not imply acceptance."""
from __future__ import annotations

import argparse
import html
import json
from pathlib import Path


def render(root: Path) -> None:
    def load(path: str):
        return json.loads((root / path).read_text(encoding='utf-8'))

    def write(path: str, content: str) -> None:
        target = root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content.strip() + '\n', encoding='utf-8')

    def bullets(items) -> str:
        return '\n'.join('- ' + item for item in items)

    def numbered(items: list[str]) -> str:
        return '\n'.join(f'{number}. {item}' for number, item in enumerate(items, 1))

    def cell(value: str) -> str:
        return value.replace('|', '\\|').replace('\n', ' ')

    plan = load('planning/goals.json')
    goals = plan['goals']
    by_id = {goal['id']: goal for goal in goals}
    integration = plan.get('integration_work', [])
    integration_by_goal = {}
    for row in integration:
        for goal_id in row['related_original_goal_ids']:
            integration_by_goal.setdefault(goal_id, row['owner_goal_id'])
    tests = load('planning/test-specifications.json')['tests']
    by_test = {test['id']: test for test in tests}
    milestones = load('planning/milestones.json')['milestones']
    requirements = load('planning/requirement-coverage.json')['requirements']
    worker_count = sum(goal['type'] == 'worker_goal' for goal in goals)
    gate_count = sum(goal['type'] == 'milestone_acceptance' for goal in goals)

    def dependency(goal_id: str, packet_prefix: str, catalogue: str) -> str:
        if goal_id in by_id:
            return f'[{goal_id}]({packet_prefix}{by_id[goal_id]["milestone"]}/{goal_id}.md)'
        if goal_id in integration_by_goal:
            owner = integration_by_goal[goal_id]
            return f'[{goal_id} — remaining integration]({catalogue}#integration-{owner.lower()})'
        return f'`{goal_id}` (historical contract)'

    # Only active packets are generated. Retired implementation instructions live
    # in Git; their executable tests and behavioral specifications remain current.
    for goal in goals:
        goal_id = goal['id']
        followup = goal.get('remaining_work', [])
        lines = [f'# {goal_id} — {goal["title"]}',
                 f'**Milestone:** {goal["milestone"]} · **Type:** {goal["type"]} · '
                 f'**Lane:** {goal["lane"]} · **Risk:** {goal["risk"]}',
                 f'**State:** remaining work · **Execution:** {goal["execution_mode"]}',
                 '> This packet describes outstanding work. Its presence, removal, or rendered state '
                 'does not establish formal acceptance, production qualification, or executed tests.',
                 '## Outcome', goal['outcome']]
        if goal.get('landed_context'):
            lines += ['## Existing implementation', goal['landed_context']]
        if followup:
            lines += ['## Remaining work', bullets(followup)]
        lines += ['## Dependencies',
                  '; '.join(dependency(item, '../', '../../WORKER-GOALS.md')
                            for item in goal['depends_on']) or 'No prior goal dependency.',
                  'Formal dependencies still require accepted evidence. A historical contract is not an '
                  'accepted prerequisite; removal of an implementation packet does not close its qualification gate.',
                  '[Architecture](../../../docs/ARCHITECTURE.md) · '
                  '[Qualification](../../../docs/QUALIFICATION.md) · [Work records](../../../work/README.md)',
                  '## Bounded ownership', bullets(goal['scope']), goal['scope_note']]
        if not followup:
            lines += ['## Before starting', numbered(goal['prerequisites']),
                      '## Worker instructions', numbered(goal['worker_steps'])]
        if goal.get('implementation_plan'):
            implementation = goal['implementation_plan']
            selection = implementation['first_verification_slice']
            lines += ['## Implementation map for assignment',
                      '**Planning state:** `' + implementation['planning_state'] + '`',
                      '### Existing paths to inspect and reuse',
                      bullets('`' + path + '`' for path in implementation['reuse_paths']),
                      '### Proposed owned paths', implementation['proposed_paths_note'],
                      bullets('`' + path + '`' for path in implementation['proposed_paths']),
                      '### First verification slice',
                      '**State:** `' + selection['state'] + '` · **Executor:** ' + selection['executor'],
                      '**Proposed whole files:** ' + ', '.join('`' + path + '`' for path in selection['whole_files']),
                      '**Stable specification IDs:** ' + ', '.join('`' + identity + '`' for identity in selection['case_ids']),
                      f'**Slice ceiling:** {selection["max_actual_cases"]} actual cases, '
                      f'{selection["max_whole_files"]} whole files, one '
                      f'{selection["invocation_deadline_seconds"]}-second invocation deadline.',
                      selection['scope'], selection['qualification_boundary'],
                      '### Goal-specific handoff', bullets(implementation['handoff'])]
        lines += ['## Do not change', bullets(goal['non_goals']),
                  '## Preserved acceptance criteria', bullets(goal.get('acceptance_criteria', [])),
                  '## Required behavior and permanent tests']
        for identity in goal['new_test_ids']:
            test = by_test[identity]
            lines += [f'### {identity} — {test["kind"]}',
                      f'**Fixture:** `{test["fixture_id"]}` · **Layer:** {test["level"]}',
                      '**Arrange and act:** ' + test['given_when'],
                      '**Assert:** ' + test['then'],
                      '**Independent oracle:** ' + test['oracle'],
                      '**Proposed implementation:** `' + test['suggested_test_path']
                      + '` (bind to actual project commands and native runner cases).']
            if test.get('mutation_to_detect'):
                lines += ['**Deliberately broken behavior the test must catch:** ' + test['mutation_to_detect']]
            lines += ['**Proof requirement:** ' + test['mutation_or_red_proof']]
        seeds = list(dict.fromkeys(goal['source_seed_test_ids'] + goal['extension_seed_test_ids']))
        if seeds:
            lines += ['## Retained original scenario obligations']
            for identity in seeds:
                test = by_test[identity]
                label = 'primary owner' if identity in goal['source_seed_test_ids'] else 'later-path extension'
                lines += [f'### {identity} — {test["title"]} ({label})',
                          '**Scenario:** ' + test['scenario'], '**Expected:** ' + test['expected_result']]
        contract = goal['regression_contract']
        lines += ['## Evidence and regression protection',
                  f'Proposed bundle: `evidence/{goal_id}/<candidate-sha>/`',
                  bullets(goal['required_evidence']),
                  '**Protected feature:** `' + contract['stable_capability_id'] + '`',
                  '**Test obligations:** ' + ', '.join('`' + identity + '`' for identity in goal['required_test_ids']),
                  contract['baseline_policy'], contract['cumulative_selection'], contract['semantic_weakening_policy'],
                  '**Cross-cutting invariants:** ' + (', '.join(goal['invariant_ids']) or 'Retain the current invariant baseline.'),
                  'The author reports ready for review. A trusted maintainer accepts after the required independent '
                  'reviews. Simulated boundaries do not qualify connected money, media, physical operations, or a release.']
        if goal['source_requirements']:
            lines += ['## Original requirement traceability']
            for requirement in goal['source_requirements']:
                lines += [f'**{requirement["id"]} — {requirement["title"]}:** '
                          + requirement['original_acceptance_criteria'], requirement['contribution']]
        if goal['type'] == 'milestone_acceptance':
            lines += ['## Original milestone exit criteria', numbered(goal['original_milestone_exit_criteria']),
                      '**Requirement closure:** ' + ', '.join('`' + identity + '`' for identity in goal['gate_requirement_ids']),
                      'Requirements remain conjunctive across their mapped implementation and qualification obligations. '
                      'An exclusion is not a passing feature; missing required evidence leaves the release unqualified.']
        lines += ['[Worker contract](../../../docs/WORKER-CONTRACT.md) · '
                  '[Regression strategy](../../../docs/REGRESSION-STRATEGY.md) · '
                  '[Evidence contract](../../../docs/EVIDENCE-CONTRACT.md) · '
                  '[Work record template](../../templates/GOAL-WORK-RECORD.md)']
        write(f'planning/goals/{goal["milestone"]}/{goal_id}.md', '\n\n'.join(lines))

    catalogue = ['# Rifare — remaining work',
                 f'**{worker_count} worker follow-ups · {gate_count} integration/acceptance gates · '
                 f'{len(integration)} connected-adapter follow-ups.** '
                 f'{len(goals)} detailed packets across {len(milestones)} milestone groups.',
                 'Implemented work is documented in [the architecture](../docs/ARCHITECTURE.md) and Git history. '
                 'The backlog keeps unfinished implementation and qualification visible. '
                 'Retiring a packet does not accept its historical dependencies or qualify a release.',
                 f'All **{len(tests)} behavioral specifications** and **{len(requirements)} requirement contracts** remain '
                 'in [the specification inventory](test-specifications.json) and '
                 '[requirement traceability](requirement-coverage.json). Native tests and independent oracles remain protected.',
                 '[Development guide](../docs/DEVELOPMENT.md) · [Qualification](../docs/QUALIFICATION.md) · '
                 '[Work records](../work/README.md) · '
                 '[Machine-readable backlog](goals.json) · [Searchable index](WORKER-GOALS.html)',
                 '## Detailed follow-ups',
                 '| Milestone group | Remaining workers | Active acceptance gate |\n|---|---:|---|']
    for milestone in milestones:
        identity = milestone['id']
        gate = milestone.get('acceptance_goal_id')
        gate_link = f'[{gate}](goals/{identity}/{gate}.md)' if gate else 'Qualification obligations retained separately'
        catalogue[-1] += (f'\n| [{identity} — {cell(milestone["title"])}](milestones/{identity}.md) | '
                          f'{milestone["worker_goal_count"]} | {gate_link} |')
        members = [goal for goal in goals if goal['milestone'] == identity]
        lines = [f'# {identity} — {milestone["title"]}', milestone['outcome'],
                 f'**Remaining workers:** {milestone["worker_goal_count"]} · '
                 + (f'**Active gate:** [{gate}](../goals/{identity}/{gate}.md)' if gate
                    else '**Active gate:** none; historical release obligations remain below.'),
                 '**Historical prerequisite milestones:** ' + (', '.join(milestone['depends_on']) or 'None.'),
                 'Milestone membership tracks remaining work. It does not assert that predecessor gates or the '
                 'original release criteria have been accepted.',
                 '## Remaining packets', '| Goal | Deliverable | Lane |\n|---|---|---|']
        for goal in members:
            lines[-1] += (f'\n| [{goal["id"]}](../goals/{identity}/{goal["id"]}.md) | '
                          f'{cell(goal["title"])} | {cell(goal["lane"])} |')
        lines += ['## Preserved qualification obligations', milestone['required_demo'],
                  bullets(milestone['exit_criteria']), milestone['exit_rule'], milestone['exclusion_rule'],
                  '[Architecture](../../docs/ARCHITECTURE.md) · '
                  '[Qualification](../../docs/QUALIFICATION.md) · [Work records](../../work/README.md) · '
                  '[Remaining-work index](../WORKER-GOALS.md)']
        write(f'planning/milestones/{identity}.md', '\n\n'.join(lines))
    catalogue += ['## Packet index', '| Goal | Remaining deliverable |\n|---|---|']
    for goal in goals:
        catalogue[-1] += f'\n| [{goal["id"]}](goals/{goal["milestone"]}/{goal["id"]}.md) | {cell(goal["title"])} |'
    if integration:
        catalogue += ['## Integration follow-ups',
                      'Reuse the landed lifecycle, authority, privacy, and regression code. These rows identify '
                      'connections that still need implementation; fixture-backed source paths do not supply a live adapter. '
                      'Original goal IDs identify preserved contracts, not new implementation packets.',
                      '| Original owner | Remaining connection | Existing implementation and evidence |\n|---|---|---|']
        for row in integration:
            owner = row['owner_goal_id']
            paths = '<br>'.join(f'[{path}](../{path})' for path in row['evidence_paths'])
            catalogue[-1] += (f'\n| <a id="integration-{owner.lower()}"></a>`{owner}` | '
                              f'{cell(row["remaining_outcome"])} | {paths} |')
    write('planning/WORKER-GOALS.md', '\n\n'.join(catalogue))

    # A compact, offline index links to the one detailed packet for each task.
    escape = html.escape
    styles = '''*{box-sizing:border-box}body{margin:0;background:#f5f7fa;color:#152435;font:16px/1.55 system-ui,sans-serif}header{background:#102c3f;color:white;padding:36px max(20px,calc((100vw - 1180px)/2))}main{max-width:1220px;margin:auto;padding:24px 20px 60px}h1{font-size:36px;line-height:1.15;margin:0 0 12px}h2{margin-top:32px}a{color:#075a79}.meta{font-size:14px;opacity:.85}.notice{border-left:4px solid #a57819;background:#fff5da;padding:12px 18px}.toolbar{display:flex;flex-wrap:wrap;gap:10px;margin:24px 0 12px}input,select{font:inherit;padding:10px;border:1px solid #a8bac7;border-radius:6px}input{flex:1;min-width:220px}table{width:100%;border-collapse:collapse;background:white}td,th{text-align:left;vertical-align:top;border-bottom:1px solid #dfe6eb;padding:12px}th{background:#e7eef3}code{font-size:.9em;overflow-wrap:anywhere}.quiet{color:#4e6170;font-size:14px}.hidden{display:none!important}@media(max-width:700px){header{padding:28px 18px}h1{font-size:28px}main{padding:18px 12px}td,th{padding:8px;font-size:14px}}'''
    parts = ['<!doctype html><html lang="en"><head><meta charset="utf-8">'
             '<meta name="viewport" content="width=device-width,initial-scale=1">'
             '<title>Rifare — Remaining work</title><style>' + styles + '</style></head><body>',
             '<header><div class="meta">RIFARE · DEVELOPMENT BACKLOG</div>'
             '<h1>What remains to build and qualify</h1>'
             f'<p>{len(goals)} detailed packets · {len(integration)} connected-adapter follow-ups · '
             f'{len(tests)} retained behavioral specifications</p></header><main>',
             '<p class="notice">Implemented work lives in the architecture and Git history. '
             'Historical dependencies and release criteria remain obligations; removing a packet does not accept them.</p>',
             '<p><a href="../docs/ARCHITECTURE.md">Architecture</a> · '
             '<a href="../docs/QUALIFICATION.md">Qualification</a> · '
             '<a href="../work/README.md">Work records</a> · '
             '<a href="WORKER-GOALS.md">Markdown index</a> · '
             '<a href="goals.json">Machine-readable backlog</a> · '
             '<a href="test-specifications.json">Retained specifications</a></p>']
    filters = sorted({goal['milestone'] for goal in goals} | {row['owner_goal_id'][:3] for row in integration})
    parts += ['<div class="toolbar"><input id="search" aria-label="Search remaining work" '
              'placeholder="Search capability, goal, or remaining connection…">'
              '<select id="milestone" aria-label="Filter milestone"><option value="">All milestones</option>'
              + ''.join('<option>' + escape(identity) + '</option>' for identity in filters)
              + '</select></div><p class="quiet" id="count"></p>',
              '<h2>Detailed follow-ups</h2><table><thead><tr><th>Goal</th><th>Remaining deliverable</th>'
              '<th>Proof mode</th></tr></thead><tbody>']
    for goal in goals:
        search = escape(' '.join([goal['id'], goal['title'], goal['outcome']] + goal.get('remaining_work', [])).lower())
        parts.append(f'<tr class="work-item" id="{goal["id"]}" data-milestone="{goal["milestone"]}" '
                     f'data-search="{search}"><td><a href="goals/{goal["milestone"]}/{goal["id"]}.md">'
                     f'{goal["id"]}</a></td><td>{escape(goal["title"])}'
                     f'<div class="quiet">{escape(goal["outcome"])}</div></td>'
                     f'<td>{escape(goal["execution_mode"])}</td></tr>')
    parts.append('</tbody></table>')
    if integration:
        parts += ['<h2 id="integration-follow-ups">Integration follow-ups</h2><p>Reuse the landed lifecycle and protected native tests. '
                  'Fixture-backed source paths do not supply a live adapter.</p>'
                  '<table><thead><tr><th>Original owner</th><th>Remaining connection</th>'
                  '<th>Existing implementation and evidence</th></tr></thead><tbody>']
        for row in integration:
            owner = row['owner_goal_id']
            search = escape(' '.join([owner, row['remaining_outcome'], row['finding']]
                                    + row['related_original_goal_ids']).lower())
            paths = '<br>'.join(f'<a href="../{escape(path)}"><code>{escape(path)}</code></a>'
                                for path in row['evidence_paths'])
            parts.append(f'<tr class="work-item" id="integration-{owner.lower()}" '
                         f'data-milestone="{owner[:3]}" data-search="{search}"><td><code>{owner}</code></td>'
                         f'<td>{escape(row["remaining_outcome"])}<div class="quiet">{escape(row["finding"])}</div></td>'
                         f'<td>{paths}</td></tr>')
        parts.append('</tbody></table>')
    parts.append('''<script>const search=document.getElementById('search'),milestone=document.getElementById('milestone'),items=[...document.querySelectorAll('.work-item')];function filter(){const query=search.value.toLowerCase().trim();let visible=0;for(const item of items){const show=(!milestone.value||item.dataset.milestone===milestone.value)&&(!query||item.dataset.search.includes(query));item.classList.toggle('hidden',!show);if(show)visible++;}document.getElementById('count').textContent=visible+' remaining-work entries shown';}search.addEventListener('input',filter);milestone.addEventListener('change',filter);filter();</script></main></body></html>''')
    write('planning/WORKER-GOALS.html', '\n'.join(parts))
    print(json.dumps({'rendered_goal_packets': len(goals), 'rendered_milestone_groups': len(milestones),
                      'integration_followups': len(integration), 'retained_specifications': len(tests)}))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    render(parser.parse_args().root.resolve())


if __name__ == '__main__':
    main()
