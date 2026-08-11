const { v4: uuidv4 } = require('uuid');

function generateReference(prefix) {
  return `${prefix}-${Date.now()}-${uuidv4().slice(0, 8)}`;
}

module.exports = { generateReference };
