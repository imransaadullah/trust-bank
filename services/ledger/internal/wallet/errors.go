package wallet

import "errors"

var (
	ErrCustomerAlreadyHasAccount = errors.New("wallet: customer already has an account")
	ErrCustomerAccountNotFound   = errors.New("wallet: no account found for this customer")
	ErrSameAccount               = errors.New("wallet: sender and recipient are the same account")
	ErrSavingsAccountNotFound    = errors.New("wallet: savings account not found")
	ErrSavingsAccountNotOwned    = errors.New("wallet: savings account does not belong to this customer")
	ErrSavingsLocked             = errors.New("wallet: savings account has not reached its maturity date")
)
