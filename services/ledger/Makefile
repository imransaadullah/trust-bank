.PHONY: migrate test run build fmt vet

migrate:
	@test -n "$(MIGRATE_DATABASE_URL)" || (echo "MIGRATE_DATABASE_URL is required (owner/superuser connection)"; exit 1)
	psql "$(MIGRATE_DATABASE_URL)" -f migrations/0001_init.sql
	psql "$(MIGRATE_DATABASE_URL)" -f migrations/0002_rls_and_triggers.sql
	psql "$(MIGRATE_DATABASE_URL)" -f migrations/0003_app_role.sql

test:
	go test ./...

run:
	go run ./cmd/ledger

build:
	go build -o bin/ledger ./cmd/ledger

fmt:
	gofmt -l .

vet:
	go vet ./...
