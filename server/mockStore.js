const { buildDefaultUsers, buildSeedLedger } = require('./seed/demoData');

let users = [];
let chargebacks = [];
let ledger = [];

function resetDemo() {
  const TODAY = new Date();
  const { buildSeedData } = require('./routes/auth');

  users = buildDefaultUsers().map((u) => ({
    ...u,
    _id: u.username,
    toObject: () => ({ ...u, _id: u.username }),
    save: async function save() { return this; }
  }));

  chargebacks = buildSeedData(TODAY).map((cb) => ({
    ...cb,
    _id: cb.id,
    toObject: () => ({ ...cb }),
    save: async function save() {
      const idx = chargebacks.findIndex((c) => c.id === this.id);
      if (idx >= 0) chargebacks[idx] = { ...this };
      return this;
    }
  }));

  ledger = buildSeedLedger(TODAY).map((row) => ({
    ...row,
    _id: row.id
  }));

  return { users: users.length, chargebacks: chargebacks.length, ledger: ledger.length };
}

function getUsers() {
  return users.map((u) => {
    const { toObject, save, ...rest } = u;
    return { ...rest };
  });
}

function findUser(query) {
  if (query.username) return users.find((u) => u.username === query.username) || null;
  return null;
}

function updateUserWallet(username, newBalance) {
  const u = users.find((x) => x.username === username);
  if (u) u.walletBalance = newBalance;
}

function getChargebacks(query = {}) {
  let list = [...chargebacks];
  if (query.userName) list = list.filter((c) => c.userName === query.userName);
  if (query.id) list = list.filter((c) => c.id === query.id);
  return list.map((c) => {
    const { save, toObject, ...rest } = c;
    return { ...rest };
  }).sort((a, b) => (b.createdDate || '').localeCompare(a.createdDate || ''));
}

function findChargebackById(id) {
  return chargebacks.find((c) => c.id === id) || null;
}

function addChargeback(cb) {
  const newCb = {
    ...cb,
    _id: cb.id,
    toObject: () => ({ ...cb }),
    save: async function save() {
      const idx = chargebacks.findIndex((c) => c.id === this.id);
      if (idx >= 0) chargebacks[idx] = { ...this };
      return this;
    }
  };
  chargebacks.unshift(newCb);
  return newCb;
}

function getLedger(query = {}) {
  let list = [...ledger];
  if (query.merchant) list = list.filter((l) => l.merchant === query.merchant);
  return list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

function addLedgerEntry(entry) {
  ledger.unshift({ ...entry, _id: entry.id });
  return entry;
}

function countLedger() {
  return ledger.length;
}

// deflectionRules & rdrRules state
let deflectionRules = [
  { merchant: 'masteruser', maxThresholdAmount: 25.00, visaCategory: 'Fraud', ruleAction: 'AUTO_INTENT_TO_CREDIT' },
  { merchant: 'masteruser', maxThresholdAmount: 50.00, visaCategory: 'Consumer Dispute', ruleAction: 'AUTO_INTENT_TO_CREDIT' },
  { merchant: 'Test@isu', maxThresholdAmount: 35.00, visaCategory: 'Processing Error', ruleAction: 'AUTO_INTENT_TO_CREDIT' },
  { merchant: 'Test@isu', maxThresholdAmount: 15.00, visaCategory: 'Authorization', ruleAction: 'AUTO_INTENT_TO_CREDIT' },
  { merchant: 'masteruser', maxThresholdAmount: 100.00, visaCategory: 'Fraud', ruleAction: 'AUTO_INTENT_TO_CREDIT' }
];

let rdrRules = [
  { merchant: 'masteruser', programId: 'VISA_RDR_CORE', rdrMaxLimit: 50.00, excludedSkus: 'HIGH_RISK_ELECTRONICS' },
  { merchant: 'masteruser', programId: 'VISA_RDR_CORE', rdrMaxLimit: 75.00, excludedSkus: 'HIGH_RISK_ELECTRONICS' },
  { merchant: 'Test@isu', programId: 'VISA_RDR_CORE', rdrMaxLimit: 30.00, excludedSkus: 'HIGH_RISK_ELECTRONICS' },
  { merchant: 'Test@isu', programId: 'VISA_RDR_CORE', rdrMaxLimit: 120.00, excludedSkus: 'HIGH_RISK_ELECTRONICS' }
];

const mapCaidToMerchant = (caid) => {
  if (!caid) return 'masteruser';
  const c = caid.toUpperCase();
  if (c.includes('COLLAB_55') || c.includes('COLLAB_12') || c.includes('MERCH_101') || c.includes('MERCH_102') || c.includes('MERCH_001') || c.includes('MERCH_002') || c.includes('8812') || c.includes('4432') || c.includes('9941') || c.includes('9981') || c.includes('4452') || c.includes('8890') || c.includes('2211') || c.includes('4412')) {
    return 'masteruser';
  }
  return 'Test@isu';
};

function getDeflectionRules(merchant) {
  if (!merchant) return deflectionRules;
  return deflectionRules.filter(r => r.merchant === merchant);
}

function saveDeflectionRules(merchant, rules) {
  deflectionRules = deflectionRules.filter(r => r.merchant !== merchant);
  rules.forEach(r => deflectionRules.push({ ...r, merchant }));
}

function getRdrRules(merchant) {
  if (!merchant) return rdrRules;
  return rdrRules.filter(r => r.merchant === merchant);
}

function saveRdrRules(merchant, rules) {
  rdrRules = rdrRules.filter(r => r.merchant !== merchant);
  rules.forEach(r => rdrRules.push({ ...r, merchant }));
}

// Preload demo data for cold starts (refreshed again when MOCK_MODE is confirmed)
resetDemo();

module.exports = {
  resetDemo,
  getUsers,
  findUser,
  updateUserWallet,
  getChargebacks,
  findChargebackById,
  addChargeback,
  getLedger,
  addLedgerEntry,
  countLedger,
  mapCaidToMerchant,
  getDeflectionRules,
  saveDeflectionRules,
  getRdrRules,
  saveRdrRules
};
