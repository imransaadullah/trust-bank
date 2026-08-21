// Package tlsconfig builds the *tls.Config a server needs to require and
// verify a client certificate — the capability behind Phase 6's mTLS
// item (CORE_BANKING_PLATFORM_ARCHITECTURE.md). Opt-in: on the default
// loopback-only SaaS topology this defends against nothing (traffic
// never leaves the machine), so ServerConfig returns nil whenever mTLS
// isn't explicitly enabled, and cmd/ledger falls back to plain
// ListenAndServe unchanged. Only worth turning on for a real hybrid
// deployment where a caller genuinely crosses an untrusted network — see
// deploy/NETWORK_TOPOLOGY.md.
//
// The Ledger never calls another service (the one house rule held
// throughout this platform), so it only ever needs to verify an inbound
// client certificate — never present one of its own.
package tlsconfig

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"os"

	"trustbank/ledger/internal/config"
)

// ServerConfig returns nil if cfg.MTLSEnabled is false — the caller's own
// signal to use plain http.Server.ListenAndServe instead.
func ServerConfig(cfg *config.Config) (*tls.Config, error) {
	if !cfg.MTLSEnabled {
		return nil, nil
	}

	cert, err := tls.LoadX509KeyPair(cfg.MTLSCertFile, cfg.MTLSKeyFile)
	if err != nil {
		return nil, fmt.Errorf("tlsconfig: load server cert/key: %w", err)
	}

	caPEM, err := os.ReadFile(cfg.MTLSCAFile)
	if err != nil {
		return nil, fmt.Errorf("tlsconfig: read CA file: %w", err)
	}
	caPool := x509.NewCertPool()
	if !caPool.AppendCertsFromPEM(caPEM) {
		return nil, fmt.Errorf("tlsconfig: no valid certificates found in CA file %s", cfg.MTLSCAFile)
	}

	return &tls.Config{
		Certificates: []tls.Certificate{cert},
		ClientCAs:    caPool,
		ClientAuth:   tls.RequireAndVerifyClientCert,
		MinVersion:   tls.VersionTLS12,
	}, nil
}
