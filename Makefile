# Mawiid local development: `make help` lists every target.
# Local runs use apps/backend/postman/.env.postman (local SQLite, Redis, LiveKit in dev mode).

SHELL := /bin/bash
.DEFAULT_GOAL := help

BACKEND  := apps/backend
FRONTEND := frontend
AI       := services/ai
PYTHON   ?= python3

BACKEND_URL   ?= http://localhost:3000
FRONTEND_PORT ?= 3100
FRONTEND_URL  ?= https://localhost:$(FRONTEND_PORT)
DEV_TLS_DIR   := $(CURDIR)/.secrets/dev-tls

REDIS_CONTAINER   := mawiid-redis
REDIS_IMAGE       := redis:7
LIVEKIT_CONTAINER := mawiid-livekit
LIVEKIT_IMAGE     := livekit/livekit-server

# make dev AI_MODELS=0 skips the model conversion on machines without the disk or RAM for it.
AI_MODELS ?= 1
# Darija is switched off (services/ai/README.md); convert its model by hand when turning it back on.
AI_MODEL_FILES := $(AI)/data/models/madlad400-3b-mt-ct2/model.bin

.PHONY: setup seed-if-missing ai-models ai-models-darija certs help install ai-install infra redis livekit infra-down infra-logs seed backend frontend ai dev stop users \
        tokens typecheck build test-unit test-ai check smoke test clean

help: ## Show this help
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z_-]+:.*## / {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# ---------------------------------------------------------------- setup

setup: ## Check the tools and install what make dev needs (safe to repeat)
	@for tool in bun docker openssl curl $(PYTHON); do \
		command -v $$tool >/dev/null || { echo "Missing $$tool: install it first."; exit 1; }; done
	@docker info >/dev/null 2>&1 || { echo "Docker is not running: start it first."; exit 1; }
	@[ -f .env ] || { printf "ENV=dev\nLIVEKIT_URL=ws://localhost:7880\nLIVEKIT_API_KEY=devkey\nLIVEKIT_API_SECRET=secret\n" > .env; \
		echo "Created .env with the local LiveKit settings. Email needs the SMTP_* values from .env.example."; }
	@$(MAKE) --no-print-directory install
	@$(MAKE) --no-print-directory $(AI)/.venv/.installed
	@$(MAKE) --no-print-directory certs

install: ## Install dependencies and generate the Prisma clients
	bun install
	cd $(BACKEND) && bun run db:generate
	cd $(FRONTEND) && bun install

ai-install: ## Create the AI worker's Python environment (Python 3.11+: make ai-install PYTHON=python3.12)
	cd $(AI) && $(PYTHON) -m venv .venv && .venv/bin/pip install -e ".[dev]"
	touch $(AI)/.venv/.installed

$(AI)/.venv/.installed: $(AI)/pyproject.toml
	@$(MAKE) --no-print-directory ai-install

ai-models: ## Convert the translation model if missing (large download, several GB of RAM)
	@if ls $(AI_MODEL_FILES) >/dev/null 2>&1; then echo "AI models are ready"; exit 0; fi; \
		echo "Converting the AI models. This runs once and takes a while; captions start when it finishes."; \
		cd $(AI) && .venv/bin/pip install torch --index-url https://download.pytorch.org/whl/cpu && \
		.venv/bin/pip install -e ".[convert]" && \
		.venv/bin/python scripts/convert_translation_model.py

ai-models-darija: ## Convert the Darija speech model if missing (needed while ar-MA is on)
	@if ls $(AI)/data/models/whisper-darija-ct2/model.bin >/dev/null 2>&1; then echo "Darija model is ready"; exit 0; fi; \
		echo "Converting the Darija model. This runs once and takes a while."; \
		cd $(AI) && .venv/bin/pip install torch --index-url https://download.pytorch.org/whl/cpu && \
		.venv/bin/pip install -e ".[convert]" && \
		.venv/bin/python scripts/convert_darija_model.py --model turbo

# ---------------------------------------------------------------- infrastructure

infra: redis livekit ## Start Redis and LiveKit (Docker) and wait until they answer
	@for i in $$(seq 1 30); do \
		docker exec $(REDIS_CONTAINER) redis-cli ping >/dev/null 2>&1 && curl -sf -o /dev/null http://localhost:7880 && exit 0; \
		sleep 1; done; echo "Redis or LiveKit did not start: see docker logs $(LIVEKIT_CONTAINER)"; exit 1

redis:
	@docker start $(REDIS_CONTAINER) >/dev/null 2>&1 || \
		docker run -d --name $(REDIS_CONTAINER) -p 6379:6379 $(REDIS_IMAGE) >/dev/null
	@echo "Redis    localhost:6379"

# Host networking so the WebRTC UDP ports are reachable; --dev uses devkey/secret,
# which matches postman/.env.postman. infra/livekit.dev.yaml sends webhooks to the
# backend on :3000, so participants who bypass a ban or removal are disconnected.
# The container is recreated each time so config changes always apply.

livekit:
	@docker rm -f $(LIVEKIT_CONTAINER) >/dev/null 2>&1 || true
	@docker run -d --name $(LIVEKIT_CONTAINER) \
		-p 7880:7880/tcp \
		-p 7881:7881/tcp \
		-p 7882:7882/udp \
		-v "$(CURDIR)/infra/livekit.dev.yaml:/etc/livekit.yaml:ro" \
		$(LIVEKIT_IMAGE) \
		--config /etc/livekit.yaml --dev --bind 0.0.0.0 >/dev/null
	@echo "LiveKit ws://localhost:7880"
	@echo "LiveKit TCP RTC localhost:7881"
	@echo "LiveKit UDP RTC localhost:7882"


infra-down: ## Stop Redis and LiveKit
	-docker stop $(LIVEKIT_CONTAINER) $(REDIS_CONTAINER)

infra-logs: ## Follow the LiveKit logs
	docker logs -f $(LIVEKIT_CONTAINER)

# ---------------------------------------------------------------- run

seed: ## Reset the local test data (backend must be stopped)
	@if curl -sf $(BACKEND_URL)/health >/dev/null; then \
		echo "The backend is running: stop it first (make stop), the seed replaces its database files."; exit 1; fi
	cd $(BACKEND) && bun run postman:seed

seed-if-missing:
	@[ -f $(BACKEND)/postman/data/main.db ] || $(MAKE) --no-print-directory seed

backend: ## Run the local backend with the public LiveKit configuration
	@set -a; . $(BACKEND)/postman/.env.postman; set +a; \
		postman_jwt_secret="$$JWT_SECRET_KEY"; \
		postman_turso_url="$$TURSODB_URL"; \
		postman_turso_token="$$TURSODB_TOKEN"; \
		postman_turso_db="$$TURSODB_DB"; \
		postman_turso_org="$$TURSODB_ORG"; \
		postman_turso_group_name="$$TURSODB_GROUP_NAME"; \
		postman_turso_group_token="$$TURSODB_GROUP_TOKEN"; \
		postman_redis_url="$$REDIS_URL"; \
		postman_internal_service_token="$$INTERNAL_SERVICE_TOKEN"; \
		postman_translator_agent="$$LIVEKIT_TRANSLATOR_AGENT"; \
		. ./.env; \
		if [ -z "$$LIVEKIT_URL" ] || [ -z "$$LIVEKIT_API_KEY" ] || [ -z "$$LIVEKIT_API_SECRET" ]; then \
			echo "Missing LIVEKIT_URL, LIVEKIT_API_KEY, or LIVEKIT_API_SECRET in .env"; exit 1; \
		fi; \
		cd $(BACKEND) && \
		JWT_SECRET_KEY="$$postman_jwt_secret" \
		TURSODB_URL="$$postman_turso_url" \
		TURSODB_TOKEN="$$postman_turso_token" \
		TURSODB_DB="$$postman_turso_db" \
		TURSODB_ORG="$$postman_turso_org" \
		TURSODB_GROUP_NAME="$$postman_turso_group_name" \
		TURSODB_GROUP_TOKEN="$$postman_turso_group_token" \
		REDIS_URL="$$postman_redis_url" \
		INTERNAL_SERVICE_TOKEN="$$postman_internal_service_token" \
		LIVEKIT_TRANSLATOR_AGENT="$$postman_translator_agent" \
		LIVEKIT_URL="$$LIVEKIT_URL" \
		LIVEKIT_PUBLIC_URL="$${LIVEKIT_PUBLIC_URL:-$$LIVEKIT_URL}" \
		LIVEKIT_API_KEY="$$LIVEKIT_API_KEY" \
		LIVEKIT_API_SECRET="$$LIVEKIT_API_SECRET" \
		PUBLIC_APP_URL="$${PUBLIC_APP_URL:-https://localhost:$(FRONTEND_PORT)}" \
		SMTP_HOST="$$SMTP_HOST" \
		SMTP_PORT="$$SMTP_PORT" \
		SMTP_USER="$$SMTP_USER" \
		SMTP_FROM="$$SMTP_FROM" \
		GOOGLE_APP_PASSWORD="$$GOOGLE_APP_PASSWORD" \
		bun run postman:dev

# Same LiveKit server as `make backend`, and the backend's internal token from postman/.env.postman.
# Model settings (MAWIID_STT_*, MAWIID_MT_*) come from .env. The first run downloads Whisper.
ai: ## Run the AI translation worker on its own (make ai-install first)
	@set -a; . ./.env; set +a; \
		if [ -z "$$LIVEKIT_URL" ] || [ -z "$$LIVEKIT_API_KEY" ] || [ -z "$$LIVEKIT_API_SECRET" ]; then \
			echo "Missing LIVEKIT_URL, LIVEKIT_API_KEY, or LIVEKIT_API_SECRET in .env"; exit 1; \
		fi; \
		if [ ! -x $(AI)/.venv/bin/python ]; then echo "Run make ai-install first"; exit 1; fi; \
		livekit_url="$$LIVEKIT_URL"; livekit_key="$$LIVEKIT_API_KEY"; livekit_secret="$$LIVEKIT_API_SECRET"; \
		set -a; . $(BACKEND)/postman/.env.postman; set +a; \
		cd $(AI) && \
		LIVEKIT_URL="$$livekit_url" \
		LIVEKIT_API_KEY="$$livekit_key" \
		LIVEKIT_API_SECRET="$$livekit_secret" \
		.venv/bin/python -m mawiid_ai.agent dev

certs: ## Create the self-signed development HTTPS certificate if needed
	@sh infra/dev-tls.sh $(DEV_TLS_DIR)

frontend: certs ## Build and run the frontend on https://:3100, or FRONTEND_PORT; http redirects to https
	cd $(FRONTEND) && bun run build && PORT=$(FRONTEND_PORT) TLS_CERT_FILE=$(DEV_TLS_DIR)/cert.pem TLS_KEY_FILE=$(DEV_TLS_DIR)/key.pem BACKEND_URL=$(BACKEND_URL) bun run start

dev: stop setup infra seed-if-missing ## Set up and run everything: Redis, LiveKit, backend, frontend, AI worker (Ctrl+C stops the servers)
	@echo "Mawiid   https://localhost:$(FRONTEND_PORT) and https://$$(hostname -I | cut -d' ' -f1):$(FRONTEND_PORT)"
	@trap 'kill 0' INT TERM EXIT; \
		$(MAKE) --no-print-directory backend & \
		$(MAKE) --no-print-directory frontend & \
		{ [ "$(AI_MODELS)" != 1 ] || $(MAKE) --no-print-directory ai-models; $(MAKE) --no-print-directory ai; } & \
		wait

# The [x] keeps each pattern from matching this shell's own command line.
stop: ## Stop the backend, frontend and AI worker
	@pkill -f '[b]un run --env-file=postman/.env.postman --watch src/app.ts' || true
	@pkill -f '[b]un --hot src/index.ts' || true
	@pkill -f '[b]un src/index.ts' || true
	@pkill -f '[m]awiid_ai.agent' || true
	@for i in $$(seq 1 28); do pgrep -f '[b]un .*src/(app|index).ts|[m]awiid_ai.agent' >/dev/null || exit 0; sleep 0.25; done; \
		pkill -9 -f '[b]un .*src/(app|index).ts|[m]awiid_ai.agent' || true

tokens: ## Print login links for the seeded users and the room code
	@cd $(BACKEND) && bun -e " \
		const { createClient } = require('@libsql/client'); \
		const db = createClient({ url: 'file:postman/data/main.db' }); \
		const room = (await db.execute('select room_uid from room_route order by room_route_id limit 1')).rows[0]; \
		console.log('room code:', room ? room.room_uid : '(none, run make seed)'); \
		for (const v of require('./postman/mawiid.postman_environment.json').values) \
			if (v.key.startsWith('token_')) console.log(v.key.slice(6).padEnd(10), '$(FRONTEND_URL)/?token=' + v.value);"

users: ## List the users in the local database
	@cd $(BACKEND) && bun -e " \
		const { createClient } = require('@libsql/client'); \
		const db = createClient({ url: 'file:postman/data/main.db' }); \
		console.table((await db.execute('select user_id, user_phone, user_first_name, user_last_name, user_language, created_at from user where deleted_at is null order by user_id')).rows);"

# ---------------------------------------------------------------- test

typecheck: ## Typecheck backend and frontend
	cd $(BACKEND) && bun x tsc --noEmit
	cd $(FRONTEND) && bun x tsc --noEmit

build: ## Production build of the frontend (frontend/dist)
	cd $(FRONTEND) && bun run build

test-unit: ## Run backend unit tests
	@if find $(BACKEND)/src -name '*.test.ts' | grep -q .; then cd $(BACKEND) && bun test src; \
		else echo "No backend unit tests yet (*.test.ts under $(BACKEND)/src)"; fi

test-ai: ## Run the AI worker's tests (make ai-install first; model tests skip without models)
	cd $(AI) && .venv/bin/python -m pytest -q

check: typecheck test-unit build ## Static checks, no services needed

smoke: ## End-to-end endpoint checks against the running stack (make dev first)
	cd $(BACKEND) && NODE_TLS_REJECT_UNAUTHORIZED=0 FRONTEND_URL=$(FRONTEND_URL) bun postman/smoke.ts

test: check smoke ## Everything: static checks, then smoke tests

clean: ## Remove the frontend build output
	rm -rf $(FRONTEND)/dist
