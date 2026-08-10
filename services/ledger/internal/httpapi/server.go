// Package httpapi is the thin HTTP layer over the tenant/coa/account/ledger
// packages. It owns request parsing, auth, and status-code mapping — no
// business logic lives here.
package httpapi

import (
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Server struct {
	pool   *pgxpool.Pool
	secret string
}

func NewServer(pool *pgxpool.Pool, sharedSecret string) http.Handler {
	s := &Server{pool: pool, secret: sharedSecret}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.handleHealth)
	mux.Handle("POST /v1/tenants", requireSecret(sharedSecret, http.HandlerFunc(s.handleCreateTenant)))
	mux.Handle("POST /v1/journal-entries", requireSecret(sharedSecret, requireTenant(http.HandlerFunc(s.handlePostJournalEntry))))
	mux.Handle("POST /v1/journal-entries/{id}/reverse", requireSecret(sharedSecret, requireTenant(http.HandlerFunc(s.handleReverseJournalEntry))))
	mux.Handle("GET /v1/accounts/{id}/balance", requireSecret(sharedSecret, requireTenant(http.HandlerFunc(s.handleGetBalance))))

	return mux
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
