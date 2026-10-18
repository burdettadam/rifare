PYTHON ?= python3
DEV_TEST_ARGS ?=
.DEFAULT_GOAL := test

.PHONY: verify plan test test-changed test-smoke test-full test-plan render
verify:
	$(PYTHON) tools/verify.py
plan:
	$(PYTHON) tools/validate_plan.py --root .
test: test-changed
test-changed:
	$(PYTHON) tools/dev_tests.py $(DEV_TEST_ARGS)
test-smoke:
	$(PYTHON) tools/dev_tests.py --profile smoke $(DEV_TEST_ARGS)
test-plan:
	$(PYTHON) tools/dev_tests.py --plan $(DEV_TEST_ARGS)
test-full:
	$(PYTHON) tools/verify.py --runtime --harness
render:
	$(PYTHON) tools/render_plan.py --root .
