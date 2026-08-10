package httpapi

import (
	"net/http"

	"trustbank/ledger/internal/ledger"
)

func (s *Server) handleGetBalance(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := tenantFromContext(r.Context())
	ledgerAccountID := r.PathValue("id")

	bal, err := ledger.GetBalance(r.Context(), s.pool, tenantID, ledgerAccountID)
	if err != nil {
		respondLedgerError(w, err)
		return
	}

	respondJSON(w, http.StatusOK, map[string]any{
		"ledgerAccountId": bal.LedgerAccountID,
		"normalBalance":   bal.NormalBalance,
		"amount":          bal.Amount,
	})
}
