# Mawiid local development: `make help` lists every target.
# Local runs use apps/backend/postman/.env.postman (local SQLite, Redis, LiveKit in dev mode).

SHELL := /bin/bash
.DEFAULT_GOAL := help

BACKEND  := apps/backend
FRONTEND := frontend

BACKEND_URL   ?= http://localhost:3000
FRONTEND_PORT ?= 3100
FRONTEND_URL  ?= http://localhost:$(FRONTEND_PORT)

REDIS_CONTAINER   := mawiid-redis
REDIS_IMAGE       := redis:7
LIVEKIT_CONTAINER := mawiid-livekit
LIVEKIT_IMAGE     := livekit/livekit-server

.PHONY: help install infra redis livekit infra-down infra-logs seed backend frontend dev stop \
        tokens typecheck build test-unit check smoke test clean

help: ## Show this help
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z_-]+:.*## / {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# ---------------------------------------------------------------- setup

install: ## Install dependencies and generate the Prisma clients
	bun install
	cd $(BACKEND) && bun run db:generate
	cd $(FRONTEND) && bun install

# ---------------------------------------------------------------- infrastructure

infra: redis livekit ## Start Redis and LiveKit (Docker)

redis:
	@docker start $(REDIS_CONTAINER) >/dev/null 2>&1 || \
		docker run -d --name $(REDIS_CONTAINER) -p 6379:6379 $(REDIS_IMAGE) >/dev/null
	@echo "Redis    localhost:6379"

# Host networking so the WebRTC UDP ports are reachable; --dev uses devkey/secret,
# which matches postman/.env.postman.
livekit:
	@docker start $(LIVEKIT_CONTAINER) >/dev/null 2>&1 || \
		docker run -d --name $(LIVEKIT_CONTAINER) --network host $(LIVEKIT_IMAGE) --dev --bind 0.0.0.0 >/dev/null
	@echo "LiveKit  ws://localhost:7880"

infra-down: ## Stop Redis and LiveKit
	-docker stop $(LIVEKIT_CONTAINER) $(REDIS_CONTAINER)

infra-logs: ## Follow the LiveKit logs
	docker logs -f $(LIVEKIT_CONTAINER)

# ---------------------------------------------------------------- run

seed: ## Reset the local test data (backend must be stopped)
	@if curl -sf $(BACKEND_URL)/health >/dev/null; then \
		echo "The backend is running: stop it first (make stop), the seed replaces its database files."; exit 1; fi
	cd $(BACKEND) && bun run postman:seed

backend: ## Run the backend on :3000 (watch mode)
	cd $(BACKEND) && bun run postman:dev

frontend: ## Run the frontend on :3100, or FRONTEND_PORT (hot reload)
	cd $(FRONTEND) && PORT=$(FRONTEND_PORT) BACKEND_URL=$(BACKEND_URL) bun dev

dev: infra ## Start infra, backend and frontend together (Ctrl+C stops both servers)
	@trap 'kill 0' INT TERM EXIT; \
		$(MAKE) --no-print-directory backend & \
		$(MAKE) --no-print-directory frontend & \
		wait

stop: ## Stop backend and frontend dev servers started elsewhere
	-pkill -f 'bun run --env-file=postman/.env.postman --watch src/app.ts'
	-pkill -f 'bun --hot src/index.ts'

tokens: ## Print login links for the seeded users and the room code
	@cd $(BACKEND) && bun -e " \
		const { createClient } = require('@libsql/client'); \
		const db = createClient({ url: 'file:postman/data/main.db' }); \
		const room = (await db.execute('select room_uid from room_route order by room_route_id limit 1')).rows[0]; \
		console.log('room code:', room ? room.room_uid : '(none, run make seed)'); \
		for (const v of require('./postman/mawiid.postman_environment.json').values) \
			if (v.key.startsWith('token_')) console.log(v.key.slice(6).padEnd(10), '$(FRONTEND_URL)/?token=' + v.value);"

# ---------------------------------------------------------------- test

typecheck: ## Typecheck backend and frontend
	cd $(BACKEND) && bun x tsc --noEmit
	cd $(FRONTEND) && bun x tsc --noEmit

build: ## Production build of the frontend (frontend/dist)
	cd $(FRONTEND) && bun run build

test-unit: ## Run backend unit tests
	@if find $(BACKEND)/src -name '*.test.ts' | grep -q .; then cd $(BACKEND) && bun test src; \
		else echo "No backend unit tests yet (*.test.ts under $(BACKEND)/src)"; fi

check: typecheck test-unit build ## Static checks, no services needed

smoke: ## End-to-end endpoint checks against the running stack (make dev first)
	cd $(BACKEND) && FRONTEND_URL=$(FRONTEND_URL) bun postman/smoke.ts

test: check smoke ## Everything: static checks, then smoke tests

clean: ## Remove the frontend build output
	rm -rf $(FRONTEND)/dist
