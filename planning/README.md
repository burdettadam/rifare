# Rifare planning

Start with the [product overview](../README.md), [roadmap](../docs/ROADMAP.md),
or [current project status](../docs/PROJECT-STATUS.md) if you are exploring Rifare.
This directory holds the detailed specifications used to develop it.

## Find a specification

| Material | Start here |
| --- | --- |
| Complete goal catalogue | [Markdown catalogue](WORKER-GOALS.md) · [Searchable offline HTML](WORKER-GOALS.html) |
| Individual goal packets | [`goals/`](goals/) |
| Milestone outcomes and gates | [`milestones/`](milestones/) |
| Canonical goal definitions | [`goals.json`](goals.json) |
| Target capabilities | [`capability-targets.json`](capability-targets.json) |
| Requirements and their coverage | [`backlog.json`](backlog.json) · [`requirement-coverage.json`](requirement-coverage.json) |
| Behavioral specifications | [`test-specifications.json`](test-specifications.json) |
| Frozen source requirements | [`reference/`](reference/) |
| Work and evidence templates | [`templates/`](templates/) |
| Historical project metadata | [`project.json`](project.json) |

Planning status is a specification, not a report of completed features. Current
development observations and decisions remain in [work records](../work/README.md)
and the [project-status guide](../docs/PROJECT-STATUS.md).

## Update the plan

Change the canonical JSON, then regenerate and check its views from the repository root:

```sh
python3 tools/render_plan.py --root .
python3 tools/check_generated.py --root .
python3 tools/validate_plan.py --root .
```

The generator writes this directory's `WORKER-GOALS.md`, `WORKER-GOALS.html`,
`goals/`, and `milestones/`. Preserve the frozen reference inputs, requirement
criteria, test expectations, and existing goal identities. Follow
[development instructions](../docs/DEVELOPMENT.md) and
[agent instructions](../AGENTS.md) for an assigned implementation.

## Location changes

The portfolio navigation refresh moved the root goal catalogues, `goals/`,
`milestones/`, `reference/`, `templates/`, and `project.json` into this directory.
The former root development rubrics are now in
[`.agents/rubrics/`](../.agents/rubrics/README.md). Root architecture, roadmap,
development, governance, and progress documents are now under `docs/`.

Historical decision prose and immutable source inputs may still name the paths
used by their original commits. Those records retain their original meaning;
current links, loaders, and generated views use the locations above.
