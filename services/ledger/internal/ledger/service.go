// Package ledger is the core ledger: posting and reversing balanced,
// multi-leg journal entries under Serializable isolation, with idempotency
// and insufficient-balance guards enforced before anything is written.
//
// Nothing outside this package writes to journal_entries or ledger_lines —
// see CORE_BANKING_PLATFORM_ARCHITECTURE.md section 4: "nothing outside
// the ledger holds a balance."
package ledger

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"trustbank/ledger/internal/account"
	"trustbank/ledger/internal/dbctx"
	"trustbank/ledger/internal/domain"
)

type LineInput struct {
	LedgerAccountID string
	Direction       domain.Direction
	Amount          int64
}

type PostInput struct {
	TenantID       string
	Reference      string
	IdempotencyKey string
	EntryType      string
	Currency       string
	Description    string
	InitiatorID    string
	InitiatorType  string
	Metadata       map[string]any
	Lines          []LineInput
}

type ReverseInput struct {
	TenantID       string
	JournalEntryID string
	Reason         string
	InitiatorID    string
	InitiatorType  string
	IdempotencyKey string
}

// PostJournalEntry validates and posts a balanced, multi-leg entry.
func PostJournalEntry(ctx context.Context, pool *pgxpool.Pool, in PostInput) (*domain.JournalEntry, error) {
	if err := validateLines(in.Lines); err != nil {
		return nil, err
	}

	var result *domain.JournalEntry
	err := dbctx.WithTenant(ctx, pool, in.TenantID, func(ctx context.Context, tx pgx.Tx) error {
		entry, err := postWithinTx(ctx, tx, postTxInput{
			TenantID:       in.TenantID,
			Reference:      in.Reference,
			IdempotencyKey: in.IdempotencyKey,
			EntryType:      in.EntryType,
			Currency:       in.Currency,
			Description:    in.Description,
			InitiatorID:    in.InitiatorID,
			InitiatorType:  in.InitiatorType,
			Metadata:       in.Metadata,
			Lines:          in.Lines,
		})
		if err != nil {
			return err
		}
		result = entry
		return nil
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}

// ReverseJournalEntry posts a new entry with every line flipped, linked
// back to the original via reversal_of_id. It never mutates the original —
// journal_entries and ledger_lines are append-only (enforced by DB trigger,
// migrations/0002_rls_and_triggers.sql).
func ReverseJournalEntry(ctx context.Context, pool *pgxpool.Pool, in ReverseInput) (*domain.JournalEntry, error) {
	var result *domain.JournalEntry
	err := dbctx.WithTenant(ctx, pool, in.TenantID, func(ctx context.Context, tx pgx.Tx) error {
		if existing, err := findByIdempotencyKey(ctx, tx, in.TenantID, in.IdempotencyKey); err != nil {
			return err
		} else if existing != nil {
			result = existing
			return nil
		}

		original, err := loadEntry(ctx, tx, in.TenantID, in.JournalEntryID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrJournalEntryNotFound
			}
			return err
		}

		alreadyReversed, err := hasReversal(ctx, tx, in.TenantID, original.ID)
		if err != nil {
			return err
		}
		if alreadyReversed {
			return ErrAlreadyReversed
		}

		flipped := make([]LineInput, len(original.Lines))
		for i, l := range original.Lines {
			flipped[i] = LineInput{
				LedgerAccountID: l.LedgerAccountID,
				Direction:       l.Direction.Opposite(),
				Amount:          l.Amount,
			}
		}

		entry, err := postWithinTx(ctx, tx, postTxInput{
			TenantID:       in.TenantID,
			Reference:      original.Reference + "-REV",
			IdempotencyKey: in.IdempotencyKey,
			EntryType:      "reversal",
			Currency:       original.Currency,
			Description:    fmt.Sprintf("Reversal: %s", in.Reason),
			InitiatorID:    in.InitiatorID,
			InitiatorType:  in.InitiatorType,
			Metadata: map[string]any{
				"originalEntryId": original.ID,
				"reason":          in.Reason,
			},
			ReversalOfID: &original.ID,
			Lines:        flipped,
		})
		if err != nil {
			return err
		}
		result = entry
		return nil
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}

// GetBalance returns the current balance of a ledger account, read-committed
// is fine here — this is a display read, not part of a money-moving
// transaction. See architecture doc section 6 on CQRS-style reads.
func GetBalance(ctx context.Context, pool *pgxpool.Pool, tenantID, ledgerAccountID string) (*domain.Balance, error) {
	var bal *domain.Balance
	err := dbctx.WithTenant(ctx, pool, tenantID, func(ctx context.Context, tx pgx.Tx) error {
		b, err := account.Balance(ctx, tx, tenantID, ledgerAccountID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return fmt.Errorf("%w: %s", ErrAccountNotFound, ledgerAccountID)
			}
			return err
		}
		bal = b
		return nil
	})
	if err != nil {
		return nil, err
	}
	return bal, nil
}

// ---- internals ----

type postTxInput struct {
	TenantID       string
	Reference      string
	IdempotencyKey string
	EntryType      string
	Currency       string
	Description    string
	InitiatorID    string
	InitiatorType  string
	Metadata       map[string]any
	ReversalOfID   *string
	Lines          []LineInput
}

func validateLines(lines []LineInput) error {
	if len(lines) < 2 {
		return ErrTooFewLines
	}
	var debitTotal, creditTotal int64
	for _, l := range lines {
		if l.Amount <= 0 {
			return ErrNonPositiveAmount
		}
		switch l.Direction {
		case domain.Debit:
			debitTotal += l.Amount
		case domain.Credit:
			creditTotal += l.Amount
		default:
			return fmt.Errorf("ledger: invalid direction %q", l.Direction)
		}
	}
	if debitTotal != creditTotal {
		return fmt.Errorf("%w: debits=%d credits=%d", ErrUnbalancedEntry, debitTotal, creditTotal)
	}
	return nil
}

// postWithinTx does the actual guard-checking and writing, shared by a
// fresh post and a reversal so both get identical account-state guards.
func postWithinTx(ctx context.Context, tx pgx.Tx, in postTxInput) (*domain.JournalEntry, error) {
	if err := validateLines(in.Lines); err != nil {
		return nil, err
	}

	if existing, err := findByIdempotencyKey(ctx, tx, in.TenantID, in.IdempotencyKey); err != nil {
		return nil, err
	} else if existing != nil {
		return existing, nil
	}

	currency := in.Currency
	if currency == "" {
		currency = "NGN"
	}

	for _, line := range in.Lines {
		acc, normal, err := account.Get(ctx, tx, in.TenantID, line.LedgerAccountID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, fmt.Errorf("%w: %s", ErrAccountNotFound, line.LedgerAccountID)
			}
			return nil, err
		}
		if acc.Status != domain.StatusActive {
			return nil, fmt.Errorf("%w: %s is %s", ErrAccountNotActive, line.LedgerAccountID, acc.Status)
		}

		reducesBalance := line.Direction != normal
		if reducesBalance && !acc.AllowNegativeBalance {
			bal, err := account.Balance(ctx, tx, in.TenantID, line.LedgerAccountID)
			if err != nil {
				return nil, err
			}
			if bal.Amount-line.Amount < 0 {
				return nil, fmt.Errorf("%w: account %s has %d, needs %d",
					ErrInsufficientBalance, line.LedgerAccountID, bal.Amount, line.Amount)
			}
		}
	}

	metadata := in.Metadata
	if metadata == nil {
		metadata = map[string]any{}
	}
	metadataJSON, err := json.Marshal(metadata)
	if err != nil {
		return nil, fmt.Errorf("ledger: marshal metadata: %w", err)
	}

	entry := &domain.JournalEntry{
		TenantID: in.TenantID, Reference: in.Reference, IdempotencyKey: in.IdempotencyKey,
		EntryType: in.EntryType, Currency: currency, Description: in.Description,
		InitiatorID: in.InitiatorID, InitiatorType: in.InitiatorType,
		Metadata: metadataJSON, ReversalOfID: in.ReversalOfID,
	}

	row := tx.QueryRow(ctx, `
		INSERT INTO journal_entries (
			tenant_id, reference, idempotency_key, entry_type, currency,
			description, initiator_id, initiator_type, metadata, reversal_of_id
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		RETURNING id, created_at
	`, in.TenantID, in.Reference, in.IdempotencyKey, in.EntryType, currency,
		in.Description, in.InitiatorID, in.InitiatorType, metadataJSON, in.ReversalOfID)
	if err := row.Scan(&entry.ID, &entry.CreatedAt); err != nil {
		return nil, fmt.Errorf("ledger: insert journal entry: %w", err)
	}

	for _, line := range in.Lines {
		ll := domain.LedgerLine{
			TenantID: in.TenantID, JournalEntryID: entry.ID, LedgerAccountID: line.LedgerAccountID,
			Direction: line.Direction, Amount: line.Amount, Currency: currency,
		}
		lrow := tx.QueryRow(ctx, `
			INSERT INTO ledger_lines (tenant_id, journal_entry_id, ledger_account_id, direction, amount, currency)
			VALUES ($1, $2, $3, $4, $5, $6)
			RETURNING id, created_at
		`, in.TenantID, entry.ID, line.LedgerAccountID, line.Direction, line.Amount, currency)
		if err := lrow.Scan(&ll.ID, &ll.CreatedAt); err != nil {
			return nil, fmt.Errorf("ledger: insert ledger line: %w", err)
		}
		entry.Lines = append(entry.Lines, ll)
	}

	if err := writeOutboxEvent(ctx, tx, in.TenantID, entry); err != nil {
		return nil, err
	}

	return entry, nil
}

func writeOutboxEvent(ctx context.Context, tx pgx.Tx, tenantID string, entry *domain.JournalEntry) error {
	payload, err := json.Marshal(map[string]any{
		"journalEntryId": entry.ID,
		"entryType":      entry.EntryType,
		"reference":      entry.Reference,
		"currency":       entry.Currency,
		"lineCount":      len(entry.Lines),
	})
	if err != nil {
		return fmt.Errorf("ledger: marshal outbox payload: %w", err)
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO event_outbox (tenant_id, event_type, payload)
		VALUES ($1, 'ledger.journal_entry.posted', $2)
	`, tenantID, payload)
	if err != nil {
		return fmt.Errorf("ledger: write outbox event: %w", err)
	}
	return nil
}

func findByIdempotencyKey(ctx context.Context, tx pgx.Tx, tenantID, key string) (*domain.JournalEntry, error) {
	row := tx.QueryRow(ctx, `
		SELECT id FROM journal_entries WHERE tenant_id = $1 AND idempotency_key = $2
	`, tenantID, key)
	var id string
	if err := row.Scan(&id); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("ledger: idempotency lookup: %w", err)
	}
	return loadEntry(ctx, tx, tenantID, id)
}

func hasReversal(ctx context.Context, tx pgx.Tx, tenantID, journalEntryID string) (bool, error) {
	row := tx.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM journal_entries WHERE tenant_id = $1 AND reversal_of_id = $2)
	`, tenantID, journalEntryID)
	var exists bool
	if err := row.Scan(&exists); err != nil {
		return false, fmt.Errorf("ledger: check reversal: %w", err)
	}
	return exists, nil
}

func loadEntry(ctx context.Context, tx pgx.Tx, tenantID, id string) (*domain.JournalEntry, error) {
	row := tx.QueryRow(ctx, `
		SELECT reference, idempotency_key, entry_type, currency, description,
		       initiator_id, initiator_type, metadata, reversal_of_id, created_at
		FROM journal_entries
		WHERE tenant_id = $1 AND id = $2
	`, tenantID, id)

	entry := &domain.JournalEntry{ID: id, TenantID: tenantID}
	var description, initiatorID, initiatorType *string
	if err := row.Scan(&entry.Reference, &entry.IdempotencyKey, &entry.EntryType, &entry.Currency,
		&description, &initiatorID, &initiatorType, &entry.Metadata, &entry.ReversalOfID, &entry.CreatedAt); err != nil {
		return nil, err
	}
	if description != nil {
		entry.Description = *description
	}
	if initiatorID != nil {
		entry.InitiatorID = *initiatorID
	}
	if initiatorType != nil {
		entry.InitiatorType = *initiatorType
	}

	rows, err := tx.Query(ctx, `
		SELECT id, ledger_account_id, direction, amount, currency, created_at
		FROM ledger_lines
		WHERE tenant_id = $1 AND journal_entry_id = $2
		ORDER BY created_at
	`, tenantID, id)
	if err != nil {
		return nil, fmt.Errorf("ledger: load lines: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var l domain.LedgerLine
		l.TenantID = tenantID
		l.JournalEntryID = id
		if err := rows.Scan(&l.ID, &l.LedgerAccountID, &l.Direction, &l.Amount, &l.Currency, &l.CreatedAt); err != nil {
			return nil, fmt.Errorf("ledger: scan line: %w", err)
		}
		entry.Lines = append(entry.Lines, l)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return entry, nil
}
