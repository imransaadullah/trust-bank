package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"

	"trustbank/ledger/internal/domain"
	"trustbank/ledger/internal/ledger"
	"trustbank/ledger/internal/wallet"
)

type lineRequest struct {
	LedgerAccountID string `json:"ledgerAccountId"`
	Direction       string `json:"direction"`
	Amount          int64  `json:"amount"`
}

type postJournalEntryRequest struct {
	Reference      string         `json:"reference"`
	IdempotencyKey string         `json:"idempotencyKey"`
	EntryType      string         `json:"entryType"`
	Currency       string         `json:"currency"`
	Description    string         `json:"description"`
	InitiatorID    string         `json:"initiatorId"`
	InitiatorType  string         `json:"initiatorType"`
	Metadata       map[string]any `json:"metadata"`
	Lines          []lineRequest  `json:"lines"`
}

func (s *Server) handlePostJournalEntry(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := tenantFromContext(r.Context())

	var req postJournalEntryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.Reference == "" || req.IdempotencyKey == "" || req.EntryType == "" {
		respondError(w, http.StatusBadRequest, "reference, idempotencyKey, and entryType are required")
		return
	}

	lines := make([]ledger.LineInput, len(req.Lines))
	for i, l := range req.Lines {
		lines[i] = ledger.LineInput{
			LedgerAccountID: l.LedgerAccountID,
			Direction:       domain.Direction(l.Direction),
			Amount:          l.Amount,
		}
	}

	entry, err := ledger.PostJournalEntry(r.Context(), s.pool, ledger.PostInput{
		TenantID: tenantID, Reference: req.Reference, IdempotencyKey: req.IdempotencyKey,
		EntryType: req.EntryType, Currency: req.Currency, Description: req.Description,
		InitiatorID: req.InitiatorID, InitiatorType: req.InitiatorType, Metadata: req.Metadata, Lines: lines,
	})
	if err != nil {
		respondWalletError(w, err)
		return
	}

	respondJSON(w, http.StatusCreated, journalEntryResponse(entry))
}

type reverseJournalEntryRequest struct {
	Reason         string `json:"reason"`
	InitiatorID    string `json:"initiatorId"`
	InitiatorType  string `json:"initiatorType"`
	IdempotencyKey string `json:"idempotencyKey"`
}

func (s *Server) handleReverseJournalEntry(w http.ResponseWriter, r *http.Request) {
	tenantID, _ := tenantFromContext(r.Context())
	journalEntryID := r.PathValue("id")

	var req reverseJournalEntryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.IdempotencyKey == "" {
		respondError(w, http.StatusBadRequest, "idempotencyKey is required")
		return
	}

	entry, err := ledger.ReverseJournalEntry(r.Context(), s.pool, ledger.ReverseInput{
		TenantID: tenantID, JournalEntryID: journalEntryID, Reason: req.Reason,
		InitiatorID: req.InitiatorID, InitiatorType: req.InitiatorType, IdempotencyKey: req.IdempotencyKey,
	})
	if err != nil {
		respondWalletError(w, err)
		return
	}

	respondJSON(w, http.StatusCreated, journalEntryResponse(entry))
}

func journalEntryResponse(entry *domain.JournalEntry) map[string]any {
	lines := make([]map[string]any, len(entry.Lines))
	for i, l := range entry.Lines {
		lines[i] = map[string]any{
			"ledgerAccountId": l.LedgerAccountID, "direction": l.Direction, "amount": l.Amount,
		}
	}
	return map[string]any{
		"id": entry.ID, "reference": entry.Reference, "entryType": entry.EntryType,
		"currency": entry.Currency, "description": entry.Description,
		"reversalOfId": entry.ReversalOfID, "createdAt": entry.CreatedAt, "lines": lines,
	}
}

// respondWalletError maps errors from both internal/wallet (product-level
// operations) and internal/ledger (the primitive underneath them) to HTTP
// status codes — a handler calling either package can use this directly.
func respondWalletError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, wallet.ErrCustomerAlreadyHasAccount):
		respondError(w, http.StatusConflict, err.Error())
	case errors.Is(err, wallet.ErrCustomerAccountNotFound):
		respondError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, wallet.ErrSameAccount):
		respondError(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, ledger.ErrInsufficientBalance):
		respondError(w, http.StatusUnprocessableEntity, err.Error())
	case errors.Is(err, ledger.ErrUnbalancedEntry), errors.Is(err, ledger.ErrTooFewLines), errors.Is(err, ledger.ErrNonPositiveAmount):
		respondError(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, ledger.ErrAccountNotFound), errors.Is(err, ledger.ErrJournalEntryNotFound):
		respondError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, ledger.ErrAccountNotActive), errors.Is(err, ledger.ErrAlreadyReversed):
		respondError(w, http.StatusConflict, err.Error())
	default:
		respondError(w, http.StatusInternalServerError, "internal error")
	}
}
