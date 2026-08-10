// Package config loads process configuration from the environment.
package config

import (
	"fmt"
	"os"
)

type Config struct {
	Port        string
	DatabaseURL string
	// SharedSecret gates every request (Authorization: Bearer <secret>),
	// with the calling tenant identified separately via X-Tenant-Id.
	// This is the simplest possible placeholder for the tiered
	// publishable/secret API key model in AUTHCORE_SCOPED_CLIENT_KEY_SPEC.md —
	// one static, unscoped secret shared by every caller, admin routes
	// included. Do not expose this service outside a trusted network, and
	// replace this before onboarding a real tenant.
	SharedSecret string
}

func Load() (*Config, error) {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		return nil, fmt.Errorf("config: DATABASE_URL is required")
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	secret := os.Getenv("LEDGER_SHARED_SECRET")
	if secret == "" {
		return nil, fmt.Errorf("config: LEDGER_SHARED_SECRET is required")
	}

	return &Config{Port: port, DatabaseURL: dbURL, SharedSecret: secret}, nil
}
