package ledger

import "errors"

var (
	ErrTooFewLines          = errors.New("ledger: journal entry needs at least 2 lines")
	ErrUnbalancedEntry      = errors.New("ledger: debits do not equal credits")
	ErrNonPositiveAmount    = errors.New("ledger: line amount must be greater than zero")
	ErrAccountNotFound      = errors.New("ledger: ledger account not found")
	ErrAccountNotActive     = errors.New("ledger: ledger account is not active")
	ErrInsufficientBalance  = errors.New("ledger: insufficient balance")
	ErrJournalEntryNotFound = errors.New("ledger: journal entry not found")
	ErrAlreadyReversed      = errors.New("ledger: journal entry already reversed")
)
