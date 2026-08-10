// Package coa manages a tenant's chart of accounts — the GL categories
// that ledger accounts roll up into.
package coa

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"

	"trustbank/ledger/internal/domain"
)

type Entry struct {
	ID              string
	TenantID        string
	Code            string
	Name            string
	Type            domain.GLAccountType
	NormalBalance   domain.Direction
	ParentID        *string
	IsSystemAccount bool
}

// Create inserts a single chart-of-accounts row inside tx.
func Create(ctx context.Context, tx pgx.Tx, tenantID, code, name string, t domain.GLAccountType, normalBalance domain.Direction, parentID *string, isSystem bool) (*Entry, error) {
	row := tx.QueryRow(ctx, `
		INSERT INTO chart_of_accounts (tenant_id, code, name, type, normal_balance, parent_id, is_system_account)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id
	`, tenantID, code, name, t, normalBalance, parentID, isSystem)

	var id string
	if err := row.Scan(&id); err != nil {
		return nil, fmt.Errorf("coa: create %s: %w", code, err)
	}

	return &Entry{
		ID: id, TenantID: tenantID, Code: code, Name: name,
		Type: t, NormalBalance: normalBalance, ParentID: parentID, IsSystemAccount: isSystem,
	}, nil
}

// ByCode looks up a GL entry by its code within the tenant already pinned
// on tx via dbctx.WithTenant.
func ByCode(ctx context.Context, tx pgx.Tx, tenantID, code string) (*Entry, error) {
	row := tx.QueryRow(ctx, `
		SELECT id, name, type, normal_balance, parent_id, is_system_account
		FROM chart_of_accounts
		WHERE tenant_id = $1 AND code = $2
	`, tenantID, code)

	e := &Entry{TenantID: tenantID, Code: code}
	if err := row.Scan(&e.ID, &e.Name, &e.Type, &e.NormalBalance, &e.ParentID, &e.IsSystemAccount); err != nil {
		return nil, fmt.Errorf("coa: lookup %s: %w", code, err)
	}
	return e, nil
}

// SeedDefault provisions the minimal chart of accounts a new tenant needs
// to start posting entries: one top-level category per GL type, plus the
// specific accounts the ledger package's system accounts attach to.
// Must run inside the same tenant-scoped transaction as tenant creation.
func SeedDefault(ctx context.Context, tx pgx.Tx, tenantID string) (map[string]*Entry, error) {
	byCode := map[string]*Entry{}

	create := func(code, name string, t domain.GLAccountType, normal domain.Direction, parentCode string, isSystem bool) error {
		var parentID *string
		if parentCode != "" {
			parentID = &byCode[parentCode].ID
		}
		e, err := Create(ctx, tx, tenantID, code, name, t, normal, parentID, isSystem)
		if err != nil {
			return err
		}
		byCode[code] = e
		return nil
	}

	steps := []struct {
		code, name, parent string
		typ                domain.GLAccountType
		normal             domain.Direction
		system             bool
	}{
		{"1000", "Assets", "", domain.Asset, domain.Debit, false},
		{"1100", "Cash & Bank", "1000", domain.Asset, domain.Debit, true},
		{"1200", "Loans Receivable", "1000", domain.Asset, domain.Debit, false},

		{"2000", "Liabilities", "", domain.Liability, domain.Credit, false},
		{"2100", "Customer Deposits", "2000", domain.Liability, domain.Credit, false},
		{"2200", "Suspense / Clearing", "2000", domain.Liability, domain.Credit, true},

		{"3000", "Equity", "", domain.Equity, domain.Credit, false},
		{"3100", "Retained Earnings", "3000", domain.Equity, domain.Credit, true},

		{"4000", "Income", "", domain.Income, domain.Credit, false},
		{"4100", "Fee Income", "4000", domain.Income, domain.Credit, true},
		{"4200", "Interest Income", "4000", domain.Income, domain.Credit, true},

		{"5000", "Expense", "", domain.Expense, domain.Debit, false},
		{"5100", "Interest Expense", "5000", domain.Expense, domain.Debit, true},
	}

	for _, s := range steps {
		if err := create(s.code, s.name, s.typ, s.normal, s.parent, s.system); err != nil {
			return nil, fmt.Errorf("coa: seed default chart: %w", err)
		}
	}

	return byCode, nil
}
