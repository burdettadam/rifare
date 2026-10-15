PYTHON ?= python3

.PHONY: verify plan test render
verify:
	$(PYTHON) tools/verify.py
plan:
	$(PYTHON) tools/validate_plan.py --root .
test:
	$(PYTHON) -m unittest discover -s tests -v
render:
	$(PYTHON) tools/render_plan.py --root .
