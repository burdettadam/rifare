#!/usr/bin/env python3
"""Generate static planning views. Live progress stays in the existing workflow/tracker."""
from pathlib import Path
from collections import defaultdict
import json, html, hashlib, re, textwrap
import argparse
parser=argparse.ArgumentParser(description='Regenerate catalogue/card views from this planning baseline; does not execute or accept goals.')
parser.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1])
OUT=parser.parse_args().root.resolve()
def load(p):return json.loads((OUT/p).read_text(encoding="utf-8"))
def text(p,s):
 q=OUT/p;q.parent.mkdir(parents=True,exist_ok=True);q.write_text(s.strip()+'\n',encoding='utf-8')
def js(p,o):text(p,json.dumps(o,indent=2,ensure_ascii=False))
goals=load('planning/goals.json')['goals']; by={g['id']:g for g in goals}
tests=load('planning/test-specifications.json')['tests'];ti={t['id']:t for t in tests}
ms=load('planning/milestones.json')['milestones'];reqs=load('planning/requirement-coverage.json')['requirements']
invs=load('planning/invariants.json')['invariants']
# Static scheduling waves: not an autonomous scheduler or a calendar estimate.
remaining=set(by);complete=set();waves=[]
while remaining:
 ready=sorted(g for g in remaining if set(by[g]['depends_on'])<=complete)
 if not ready:raise ValueError('DAG cannot progress')
 groups=defaultdict(list)
 for gid in ready:groups[by[gid]['lane']].append(gid)
 waves.append({'wave':len(waves)+1,'goal_ids':ready,'shared_lane_conflicts':{k:v for k,v in groups.items() if len(v)>1},'note':'Dependency-ready only. Actual execution needs accepted prerequisites, approved scope and nonoverlapping concrete write paths; a wave is not a duration estimate.'})
 remaining-=set(ready);complete|=set(ready)
js('planning/dependency-waves.json',{'status':'planning_only','waves':waves})
js('planning/initial-ready-queue.json',{'state':'not_started','can_begin_drafting':['M00-G01'],'note':'Only the initial charter goal has no dependencies. No goal is preaccepted, assigned or authorized for external side effects.'})

# Worker cards. All contain exact test oracles and a bounded task, not a prose-only issue title.
for g in goals:
 gid=g['id'];lines=[f'# {gid} — {g["title"]}',
  f'**Milestone:** {g["milestone"]} · **Type:** {g["type"]} · **Lane:** {g["lane"]} · **Risk:** {g["risk"]}',
  f'**State:** not started · **Owner:** unassigned · **Execution:** {g["execution_mode"]}',
  '> Planning specification only. No application test, provider operation or feature completion is claimed.',
  '## Outcome',g['outcome'],'## Dependencies']
 lines += ['; '.join(f'[{d}](../{d[:3]}/{d}.md)' for d in g['depends_on']) or 'None. Prepare the charter and seek the actual authorized human decision.']
 lines += ['Dependencies must be **accepted**, not merely assigned or implemented. Inspect current accepted evidence before starting.','## Bounded ownership']
 lines += ['\n'.join('- '+v for v in g['scope']),g['scope_note'],'## Before starting','\n'.join(f'{i+1}. {s}' for i,s in enumerate(g['prerequisites']))]
 lines += ['## Worker instructions','\n'.join(f'{i+1}. {s}' for i,s in enumerate(g['worker_steps']))]
 lines += ['## Do not change','\n'.join('- '+v for v in g['non_goals'])]
 lines += ['## Required behavior and permanent tests']
 for tid in g['new_test_ids']:
  t=ti[tid];lines += [f'### {tid} — {t["kind"]}',f'**Fixture:** `{t["fixture_id"]}` · **Layer:** {t["level"]}',
    '**Arrange and act:** '+t['given_when'], '**Assert:** '+t['then'], '**Independent oracle:** '+t['oracle'],
    '**Proposed implementation:** `'+t['suggested_test_path']+'` (bind to actual project commands and native runner cases).']
  if t.get('mutation_to_detect'):lines+=['**Deliberately broken behavior the test must catch:** '+t['mutation_to_detect']]
  lines+=['**Proof requirement:** '+t['mutation_or_red_proof']]
 if g['source_seed_test_ids'] or g['extension_seed_test_ids']:
  lines+=['## Retained original scenario obligations']
  for tid in dict.fromkeys(g['source_seed_test_ids']+g['extension_seed_test_ids']):
   t=ti[tid];label='primary owner' if tid in g['source_seed_test_ids'] else 'later-path extension'
   lines += [f'### {tid} — {t["title"]} ({label})', '**Scenario:** '+t['scenario'],'**Expected:** '+t['expected_result']]
  lines+=['Keep original expectations. Early simulated boundaries do not qualify later connected money, media or physical operations.']
 lines += ['## Evidence to submit',f'Proposed bundle: `evidence/{gid}/<candidate-sha>/`','\n'.join('- '+e for e in g['required_evidence'])]
 lines+=['## Completion and regression protection',
  'The author reports **ready for review**, never self-accepts. A trusted integration owner/maintainer accepts after independent regression/security review. A tagged/public release requires human authorization.',
  '**Protected feature:** `'+g['regression_contract']['stable_capability_id']+'`',
  '**Test obligations:** '+', '.join('`'+i+'`' for i in g['required_test_ids']),
  g['regression_contract']['baseline_policy'],g['regression_contract']['cumulative_selection'],g['regression_contract']['semantic_weakening_policy'],
  '**Introduced cross-cutting invariants to retain:** '+(', '.join(g['invariant_ids']) or 'Establish the initial invariant/evidence baseline; do not invent prior acceptance.'),
  'A skipped test, a changed denominator, a mutable screenshot baseline or a self-authored pass report is not regression evidence. Changes to protected expectations need independent review; current integrated-candidate results supersede old branch results.']
 if g['source_requirements']:
  lines+=['## Original requirement traceability']
  for r in g['source_requirements']:
   lines += [f'**{r["id"]} — {r["title"]}:** '+r['original_acceptance_criteria'],r['contribution']]
 if g['type']=='milestone_acceptance':
  lines += ['## Original milestone exit criteria','\n'.join(f'{i+1}. {s}' for i,s in enumerate(g['original_milestone_exit_criteria'])),
   '**Requirement closure:** '+', '.join('`'+r+'`' for r in g['gate_requirement_ids']),
   'Every relevant requirement is conjunctive across its mapped goals. Full regression selection comes from the current protected accepted baseline, including parallel work—not only this goal’s static dependency list.',
   'An explicit human-approved optional capability exclusion changes the supported release envelope and remains visibly excluded/disabled. It is not a passing feature. Missing required v1 pilot evidence means beta/RC, not silently passed M07.']
 lines+=['## Handoff template',
  '```text\nGoal: '+gid+'\nState: ready_for_review | blocked | needs_changes\nCandidate / base SHA:\nConcrete files changed:\nTests: new / retained / full-suite / connected (actual counts, results, paths)\nBehavioral red or targeted fault caught:\nObserved source effects and financial/physical stage:\nSkill/profile/policy/model/runtime/adapter versions:\nKnown limits and blocked prerequisites:\nIndependent reviewer references:\nRollback / recovery:\nNext dependency-ready goal:\n```',
  '[Worker contract](../../docs/WORKER-CONTRACT.md) · [Regression strategy](../../docs/REGRESSION-STRATEGY.md) · [Evidence contract](../../docs/EVIDENCE-CONTRACT.md)']
 text(f'goals/{g["milestone"]}/{gid}.md','\n\n'.join(lines))

# Milestone summaries and complete compact catalogue.
catalogue=['# Rifare — AI-worker goal catalogue','**Planning date:** October 15, 2026. **State:** proposed, not implemented.',
'190 bounded worker goals + 13 integration/acceptance gates = **203 goal packets**. **676 acceptance/regression specifications** include all 67 original scenarios. All 151 original requirements are preserved and mapped; their acceptance criteria are retained verbatim.',
'Each linked packet includes dependencies, allowed ownership, explicit success/negative/regression assertions, a deliberate fault to detect, source requirement links and required evidence. Product tests remain not run.','## How to dispatch',
'Read `docs/WORKER-CONTRACT.md`, inspect the actual repository and installed git-agent version, then hand a worker one dependency-ready packet. Start with **M00-G01**. Use existing worktrees, test commands and reviewers; do not build another scheduler. Dependency readiness does not authorize spending, production writes or publication.',
'**First competitive v1:** M07. M08–M12 are broader suite expansion; M11 also depends on M08. Optional partner/code-mode capability must be explicitly qualified or remain excluded/disabled.','## Milestone index',
'| Milestone | Outcome | Worker goals | Acceptance gate |\n|---|---|---:|---|']
for m in ms:
 catalogue.append(f'| [{m["id"]}](milestones/{m["id"]}.md) | {m["title"]} | {m["worker_goal_count"]} | [{m["acceptance_goal_id"]}](goals/{m["id"]}/{m["acceptance_goal_id"]}.md) |')
for m in ms:
 members=[g for g in goals if g['milestone']==m['id']]
 block=[f'## {m["id"]} — {m["title"]}',m['outcome'],
  '**Prerequisite milestone gates:** '+(', '.join(d+'-G99' for d in m['depends_on']) or 'None.'),
  '| Goal | Deliverable | Dependencies | Proof mode |\n|---|---|---|---|']
 for g in members:
  block.append(f'| [{g["id"]}](goals/{m["id"]}/{g["id"]}.md) | {g["title"]} | '+(', '.join(g['depends_on']) if not g['id'].endswith('G99') else 'All milestone worker goals + prior milestone gates')+f' | {g["execution_mode"]} |')
 catalogue+=block
 per=[f'# {m["id"]} — {m["title"]}',m['outcome'],f'**Worker goals:** {m["worker_goal_count"]} · **Integration gate:** [{m["acceptance_goal_id"]}](../goals/{m["id"]}/{m["acceptance_goal_id"]}.md)',
       '**Entry:** '+(', '.join(p+'-G99 accepted' for p in m['depends_on']) or 'Prepare the initial charter and obtain the real decision.'),
       '## Dispatchable components','| Goal | Outcome | Lane |\n|---|---|---|']
 for g in members:
  per.append(f'| [{g["id"]}](../goals/{m["id"]}/{g["id"]}.md) | {g["title"]} | {g["lane"]} |')
 per += ['## Required integrated demonstration',m['required_demo'],'## Original exit criteria','\n'.join('- '+v for v in m['exit_criteria']),
         '## Evidence gate',m['exit_rule'],m['exclusion_rule'],
         'A prior accepted component does not prove the integrated candidate still works. Re-run current applicable accepted tests, introduced invariants, affected connected-provider qualifications and the complete milestone journey.']
 text(f'milestones/{m["id"]}.md','\n\n'.join(per))
catalogue[2]=f"{sum(g['type']=='worker_goal' for g in goals)} bounded worker goals + {len(ms)} integration/acceptance gates = **{len(goals)} goal packets**. **{len(tests)} acceptance/regression specifications** include all {sum(t.get('kind')=='retained_source_scenario' for t in tests)} original scenarios. All {len(reqs)} original requirements are preserved and mapped; their acceptance criteria are retained verbatim."
text('WORKER-GOALS.md','\n\n'.join(catalogue))

# Single offline HTML view: searchable, no remote assets or dependencies.
styles='''*{box-sizing:border-box}body{margin:0;background:#f5f7fa;color:#152435;font:16px/1.55 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}header{background:#102c3f;color:#fff;padding:40px max(20px,calc((100vw - 1180px)/2))}main{max-width:1220px;margin:auto;padding:24px 20px 70px}h1{font-size:34px;line-height:1.15;margin:0 0 14px}h2{font-size:25px;margin-top:38px}h3{font-size:19px}a{color:#075a79}header a{color:#c4e9f2}.meta{font-size:14px;opacity:.86}.notice{border-left:4px solid #a57819;background:#fff5da;padding:14px 18px;margin:20px 0}.stats{display:flex;flex-wrap:wrap;gap:12px;margin:20px 0}.stat{background:#fff;border:1px solid #d5dfe6;border-radius:9px;padding:14px 20px;min-width:160px}.stat b{font-size:27px;display:block}.toolbar{position:sticky;top:0;z-index:10;background:#f5f7faf2;backdrop-filter:blur(8px);padding:12px 0;display:flex;gap:10px;flex-wrap:wrap}input,select{font:inherit;padding:11px 13px;border:1px solid #a8bac7;border-radius:6px}input{flex:1;min-width:220px}table{width:100%;border-collapse:collapse;background:white}td,th{text-align:left;vertical-align:top;border-bottom:1px solid #dfe6eb;padding:10px}th{background:#e7eef3}.goal{background:white;border:1px solid #cfdbe3;border-radius:8px;margin:12px 0;overflow:hidden}.goal summary{cursor:pointer;padding:16px 18px;font-weight:650}.goal[open] summary{background:#edf4f7;border-bottom:1px solid #d7e2e9}.content{padding:4px 20px 20px}.chips{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:10px}.chip{font-size:12px;border:1px solid #b9ccd8;border-radius:4px;padding:2px 7px;color:#32576e}code{background:#edf2f5;border-radius:3px;padding:1px 4px;font-size:.88em;overflow-wrap:anywhere}.test{border-left:3px solid #4a8799;background:#f4f8fa;padding:10px 14px;margin:12px 0}.test p{margin:7px 0}.quiet{color:#4e6170}li{margin:7px 0}.hidden{display:none!important}@media(max-width:700px){header{padding:28px 18px}h1{font-size:28px}main{padding:18px 14px}td,th{padding:7px;font-size:13px}.content{padding:5px 14px 18px}}@media print{.toolbar{position:static}body{background:white}.goal{break-inside:avoid}.goal summary{font-size:16px}header{background:white;color:#111}a{color:#111}}'''
H=html.escape
header='''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rifare — Worker Goals</title><style>'''+styles+'''</style></head><body><header><div class="meta">RIFARE · DEVELOPMENT STEERING · OCTOBER 15, 2026</div><h1>AI-worker goals and regression evidence</h1><p>Bounded work. Independent proof. Cumulative feature protection.</p><div class="meta">A decomposition of the existing roadmap, not a claim that the application has been built.</div></header><main>'''
parts=[header,'<div class="stats"><div class="stat"><b>190</b>Worker goals</div><div class="stat"><b>13</b>Milestone gates</div><div class="stat"><b>676</b>Test specifications</div><div class="stat"><b>151 / 151</b>Requirements mapped</div></div>',
'<div class="notice"><strong>All application tests are not run.</strong> The package contains executable planning/inventory helper self-tests, separate from the proposed product tests. Source-system qualification, human decisions and actual pilot observations cannot be replaced with simulated success.</div>',
'<p>Start with <a href="#M00-G01">M00-G01</a>. Give each worker one packet after its dependencies are accepted. Use the installed git-agent workflow, ordinary project commands and one writer per isolated worktree. Every accepted feature adds protected regression obligations.</p>',
'<p><a href="WORKER-GOALS.md">Complete Markdown catalogue</a> · <a href="planning/goals.json">Machine-readable goals</a> · <a href="docs/WORKER-CONTRACT.md">Worker contract</a> · <a href="docs/REGRESSION-STRATEGY.md">Regression strategy</a> · <a href="docs/EVIDENCE-CONTRACT.md">Evidence contract</a></p>',
'<div class="toolbar"><input id="search" aria-label="Search goals" placeholder="Search goal, requirement, behavior, or test…"><select id="milestone" aria-label="Filter milestone"><option value="">All milestones</option>'+''.join('<option>'+m['id']+'</option>' for m in ms)+'</select><select id="mode" aria-label="Filter execution mode"><option value="">All proof modes</option>'+''.join('<option>'+v+'</option>' for v in sorted({g['execution_mode'] for g in goals}))+'</select></div><p class="quiet" id="count">203 goals displayed</p>',
'<table><thead><tr><th>Milestone</th><th>Outcome</th><th>Workers + gate</th></tr></thead><tbody>']
for m in ms:parts.append(f'<tr><td><a href="#section-{m["id"]}">{m["id"]}</a></td><td>{H(m["title"])}</td><td>{m["worker_goal_count"]} + 1</td></tr>')
parts.append('</tbody></table>')
for m in ms:
 parts.append(f'<section class="milestone-section" id="section-{m["id"]}" data-milestone="{m["id"]}"><h2>{m["id"]} — {H(m["title"])}</h2><p>{H(m["outcome"])}</p>')
 for g in [x for x in goals if x['milestone']==m['id']]:
  gid=g['id'];search=H(' '.join([gid,g['title'],g['outcome'],' '.join(g['requirement_ids']),' '.join(g['required_test_ids'])]+[ti[t]['given_when']+' '+ti[t]['then'] for t in g['new_test_ids']]).lower())
  parts.append(f'<details class="goal" id="{gid}" data-milestone="{g["milestone"]}" data-mode="{g["execution_mode"]}" data-search="{search}"><summary>{gid} · {H(g["title"])}</summary><div class="content">')
  parts.append('<div class="chips">'+''.join(f'<span class="chip">{H(v)}</span>' for v in [g['lane'],g['risk']+' risk',g['execution_mode'],'not started'])+'</div>')
  parts.append('<p><strong>Outcome:</strong> '+H(g['outcome'])+'</p>')
  parts.append('<p><strong>Depends on:</strong> '+(', '.join(f'<a href="#{d}">{d}</a>' for d in g['depends_on']) or 'No prior goal; obtain the actual charter decision.')+'</p>')
  parts.append('<p><strong>Owned scope:</strong> '+H('; '.join(g['scope']))+'. Proposed modules; bind to real repository paths.</p>')
  parts.append('<h3>Required tests and independent oracles</h3>')
  for tid in g['new_test_ids']:
   t=ti[tid];parts.append('<div class="test"><strong>'+H(tid)+' · '+H(t['kind'])+'</strong><p><strong>Arrange / act:</strong> '+H(t['given_when'])+'</p><p><strong>Assert:</strong> '+H(t['then'])+'</p>')
   if t['mutation_to_detect']:parts.append('<p><strong>Broken behavior to detect:</strong> '+H(t['mutation_to_detect'])+'</p>')
   parts.append('</div>')
  if g['source_seed_test_ids'] or g['extension_seed_test_ids']:
   parts.append('<h3>Original scenarios retained</h3>')
   for sid in dict.fromkeys(g['source_seed_test_ids']+g['extension_seed_test_ids']):
    t=ti[sid];parts.append('<p><strong>'+H(sid)+' · '+H(t['title'])+'</strong><br>'+H(t['scenario'])+' <strong>Expected:</strong> '+H(t['expected_result'])+'</p>')
  parts.append('<h3>Evidence and acceptance</h3><ul>'+''.join('<li>'+H(v)+'</li>' for v in g['required_evidence'])+'</ul>')
  parts.append('<p><strong>Preserve:</strong> '+H(g['regression_contract']['cumulative_selection'])+'</p>')
  if g['source_requirements']:
   parts.append('<h3>Source requirements</h3>')
   for r in g['source_requirements']:parts.append('<p><strong>'+H(r['id'])+' · '+H(r['title'])+'</strong><br>'+H(r['original_acceptance_criteria'])+'</p>')
  if g['original_milestone_exit_criteria']:
   parts.append('<h3>Original milestone exit criteria</h3><ul>'+''.join('<li>'+H(c)+'</li>' for c in g['original_milestone_exit_criteria'])+'</ul>')
  parts.append(f'<p><a href="goals/{g["milestone"]}/{gid}.md">Open complete worker packet</a></p></div></details>')
 parts.append('</section>')
parts.append('''<script>
const search=document.getElementById('search'), ms=document.getElementById('milestone'), mode=document.getElementById('mode');
function filter(){let count=0;const q=search.value.toLowerCase().trim();document.querySelectorAll('.goal').forEach(g=>{const ok=(!q||g.dataset.search.includes(q))&&(!ms.value||g.dataset.milestone===ms.value)&&(!mode.value||g.dataset.mode===mode.value);g.classList.toggle('hidden',!ok);if(ok)count++;});document.querySelectorAll('.milestone-section').forEach(s=>s.classList.toggle('hidden',!s.querySelector('.goal:not(.hidden)')));document.getElementById('count').textContent=count+' goals displayed';}
[search,ms,mode].forEach(e=>e.addEventListener('input',filter));
function reveal(){const id=decodeURIComponent(location.hash.slice(1)),e=document.getElementById(id);if(e&&e.classList.contains('goal')){search.value='';ms.value='';mode.value='';filter();e.open=true;e.scrollIntoView({block:'start'});}}
window.addEventListener('hashchange',reveal);reveal();
</script></main></body></html>''')
markup='\n'.join(parts)
markup=markup.replace('<b>190</b>Worker goals',f"<b>{sum(g['type']=='worker_goal' for g in goals)}</b>Worker goals").replace('<b>13</b>Milestone gates',f'<b>{len(ms)}</b>Milestone gates').replace('<b>676</b>Test specifications',f'<b>{len(tests)}</b>Test specifications').replace('<b>151 / 151</b>Requirements mapped',f'<b>{len(reqs)} / {len(reqs)}</b>Requirements mapped').replace('203 goals displayed',f'{len(goals)} goals displayed')
text('WORKER-GOALS.html',markup)
print('Rendered',len(goals),'goal packets,',len(ms),'milestone sheets and searchable HTML.')
