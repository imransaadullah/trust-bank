const errorHandler = require('../src/middleware/errorHandler');
const { KYCTierRequiredError, UserNotFoundError } = require('../src/utils/errors');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('errorHandler', () => {
  test('maps KYCTierRequiredError to 403', () => {
    const res = mockRes();
    errorHandler(new KYCTierRequiredError(1), { path: '/wallet/withdraw' }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, code: 'KYC_TIER_REQUIRED' }));
  });

  test('maps UserNotFoundError to 404', () => {
    const res = mockRes();
    errorHandler(new UserNotFoundError(), { path: '/wallet/balance' }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('maps an upstream Ledger error (err.status set) to that status', () => {
    const res = mockRes();
    const err = new Error('insufficient balance');
    err.status = 422;
    err.ledgerErrorBody = { error: 'insufficient balance' };
    errorHandler(err, { path: '/wallet/withdraw' }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(422);
  });

  test('falls back to 500 for an unrecognized error', () => {
    const res = mockRes();
    errorHandler(new Error('boom'), { path: '/x' }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
