// Plain hand-written HTML — no view engine, matching
// services/gateway/public/index.html's own style (same --paper/--brass
// custom properties for visual consistency across this platform's
// public-facing surfaces). Never renders an <input> for card data —
// that's the entire PCI-scope guarantee (section 7's rule: this
// codebase never touches raw card data). The "Pay now" state is a
// literal anchor tag to the provider's own (already PCI-compliant)
// hosted page or Noop's own /simulate page — nothing here collects
// payment details itself.

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatNaira(amountKobo) {
  return `₦${(amountKobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const SHELL_STYLE = `
  :root { --paper: #eef1e6; --ink: #1c2420; --ink-soft: #47554a; --brass: #93641f; --line: #c9d1bd; }
  @media (prefers-color-scheme: dark) {
    :root { --paper: #10160f; --ink: #e9e6d6; --ink-soft: #a9b39c; --brass: #d3a44f; --line: #2c362a; }
  }
  html, body { margin: 0; padding: 0; background: var(--paper); color: var(--ink); }
  body {
    font: 1rem -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    display: flex; align-items: center; justify-content: center; min-height: 100vh;
  }
  .card {
    max-width: 380px; width: calc(100% - 48px); margin: 24px; padding: 32px 28px;
    border: 1px solid var(--line); border-radius: 8px; text-align: center;
  }
  .eyebrow { font-size: 0.72rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--brass); }
  h1 { font-size: 1.3rem; font-weight: 600; margin: 0.6em 0 0.2em; }
  .amount { font-size: 2.1rem; font-weight: 600; color: var(--brass); margin: 0.4em 0; }
  p { color: var(--ink-soft); font-size: 0.92rem; line-height: 1.5; }
  .pay-btn {
    display: inline-block; margin-top: 1.2rem; padding: 0.75em 2em; border-radius: 6px;
    background: var(--brass); color: var(--paper); text-decoration: none; font-weight: 600;
  }
  .ref { margin-top: 1.4rem; font-family: ui-monospace, monospace; font-size: 0.76rem; color: var(--ink-soft); }
`;

function shell(bodyHtml) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Checkout — trust-bank</title>
<style>${SHELL_STYLE}</style>
</head>
<body>
<div class="card">${bodyHtml}</div>
</body>
</html>`;
}

function renderHostedPage({ merchantName, amountKobo, currency, status, authorizationUrl, reference }) {
  const safeName = escapeHtml(merchantName);
  const amount = formatNaira(amountKobo);
  const refLine = `<div class="ref">${escapeHtml(reference)}</div>`;

  if (status === 'pending' || status === 'processing') {
    return shell(`
      <div class="eyebrow">Pay ${safeName}</div>
      <h1>${safeName}</h1>
      <div class="amount">${amount} <small style="font-size:0.5em;">${escapeHtml(currency)}</small></div>
      <p>You're paying ${safeName} via trust-bank Checkout.</p>
      <a class="pay-btn" href="${escapeHtml(authorizationUrl)}">Pay now</a>
      ${refLine}
    `);
  }

  if (status === 'paid') {
    return shell(`
      <div class="eyebrow">Payment received</div>
      <h1>Thank you.</h1>
      <div class="amount">${amount}</div>
      <p>Your payment to ${safeName} was successful.</p>
      ${refLine}
    `);
  }

  if (status === 'expired') {
    return shell(`
      <div class="eyebrow">Link expired</div>
      <h1>This payment link has expired.</h1>
      <p>Contact ${safeName} for a new payment link.</p>
      ${refLine}
    `);
  }

  if (status === 'cancelled') {
    return shell(`
      <div class="eyebrow">Cancelled</div>
      <h1>This payment link was cancelled.</h1>
      <p>${safeName} cancelled this payment request.</p>
      ${refLine}
    `);
  }

  // 'failed', or any other terminal-but-unsuccessful state.
  return shell(`
    <div class="eyebrow">Payment failed</div>
    <h1>This payment attempt failed.</h1>
    <p>Contact ${safeName} for a new payment link.</p>
    ${refLine}
  `);
}

function renderSimulatePage({ merchantName, amountKobo, currency, sessionId }) {
  const safeName = escapeHtml(merchantName);
  return shell(`
    <div class="eyebrow">Noop provider — simulated payment</div>
    <h1>${safeName}</h1>
    <div class="amount">${formatNaira(amountKobo)} <small style="font-size:0.5em;">${escapeHtml(currency)}</small></div>
    <p>No real provider is configured for this tenant. Simulate the outcome of this payment:</p>
    <form method="POST" action="/pay/${escapeHtml(sessionId)}/simulate" style="margin-top:1rem;">
      <input type="hidden" name="outcome" value="success">
      <button class="pay-btn" type="submit" style="border:none; cursor:pointer;">Simulate successful payment</button>
    </form>
  `);
}

module.exports = { renderHostedPage, renderSimulatePage, formatNaira, escapeHtml };
