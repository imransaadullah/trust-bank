class CardsError extends Error {
  constructor(message, code, statusCode) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
  }
}

class ProviderNotImplementedError extends CardsError {
  constructor(provider, method) {
    super(`Provider "${provider}" does not implement ${method} yet`, 'PROVIDER_NOT_IMPLEMENTED', 501);
  }
}

class CredentialNotFoundError extends CardsError {
  constructor(credentialId) {
    super(`No credential found with id ${credentialId}`, 'CREDENTIAL_NOT_FOUND', 404);
  }
}

class TenantLedgerCredentialNotFoundError extends CardsError {
  constructor(tenantId) {
    super(
      `No Ledger credential stored for tenant ${tenantId} — Cards can't call the Ledger on this tenant's behalf until one is stored via POST /v1/tenants/:tenantId/ledger-credential`,
      'TENANT_LEDGER_CREDENTIAL_NOT_FOUND',
      424,
    );
  }
}

class CardNotFoundError extends CardsError {
  constructor(cardId) {
    super(`No card found with id ${cardId}`, 'CARD_NOT_FOUND', 404);
  }
}

class CardNotActiveError extends CardsError {
  constructor(cardId, status) {
    super(`Card ${cardId} is ${status}, not ACTIVE`, 'CARD_NOT_ACTIVE', 409);
  }
}

class LimitExceededError extends CardsError {
  constructor(message) {
    super(message, 'LIMIT_EXCEEDED', 422);
  }
}

module.exports = {
  CardsError,
  ProviderNotImplementedError,
  CredentialNotFoundError,
  TenantLedgerCredentialNotFoundError,
  CardNotFoundError,
  CardNotActiveError,
  LimitExceededError,
};
