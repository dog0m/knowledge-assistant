.PHONY: up down logs test lint eval e2e check

up:
	docker compose up -d --build app rag worker

down:
	docker compose down

logs:
	docker compose logs --tail 100 app rag worker

test:
	python -m pytest -q

lint:
	ruff check rag

eval:
	pwsh -NoProfile -ExecutionPolicy Bypass -File ./scripts/run-evaluation.ps1

e2e:
	npx playwright test -c tests/e2e/playwright.config.js

check:
	node --check app/server.js
	node --check app/public/app.js
	python -m py_compile rag/main.py rag/settings.py rag/security.py rag/worker.py
	docker compose config --quiet
