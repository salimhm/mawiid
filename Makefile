# Mawiid: `make help` lists every target. `make mawiid` deploys production on a fresh server;
# the other targets are local development. Local runs use apps/backend/postman/.env.postman (local SQLite, Redis, LiveKit in dev mode).

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

# make dev starts scripts/test_report.py in the background: it waits for the servers, runs the tests,
# security probes and load tests, and writes reports/<timestamp>/report.md and .html (reports/latest).
# REPORT=0 turns it off; REPORT_PROFILE=quick|hour|full|none picks the load tests (see the script).
REPORT ?= 1
REPORT_PROFILE ?= quick

# make dev AI_MODELS=0 skips the model conversion on machines without the disk or RAM for it.
AI_MODELS ?= 1
# Darija is switched off (services/ai/README.md); convert its model by hand when turning it back on.
AI_MODEL_FILES := $(AI)/data/models/madlad400-3b-mt-ct2/model.bin

.PHONY: mawiid azure mawiid-status mawiid-logs mawiid-down setup seed-if-missing ai-models ai-models-darija certs help install ai-install infra redis livekit infra-down infra-logs seed backend frontend ai dev stop users \
        tokens typecheck build test-unit test-ai check smoke test_bot loadtest report test clean

help: ## Show this help
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z_-]+:.*## / {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# ---------------------------------------------------------------- production

# Installs Docker and the host tools, creates infra/compose/.env.production with generated
# secrets, builds and starts the stack, then the AI worker. Rerun it to update after a git pull.
# Options: make mawiid APP_DOMAIN=app.example.com RTC_DOMAIN=rtc.example.com WITH_AI=0 GPU=auto|1|0
WITH_AI ?= 1
GPU     ?= auto
PROD_COMPOSE = cd infra/compose && $$(docker info >/dev/null 2>&1 || echo sudo) docker compose --env-file .env.production \
	-f docker-compose.yml $$(grep -qs '^AI_CUDA=1' .env.production && echo -f docker-compose.gpu.yml) --profile ai

mawiid: ## Production: install everything on this server and serve the website (rerun to update)
	@APP_DOMAIN="$(APP_DOMAIN)" RTC_DOMAIN="$(RTC_DOMAIN)" AI="$(WITH_AI)" GPU="$(GPU)" bash infra/deploy/mawiid.sh

# Same, on an Azure GPU VM (Ubuntu): also installs the NVIDIA driver the VM size needs (GRID for
# NV-series, reboots once), checks disk and RAM, and runs the AI worker on the GPU with MADLAD 10b.
# Options: make azure APP_DOMAIN=... RTC_DOMAIN=... MT_MODEL=10b|3b REBOOT=1
MT_MODEL ?= 10b
azure: ## Production on an Azure GPU VM: NVIDIA driver, GPU AI worker with MADLAD 10b, whole stack (rerun to update)
	@APP_DOMAIN="$(APP_DOMAIN)" RTC_DOMAIN="$(RTC_DOMAIN)" MT_MODEL="$(MT_MODEL)" REBOOT="$(REBOOT)" bash infra/deploy/azure.sh

mawiid-status: ## Production: show the services
	@$(PROD_COMPOSE) ps

mawiid-logs: ## Production: follow the logs (make mawiid-logs S=backend for one service)
	@$(PROD_COMPOSE) logs -f --tail=100 $(S)

mawiid-down: ## Production: stop the stack (data volumes are kept)
	@$(PROD_COMPOSE) down

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
# Inside Docker, LiveKit would announce its container address (172.17.x.x) for media,
# which only this machine can reach: other devices on the LAN connect, then drop.
# It announces this machine's LAN address instead (override: make livekit NODE_IP=…).
NODE_IP ?= $(shell hostname -I 2>/dev/null | tr ' ' '\n' | grep -m1 -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$$' || echo 127.0.0.1)

livekit:
	@docker rm -f $(LIVEKIT_CONTAINER) >/dev/null 2>&1 || true
	@docker run -d --name $(LIVEKIT_CONTAINER) \
		-p 7880:7880/tcp \
		-p 7881:7881/tcp \
		-p 7882:7882/udp \
		-v "$(CURDIR)/infra/livekit.dev.yaml:/etc/livekit.yaml:ro" \
		$(LIVEKIT_IMAGE) \
		--config /etc/livekit.yaml --dev --bind 0.0.0.0 --node-ip $(NODE_IP) >/dev/null
	@echo "LiveKit ws://localhost:7880"
	@echo "LiveKit TCP RTC $(NODE_IP):7881"
	@echo "LiveKit UDP RTC $(NODE_IP):7882"


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
		{ [ "$(AI_MODELS)" != 1 ] || $(MAKE) --no-print-directory ai-models; MAWIID_STAGE_TIMINGS=$${MAWIID_STAGE_TIMINGS:-$(REPORT)} $(MAKE) --no-print-directory ai; } & \
		{ [ "$(REPORT)" != 1 ] || $(PYTHON) scripts/test_report.py --profile $(REPORT_PROFILE) --quiet; } & \
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

# Bots speak recorded sentences (FLEURS) in each language and listener bots read the captions;
# each caption is scored against the human reference (WER for speech-to-text, chrF/BLEU for translation).
# Needs LiveKit and the AI worker running (make dev). TEST_BOT_ARGS="--clips 10 --auto-detect" for more.

# OPTIONS
# make test_bot TEST_BOT_ARGS="--clips 10"               # 10 sentences per language
# make test_bot TEST_BOT_ARGS="--auto-detect"            # speakers on "Auto", also tests language detection
# make test_bot TEST_BOT_ARGS="--warmup-s 900"           # wait up to 15 min if the worker is still loading
# make test_bot TEST_BOT_ARGS="--languages fr-FR en-US"  # only some languages
TEST_BOT_ARGS ?=
test_bot: ## Translation test bots: bots speak, listener bots read, captions scored (make dev first)
	@set -a; . ./.env; set +a; \
		livekit_url="$$LIVEKIT_URL"; livekit_key="$$LIVEKIT_API_KEY"; livekit_secret="$$LIVEKIT_API_SECRET"; \
		set -a; . $(BACKEND)/postman/.env.postman; set +a; \
		if [ ! -x $(AI)/.venv/bin/python ]; then echo "Run make ai-install first"; exit 1; fi; \
		cd $(AI) && { [ -f data/translation/parallel.jsonl ] || .venv/bin/python scripts/fetch_samples.py --languages fr-FR en-US ar-SA; } && \
		LIVEKIT_URL="$$livekit_url" LIVEKIT_API_KEY="$$livekit_key" LIVEKIT_API_SECRET="$$livekit_secret" \
		.venv/bin/python scripts/translation_bot.py $(TEST_BOT_ARGS)

# Load test: LOAD_ROOMS rooms of LOAD_BOTS bots, LOAD_TALKING talking at once per room (0: all),
# for LOAD_MINUTES. Each bot speaks FLEURS clips and times every caption; the resource sampler runs
# alongside (GPU, containers, host). Results: services/ai/data/loadtest/<LOAD_NAME>/.
#   make loadtest                                   # 10 rooms x 10 bots, all talking, 10 min
#   make loadtest LOAD_TALKING=1                    # 10 normal meetings: one person talks at a time
#   make loadtest LOAD_MINUTES=60                   # the 1-hour session
#   make loadtest LOAD_ROOMS=1 LOAD_BOTS=5          # smaller
#   make loadtest LOAD_ARGS="--ramp 1,2,4,6,8,10 --step-minutes 5"   # find the breaking point
LOAD_ROOMS   ?= 10
LOAD_BOTS    ?= 10
LOAD_TALKING ?= 0
LOAD_MINUTES ?= 10
LOAD_NAME    ?= $(LOAD_ROOMS)x$(LOAD_BOTS)-$(shell date +%Y%m%d-%H%M%S)
LOAD_ARGS    ?=
loadtest: ## Load test: 10 rooms x 10 bots talking (LOAD_ROOMS, LOAD_BOTS, LOAD_TALKING, LOAD_MINUTES; make dev first)
	@set -a; . ./.env; set +a; \
		livekit_url="$$LIVEKIT_URL"; livekit_key="$$LIVEKIT_API_KEY"; livekit_secret="$$LIVEKIT_API_SECRET"; \
		set -a; . $(BACKEND)/postman/.env.postman; set +a; \
		if [ ! -x $(AI)/.venv/bin/python ]; then echo "Run make ai-install first"; exit 1; fi; \
		if ! curl -s -o /dev/null --max-time 3 "$$(echo $$livekit_url | sed 's#^ws#http#')"; then \
			echo "LiveKit is not answering at $$livekit_url: start the stack first (make dev)"; exit 1; fi; \
		cd $(AI) && { ls data/samples/ar-SA/*.wav >/dev/null 2>&1 || .venv/bin/python scripts/fetch_samples.py --languages fr-FR en-US ar-SA; } && \
		out=data/loadtest/$(LOAD_NAME); mkdir -p $$out; \
		bash scripts/resource_sampler.sh $$out 5 >/dev/null 2>&1 & sampler=$$!; \
		trap 'kill $$sampler 2>/dev/null' EXIT INT TERM; \
		echo "$(LOAD_ROOMS) rooms x $(LOAD_BOTS) bots, $$( [ "$(LOAD_TALKING)" = 0 ] && echo all || echo $(LOAD_TALKING)) talking per room, $(LOAD_MINUTES) min -> services/ai/$$out"; \
		LIVEKIT_URL="$$livekit_url" LIVEKIT_API_KEY="$$livekit_key" LIVEKIT_API_SECRET="$$livekit_secret" PYTHONUNBUFFERED=1 \
		.venv/bin/python scripts/room_loadtest.py --rooms $(LOAD_ROOMS) --speakers $(LOAD_BOTS) --concurrency $(LOAD_TALKING) \
			--minutes $(LOAD_MINUTES) --out $$out $(LOAD_ARGS)

report: ## Test report against the running stack (make dev first): REPORT_PROFILE=quick|hour|full|none
	@$(PYTHON) scripts/test_report.py --profile $(REPORT_PROFILE)

test: check smoke ## Everything: static checks, then smoke tests

clean: ## Remove the frontend build output
	rm -rf $(FRONTEND)/dist
