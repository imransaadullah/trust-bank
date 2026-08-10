// Package domain holds the types shared across the tenant, coa, account,
// and ledger packages — no ORM, so these mirror the SQL in migrations/
// by hand and are kept deliberately close to the table shapes.
package domain

import (
	"encoding/json"
	"time"
)

type Direction string

const (
	Debit  Direction = "DEBIT"
	Credit Direction = "CREDIT"
)

// Opposite returns the other direction — used when flipping a journal
// entry's lines for a reversal.
func (d Direction) Opposite() Direction {
	if d == Debit {
		return Credit
	}
	return Debit
}

type GLAccountType string

const (
	Asset     GLAccountType = "ASSET"
	Liability GLAccountType = "LIABILITY"
	Equity    GLAccountType = "EQUITY"
	Income    GLAccountType = "INCOME"
	Expense   GLAccountType = "EXPENSE"
)

type LedgerAccountStatus string

const (
	StatusActive  LedgerAccountStatus = "ACTIVE"
	StatusFrozen  LedgerAccountStatus = "FROZEN"
	StatusClosed  LedgerAccountStatus = "CLOSED"
	StatusPending LedgerAccountStatus = "PENDING"
)

type LicenseType string

const (
	UnitMFB      LicenseType = "UNIT_MFB"
	StateMFB     LicenseType = "STATE_MFB"
	NationalMFB  LicenseType = "NATIONAL_MFB"
	PSB          LicenseType = "PSB"
	BaaSReseller LicenseType = "BAAS_RESELLER"
	OtherLicense LicenseType = "OTHER"
)

type DeploymentMode string

const (
	Shared           DeploymentMode = "SHARED"
	DedicatedSchema  DeploymentMode = "DEDICATED_SCHEMA"
	DedicatedCluster DeploymentMode = "DEDICATED"
)

type Tenant struct {
	ID             string
	Slug           string
	Name           string
	LicenseType    LicenseType
	DeploymentMode DeploymentMode
	BaseCurrency   string
	CreatedAt      time.Time
}

type ChartOfAccount struct {
	ID              string
	TenantID        string
	Code            string
	Name            string
	Type            GLAccountType
	NormalBalance   Direction
	ParentID        *string
	IsSystemAccount bool
	Currency        string
}

type LedgerAccount struct {
	ID                   string
	TenantID             string
	GLAccountID          string
	AccountNumber        string
	ExternalCustomerID   *string
	ProductType          string
	Status               LedgerAccountStatus
	Currency             string
	KYCTier              int
	IsSystemAccount      bool
	AllowNegativeBalance bool
	Metadata             json.RawMessage
	CreatedAt            time.Time
}

type JournalEntry struct {
	ID             string
	TenantID       string
	Reference      string
	IdempotencyKey string
	EntryType      string
	Currency       string
	Description    string
	InitiatorID    string
	InitiatorType  string
	Metadata       json.RawMessage
	ReversalOfID   *string
	CreatedAt      time.Time
	Lines          []LedgerLine
}

type LedgerLine struct {
	ID              string
	TenantID        string
	JournalEntryID  string
	LedgerAccountID string
	Direction       Direction
	Amount          int64
	Currency        string
	CreatedAt       time.Time
}

// Balance is expressed "in the normal-balance sense": positive means
// healthy regardless of whether the underlying GL type is a debit-normal
// account (asset/expense) or a credit-normal one (liability/equity/income).
type Balance struct {
	LedgerAccountID string
	NormalBalance   Direction
	Amount          int64
}
