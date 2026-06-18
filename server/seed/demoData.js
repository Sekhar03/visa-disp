const User = require('../models/User');
const Chargeback = require('../models/Chargeback');
const Ledger = require('../models/Ledger');

const buildDefaultUsers = () => [
  { username: 'Test@isu', password: 'Test@2026', role: 'merchant', name: 'Test@isu', walletBalance: 12450.75 },
  { username: 'masteruser', password: 'Test@2026', role: 'merchant', name: 'masteruser', walletBalance: 964.35 },
  { username: 'Test@Ad', password: 'Test@2027', role: 'admin', name: 'Krishna Das', walletBalance: 245800.00 }
];

const buildSeedLedger = (TODAY) => {
  const fmtDate = (d) => d.toISOString().split('T')[0];
  const daysAgo = (n) => {
    const d = new Date(TODAY);
    d.setDate(d.getDate() - n);
    return fmtDate(d);
  };

  return [
    { id: 'ADJ101', merchant: 'masteruser', type: 'Debit', amount: 1000, date: daysAgo(1), remarks: 'Lien hold — CB001 VISA chargeback' },
    { id: 'ADJ102', merchant: 'masteruser', type: 'Debit', amount: 3000, date: daysAgo(2), remarks: 'Lien hold — CB002 VISA chargeback' },
    { id: 'ADJ103', merchant: 'masteruser', type: 'Credit', amount: 8500, date: daysAgo(10), remarks: 'Dispute won credit — CB007 refund to wallet' },
    { id: 'ADJ104', merchant: 'masteruser', type: 'Debit', amount: 15000, date: daysAgo(0), remarks: 'Fraud lien — CB016 high-value alert' },
    { id: 'ADJ105', merchant: 'Test@isu', type: 'Debit', amount: 3200, date: daysAgo(1), remarks: 'Lien hold — CB033 Rupay chargeback' },
    { id: 'ADJ106', merchant: 'Test@isu', type: 'Credit', amount: 8900, date: daysAgo(8), remarks: 'Dispute won — CB035 Mastercard ruling' },
    { id: 'ADJ107', merchant: 'masteruser', type: 'Debit', amount: 1600, date: daysAgo(8), remarks: 'Merchant accepted refund — CB039' },
    { id: 'ADJ108', merchant: 'Test@isu', type: 'Credit', amount: 3000, date: daysAgo(5), remarks: 'NPCI won — CB028 Rupay dispute' },
    { id: 'ADJ109', merchant: 'masteruser', type: 'Debit', amount: 18500, date: daysAgo(12), remarks: 'Fraud lost — CB029 wallet debit' },
    { id: 'ADJ110', merchant: 'masteruser', type: 'Credit', amount: 2500, date: daysAgo(4), remarks: 'Manual admin credit — representment fee reversal' }
  ];
};

async function seedAllDemoData() {
  if (global.MOCK_MODE) {
    return require('../mockStore').resetDemo();
  }

  const TODAY = new Date();

  try {
    await User.deleteMany({});
    await Chargeback.deleteMany({});
    await Ledger.deleteMany({});

    const users = buildDefaultUsers();
    await User.insertMany(users);

    const { buildSeedData } = require('../routes/auth');
    const chargebacks = buildSeedData(TODAY);
    await Chargeback.insertMany(chargebacks);

    const ledger = buildSeedLedger(TODAY);
    await Ledger.insertMany(ledger);

    return {
      users: users.length,
      chargebacks: chargebacks.length,
      ledger: ledger.length
    };
  } catch (err) {
    console.warn('[seed] MongoDB seed failed, using in-memory store:', err.message);
    global.MOCK_MODE = true;
    return require('../mockStore').resetDemo();
  }
}

module.exports = {
  buildDefaultUsers,
  buildSeedLedger,
  seedAllDemoData
};
