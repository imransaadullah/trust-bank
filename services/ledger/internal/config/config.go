// Package config loads process configuration from the environment.
package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

type Config struct {
	Port string
	// BindHost defaults to loopback only — this service is never meant to
	// be internet-facing. Override to a private/VPN interface IP (e.g. a
	// WireGuard tunnel address) for a hybrid deployment where the caller
	// lives on a different host; never set to 0.0.0.0.
	BindHost    string
	DatabaseURL string
	// SharedSecret gates every request (Authorization: Bearer <secret>),
	// with the calling tenant identified separately via X-Tenant-Id.
	// This is the simplest possible placeholder for the tiered
	// publishable/secret API key model in AUTHCORE_SCOPED_CLIENT_KEY_SPEC.md —
	// one static, unscoped secret shared by every caller, admin routes
	// included. Do not expose this service outside a trusted network, and
	// replace this before onboarding a real tenant.
	SharedSecret string
	// AccrualPollInterval defaults to 24h in production; tests call
	// accrual.Consumer.RunOnce directly rather than waiting on this.
	AccrualPollInterval time.Duration
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

	bindHost := os.Getenv("BIND_HOST")
	if bindHost == "" {
		bindHost = "127.0.0.1"
	}

	secret := os.Getenv("LEDGER_SHARED_SECRET")
	if secret == "" {
		return nil, fmt.Errorf("config: LEDGER_SHARED_SECRET is required")
	}

	accrualInterval := 24 * time.Hour
	if raw := os.Getenv("ACCRUAL_POLL_INTERVAL_MINUTES"); raw != "" {
		minutes, err := strconv.Atoi(raw)
		if err != nil {
			return nil, fmt.Errorf("config: ACCRUAL_POLL_INTERVAL_MINUTES must be an integer: %w", err)
		}
		accrualInterval = time.Duration(minutes) * time.Minute
	}

	return &Config{
		Port: port, BindHost: bindHost, DatabaseURL: dbURL, SharedSecret: secret,
		AccrualPollInterval: accrualInterval,
	}, nil
}
