package httpapi

import (
	"encoding/json"
	"net/http"

	"trustbank/ledger/internal/loan"
)

type originateLoanRequest struct {
	ExternalCustomerID string `json:"externalCustomerId"`
	PrincipalKobo      int64  `json:"principalKobo"`
	AnnualRateBps      int    `json:"annualRateBps"`
	TenorDays          int    `json:"tenorDays"`
	// Optional — which branch originated this (services/identity's own
	// Branch, no FK, same convention as accounts.go's own branchId).
	BranchID string `json:"branchId"`
}

// handleOriginateLoan creates a PENDING loan — no money moves. The
// caller (services/identity) is responsible for the credit-eligibility
// decision before ever reaching this endpoint; this handler trusts it.
func (s *Server) handleOriginateLoan(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := tenantFromContext(r.Context())

	var req originateLoanRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.ExternalCustomerID == "" || req.PrincipalKobo <= 0 {
		respondError(w, http.StatusBadRequest, "externalCustomerId and a positive principalKobo are required")
		return
	}

	var branchID *string
	if req.BranchID != "" {
		branchID = &req.BranchID
	}

	acc, err := loan.Originate(r.Context(), s.pool, loan.OriginateInput{
		TenantID: tenantID, ExternalCustomerID: req.ExternalCustomerID,
		BranchID: branchID, PrincipalKobo: req.PrincipalKobo,
		AnnualRateBps: req.AnnualRateBps, TenorDays: req.TenorDays,
	})
	if err != nil {
		respondWalletError(w, err)
		return
	}

	respondJSON(w, http.StatusCreated, accountResponse(acc))
}

type disburseLoanRequest struct {
	Reference      string `json:"reference"`
	IdempotencyKey string `json:"idempotencyKey"`
	Description    string `json:"description"`
}

func (s *Server) handleDisburseLoan(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := tenantFromContext(r.Context())
	loanAccountID := r.PathValue("id")

	var req disburseLoanRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.Reference == "" || req.IdempotencyKey == "" {
		respondError(w, http.StatusBadRequest, "reference and idempotencyKey are required")
		return
	}

	entry, err := loan.Disburse(r.Context(), s.pool, loan.DisburseInput{
		TenantID: tenantID, LoanAccountID: loanAccountID,
		Reference: req.Reference, IdempotencyKey: req.IdempotencyKey, Description: req.Description,
	})
	if err != nil {
		respondWalletError(w, err)
		return
	}

	respondJSON(w, http.StatusCreated, journalEntryResponse(entry))
}

type repayLoanRequest struct {
	ExternalCustomerID string `json:"externalCustomerId"`
	Amount             int64  `json:"amount"`
	Reference          string `json:"reference"`
	IdempotencyKey     string `json:"idempotencyKey"`
	Description        string `json:"description"`
}

func (s *Server) handleRepayLoan(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := tenantFromContext(r.Context())
	loanAccountID := r.PathValue("id")

	var req repayLoanRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.ExternalCustomerID == "" || req.Reference == "" || req.IdempotencyKey == "" || req.Amount <= 0 {
		respondError(w, http.StatusBadRequest, "externalCustomerId, reference, idempotencyKey, and a positive amount are required")
		return
	}

	entry, err := loan.Repay(r.Context(), s.pool, loan.RepayInput{
		TenantID: tenantID, ExternalCustomerID: req.ExternalCustomerID, LoanAccountID: loanAccountID,
		Amount: req.Amount, Reference: req.Reference, IdempotencyKey: req.IdempotencyKey, Description: req.Description,
	})
	if err != nil {
		respondWalletError(w, err)
		return
	}

	respondJSON(w, http.StatusCreated, journalEntryResponse(entry))
}

func (s *Server) handleListLoans(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := tenantFromContext(r.Context())
	externalCustomerID := r.PathValue("externalCustomerId")

	accounts, err := loan.ListByCustomer(r.Context(), s.pool, tenantID, externalCustomerID)
	if err != nil {
		respondWalletError(w, err)
		return
	}

	list := make([]map[string]any, len(accounts))
	for i, acc := range accounts {
		list[i] = accountResponse(&acc)
	}
	respondJSON(w, http.StatusOK, map[string]any{"loans": list})
}
