const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Chargeback = require('../models/Chargeback');

// Fetch all users
router.get('/', async (req, res) => {
  try {
    if (global.MOCK_MODE) {
      return res.json(require('../mockStore').getUsers());
    }
    const users = await User.find({});
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ── Helper: build all chargeback seed records ─────────────────────────────────
const buildSeedData = (TODAY) => {
  const fmtDate = d => d.toISOString().split('T')[0];
  const dA = n => { let d = new Date(TODAY); d.setDate(d.getDate() - n); return fmtDate(d); };
  const dL = n => fmtDate(new Date(TODAY.getTime() + n * 86400000));

  return [
    // CB_PEND_1 — Document Pending for Verification
    {
      id: 'CB_PEND_1', caseId: 'CASE000991', userName: 'masteruser', userId: '2575789089',
      rrn: '7788991122', txnId: '500001', terminalId: '5692005',
      beneMobile: '9100005005', remMobile: '9200005005',
      createdDate: dA(2), txnDate: dA(3), adjDate: dA(2), respondByDate: dL(8),
      mStatus: 'Chargeback Raise', mSubStatus: 'Chargeback In Progress',
      adjType: 'Chargeback Raise', remitter: 'AXIS', beneficiary: 'FIP',
      txnAmt: 8500, adjAmt: 8500, glNo: '354458',
      currency: 'Rupees', reasonCode: '10.4', pan: '416600*****',
      product: 'VISA', aging: 2,
      merchantAction: 'evidence', acquirerAction: null, visaPending: false,
      documents: [
        { id: 'doc_pend1_1', filename: 'DeliveryReceipt.pdf', uploadedAt: dA(1) + 'T10:00:00Z', status: 'Pending Review' },
        { id: 'doc_pend1_2', filename: 'StatementOfService.pdf', uploadedAt: dA(1) + 'T10:00:00Z', status: 'Pending Review' },
        { id: 'doc_pend1_3', filename: 'RefundInvoice.pdf', uploadedAt: dA(1) + 'T10:00:00Z', status: 'Pending Review' }
      ],
      timeline: [
        { by: 'iServeU', time: dA(2) + ' 10:00 AM', title: 'Chargeback Received', remarks: 'New dispute received.', file: null },
        { by: 'masteruser', time: dA(1) + ' 02:00 PM', title: 'Evidence Submitted', remarks: 'Attached delivery confirmation.', file: 'DeliveryReceipt.pdf' }
      ]
    },
    // CB_PEND_2 — Document Pending for Verification
    {
      id: 'CB_PEND_2', caseId: 'CASE000992', userName: 'Test@isu', userId: '9876543210',
      rrn: '8899002233', txnId: '500002', terminalId: '5692006',
      beneMobile: '9100006006', remMobile: '9200006006',
      createdDate: dA(3), txnDate: dA(4), adjDate: dA(3), respondByDate: dL(7),
      mStatus: 'Chargeback Raise', mSubStatus: 'Chargeback In Progress',
      adjType: 'Chargeback Raise', remitter: 'HDFC', beneficiary: 'FIP',
      txnAmt: 12000, adjAmt: 12000, glNo: '354459',
      currency: 'Rupees', reasonCode: '13.1', pan: '512500*****',
      product: 'VISA', aging: 3,
      merchantAction: 'evidence', acquirerAction: null, visaPending: false,
      documents: [
        { id: 'doc_pend2', filename: 'ServiceInvoice.pdf', uploadedAt: dA(2) + 'T14:00:00Z', status: 'Pending Review' },
        { id: 'doc_pend3', filename: 'CustomerComms.pdf', uploadedAt: dA(2) + 'T14:00:00Z', status: 'Pending Review' }
      ],
      timeline: [
        { by: 'iServeU', time: dA(3) + ' 09:30 AM', title: 'Chargeback Received', remarks: 'Services not provided claim.', file: null },
        { by: 'Test@isu', time: dA(2) + ' 11:15 AM', title: 'Evidence Submitted', remarks: 'Attached invoice and emails.', file: 'ServiceInvoice.pdf' }
      ]
    },
    // CB001 — VISA · New · Awaiting merchant action
    {
      id: 'CB001', caseId: 'CASE000001', userName: 'masteruser', userId: '2575789089',
      rrn: '6093156553', txnId: '8768987', terminalId: '5683583',
      beneMobile: '9348909106', remMobile: '7845695654',
      createdDate: dA(1), txnDate: dA(5), adjDate: dA(1), respondByDate: dL(8),
      mStatus: 'Chargeback Raise', mSubStatus: 'Chargeback New',
      adjType: 'Chargeback Raise', remitter: 'AXB', beneficiary: 'FIP',
      txnAmt: 1000, adjAmt: 1000, glNo: '354422',
      currency: 'Rupees', reasonCode: '4808', pan: '832927*****',
      product: 'VISA', aging: 1,
      merchantAction: null, acquirerAction: null, visaPending: false,
      timeline: [
        { by: 'iServeU', time: dA(1) + ' 10:30 AM', title: 'Dispute Raised by iServeU', remarks: 'Chargeback initiated for VISA txn', file: null },
        { by: 'iServeU', time: dA(1) + ' 05:30 PM', title: 'Lien Amount Applied', remarks: 'Hold placed on merchant wallet pending resolution', file: 'LienNotice.pdf' }
      ]
    },
    // CB002 — VISA · New · Awaiting merchant action
    {
      id: 'CB002', caseId: 'CASE000002', userName: 'masteruser', userId: '2575789089',
      rrn: '6093152984', txnId: '8768988', terminalId: '5688584',
      beneMobile: '9348909107', remMobile: '7845695653',
      createdDate: dA(2), txnDate: dA(6), adjDate: dA(2), respondByDate: dL(7),
      mStatus: 'Chargeback Raise', mSubStatus: 'Chargeback New',
      adjType: 'Chargeback Raise', remitter: 'AXB', beneficiary: 'FIP',
      txnAmt: 3000, adjAmt: 3000, glNo: '354422',
      currency: 'Rupees', reasonCode: '4808', pan: '832927*****',
      product: 'VISA', aging: 2,
      merchantAction: null, acquirerAction: null, visaPending: false,
      timeline: [
        { by: 'iServeU', time: dA(2) + ' 09:00 AM', title: 'Dispute Raised by iServeU', remarks: 'Customer reported unauthorized debit of Rs.3000', file: null }
      ]
    },
    // CB003 — VISA · Chargeback Lost · Declined by admin
    {
      id: 'CB003', caseId: 'CASE000003', userName: 'masteruser', userId: '2575789089',
      rrn: '6093152911', txnId: '8768989', terminalId: '5678585',
      beneMobile: '9398909108', remMobile: '7845665652',
      createdDate: dA(10), txnDate: dA(15), adjDate: dA(10), respondByDate: dA(2),
      mStatus: 'Chargeback Raise', mSubStatus: 'Chargeback Won',
      adjType: 'Chargeback Raise', remitter: 'AXB', beneficiary: 'FIP',
      txnAmt: 1500, adjAmt: 1500, glNo: '354422',
      currency: 'Rupees', reasonCode: '4808', pan: '397927*****',
      product: 'VISA', aging: 10,
      merchantAction: 'rejected', acquirerAction: 'declined', visaPending: false,
      chargbackId: 'CommonVISA17268', issuerName: 'Krishna Das',
      rejectReason: 'Transaction log confirms delivery of service to registered customer mobile. Dispute ruled in acquirer favour by NPCI.',
      timeline: [
        { by: 'iServeU', time: dA(10) + ' 08:00 AM', title: 'Dispute Raised', remarks: 'Customer claims unauthorized VISA debit', file: null },
        { by: 'masteruser', time: dA(8) + ' 10:00 AM', title: 'Evidence Submitted by masteruser', remarks: 'Delivery proof and transaction log attached', file: 'EvidenceFile.pdf' },
        { by: 'Krishna Das', time: dA(5) + ' 03:00 PM', title: 'Admin Reviewed — Declined', remarks: 'Evidence insufficient. Case ruled in favour of customer.', file: 'AdminDecision.pdf' }
      ]
    },
    // CB004 — VISA · Pre-Arbitration · New
    {
      id: 'CB004', caseId: 'CASE000004', userName: 'masteruser', userId: '2575789089',
      rrn: '6093152992', txnId: '8768990', terminalId: '5688585',
      beneMobile: '9348909108', remMobile: '7845695652',
      createdDate: dA(4), txnDate: dA(8), adjDate: dA(4), respondByDate: dL(3),
      mStatus: 'Pre-Arbitration Raise', mSubStatus: 'Chargeback New',
      adjType: 'Pre-Arbitration Raise', remitter: 'HDFC', beneficiary: 'FIP',
      txnAmt: 2500, adjAmt: 2500, glNo: '354423',
      currency: 'Rupees', reasonCode: '4853', pan: '456712*****',
      product: 'VISA', aging: 4,
      merchantAction: null, acquirerAction: null, visaPending: false,
      timeline: [
        { by: 'iServeU', time: dA(4) + ' 08:30 AM', title: 'Pre-Arbitration Raised', remarks: 'Escalated to Pre-Arb stage after initial chargeback rejection', file: null }
      ]
    },
    // CB005 — VISA · In Progress · Evidence submitted → Visa pending
    {
      id: 'CB005', caseId: 'CASE000005', userName: 'masteruser', userId: '2575789089',
      rrn: '6093152993', txnId: '8768991', terminalId: '5683583',
      beneMobile: '9348909106', remMobile: '7845695654',
      createdDate: dA(5), txnDate: dA(9), adjDate: dA(5), respondByDate: dL(2),
      mStatus: 'Chargeback Raise', mSubStatus: 'Chargeback In Progress',
      adjType: 'Chargeback Raise', remitter: 'ICICI', beneficiary: 'FIP',
      txnAmt: 500, adjAmt: 500, glNo: '354422',
      currency: 'Rupees', reasonCode: '1', pan: '832927*****',
      product: 'VISA', aging: 5,
      merchantAction: 'evidence', acquirerAction: null, visaPending: true,
      documents: [
        { id: 'doc_cb005_1', filename: 'EvidenceSubmitted.pdf', uploadedAt: dA(3) + 'T11:45:00Z', status: 'Pending Review' }
      ],
      timeline: [
        { by: 'iServeU', time: dA(5) + ' 09:00 AM', title: 'Dispute Raised', remarks: 'Customer dispute: service not received', file: null },
        { by: 'masteruser', time: dA(3) + ' 11:45 AM', title: 'Evidence Submitted by masteruser (Partner Representation)', remarks: 'Delivery proof submitted — Evidence forwarded to Acquirer on behalf of Partner for Visa consideration.', file: 'EvidenceSubmitted.pdf' }
      ]
    },
    // CB006 — Mastercard · Arbitration · New
    {
      id: 'CB006', caseId: 'CASE000006', userName: 'masteruser', userId: '2575789089',
      rrn: '6093152994', txnId: '8768992', terminalId: '5688584',
      beneMobile: '9348909107', remMobile: '7845695653',
      createdDate: dA(6), txnDate: dA(10), adjDate: dA(6), respondByDate: dL(4),
      mStatus: 'Arbitration Raise', mSubStatus: 'Chargeback In Progress',
      adjType: 'Arbitration Raise', remitter: 'AXIS', beneficiary: 'FIP',
      txnAmt: 3000, adjAmt: 3000, glNo: '354424',
      currency: 'Rupees', reasonCode: '4808', pan: '545454*****',
      product: 'VISA', aging: 6,
      merchantAction: null, acquirerAction: null, visaPending: false,
      timeline: [
        { by: 'iServeU', time: dA(6) + ' 08:00 AM', title: 'Arbitration Raised', remarks: 'Escalated to Mastercard Arbitration panel after Pre-Arb failure', file: null },
        { by: 'iServeU', time: dA(4) + ' 02:00 PM', title: 'Awaiting Mastercard Ruling', remarks: 'Pending card scheme arbitration decision', file: null }
      ]
    },
    // CB007 — VISA · Refund Success · Won
    {
      id: 'CB007', caseId: 'CASE000007', userName: 'masteruser', userId: '2575789089',
      rrn: '7045218834', txnId: '9912345', terminalId: '5690001',
      beneMobile: '9876543210', remMobile: '9123456789',
      createdDate: dA(20), txnDate: dA(25), adjDate: dA(20), respondByDate: dA(10),
      mStatus: 'Chargeback Raise', mSubStatus: 'Chargeback Won',
      adjType: 'Chargeback Raise', remitter: 'SBI', beneficiary: 'FIP',
      txnAmt: 8500, adjAmt: 8500, glNo: '354425',
      currency: 'Rupees', reasonCode: '4853', pan: '411234*****',
      product: 'VISA', aging: 20,
      merchantAction: 'rejected', acquirerAction: 'considered', visaPending: false,
      timeline: [
        { by: 'iServeU', time: dA(20) + ' 10:00 AM', title: 'Dispute Raised', remarks: 'Customer claims item not received', file: null },
        { by: 'masteruser', time: dA(18) + ' 02:00 PM', title: 'Evidence Submitted', remarks: 'Delivery confirmation with courier tracking attached', file: 'DeliveryProof.pdf' },
        { by: 'Krishna Das', time: dA(15) + ' 04:00 PM', title: 'Admin Considered — Represented to VISA', remarks: 'Merchant evidence validated. Case represented to VISA network.', file: null },
        { by: 'iServeU', time: dA(10) + ' 09:00 AM', title: 'VISA Ruled — Dispute Won', remarks: 'Dispute Won. Refund issued to merchant wallet.', file: 'VisaRuling.pdf' }
      ]
    },
    // CB008 — Rupay · Chargeback Won · Visa pending
    {
      id: 'CB008', caseId: 'CASE000008', userName: 'masteruser', userId: '2575789089',
      rrn: '7045218899', txnId: '9912346', terminalId: '5690002',
      beneMobile: '9876500001', remMobile: '9000000001',
      createdDate: dA(15), txnDate: dA(20), adjDate: dA(15), respondByDate: dA(5),
      mStatus: 'Chargeback Raise', mSubStatus: 'Chargeback Won',
      adjType: 'Chargeback Raise', remitter: 'BOI', beneficiary: 'FIP',
      txnAmt: 4200, adjAmt: 4200, glNo: '354426',
      currency: 'Rupees', reasonCode: '4808', pan: '607080*****',
      product: 'VISA', aging: 15,
      merchantAction: 'rejected', acquirerAction: 'considered', visaPending: true,
      timeline: [
        { by: 'iServeU', time: dA(15) + ' 08:00 AM', title: 'Dispute Raised', remarks: 'Rupay chargeback: duplicate transaction claim', file: null },
        { by: 'masteruser', time: dA(13) + ' 11:00 AM', title: 'Evidence Submitted (Partner Representation)', remarks: 'Bank statement shows single debit. Forwarded to Acquirer on behalf of Partner for Visa.', file: 'BankStatement.pdf' },
        { by: 'Krishna Das', time: dA(10) + ' 03:00 PM', title: 'Admin Considered — Escalated to NPCI', remarks: 'Strong evidence. Represented to Rupay NPCI grid.', file: null },
        { by: 'iServeU', time: dA(6) + ' 10:00 AM', title: 'NPCI Ruled — Dispute Won', remarks: 'Chargeback Won. Merchant vindicated.', file: null }
      ]
    },
    // CB009 — Mastercard · Fraud · In Progress · Visa pending
    {
      id: 'CB009', caseId: 'CASE000009', userName: 'masteruser', userId: '2575789089',
      rrn: '8812349901', txnId: '1100045', terminalId: '5690003',
      beneMobile: '9700001234', remMobile: '9800001234',
      createdDate: dA(3), txnDate: dA(7), adjDate: dA(3), respondByDate: dL(5),
      mStatus: 'Chargeback Raise', mSubStatus: 'Chargeback In Progress',
      adjType: 'Fraud Chargeback Raise', remitter: 'PNB', beneficiary: 'FIP',
      txnAmt: 12000, adjAmt: 12000, glNo: '354427',
      currency: 'Rupees', reasonCode: '4863', pan: '522222*****',
      product: 'VISA', aging: 3,
      merchantAction: 'evidence', acquirerAction: null, visaPending: true,
      timeline: [
        { by: 'iServeU', time: dA(3) + ' 07:00 AM', title: 'Fraud Chargeback Raised', remarks: 'High-value card fraud. Lien placed on Rs.12,000', file: null },
        { by: 'masteruser', time: dA(2) + ' 01:00 PM', title: 'Evidence Submitted (Partner Representation)', remarks: 'OTP log and 3DS auth proof attached. Forwarded to Mastercard via Acquirer.', file: 'FraudEvidence.pdf' }
      ]
    },
    // CB010 — VISA · Deferred · Resubmit
    {
      id: 'CB010', caseId: 'CASE000010', userName: 'masteruser', userId: '2575789089',
      rrn: '5512348800', txnId: '7700011', terminalId: '5690004',
      beneMobile: '9600001111', remMobile: '9100001111',
      createdDate: dA(7), txnDate: dA(12), adjDate: dA(7), respondByDate: dL(0),
      mStatus: 'Chargeback Raise', mSubStatus: 'Chargeback In Progress',
      adjType: 'Differed Chargeback Raise', remitter: 'KOTAK', beneficiary: 'FIP',
      txnAmt: 750, adjAmt: 750, glNo: '354422',
      currency: 'Rupees', reasonCode: '4808', pan: '832900*****',
      product: 'VISA', aging: 7,
      merchantAction: null, acquirerAction: null, visaPending: false,
      timeline: [
        { by: 'iServeU', time: dA(7) + ' 09:30 AM', title: 'Deferred Chargeback Raised', remarks: 'Initial CB returned by NPCI — resubmitting', file: null },
        { by: 'iServeU', time: dA(5) + ' 02:00 PM', title: 'Resubmit Initiated', remarks: 'Case resubmitted to NPCI grid with corrected ARN', file: 'Resubmit_CB010.pdf' }
      ]
    },
    // CB011 — VISA · New (today)
    {
      id: 'CB011', caseId: 'CASE000011', userName: 'masteruser', userId: '2575789089',
      rrn: '9911223344', txnId: '5500022', terminalId: '5690005',
      beneMobile: '9500002222', remMobile: '9200002222',
      createdDate: dA(1), txnDate: dA(4), adjDate: dA(1), respondByDate: dL(9),
      mStatus: 'Chargeback Raise', mSubStatus: 'Chargeback New',
      adjType: 'Chargeback Raise', remitter: 'YES BANK', beneficiary: 'FIP',
      txnAmt: 5600, adjAmt: 5600, glNo: '354428',
      currency: 'Rupees', reasonCode: '4853', pan: '411111*****',
      product: 'VISA', aging: 1,
      merchantAction: null, acquirerAction: null, visaPending: false,
      timeline: [
        { by: 'iServeU', time: dA(1) + ' 11:00 AM', title: 'VISA Chargeback Raised', remarks: 'Customer claims hotel booking cancelled but charged', file: null }
      ]
    },
    // CB012 — Rupay · New
    {
      id: 'CB012', caseId: 'CASE000012', userName: 'masteruser', userId: '2575789089',
      rrn: '3312349900', txnId: '4400033', terminalId: '5690006',
      beneMobile: '9400003333', remMobile: '9300003333',
      createdDate: dA(2), txnDate: dA(5), adjDate: dA(2), respondByDate: dL(6),
      mStatus: 'Chargeback Raise', mSubStatus: 'Chargeback New',
      adjType: 'Chargeback Raise', remitter: 'CANARA', beneficiary: 'FIP',
      txnAmt: 1800, adjAmt: 1800, glNo: '354429',
      currency: 'Rupees', reasonCode: '4808', pan: '607001*****',
      product: 'VISA', aging: 2,
      merchantAction: null, acquirerAction: null, visaPending: false,
      timeline: [
        { by: 'iServeU', time: dA(2) + ' 10:00 AM', title: 'Rupay Chargeback Raised', remarks: 'Customer: EMI deducted but subscription not activated', file: null }
      ]
    },
    // CB013 — VISA · Pre-Arb · Refund On Hold · Visa pending
    {
      id: 'CB013', caseId: 'CASE000013', userName: 'masteruser', userId: '2575789089',
      rrn: '1100099988', txnId: '6600044', terminalId: '5690007',
      beneMobile: '9111110000', remMobile: '9222220000',
      createdDate: dA(18), txnDate: dA(22), adjDate: dA(18), respondByDate: dA(8),
      mStatus: 'Pre-Arbitration Raise', mSubStatus: 'Chargeback New',
      adjType: 'Pre-Arbitration Raise', remitter: 'IDFC', beneficiary: 'FIP',
      txnAmt: 9900, adjAmt: 9900, glNo: '354430',
      currency: 'Rupees', reasonCode: '4853', pan: '400001*****',
      product: 'VISA', aging: 18,
      merchantAction: 'rejected', acquirerAction: 'considered', visaPending: true,
      timeline: [
        { by: 'iServeU', time: dA(18) + ' 09:00 AM', title: 'Pre-Arbitration Raised', remarks: 'Escalated after failed chargeback representation', file: null },
        { by: 'masteruser', time: dA(16) + ' 12:00 PM', title: 'Evidence Submitted (Partner Representation)', remarks: 'Full transaction log + 3DS auth. Submitted to VISA acquirer.', file: 'EvidencePackage.pdf' },
        { by: 'Krishna Das', time: dA(12) + ' 04:00 PM', title: 'Admin Considered — Sent to VISA', remarks: 'Case represented. Refund on hold pending VISA ruling.', file: null }
      ]
    },
    // CB014 — Mastercard · Lost
    {
      id: 'CB014', caseId: 'CASE000014', userName: 'masteruser', userId: '2575789089',
      rrn: '2200011122', txnId: '3300055', terminalId: '5690008',
      beneMobile: '9000005555', remMobile: '9900005555',
      createdDate: dA(25), txnDate: dA(30), adjDate: dA(25), respondByDate: dA(15),
      mStatus: 'Chargeback Raise', mSubStatus: 'Chargeback Won',
      adjType: 'Chargeback Raise', remitter: 'BOB', beneficiary: 'FIP',
      txnAmt: 6700, adjAmt: 6700, glNo: '354431',
      currency: 'Rupees', reasonCode: '4808', pan: '545454*****',
      product: 'VISA', aging: 25,
      merchantAction: 'rejected', acquirerAction: 'declined', visaPending: false,
      rejectReason: 'Mastercard dispute resolution team ruled in favour of cardholder. Service log did not match claimed delivery date.',
      timeline: [
        { by: 'iServeU', time: dA(25) + ' 08:30 AM', title: 'Mastercard Chargeback Raised', remarks: 'Card not present transaction disputed', file: null },
        { by: 'masteruser', time: dA(23) + ' 03:00 PM', title: 'Evidence Submitted', remarks: 'POS receipt and camera footage link shared', file: 'POSReceipt.pdf' },
        { by: 'Krishna Das', time: dA(20) + ' 02:00 PM', title: 'Admin Reviewed — Declined', remarks: 'Mastercard ruling against merchant. Case closed as Lost.', file: null }
      ]
    },
    // CB015 — VISA · Auto-accepted (TAT expired) · Visa pending
    {
      id: 'CB015', caseId: 'CASE000015', userName: 'masteruser', userId: '2575789089',
      rrn: '4400022233', txnId: '2200066', terminalId: '5690009',
      beneMobile: '9800006666', remMobile: '9700006666',
      createdDate: dA(6), txnDate: dA(10), adjDate: dA(6), respondByDate: dL(1),
      mStatus: 'Chargeback Raise', mSubStatus: 'Chargeback Won',
      adjType: 'Chargeback Raise', remitter: 'UNION', beneficiary: 'FIP',
      txnAmt: 2200, adjAmt: 2200, glNo: '354422',
      currency: 'Rupees', reasonCode: '4808', pan: '832927*****',
      product: 'VISA', aging: 6,
      merchantAction: 'rejected', acquirerAction: 'auto-accepted', visaPending: true,
      timeline: [
        { by: 'iServeU', time: dA(6) + ' 08:00 AM', title: 'Dispute Raised', remarks: 'Customer disputes VISA double debit', file: null },
        { by: 'masteruser', time: dA(4) + ' 10:00 AM', title: 'Evidence Submitted', remarks: 'Merchant rejected the claim with supporting docs', file: 'Evidence_CB015.pdf' },
        { by: 'system-auto', time: dA(0) + ' 12:00 AM', title: 'TAT Expired — Auto-Accepted & Pushed to Visa', remarks: 'TAT of 6 days exceeded. System auto-accepted and escalated to Visa for review.', file: null }
      ]
    },
    // CB016 — VISA · Fraud · New (high value)
    {
      id: 'CB016', caseId: 'CASE000016', userName: 'masteruser', userId: '2575789089',
      rrn: '5500033344', txnId: '1100077', terminalId: '5690010',
      beneMobile: '9600007777', remMobile: '9500007777',
      createdDate: dA(0), txnDate: dA(2), adjDate: dA(0), respondByDate: dL(10),
      mStatus: 'Chargeback Raise', mSubStatus: 'Chargeback New',
      adjType: 'Fraud Chargeback Raise', remitter: 'KARUR', beneficiary: 'FIP',
      txnAmt: 15000, adjAmt: 15000, glNo: '354432',
      currency: 'Rupees', reasonCode: '4863', pan: '400222*****',
      product: 'VISA', aging: 0,
      merchantAction: null, acquirerAction: null, visaPending: false,
      timeline: [
        { by: 'iServeU', time: dA(0) + ' 06:00 AM', title: 'Fraud Chargeback Raised — HIGH VALUE', remarks: 'High-value card fraud alert. Immediate lien placed on Rs.15,000.', file: null }
      ]
    },
    // CB017 — VISA · Chargeback Won
    {
      id: 'CB017', caseId: 'CASE000017', userName: 'masteruser', userId: '2575789089',
      rrn: '7700044455', txnId: '9900088', terminalId: '5690011',
      beneMobile: '9400008888', remMobile: '9300008888',
      createdDate: dA(12), txnDate: dA(16), adjDate: dA(12), respondByDate: dA(4),
      mStatus: 'Chargeback Raise', mSubStatus: 'Chargeback Won',
      adjType: 'Chargeback Raise', remitter: 'IOB', beneficiary: 'FIP',
      txnAmt: 3300, adjAmt: 3300, glNo: '354422',
      currency: 'Rupees', reasonCode: '4808', pan: '832927*****',
      product: 'VISA', aging: 12,
      merchantAction: 'rejected', acquirerAction: 'considered', visaPending: false,
      timeline: [
        { by: 'iServeU', time: dA(12) + ' 09:00 AM', title: 'Dispute Raised', remarks: 'Customer disputes Rs.3300 VISA debit', file: null },
        { by: 'masteruser', time: dA(10) + ' 02:00 PM', title: 'Evidence Submitted', remarks: 'Delivery receipt and GPS proof shared', file: 'GPSProof.pdf' },
        { by: 'Krishna Das', time: dA(7) + ' 11:00 AM', title: 'Admin Considered — Sent to NPCI', remarks: 'Evidence strong. Case represented.', file: null },
        { by: 'iServeU', time: dA(4) + ' 09:00 AM', title: 'NPCI Ruled — Dispute Won', remarks: 'Chargeback Won. Merchant wallet credited.', file: null }
      ]
    },
    // CB018 — Rupay · Accepted by merchant
    {
      id: 'CB018', caseId: 'CASE000018', userName: 'masteruser', userId: '2575789089',
      rrn: '8800055566', txnId: '8800099', terminalId: '5690012',
      beneMobile: '9200009999', remMobile: '9100009999',
      createdDate: dA(3), txnDate: dA(6), adjDate: dA(3), respondByDate: dL(4),
      mStatus: 'Chargeback Raise', mSubStatus: 'Chargeback In Progress',
      adjType: 'Chargeback Raise', remitter: 'SYNDICATE', beneficiary: 'FIP',
      txnAmt: 900, adjAmt: 900, glNo: '354433',
      currency: 'Rupees', reasonCode: '4808', pan: '607001*****',
      product: 'VISA', aging: 3,
      merchantAction: 'accepted', acquirerAction: null, visaPending: false,
      timeline: [
        { by: 'iServeU', time: dA(3) + ' 10:30 AM', title: 'Rupay Chargeback Raised', remarks: 'Customer reports recharge failed but amount debited', file: null },
        { by: 'masteruser', time: dA(2) + ' 02:30 PM', title: 'Merchant Accepted Dispute', remarks: 'Merchant accepted — refund process initiated', file: null }
      ]
    },
    // CB019 — Mastercard · Pending admin review (evidence submitted)
    {
      id: 'CB019', caseId: 'CASE000019', userName: 'masteruser', userId: '2575789089',
      rrn: '9900066677', txnId: '7700000', terminalId: '5690013',
      beneMobile: '9000010101', remMobile: '9000020202',
      createdDate: dA(4), txnDate: dA(8), adjDate: dA(4), respondByDate: dL(2),
      mStatus: 'Chargeback Raise', mSubStatus: 'Chargeback In Progress',
      adjType: 'Chargeback Raise', remitter: 'BANDHAN', beneficiary: 'FIP',
      txnAmt: 7200, adjAmt: 7200, glNo: '354434',
      currency: 'Rupees', reasonCode: '4853', pan: '512345*****',
      product: 'VISA', aging: 4,
      merchantAction: 'rejected', acquirerAction: null, visaPending: false,
      documents: [
        { id: 'doc_cb019_1', filename: 'CourierReceipt.pdf', uploadedAt: dA(3) + 'T15:00:00Z', status: 'Pending Review' },
        { id: 'doc_cb019_2', filename: 'Merchant_Evidence.pdf', uploadedAt: dA(3) + 'T15:02:00Z', status: 'Pending Review' }
      ],
      rejectReason: 'Service was fully rendered. Customer received goods at doorstep on 15/05/2026. Attached courier tracking reference.',
      timeline: [
        { by: 'iServeU', time: dA(4) + ' 08:00 AM', title: 'Mastercard Chargeback Raised', remarks: 'Customer claims goods not received', file: null },
        { by: 'masteruser', time: dA(3) + ' 03:00 PM', title: 'Evidence Submitted', remarks: 'Delivery confirmed. Awaiting admin review.', file: 'CourierReceipt.pdf' }
      ]
    },
    // CB020 — VISA · New · Fresh today
    {
      id: 'CB020', caseId: 'CASE000020', userName: 'masteruser', userId: '2575789089',
      rrn: '1234567890', txnId: '5678900', terminalId: '5690014',
      beneMobile: '9876543211', remMobile: '9123456700',
      createdDate: dA(0), txnDate: dA(1), adjDate: dA(0), respondByDate: dL(10),
      mStatus: 'Chargeback Raise', mSubStatus: 'Chargeback New',
      adjType: 'Chargeback Raise', remitter: 'FEDERAL', beneficiary: 'FIP',
      txnAmt: 4500, adjAmt: 4500, glNo: '354435',
      currency: 'Rupees', reasonCode: '4808', pan: '416001*****',
      product: 'VISA', aging: 0,
      merchantAction: null, acquirerAction: null, visaPending: false,
      timeline: [
        { by: 'iServeU', time: dA(0) + ' 08:30 AM', title: 'VISA Chargeback Raised — Fresh', remarks: 'New chargeback received from VISA acquirer network', file: null }
      ]
    }    ,{
      id: 'CB_VROL_01', caseId: 'CASE_VROL_01', userName: 'masteruser', userId: '2575789089',
      rrn: '1231231231', txnId: '9898989', terminalId: '5690015',
      beneMobile: '9999999999', remMobile: '8888888888',
      createdDate: dA(2), txnDate: dA(5), adjDate: dA(2), respondByDate: dL(5),
      mStatus: 'Chargeback Raise', mSubStatus: 'Chargeback New',
      adjType: 'Chargeback Raise', remitter: 'HDFC', beneficiary: 'FIP',
      txnAmt: 5000, adjAmt: 5000, glNo: '354435',
      currency: 'Rupees', reasonCode: '10.4', pan: '416001*****',
      product: 'VISA', aging: 2,
      merchantAction: null, acquirerAction: null, visaPending: true,
      timeline: [
        { by: 'iServeU', time: dA(2) + ' 10:00 AM', title: 'Chargeback Raise Initiated', remarks: 'Visa raised inquiry for potential fraud.', file: null }
      ]
    },
    {
      id: 'CB_VROL_02', caseId: 'CASE_VROL_02', userName: 'masteruser', userId: '2575789089',
      rrn: '1231231232', txnId: '9898990', terminalId: '5690016',
      beneMobile: '9999999998', remMobile: '8888888887',
      createdDate: dA(5), txnDate: dA(10), adjDate: dA(5), respondByDate: dA(1),
      mStatus: 'Chargeback Raise', mSubStatus: 'Chargeback In Progress',
      adjType: 'Chargeback Raise', remitter: 'SBI', beneficiary: 'FIP',
      txnAmt: 3500, adjAmt: 3500, glNo: '354436',
      currency: 'Rupees', reasonCode: '13.1', pan: '426001*****',
      product: 'VISA', aging: 5,
      merchantAction: 'evidence', acquirerAction: null, visaPending: true,
      timeline: [
        { by: 'iServeU', time: dA(5) + ' 11:00 AM', title: 'VROL Chargeback Received', remarks: 'First chargeback initiated by issuer.', file: null }
      ]
    },
    {
      id: 'CB_VROL_03', caseId: 'CASE_VROL_03', userName: 'masteruser', userId: '2575789089',
      rrn: '1231231233', txnId: '9898991', terminalId: '5690017',
      beneMobile: '9999999997', remMobile: '8888888886',
      createdDate: dA(15), txnDate: dA(20), adjDate: dA(15), respondByDate: dA(2),
      mStatus: 'Pre-Arbitration Raise', mSubStatus: 'Chargeback New',
      adjType: 'Pre-Arbitration Raise', remitter: 'AXIS', beneficiary: 'FIP',
      txnAmt: 7500, adjAmt: 7500, glNo: '354437',
      currency: 'Rupees', reasonCode: '10.4', pan: '436001*****',
      product: 'VISA', aging: 15,
      merchantAction: 'evidence', acquirerAction: 'considered', visaPending: true,
      timeline: [
        { by: 'iServeU', time: dA(15) + ' 12:00 PM', title: 'VROL Pre-Arbitration Raised', remarks: 'Issuer declined evidence, pushed to pre-arb.', file: null }
      ]
    },
    {
      id: 'CB_VROL_04', caseId: 'CASE_VROL_04', userName: 'masteruser', userId: '2575789089',
      rrn: '1231231234', txnId: '9898992', terminalId: '5690018',
      beneMobile: '9999999996', remMobile: '8888888885',
      createdDate: dA(30), txnDate: dA(40), adjDate: dA(30), respondByDate: dA(5),
      mStatus: 'Arbitration Raise', mSubStatus: 'Chargeback In Progress',
      adjType: 'Arbitration Raise', remitter: 'ICICI', beneficiary: 'FIP',
      txnAmt: 10000, adjAmt: 10000, glNo: '354438',
      currency: 'Rupees', reasonCode: '10.5', pan: '446001*****',
      product: 'VISA', aging: 30,
      merchantAction: 'evidence', acquirerAction: 'declined', visaPending: false,
      timeline: [
        { by: 'iServeU', time: dA(30) + ' 01:00 PM', title: 'VROL Arbitration Lost', remarks: 'Visa Arbitration panel ruled in favor of cardholder.', file: null }
      ]
    },
    // CB024 — New Demo Data 1
    {
      id: 'CB024', caseId: 'CASE000024', userName: 'Test@isu', userId: '11111111',
      rrn: '1234567890', txnId: '100001', terminalId: '5690020',
      beneMobile: '9000000002', remMobile: '9000000003',
      createdDate: dA(2), txnDate: dA(4), adjDate: dA(2), respondByDate: dL(6),
      mStatus: 'Chargeback Raise', mSubStatus: 'Chargeback New',
      adjType: 'Chargeback Raise', remitter: 'HDFC', beneficiary: 'FIP',
      txnAmt: 2000, adjAmt: 2000, glNo: '354440',
      currency: 'Rupees', reasonCode: '4808', pan: '411111*****',
      product: 'VISA', aging: 2,
      merchantAction: null, acquirerAction: null, visaPending: false,
      timeline: [
        { by: 'iServeU', time: dA(2) + ' 10:00 AM', title: 'Chargeback Raised', remarks: 'Customer disputes txn', file: null }
      ]
    },
    // CB025 — New Demo Data 2 (Pre-Arb)
    {
      id: 'CB025', caseId: 'CASE000025', userName: 'Test@isu', userId: '11111111',
      rrn: '1234567891', txnId: '100002', terminalId: '5690021',
      beneMobile: '9000000004', remMobile: '9000000005',
      createdDate: dA(10), txnDate: dA(12), adjDate: dA(10), respondByDate: dA(1),
      mStatus: 'Pre-Arbitration Raise', mSubStatus: 'Chargeback New',
      adjType: 'Pre-Arbitration Raise', remitter: 'SBI', beneficiary: 'FIP',
      txnAmt: 5000, adjAmt: 5000, glNo: '354441',
      currency: 'Rupees', reasonCode: '4853', pan: '545454*****',
      product: 'VISA', aging: 10,
      merchantAction: 'evidence', acquirerAction: null, visaPending: true,
      timeline: [
        { by: 'Test@isu', time: dA(5) + ' 12:00 PM', title: 'Evidence Submitted', remarks: 'Provided delivery proof', file: 'Proof.pdf' }
      ]
    },
    // CB026 — New Demo Data 3 (Arbitration)
    {
      id: 'CB026', caseId: 'CASE000026', userName: 'masteruser', userId: '2575789089',
      rrn: '1234567892', txnId: '100003', terminalId: '5690022',
      beneMobile: '9000000006', remMobile: '9000000007',
      createdDate: dA(25), txnDate: dA(30), adjDate: dA(25), respondByDate: dA(5),
      mStatus: 'Arbitration Raise', mSubStatus: 'Chargeback In Progress',
      adjType: 'Arbitration Raise', remitter: 'AXIS', beneficiary: 'FIP',
      txnAmt: 15000, adjAmt: 15000, glNo: '354442',
      currency: 'Rupees', reasonCode: '10.5', pan: '446001*****',
      product: 'VISA', aging: 25,
      merchantAction: 'evidence', acquirerAction: 'considered', visaPending: true,
      timeline: [
        { by: 'Krishna Das', time: dA(20) + ' 03:00 PM', title: 'Admin Considered — Sent to VISA', remarks: 'Case represented to Visa Arbitration.', file: null }
      ]
    },
    // CB027 — New Demo Data 4 (Retrieval)
    {
      id: 'CB027', caseId: 'CASE000027', userName: 'masteruser', userId: '2575789089',
      rrn: '1234567893', txnId: '100004', terminalId: '5690023',
      beneMobile: '9000000008', remMobile: '9000000009',
      createdDate: dA(1), txnDate: dA(3), adjDate: dA(1), respondByDate: dL(10),
      mStatus: 'Chargeback Raise', mSubStatus: 'Chargeback New',
      adjType: 'Retrieval Request', remitter: 'KOTAK', beneficiary: 'FIP',
      txnAmt: 1000, adjAmt: 1000, glNo: '354443',
      currency: 'Rupees', reasonCode: '4808', pan: '400001*****',
      product: 'VISA', aging: 1,
      merchantAction: null, acquirerAction: null, visaPending: false,
      timeline: [
        { by: 'iServeU', time: dA(1) + ' 09:00 AM', title: 'Retrieval Request', remarks: 'Bank requested more info', file: null }
      ]
    },
    // CB028 — New Demo Data 5 (Chargeback Won)
    {
      id: 'CB028', caseId: 'CASE000028', userName: 'Test@isu', userId: '11111111',
      rrn: '1234567894', txnId: '100005', terminalId: '5690024',
      beneMobile: '9000000010', remMobile: '9000000011',
      createdDate: dA(15), txnDate: dA(20), adjDate: dA(15), respondByDate: dA(5),
      mStatus: 'Chargeback Raise', mSubStatus: 'Chargeback Won',
      adjType: 'Chargeback Raise', remitter: 'PNB', beneficiary: 'FIP',
      txnAmt: 3000, adjAmt: 3000, glNo: '354444',
      currency: 'Rupees', reasonCode: '4853', pan: '607001*****',
      product: 'VISA', aging: 15,
      merchantAction: 'evidence', acquirerAction: 'considered', visaPending: false,
      resolution: 'Won',
      timeline: [
        { by: 'iServeU', time: dA(5) + ' 10:00 AM', title: 'NPCI Ruled — Dispute Won', remarks: 'Merchant vindicated.', file: null }
      ]
    },
    // CB029 — VISA · Fraud · Lost
    {
      id: 'CB029', caseId: 'CASE000029', userName: 'masteruser', userId: '2575789089',
      rrn: '5678901234', txnId: '200001', terminalId: '5690025',
      beneMobile: '9800001001', remMobile: '9700001001',
      createdDate: dA(22), txnDate: dA(26), adjDate: dA(22), respondByDate: dA(12),
      mStatus: 'Chargeback Raise', mSubStatus: 'Chargeback Won',
      adjType: 'Fraud Chargeback Raise', remitter: 'HDFC', beneficiary: 'FIP',
      txnAmt: 18500, adjAmt: 18500, glNo: '354445',
      currency: 'Rupees', reasonCode: '4863', pan: '400001*****',
      product: 'VISA', aging: 22,
      merchantAction: 'rejected', acquirerAction: 'declined', visaPending: false,
      rejectReason: 'Customer provided OTP log. Fraud confirmed by Visa fraud detection team.',
      timeline: [
        { by: 'iServeU', time: dA(22) + ' 07:00 AM', title: 'Fraud Chargeback Raised', remarks: 'High-value fraud alert: Rs.18,500 disputed. Lien placed.', file: null },
        { by: 'masteruser', time: dA(20) + ' 11:00 AM', title: 'Evidence Submitted', remarks: 'POS terminal log and CCTV timestamp shared', file: 'FraudEvidence_CB029.pdf' },
        { by: 'Krishna Das', time: dA(15) + ' 03:30 PM', title: 'Admin Reviewed — Declined', remarks: 'Evidence insufficient. Visa fraud team confirmed unauthorized access.', file: 'VisaFraudRuling.pdf' },
        { by: 'iServeU', time: dA(12) + ' 09:00 AM', title: 'Case Closed — Chargeback Lost', remarks: 'Merchant wallet debited Rs.18,500 in favour of cardholder.', file: null }
      ]
    },
    // CB030 — Rupay · Retrieval Request
    {
      id: 'CB030', caseId: 'CASE000030', userName: 'masteruser', userId: '2575789089',
      rrn: '6789012345', txnId: '200002', terminalId: '5690026',
      beneMobile: '9800002002', remMobile: '9700002002',
      createdDate: dA(3), txnDate: dA(6), adjDate: dA(3), respondByDate: dL(8),
      mStatus: 'Chargeback Raise', mSubStatus: 'Chargeback New',
      adjType: 'Retrieval Request', remitter: 'BOI', beneficiary: 'FIP',
      txnAmt: 2300, adjAmt: 2300, glNo: '354446',
      currency: 'Rupees', reasonCode: '4808', pan: '607002*****',
      product: 'VISA', aging: 3,
      merchantAction: null, acquirerAction: null, visaPending: false,
      timeline: [
        { by: 'iServeU', time: dA(3) + ' 10:00 AM', title: 'Rupay Retrieval Request', remarks: 'NPCI has requested transaction records for Rs.2,300. Merchant must respond within 8 days.', file: null }
      ]
    },
    // CB031 — Mastercard · Pre-Arb · Won
    {
      id: 'CB031', caseId: 'CASE000031', userName: 'masteruser', userId: '2575789089',
      rrn: '7890123456', txnId: '200003', terminalId: '5690027',
      beneMobile: '9800003003', remMobile: '9700003003',
      createdDate: dA(30), txnDate: dA(35), adjDate: dA(30), respondByDate: dA(20),
      mStatus: 'Chargeback Raise', mSubStatus: 'Chargeback Won',
      adjType: 'Pre-Arbitration Raise', remitter: 'AXIS', beneficiary: 'FIP',
      txnAmt: 11200, adjAmt: 11200, glNo: '354447',
      currency: 'Rupees', reasonCode: '4853', pan: '512300*****',
      product: 'VISA', aging: 30,
      merchantAction: 'rejected', acquirerAction: 'considered', visaPending: false,
      rejectReason: 'Merchant provided signed delivery receipt and GPS coordinates. Service fully rendered.',
      timeline: [
        { by: 'iServeU', time: dA(30) + ' 09:00 AM', title: 'Pre-Arbitration Raised by Mastercard', remarks: 'Customer escalated after initial denial', file: null },
        { by: 'masteruser', time: dA(28) + ' 02:00 PM', title: 'Evidence Submitted — Pre-Arb', remarks: 'Signed delivery receipt + GPS proof + call recording', file: 'PreArb_Evidence_CB031.pdf' },
        { by: 'Krishna Das', time: dA(24) + ' 04:00 PM', title: 'Admin Considered — Sent to Mastercard', remarks: 'Strong evidence. Represented to Mastercard.', file: null },
        { by: 'iServeU', time: dA(20) + ' 10:00 AM', title: 'Mastercard Ruled — Dispute Won', remarks: 'Pre-Arb Won. Lien released. Merchant wallet restored.', file: 'MastercardRuling.pdf' }
      ]
    },
    // CB032 — VISA · Deferred CB · In Progress
    {
      id: 'CB032', caseId: 'CASE000032', userName: 'masteruser', userId: '2575789089',
      rrn: '8901234567', txnId: '200004', terminalId: '5690028',
      beneMobile: '9800004004', remMobile: '9700004004',
      createdDate: dA(8), txnDate: dA(12), adjDate: dA(8), respondByDate: dL(2),
      mStatus: 'Differed Chargeback Raise', mSubStatus: 'Chargeback New',
      adjType: 'Differed Chargeback Raise', remitter: 'YES BANK', beneficiary: 'FIP',
      txnAmt: 4600, adjAmt: 4600, glNo: '354448',
      currency: 'Rupees', reasonCode: '4808', pan: '416100*****',
      product: 'VISA', aging: 8,
      merchantAction: 'evidence', acquirerAction: null, visaPending: true,
      rejectReason: 'Transaction completed. 3DS authenticated.',
      timeline: [
        { by: 'iServeU', time: dA(8) + ' 08:30 AM', title: 'Deferred Chargeback Raised', remarks: 'VISA returned initial CB. Resubmitted with new ARN.', file: null },
        { by: 'masteruser', time: dA(6) + ' 01:00 PM', title: 'Evidence Submitted (Resubmission)', remarks: 'Updated ARN, 3DS auth log, merchant terminal receipt', file: 'Resubmit_CB032.pdf' }
      ]
    },
    // CB033 — Rupay · New · for Test@isu merchant
    {
      id: 'CB033', caseId: 'CASE000033', userName: 'Test@isu', userId: '11111111',
      rrn: '9012345678', txnId: '300001', terminalId: '5691001',
      beneMobile: '9900001001', remMobile: '9800001001',
      createdDate: dA(1), txnDate: dA(4), adjDate: dA(1), respondByDate: dL(9),
      mStatus: 'Chargeback Raise', mSubStatus: 'Chargeback New',
      adjType: 'Chargeback Raise', remitter: 'CANARA', beneficiary: 'FIP',
      txnAmt: 3200, adjAmt: 3200, glNo: '354449',
      currency: 'Rupees', reasonCode: '4808', pan: '607003*****',
      product: 'VISA', aging: 1,
      merchantAction: null, acquirerAction: null, visaPending: false,
      timeline: [
        { by: 'iServeU', time: dA(1) + ' 09:00 AM', title: 'Rupay Chargeback Raised', remarks: 'Customer claims Rs.3200 deducted but wallet not credited', file: null }
      ]
    },
    // CB034 — VISA · In Progress · for Test@isu merchant
    {
      id: 'CB034', caseId: 'CASE000034', userName: 'Test@isu', userId: '11111111',
      rrn: '0123456789', txnId: '300002', terminalId: '5691002',
      beneMobile: '9900002002', remMobile: '9800002002',
      createdDate: dA(5), txnDate: dA(9), adjDate: dA(5), respondByDate: dL(3),
      mStatus: 'Chargeback Raise', mSubStatus: 'Chargeback In Progress',
      adjType: 'Chargeback Raise', remitter: 'ICICI', beneficiary: 'FIP',
      txnAmt: 6800, adjAmt: 6800, glNo: '354450',
      currency: 'Rupees', reasonCode: '4853', pan: '411200*****',
      product: 'VISA', aging: 5,
      merchantAction: 'rejected', acquirerAction: null, visaPending: false,
      rejectReason: 'Product delivered on 20-May-2026 via Delhivery. AWB No: 3456781. Customer received and signed.',
      timeline: [
        { by: 'iServeU', time: dA(5) + ' 10:00 AM', title: 'VISA Chargeback Raised', remarks: 'Customer: goods not received despite payment', file: null },
        { by: 'Test@isu', time: dA(3) + ' 04:00 PM', title: 'Evidence Submitted by Test@isu', remarks: 'Courier AWB and delivery confirmation uploaded', file: 'Delivery_Evidence.pdf' }
      ]
    },
    // CB035 — Mastercard · Won · for Test@isu merchant
    {
      id: 'CB035', caseId: 'CASE000035', userName: 'Test@isu', userId: '11111111',
      rrn: '1122334455', txnId: '300003', terminalId: '5691003',
      beneMobile: '9900003003', remMobile: '9800003003',
      createdDate: dA(18), txnDate: dA(22), adjDate: dA(18), respondByDate: dA(8),
      mStatus: 'Chargeback Raise', mSubStatus: 'Chargeback Won',
      adjType: 'Chargeback Raise', remitter: 'PNB', beneficiary: 'FIP',
      txnAmt: 8900, adjAmt: 8900, glNo: '354451',
      currency: 'Rupees', reasonCode: '4808', pan: '545401*****',
      product: 'VISA', aging: 18,
      merchantAction: 'rejected', acquirerAction: 'considered', visaPending: false,
      rejectReason: 'Service provided. Transaction authenticated via OTP. Customer acknowledged receipt.',
      timeline: [
        { by: 'iServeU', time: dA(18) + ' 08:00 AM', title: 'Mastercard Dispute Raised', remarks: 'Cardholder disputes Rs.8,900 charge', file: null },
        { by: 'Test@isu', time: dA(16) + ' 02:00 PM', title: 'Evidence Submitted', remarks: 'OTP log, 3DS auth record, and invoice', file: 'MastercardEvidence.pdf' },
        { by: 'Krishna Das', time: dA(12) + ' 11:00 AM', title: 'Admin Considered — Sent to Mastercard', remarks: 'Evidence verified. Represented to Mastercard.', file: null },
        { by: 'iServeU', time: dA(8) + ' 09:00 AM', title: 'Mastercard Ruled — Won', remarks: 'Dispute Won. Merchant wallet restored.', file: 'MastercardWin.pdf' }
      ]
    },
    // CB036 — VISA · Chargeback Raise · for Test@isu
    {
      id: 'CB036', caseId: 'CASE_VROL_06', userName: 'Test@isu', userId: '11111111',
      rrn: '2233445566', txnId: '300004', terminalId: '5691004',
      beneMobile: '9900004004', remMobile: '9800004004',
      createdDate: dA(4), txnDate: dA(8), adjDate: dA(4), respondByDate: dL(6),
      mStatus: 'Chargeback Raise', mSubStatus: 'Chargeback New',
      adjType: 'Chargeback Raise', remitter: 'SBI', beneficiary: 'FIP',
      txnAmt: 7500, adjAmt: 7500, glNo: '354452',
      currency: 'Rupees', reasonCode: '10.4', pan: '416200*****',
      product: 'VISA', aging: 4,
      merchantAction: null, acquirerAction: null, visaPending: true,
      timeline: [
        { by: 'iServeU', time: dA(4) + ' 11:00 AM', title: 'Chargeback Raise Received from Visa', remarks: 'Visa raised inquiry on Rs.7,500 transaction under reason code 10.4 (Card Absent Fraud).', file: null }
      ]
    },
    // CB037 — Rupay · Lost · for Test@isu
    {
      id: 'CB037', caseId: 'CASE000037', userName: 'Test@isu', userId: '11111111',
      rrn: '3344556677', txnId: '300005', terminalId: '5691005',
      beneMobile: '9900005005', remMobile: '9800005005',
      createdDate: dA(28), txnDate: dA(33), adjDate: dA(28), respondByDate: dA(18),
      mStatus: 'Chargeback Raise', mSubStatus: 'Chargeback Won',
      adjType: 'Chargeback Raise', remitter: 'UNION', beneficiary: 'FIP',
      txnAmt: 4100, adjAmt: 4100, glNo: '354453',
      currency: 'Rupees', reasonCode: '4808', pan: '607004*****',
      product: 'VISA', aging: 28,
      merchantAction: 'rejected', acquirerAction: 'declined', visaPending: false,
      rejectReason: 'NPCI could not verify delivery date match. Ruled in favour of cardholder.',
      timeline: [
        { by: 'iServeU', time: dA(28) + ' 08:30 AM', title: 'Rupay Chargeback Raised', remarks: 'Customer: subscription renewed without consent', file: null },
        { by: 'Test@isu', time: dA(26) + ' 03:00 PM', title: 'Evidence Submitted', remarks: 'T&C and renewal notification emails attached', file: 'Renewal_Evidence.pdf' },
        { by: 'Krishna Das', time: dA(22) + ' 02:00 PM', title: 'Admin Reviewed — Declined', remarks: 'Evidence did not include cancellation refusal proof.', file: null }
      ]
    },
    // CB038 — VISA · Arbitration · Pending Visa · high value
    {
      id: 'CB038', caseId: 'CASE000038', userName: 'masteruser', userId: '2575789089',
      rrn: '4455667788', txnId: '400001', terminalId: '5692001',
      beneMobile: '9100001001', remMobile: '9200001001',
      createdDate: dA(45), txnDate: dA(50), adjDate: dA(45), respondByDate: dA(35),
      mStatus: 'Arbitration Raise', mSubStatus: 'Chargeback In Progress',
      adjType: 'Arbitration Raise', remitter: 'HDFC', beneficiary: 'FIP',
      txnAmt: 25000, adjAmt: 25000, glNo: '354454',
      currency: 'Rupees', reasonCode: '10.5', pan: '416300*****',
      product: 'VISA', aging: 45,
      merchantAction: 'evidence', acquirerAction: 'considered', visaPending: true,
      rejectReason: 'High-value transaction with complete 3DS authentication trail and signed delivery confirmation.',
      timeline: [
        { by: 'iServeU', time: dA(45) + ' 09:00 AM', title: 'VISA Arbitration Filed', remarks: 'After Pre-Arb failure, escalated to VISA Arbitration. Rs.25,000 at stake.', file: null },
        { by: 'masteruser', time: dA(42) + ' 12:00 PM', title: 'Arbitration Evidence Submitted', remarks: 'Full documentation: 3DS auth, call recordings, delivery GPS, invoice pack', file: 'Arbitration_Full_Pack.pdf' },
        { by: 'Krishna Das', time: dA(38) + ' 04:00 PM', title: 'Admin Considered — Sent to VISA', remarks: 'Comprehensive case filed with VISA Arbitration Panel.', file: null },
        { by: 'iServeU', time: dA(35) + ' 11:00 AM', title: 'VISA Arbitration — Pending Decision', remarks: 'Awaiting VISA Arbitration Panel final ruling.', file: null }
      ]
    },
    // CB039 — Mastercard · Accepted · Refund Issued
    {
      id: 'CB039', caseId: 'CASE000039', userName: 'masteruser', userId: '2575789089',
      rrn: '5566778899', txnId: '400002', terminalId: '5692002',
      beneMobile: '9100002002', remMobile: '9200002002',
      createdDate: dA(10), txnDate: dA(14), adjDate: dA(10), respondByDate: dA(0),
      mStatus: 'Chargeback Raise', mSubStatus: 'Chargeback Won',
      adjType: 'Chargeback Raise', remitter: 'KOTAK', beneficiary: 'FIP',
      txnAmt: 1600, adjAmt: 1600, glNo: '354455',
      currency: 'Rupees', reasonCode: '4808', pan: '512400*****',
      product: 'VISA', aging: 10,
      merchantAction: 'accepted', acquirerAction: 'auto-accepted', visaPending: false,
      timeline: [
        { by: 'iServeU', time: dA(10) + ' 09:30 AM', title: 'Mastercard Chargeback Raised', remarks: 'Customer: wrong amount charged', file: null },
        { by: 'masteruser', time: dA(9) + ' 11:00 AM', title: 'Merchant Accepted Dispute', remarks: 'Billing error confirmed. Merchant accepted full responsibility.', file: null },
        { by: 'iServeU', time: dA(8) + ' 03:00 PM', title: 'Refund Processed', remarks: 'Rs.1,600 refunded to cardholder. Merchant wallet debited.', file: 'RefundReceipt.pdf' }
      ]
    },
    // CB040 — VISA · Document Rejected
    {
      id: 'CB040', caseId: 'CASE000040', userName: 'masteruser', userId: '2575789089',
      rrn: '6677889900', txnId: '400003', terminalId: '5692003',
      beneMobile: '9100003003', remMobile: '9200003003',
      createdDate: dA(0), txnDate: dA(0), adjDate: dA(0), respondByDate: dL(10),
      mStatus: 'Chargeback Raise', mSubStatus: 'Chargeback Resubmit',
      adjType: 'Chargeback Raise', remitter: 'FEDERAL', beneficiary: 'FIP',
      txnAmt: 9200, adjAmt: 9200, glNo: '354456',
      currency: 'Rupees', reasonCode: '10.4', pan: '416400*****',
      product: 'VISA', aging: 0,
      merchantAction: 'rejected', acquirerAction: 'request_info', visaPending: false,
      rejectReason: 'The provided document is blurry. Please upload a clear copy of the invoice.',
      documents: [
        { id: 'doc_cb040_1', filename: 'Blurry_Invoice.pdf', uploadedAt: dA(0) + 'T11:00:00Z', status: 'Rejected', rejectionRemarks: 'The provided document is blurry. Please upload a clear copy of the invoice.', uploadedBy: 'Merchant', rejectedAt: dA(0) + 'T12:00:00Z' }
      ],
      timeline: [
        { by: 'iServeU', time: dA(0) + ' 10:45 AM', title: 'Fresh VISA Chargeback Received', remarks: 'New dispute received from VISA acquirer.', file: null },
        { by: 'masteruser', time: dA(0) + ' 11:00 AM', title: 'Evidence Submitted', remarks: 'Merchant uploaded evidence.', file: 'Blurry_Invoice.pdf' },
        { by: 'Admin', time: dA(0) + ' 12:00 PM', title: 'Documents Rejected', remarks: 'Admin requested clear invoice.', file: null }
      ]
    }
  ];
}

// ── Standard Seed (only fills empty collections) ─────────────────────────────
router.post('/seed', async (req, res) => {
  try {
    if (global.MOCK_MODE) {
      const counts = require('../mockStore').resetDemo();
      return res.json({
        message: 'Seeding completed (in-memory)',
        usersSeeded: true,
        chargebacksSeeded: true,
        ledgerSeeded: true,
        ...counts
      });
    }

    const { buildDefaultUsers, buildSeedLedger } = require('../seed/demoData');
    const Ledger = require('../models/Ledger');

    const userCount = await User.countDocuments();
    let usersSeeded = false;
    if (userCount === 0) {
      await User.insertMany(buildDefaultUsers());
      usersSeeded = true;
    }

    const cbCount = await Chargeback.countDocuments();
    let chargebacksSeeded = false;
    if (cbCount === 0) {
      const TODAY = new Date();
      const { PARTNER_ID } = require('../seed/demoData');
      const chargebacks = buildSeedData(TODAY).map((cb) => ({ ...cb, partnerId: PARTNER_ID }));
      await Chargeback.insertMany(chargebacks);
      chargebacksSeeded = true;
    }

    const ledgerCount = await Ledger.countDocuments();
    let ledgerSeeded = false;
    if (ledgerCount === 0) {
      await Ledger.insertMany(buildSeedLedger(new Date()));
      ledgerSeeded = true;
    }

    res.json({ message: 'Seeding completed', usersSeeded, chargebacksSeeded, ledgerSeeded });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ── Full demo reset: users + chargebacks + ledger ───────────────────────────
router.post('/demo', async (req, res) => {
  try {
    const mockStore = require('../mockStore');
    const { seedAllDemoData } = require('../seed/demoData');
    const counts = await seedAllDemoData();
    res.json({
      message: global.MOCK_MODE
        ? 'Demo data loaded successfully (in-memory)'
        : 'Demo data loaded successfully',
      ...counts
    });
  } catch (error) {
    try {
      global.MOCK_MODE = true;
      const counts = require('../mockStore').resetDemo();
      return res.json({ message: 'Demo data loaded (fallback in-memory)', ...counts });
    } catch (fallbackErr) {
      res.status(500).json({ message: error.message || fallbackErr.message });
    }
  }
});

// Full demo bundle for client hydration (always works with mock fallback)
router.get('/bootstrap', async (req, res) => {
  try {
    const mockStore = require('../mockStore');
    if (global.MOCK_MODE) {
      return res.json({
        users: mockStore.getUsers(),
        chargebacks: mockStore.getChargebacks({}),
        ledger: mockStore.getLedger({})
      });
    }

    const Ledger = require('../models/Ledger');
    let users = await User.find({});
    let chargebacks = await Chargeback.find({});
    let ledger = await Ledger.find({});

    if (chargebacks.length === 0) {
      await require('../seed/demoData').seedAllDemoData();
      users = await User.find({});
      chargebacks = await Chargeback.find({});
      ledger = await Ledger.find({});
    }

    res.json({ users, chargebacks, ledger });
  } catch (error) {
    try {
      global.MOCK_MODE = true;
      const mockStore = require('../mockStore');
      mockStore.resetDemo();
      return res.json({
        users: mockStore.getUsers(),
        chargebacks: mockStore.getChargebacks({}),
        ledger: mockStore.getLedger({})
      });
    } catch (fallbackErr) {
      res.status(500).json({ message: error.message || fallbackErr.message });
    }
  }
});

// ── Force Reseed: alias for full demo reset ───────────────────────────────────
router.post('/reseed', async (req, res) => {
  try {
    if (global.MOCK_MODE) {
      const counts = require('../mockStore').resetDemo();
      return res.json({ message: 'Force reseed completed successfully (in-memory)', ...counts });
    }
    const { seedAllDemoData } = require('../seed/demoData');
    const counts = await seedAllDemoData();
    res.json({
      message: 'Force reseed completed successfully',
      ...counts
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Fetch a single user by username (must be after /bootstrap, /seed paths)
router.get('/:username', async (req, res) => {
  try {
    if (global.MOCK_MODE) {
      const user = require('../mockStore').findUser({ username: req.params.username });
      if (!user) return res.status(404).json({ message: 'User not found' });
      const { save, toObject, ...rest } = user;
      return res.json(rest);
    }
    const user = await User.findOne({ username: req.params.username });
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Onboard user
router.post('/', async (req, res) => {
  const { username, password, role, name, walletBalance, caid } = req.body;
  try {
    if (global.MOCK_MODE) {
      const mockStore = require('../mockStore');
      const existing = mockStore.findUser({ username });
      if (existing) {
        return res.status(400).json({ message: 'User already exists' });
      }
      const newUser = mockStore.addUser({
        username,
        password,
        role: role || 'merchant',
        name,
        walletBalance: parseFloat(walletBalance) || 0,
        status: 'active',
        partnerId: null
      });
      if (caid) {
        mockStore.addCaidMapping(caid, username);
      }
      return res.status(201).json(newUser);
    }
    
    const User = require('../models/User');
    const existing = await User.findOne({ username });
    if (existing) {
      return res.status(400).json({ message: 'User already exists' });
    }
    const newUser = await User.create({
      username,
      password,
      role: role || 'merchant',
      name,
      walletBalance: parseFloat(walletBalance) || 0,
      status: 'active',
      partnerId: null
    });
    res.status(201).json(newUser);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
module.exports.buildSeedData = buildSeedData;

