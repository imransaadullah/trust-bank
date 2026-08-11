package httpapi

import (
	"encoding/json"
	"net/http"

	"trustbank/ledger/internal/wallet"
)

type openSavingsAccountRequest struct {
	ExternalCustomerID string `json:"externalCustomerId"`
	AnnualRateBps      int    `json:"annualRateBps"`
	LockDays           int    `json:"lockDays"`
	PrincipalKobo      int64  `json:"principalKobo"`
	Reference          string `json:"reference"`
	IdempotencyKey     string `json:"idempotencyKey"`
	Description        string `json:"description"`
}

func (s *Server) handleOpenSavingsAccount(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := tenantFromContext(r.Context())

	var req openSavingsAccountRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.ExternalCustomerID == "" || req.Reference == "" || req.IdempotencyKey == "" || req.PrincipalKobo <= 0 {
		respondError(w, http.StatusBadRequest, "externalCustomerId, reference, idempotencyKey, and a positive principalKobo are required")
		return
	}

	acc, entry, err := wallet.OpenSavingsAccount(r.Context(), s.pool, wallet.OpenSavingsAccountInput{
		TenantID: tenantID, ExternalCustomerID: req.ExternalCustomerID,
		AnnualRateBps: req.AnnualRateBps, LockDays: req.LockDays, PrincipalKobo: req.PrincipalKobo,
		Reference: req.Reference, IdempotencyKey: req.IdempotencyKey, Description: req.Description,
	})
	if err != nil {
		respondWalletError(w, err)
		return
	}

	respondJSON(w, http.StatusCreated, map[string]any{
		"savingsAccount": accountResponse(acc),
		"fundingEntry":   journalEntryResponse(entry),
	})
}

type withdrawSavingsRequest struct {
	ExternalCustomerID string `json:"externalCustomerId"`
	Amount             int64  `json:"amount"`
	Reference          string `json:"reference"`
	IdempotencyKey     string `json:"idempotencyKey"`
	Description        string `json:"description"`
}

func (s *Server) handleWithdrawSavings(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := tenantFromContext(r.Context())
	savingsAccountID := r.PathValue("id")

	var req withdrawSavingsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.ExternalCustomerID == "" || req.Reference == "" || req.IdempotencyKey == "" {
		respondError(w, http.StatusBadRequest, "externalCustomerId, reference, and idempotencyKey are required")
		return
	}

	entry, err := wallet.WithdrawSavings(r.Context(), s.pool, wallet.WithdrawSavingsInput{
		TenantID: tenantID, ExternalCustomerID: req.ExternalCustomerID, SavingsAccountID: savingsAccountID,
		Amount: req.Amount, Reference: req.Reference, IdempotencyKey: req.IdempotencyKey, Description: req.Description,
	})
	if err != nil {
		respondWalletError(w, err)
		return
	}

	respondJSON(w, http.StatusCreated, journalEntryResponse(entry))
}

func (s *Server) handleListSavingsAccounts(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := tenantFromContext(r.Context())
	externalCustomerID := r.PathValue("externalCustomerId")

	accounts, err := wallet.ListSavingsAccounts(r.Context(), s.pool, tenantID, externalCustomerID)
	if err != nil {
		respondWalletError(w, err)
		return
	}

	list := make([]map[string]any, len(accounts))
	for i, acc := range accounts {
		list[i] = accountResponse(&acc)
	}
	respondJSON(w, http.StatusOK, map[string]any{"savingsAccounts": list})
}
