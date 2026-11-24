.DEFAULT_GOAL := test

.PHONY: test check verify build dev
test:
	npm test
check verify:
	npm run check
build:
	npm run build
dev:
	npm run dev
