const mongoose = require('mongoose');

const timelineEntrySchema = new mongoose.Schema({
  by: { type: String, required: true },
  time: { type: String, required: true }, // Store formatted string for timeline rendering
  title: { type: String, required: true },
  remarks: { type: String, default: '' },
  file: { type: String, default: null }
});

const documentEntrySchema = new mongoose.Schema({
  id: { type: String, required: true },
  filename: { type: String, required: true },
  uploadedAt: { type: String, required: true },
  status: { type: String, default: 'Pending Review' },
  rejectionRemarks: { type: String, default: '' },
  rejectedAt: { type: String, default: null },
  uploadedBy: { type: String, default: 'Merchant' }
});

const chargebackSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  caseId: { type: String, required: true },
  visaId: { type: String, default: null },
  userName: { type: String, default: 'masteruser' },
  userId: { type: String, default: '' },
  rrn: { type: String, required: true },
  txnId: { type: String, required: true },
  terminalId: { type: String, default: '' },
  beneMobile: { type: String, default: '' },
  remMobile: { type: String, default: '' },
  createdDate: { type: String, required: true }, // Date string (YYYY-MM-DD)
  txnDate: { type: String, required: true },     // Date string (YYYY-MM-DD)
  adjDate: { type: String, required: true },     // Date string (YYYY-MM-DD)
  respondByDate: { type: String, required: true },// Date string (YYYY-MM-DD)
  mStatus: { type: String, required: true, default: 'Chargeback Raise' }, // Chargeback Raise, Pre-Arbitration Raise, Arbitration Raise, VROL Inquiry, VROL Chargeback, VROL Pre-Arbitration, VROL Arbitration
  mSubStatus: { type: String, required: true, default: 'Chargeback New' }, // Chargeback New, Chargeback In Progress, Chargeback Resubmit, Chargeback Won, Chargeback Lost, Refund Success, Refund On Hold
  resolution: { type: String, enum: ['Won', 'Lost', 'Pending'], default: 'Pending' },
  partnerId: { type: String, default: null },
  adjType: { type: String, required: true },
  remitter: { type: String, default: 'AXB' },
  beneficiary: { type: String, default: 'FIP' },
  txnAmt: { type: Number, required: true },
  adjAmt: { type: Number, required: true },
  leinAmt: { type: Number, default: 0 },
  glNo: { type: String, default: '354422' },
  currency: { type: String, default: 'Rupees' },
  reasonCode: { type: String, default: '1' },
  pan: { type: String, default: '' },
  walletStatus: { type: String, default: 'Debited' },
  product: { type: String, default: 'VISA' },
  aging: { type: Number, default: 0 },
  merchantAction: { type: String, default: null },
  acquirerAction: { type: String, default: null },
  issuerAction: { type: String, default: null },
  rejectReason: { type: String, default: '' },
  chargbackId: { type: String, default: '' },
  issuerName: { type: String, default: 'nsdladmin' },
  visaPending: { type: Boolean, default: false },
  acceptedAmount: { type: Number, default: 0 },
  queuePriority: { type: String, default: 'Standard-Priority Queue' },
  isLocked: { type: Boolean, default: false },
  productCategory: { type: String, default: '' },
  customerDeviceIp: { type: String, default: '' },
  deviceFingerprint: { type: String, default: '' },
  fulfillmentStatus: { type: String, default: '' },
  customerName: { type: String, default: '' },
  productDescription: { type: String, default: '' },
  visaTxId: { type: String, default: '' },
  arn: { type: String, default: '' },
  networkDayLimit: { type: String, default: '' },
  networkSubmissionDate: { type: String, default: '' },
  isCollaboration: { type: Boolean, default: false },
  collaborationPhase: { type: String, default: '' },
  preArbCounterReason: { type: String, default: '' },
  documents: [documentEntrySchema],
  timeline: [timelineEntrySchema]
}, { timestamps: true });

module.exports = mongoose.model('Chargeback', chargebackSchema);
