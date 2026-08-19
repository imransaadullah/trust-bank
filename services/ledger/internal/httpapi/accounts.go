package httpapi

import (
	"encoding/json"
	"net/http"

	"trustbank/ledger/internal/domain"
	"trustbank/ledger/internal/ledger"
	"trustbank/ledger/internal/wallet"
)

func (s *Server) handleGetBalance(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := tenantFromContext(r.Context())
	ledgerAccountID := r.PathValue("id")

	bal, err := ledger.GetBalance(r.Context(), s.pool, tenantID, ledgerAccountID)
	if err != nil {
		respondWalletError(w, err)
		return
	}

	respondJSON(w, http.StatusOK, map[string]any{
		"ledgerAccountId": bal.LedgerAccountID,
		"normalBalance":   bal.NormalBalance,
		"amount":          bal.Amount,
	})
}

type openAccountRequest struct {
	ExternalCustomerID string `json:"externalCustomerId"`
	ProductType        string `json:"productType"`
	Currency           string `json:"currency"`
	KYCTier            int    `json:"kycTier"`
	AccountNumber      string `json:"accountNumber"`
	// Optional — which branch opened this account (services/identity's
	// own Branch, no FK). Never set by trustpay-backend's self-service
	// consumer flow; only a staff-initiated open (services/identity's
	// own /v1/accounts route) ever sends this.
	BranchID string `json:"branchId"`
}

func (s *Server) handleOpenAccount(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := tenantFromContext(r.Context())

	var req openAccountRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.ExternalCustomerID == "" {
		respondError(w, http.StatusBadRequest, "externalCustomerId is required")
		return
	}

	acc, err := wallet.OpenAccount(r.Context(), s.pool, wallet.OpenAccountInput{
		TenantID: tenantID, ExternalCustomerID: req.ExternalCustomerID,
		ProductType: req.ProductType, Currency: req.Currency, KYCTier: req.KYCTier,
		AccountNumber: req.AccountNumber, BranchID: req.BranchID,
	})
	if err != nil {
		respondWalletError(w, err)
		return
	}

	respondJSON(w, http.StatusCreated, accountResponse(acc))
}

func (s *Server) handleGetAccountByCustomer(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := tenantFromContext(r.Context())
	externalCustomerID := r.PathValue("externalCustomerId")

	acc, err := wallet.GetAccountByCustomer(r.Context(), s.pool, tenantID, externalCustomerID)
	if err != nil {
		respondWalletError(w, err)
		return
	}

	respondJSON(w, http.StatusOK, accountResponse(acc))
}

func accountResponse(acc *domain.LedgerAccount) map[string]any {
	return map[string]any{
		"id": acc.ID, "accountNumber": acc.AccountNumber, "externalCustomerId": acc.ExternalCustomerID,
		"branchId": acc.BranchID, "productType": acc.ProductType, "status": acc.Status,
		"currency": acc.Currency, "kycTier": acc.KYCTier,
	}
}
