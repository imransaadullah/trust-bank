package loan

import "errors"

var (
	ErrLoanNotFound   = errors.New("loan: loan account not found")
	ErrLoanNotOwned   = errors.New("loan: loan account does not belong to this customer")
	ErrLoanNotPending = errors.New("loan: loan is not pending disbursement")
	ErrLoanNotActive  = errors.New("loan: loan is not active")
)
