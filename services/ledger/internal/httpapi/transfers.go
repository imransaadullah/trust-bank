package httpapi

import (
	"encoding/json"
	"net/http"

	"trustbank/ledger/internal/wallet"
)

type p2pTransferRequest struct {
	FromExternalCustomerID string `json:"fromExternalCustomerId"`
	ToExternalCustomerID   string `json:"toExternalCustomerId"`
	Amount                 int64  `json:"amount"`
	Reference              string `json:"reference"`
	IdempotencyKey         string `json:"idempotencyKey"`
	Description            string `json:"description"`
}

func (s *Server) handleP2PTransfer(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := tenantFromContext(r.Context())

	var req p2pTransferRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.FromExternalCustomerID == "" || req.ToExternalCustomerID == "" || req.Reference == "" || req.IdempotencyKey == "" {
		respondError(w, http.StatusBadRequest, "fromExternalCustomerId, toExternalCustomerId, reference, and idempotencyKey are required")
		return
	}

	entry, err := wallet.TransferP2P(r.Context(), s.pool, wallet.TransferP2PInput{
		TenantID: tenantID, FromExternalCustomerID: req.FromExternalCustomerID,
		ToExternalCustomerID: req.ToExternalCustomerID, Amount: req.Amount,
		Reference: req.Reference, IdempotencyKey: req.IdempotencyKey, Description: req.Description,
	})
	if err != nil {
		respondWalletError(w, err)
		return
	}

	respondJSON(w, http.StatusCreated, journalEntryResponse(entry))
}

type confirmDepositRequest struct {
	ExternalCustomerID string `json:"externalCustomerId"`
	Amount             int64  `json:"amount"`
	ProviderRef        string `json:"providerRef"`
	Reference          string `json:"reference"`
	IdempotencyKey     string `json:"idempotencyKey"`
	Description        string `json:"description"`
}

func (s *Server) handleConfirmDeposit(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := tenantFromContext(r.Context())

	var req confirmDepositRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.ExternalCustomerID == "" || req.Reference == "" || req.IdempotencyKey == "" {
		respondError(w, http.StatusBadRequest, "externalCustomerId, reference, and idempotencyKey are required")
		return
	}

	entry, err := wallet.ConfirmDeposit(r.Context(), s.pool, wallet.ConfirmDepositInput{
		TenantID: tenantID, ExternalCustomerID: req.ExternalCustomerID, Amount: req.Amount,
		ProviderRef: req.ProviderRef, Reference: req.Reference, IdempotencyKey: req.IdempotencyKey,
		Description: req.Description,
	})
	if err != nil {
		respondWalletError(w, err)
		return
	}

	respondJSON(w, http.StatusCreated, journalEntryResponse(entry))
}

type recordWithdrawalRequest struct {
	ExternalCustomerID string `json:"externalCustomerId"`
	Amount             int64  `json:"amount"`
	Reference          string `json:"reference"`
	IdempotencyKey     string `json:"idempotencyKey"`
	Description        string `json:"description"`
}

func (s *Server) handleRecordWithdrawal(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := tenantFromContext(r.Context())

	var req recordWithdrawalRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.ExternalCustomerID == "" || req.Reference == "" || req.IdempotencyKey == "" {
		respondError(w, http.StatusBadRequest, "externalCustomerId, reference, and idempotencyKey are required")
		return
	}

	entry, err := wallet.RecordWithdrawal(r.Context(), s.pool, wallet.RecordWithdrawalInput{
		TenantID: tenantID, ExternalCustomerID: req.ExternalCustomerID, Amount: req.Amount,
		Reference: req.Reference, IdempotencyKey: req.IdempotencyKey, Description: req.Description,
	})
	if err != nil {
		respondWalletError(w, err)
		return
	}

	respondJSON(w, http.StatusCreated, journalEntryResponse(entry))
}

type recordCardSettlementRequest struct {
	ExternalCustomerID string `json:"externalCustomerId"`
	Amount             int64  `json:"amount"`
	Reference          string `json:"reference"`
	IdempotencyKey     string `json:"idempotencyKey"`
	Description        string `json:"description"`
}

// handleRecordCardSettlement is services/cards' own settlement call —
// grouped with the other transfer primitives (deposit/withdrawal/p2p)
// since the Ledger has no "card" concept of its own, just another
// money-movement primitive against an existing wallet.
func (s *Server) handleRecordCardSettlement(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := tenantFromContext(r.Context())

	var req recordCardSettlementRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.ExternalCustomerID == "" || req.Reference == "" || req.IdempotencyKey == "" {
		respondError(w, http.StatusBadRequest, "externalCustomerId, reference, and idempotencyKey are required")
		return
	}

	entry, err := wallet.RecordCardSettlement(r.Context(), s.pool, wallet.RecordCardSettlementInput{
		TenantID: tenantID, ExternalCustomerID: req.ExternalCustomerID, Amount: req.Amount,
		Reference: req.Reference, IdempotencyKey: req.IdempotencyKey, Description: req.Description,
	})
	if err != nil {
		respondWalletError(w, err)
		return
	}

	respondJSON(w, http.StatusCreated, journalEntryResponse(entry))
}
