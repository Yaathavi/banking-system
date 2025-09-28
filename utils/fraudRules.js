// - Unusually large withdrawal amount.
// - Transactions from different geographic regions within a short time window.
// - Too many failed login attempts before a transaction.
function fraudRules(transaction) {
  if (transaction.amount > 5000) {
    return true; //flagged
  }
  return false; //safe
}

module.exports = fraudRules;
