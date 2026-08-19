// Package httpapi is the thin HTTP layer over the tenant/coa/account/ledger
// packages. It owns request parsing, auth, and status-code mapping — no
// business logic lives here.
package httpapi

import (
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"trustbank/ledger/internal/credential"
)

type Server struct {
	pool *pgxpool.Pool
}

func NewServer(pool *pgxpool.Pool) http.Handler {
	s := &Server{pool: pool}

	admin := func(h http.HandlerFunc) http.Handler {
		return requireApiKey(pool, credential.ScopeAdmin, h)
	}
	operate := func(h http.HandlerFunc) http.Handler {
		return requireApiKey(pool, credential.ScopeOperate, h)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.handleHealth)
	mux.Handle("POST /v1/tenants", requireApiKey(pool, credential.ScopePlatformAdmin, http.HandlerFunc(s.handleCreateTenant)))

	mux.Handle("POST /v1/credentials", admin(s.handleIssueCredential))
	mux.Handle("GET /v1/credentials", admin(s.handleListCredentials))
	mux.Handle("POST /v1/credentials/{credId}/revoke", admin(s.handleRevokeCredential))

	mux.Handle("POST /v1/journal-entries", operate(s.handlePostJournalEntry))
	mux.Handle("POST /v1/journal-entries/{id}/reverse", operate(s.handleReverseJournalEntry))
	mux.Handle("GET /v1/accounts/{id}/balance", operate(s.handleGetBalance))
	mux.Handle("POST /v1/accounts", operate(s.handleOpenAccount))
	mux.Handle("GET /v1/customers/{externalCustomerId}/account", operate(s.handleGetAccountByCustomer))
	mux.Handle("POST /v1/transfers/p2p", operate(s.handleP2PTransfer))
	mux.Handle("POST /v1/transfers/deposit/confirm", operate(s.handleConfirmDeposit))
	mux.Handle("POST /v1/transfers/withdrawal", operate(s.handleRecordWithdrawal))
	mux.Handle("POST /v1/savings/accounts", operate(s.handleOpenSavingsAccount))
	mux.Handle("POST /v1/savings/accounts/{id}/withdraw", operate(s.handleWithdrawSavings))
	mux.Handle("GET /v1/customers/{externalCustomerId}/savings-accounts", operate(s.handleListSavingsAccounts))
	mux.Handle("POST /v1/loans", operate(s.handleOriginateLoan))
	mux.Handle("POST /v1/loans/{id}/disburse", operate(s.handleDisburseLoan))
	mux.Handle("POST /v1/loans/{id}/repay", operate(s.handleRepayLoan))
	mux.Handle("GET /v1/customers/{externalCustomerId}/loans", operate(s.handleListLoans))

	return mux
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
