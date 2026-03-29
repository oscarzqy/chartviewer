.PHONY: up down build logs restart deploy shell-backend

## Start containers in the background
up:
	docker compose up -d

## Stop containers
down:
	docker compose down

## Rebuild images and restart
build:
	docker compose up -d --build

## Tail logs (all services)
logs:
	docker compose logs -f

## Restart all services
restart:
	docker compose restart

## Pull latest code and redeploy (run on VPS)
deploy:
	git pull
	docker compose up -d --build

## Open a shell in the backend container
shell-backend:
	docker compose exec backend bash
