const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const csv = require('csv-parser');
const xlsx = require('xlsx');

const Chargeback = require('../models/Chargeback');
const mockStore = require('../mockStore');

const upload = multer({ dest: 'uploads/vrol/' });

// In-memory file imports log for demo purposes
const fileImports = [];
// In-memory RTSI API Audit logs
const rtsiAuditLogs = [
  {
    id: 'RTSI-1718712300000-001',
    time: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    endpoint: '/oi/inquiry',
    method: 'POST',
    requestPayload: {
      visaTxId: "987654321012345",
      merchantCaid: "MERCH_ACQ_9981",
      arn: "74123456789012345678901",
      txTimestamp: "2026-06-15T14:32:00Z",
      amount: "149.99",
      currencyIso: "840",
      disputeCategoryCode: "Fraud"
    },
    responsePayload: {
      status: "RESOLVED_DEFLECTED",
      digitalReceipt: {
        customerAccountName: "Jane Doe",
        productDigitalDescription: "Premium SaaS Subscription - Annual",
        customerDeviceIpAddress: "192.168.1.45",
        deviceFingerprintHash: "a7b8c9d0e1f2g3h4i5j6k7l8m9n0o1p2",
        shippingCarrierStatus: "FULFILLED_DIGITAL_DELIVERY",
        productCategory: "Digital SaaS"
      },
      message: "Compiled digital receipt transmitted successfully via RTSI."
    },
    status: 200,
    comments: "Deflected via digital receipt compilation. Time elapsed: 142ms"
  },
  {
    id: 'RTSI-1718712300000-002',
    time: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    endpoint: '/rdr/alert',
    method: 'POST',
    requestPayload: {
      vrolCaseId: "RDR-771120A",
      disputeCondition: "10.1: EMV Fraud Counterfeit",
      disputeAmount: "22.50",
      currency: "USD",
      productSku: "DIGITAL_COIN_X1",
      merchantCaid: "CAID_MERCH_001"
    },
    responsePayload: {
      status: "RDR_ACCEPTED",
      vrolCaseId: "RDR-771120A",
      merchantSynced: true,
      message: "Automated Rapid Dispute Resolution successfully accepted and ledger processed."
    },
    status: 200,
    comments: "Automated RDR credit adjusted. ERP webhook synced."
  }
];

// Helper to push RTSI Audit Log
const logRTSIAudit = (endpoint, method, requestPayload, responsePayload, status, comments) => {
  rtsiAuditLogs.unshift({
    id: 'RTSI-' + Date.now() + '-' + Math.floor(Math.random()*1000),
    time: new Date().toISOString(),
    endpoint,
    method,
    requestPayload,
    responsePayload,
    status,
    comments
  });
};

// Helper to update/create a Ledger AEM entry and update user wallet
const logAEM = async (merchant, type, amount, remarks) => {
  if (global.MOCK_MODE) {
    const user = mockStore.findUser({ username: merchant });
    if (user) {
      const balance = user.walletBalance + (type === 'Credit' ? amount : -amount);
      mockStore.updateUserWallet(merchant, balance);
    }
    const entry = {
      id: `ADJ${mockStore.countLedger() + 101}`,
      merchant,
      type,
      amount,
      date: new Date().toISOString().split('T')[0],
      remarks
    };
    mockStore.addLedgerEntry(entry);
    return entry;
  } else {
    try {
      const User = require('../models/User');
      const Ledger = require('../models/Ledger');
      const user = await User.findOne({ username: merchant });
      if (user) {
        user.walletBalance = user.walletBalance + (type === 'Credit' ? amount : -amount);
        await user.save();
      }
      const count = await Ledger.countDocuments();
      const entry = await Ledger.create({
        id: `ADJ${count + 101}`,
        merchant,
        type,
        amount,
        date: new Date().toISOString().split('T')[0],
        remarks
      });
      return entry;
    } catch (e) {
      console.error('Failed to log AEM to MongoDB:', e);
    }
  }
};

// Mock CRM/OMS registry matching Gherkin scenarios
const OMS_REGISTRY = {
  '987654321012345': {
    customerName: 'Jane Doe',
    productDescription: 'Premium SaaS Subscription - Annual',
    deviceIP: '192.168.1.45',
    deviceFingerprint: 'a7b8c9d0e1f2g3h4i5j6k7l8m9n0o1p2',
    fulfillmentStatus: 'FULFILLED_DIGITAL_DELIVERY',
    productCategory: 'Digital SaaS'
  },
  '987654321012346': {
    customerName: 'John Smith',
    productDescription: 'Leather Messenger Work Bag',
    deviceIP: '172.56.21.9',
    deviceFingerprint: 'z1x2c3v4b5n6m7asdfghjklqwertyui1',
    fulfillmentStatus: 'DELIVERED_SIGNED_BY_RECIP',
    productCategory: 'Physical Retail'
  },
  '987654321012347': {
    customerName: 'Alice Green',
    productDescription: 'Boutique Hotel Stay - 2 Nights',
    deviceIP: '204.14.52.88',
    deviceFingerprint: 'q1w2e3r4t5y6u7i8o9p0asdfghjklzxc',
    fulfillmentStatus: 'CHECKED_OUT_VALID_ID',
    productCategory: 'Travel & T&E'
  },
  '987654321012348': {
    customerName: 'Bob Taylor',
    productDescription: 'In-Game Virtual Currency Pack',
    deviceIP: '101.23.4.112',
    deviceFingerprint: 'm9n8b7v6c5x4z3asdfghjklpoiuytrew',
    fulfillmentStatus: 'CREDITED_TO_USER_WALLET',
    productCategory: 'Digital Goods'
  }
};

// --- Webhook: Order Insight (OI) Purchase Inquiry ---
router.post('/oi/inquiry', async (req, res) => {
  const payload = req.body;
  const { visaTxId, merchantCaid, arn, txTimestamp, amount, currencyIso, disputeCategoryCode } = payload;
  const startTime = Date.now();

  try {
    const merchantUser = mockStore.mapCaidToMerchant(merchantCaid);
    
    // 1. Evaluate configured threshold deflection rules
    const rules = mockStore.getDeflectionRules(merchantUser);
    const matchedRule = rules.find(r => 
      parseFloat(amount) <= parseFloat(r.maxThresholdAmount) && 
      (r.visaCategory === 'ALL_MATCHES' || r.visaCategory.toLowerCase() === (disputeCategoryCode || 'Fraud').toLowerCase()) &&
      r.ruleAction === 'AUTO_INTENT_TO_CREDIT'
    );

    if (matchedRule) {
      // Execute AUTO_INTENT_TO_CREDIT logic
      const ledgerRemarks = `PRE_DISPUTE_DEFLECTION_REVERSAL | Debit: Merchant Escrow Settlement Account | Credit: Issuer Cardholder Network Settlement Pool | Allocation: ${amount} ${currencyIso || 'USD'}`;
      await logAEM(merchantUser, 'Debit', parseFloat(amount), ledgerRemarks);

      // Create pre-dispute deflected dispute record
      const caseId = 'OI-CREDIT-' + Date.now();
      const timelineEntry = {
        by: 'VROL RTSI System',
        time: new Date().toLocaleString(),
        title: 'Intent to Credit Triggered',
        remarks: `Auto-deflection rule evaluated. Amount ${amount} is below ${matchedRule.maxThresholdAmount} threshold. Posted AEM and issued Intent to Credit.`,
        file: null
      };

      const newDispute = {
        id: caseId,
        caseId: caseId,
        visaId: visaTxId || caseId,
        visaTxId: visaTxId,
        userName: merchantUser,
        userId: merchantCaid,
        rrn: arn ? arn.substring(0, 12) : 'RRN-' + Math.floor(Math.random()*1000000),
        arn: arn,
        txnId: 'TXN-' + Math.floor(Math.random()*1000000),
        createdDate: new Date().toISOString().split('T')[0],
        txnDate: txTimestamp ? txTimestamp.split('T')[0] : new Date().toISOString().split('T')[0],
        adjDate: new Date().toISOString().split('T')[0],
        respondByDate: new Date().toISOString().split('T')[0],
        mStatus: 'VROL Inquiry',
        mSubStatus: 'Resolved - Deflected via OI Credit',
        adjType: 'Order Insight Inquiry',
        txnAmt: parseFloat(amount),
        adjAmt: parseFloat(amount),
        currency: currencyIso || '840',
        timeline: [timelineEntry],
        documents: [],
        resolution: 'Lost',
        acquirerAction: 'lost',
        merchantAction: 'accepted'
      };

      if (global.MOCK_MODE) {
        mockStore.addChargeback(newDispute);
      } else {
        await new Chargeback(newDispute).save();
      }

      const responsePayload = {
        status: 'RESOLVED_AUTO_CREDIT',
        intentToCredit: true,
        actionCode: 'AUTO_INTENT_TO_CREDIT',
        message: 'Order Insight inquiry auto-resolved via Intent to Credit threshold.'
      };

      logRTSIAudit('/oi/inquiry', 'POST', payload, responsePayload, 200, `Threshold check passed for amount ${amount} <= ${matchedRule.maxThresholdAmount}`);
      return res.json(responsePayload);
    }

    // 2. Standard Digital Receipt Compiling via OMS registry
    const omsRecord = OMS_REGISTRY[visaTxId] || Object.values(OMS_REGISTRY)[0]; // fallback
    const compiledReceipt = {
      customerAccountName: omsRecord.customerName,
      productDigitalDescription: omsRecord.productDescription,
      customerDeviceIpAddress: omsRecord.deviceIP,
      deviceFingerprintHash: omsRecord.deviceFingerprint,
      shippingCarrierStatus: omsRecord.fulfillmentStatus,
      productCategory: omsRecord.productCategory
    };

    // Save pre-dispute digital receipt deflection record
    const caseId = 'OI-DIGITAL-' + Date.now();
    const timelineEntry = {
      by: 'VROL RTSI System',
      time: new Date().toLocaleString(),
      title: 'Order Insight Response Compiled',
      remarks: `Compiled digital receipt from OMS. Customer IP: ${omsRecord.deviceIP}. Fulfillment status: ${omsRecord.fulfillmentStatus}. Deflection successful.`,
      file: null
    };

    const newDispute = {
      id: caseId,
      caseId: caseId,
      visaId: visaTxId || caseId,
      visaTxId: visaTxId,
      userName: merchantUser,
      userId: merchantCaid,
      rrn: arn ? arn.substring(0, 12) : 'RRN-' + Math.floor(Math.random()*1000000),
      arn: arn,
      txnId: 'TXN-' + Math.floor(Math.random()*1000000),
      createdDate: new Date().toISOString().split('T')[0],
      txnDate: txTimestamp ? txTimestamp.split('T')[0] : new Date().toISOString().split('T')[0],
      adjDate: new Date().toISOString().split('T')[0],
      respondByDate: new Date().toISOString().split('T')[0],
      mStatus: 'VROL Inquiry',
      mSubStatus: 'Pre-Dispute - Deflected via Order Insight',
      adjType: 'Order Insight Inquiry',
      txnAmt: parseFloat(amount),
      adjAmt: parseFloat(amount),
      currency: currencyIso || '840',
      timeline: [timelineEntry],
      documents: [],
      resolution: 'Won',
      acquirerAction: 'won',
      merchantAction: 'evidence',
      productCategory: omsRecord.productCategory,
      customerName: omsRecord.customerName,
      productDescription: omsRecord.productDescription,
      customerDeviceIp: omsRecord.deviceIP,
      deviceFingerprint: omsRecord.deviceFingerprint,
      fulfillmentStatus: omsRecord.fulfillmentStatus
    };

    if (global.MOCK_MODE) {
      mockStore.addChargeback(newDispute);
    } else {
      await new Chargeback(newDispute).save();
    }

    const elapsed = Date.now() - startTime;
    if (elapsed > 2000) {
      console.warn(`Visa network timeout warning: Order Insight response took ${elapsed}ms.`);
    }

    const responsePayload = {
      status: 'RESOLVED_DEFLECTED',
      digitalReceipt: compiledReceipt,
      message: 'Compiled digital receipt transmitted successfully via RTSI.'
    };

    logRTSIAudit('/oi/inquiry', 'POST', payload, responsePayload, 200, `Deflected via digital receipt compilation. Time elapsed: ${elapsed}ms`);
    res.json(responsePayload);
  } catch (error) {
    console.error('Order Insight Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// --- Webhook: Rapid Dispute Resolution (RDR) Alert Ingestion ---
router.post('/rdr/alert', async (req, res) => {
  const payload = req.body;
  const { vrolCaseId, disputeCondition, disputeAmount, currency, productSku, merchantCaid } = payload;

  try {
    const merchantUser = mockStore.mapCaidToMerchant(merchantCaid);
    const rules = mockStore.getRdrRules(merchantUser);

    const activeRule = rules.find(r => 
      parseFloat(disputeAmount) <= parseFloat(r.rdrMaxLimit) &&
      (!r.excludedSkus || !r.excludedSkus.split(',').map(s => s.trim()).includes(productSku)) &&
      r.programId === 'VISA_RDR_CORE'
    );

    if (!activeRule) {
      const responsePayload = { status: 'RDR_REJECTED', message: 'RDR parameters do not match rules limits or exclusions.' };
      logRTSIAudit('/rdr/alert', 'POST', payload, responsePayload, 400, 'RDR rule evaluation failed');
      return res.status(400).json(responsePayload);
    }

    // Process automated debit RDR credit adjustment
    const remarks = `Automated RDR Credit Adjustment | Source Merchant CAID: ${merchantCaid} | Debit: ${disputeAmount} ${currency || 'USD'} | Credit: Acquirer Network Liability Clear Account`;
    await logAEM(merchantUser, 'Debit', parseFloat(disputeAmount), remarks);

    const timelineEntry = {
      by: 'RDR Automation Engine',
      time: new Date().toLocaleString(),
      title: 'Rapid Dispute Resolution Accepted',
      remarks: `RDR alert matches rule (${disputeAmount} <= ${activeRule.rdrMaxLimit}). Issued accept response, debited merchant wallet.`,
      file: null
    };

    const rdrCase = {
      id: vrolCaseId,
      caseId: vrolCaseId,
      visaId: vrolCaseId,
      userName: merchantUser,
      userId: merchantCaid,
      rrn: 'RRN-' + Math.floor(Math.random()*1000000),
      txnId: 'TXN-' + Math.floor(Math.random()*1000000),
      createdDate: new Date().toISOString().split('T')[0],
      txnDate: new Date().toISOString().split('T')[0],
      adjDate: new Date().toISOString().split('T')[0],
      respondByDate: new Date().toISOString().split('T')[0],
      mStatus: 'VROL Chargeback',
      mSubStatus: 'Resolved - Deflected via RDR',
      adjType: 'Rapid Dispute Resolution',
      txnAmt: parseFloat(disputeAmount),
      adjAmt: parseFloat(disputeAmount),
      currency: currency || 'USD',
      timeline: [timelineEntry],
      documents: [],
      resolution: 'Lost',
      acquirerAction: 'lost',
      merchantAction: 'accepted'
    };

    if (global.MOCK_MODE) {
      mockStore.addChargeback(rdrCase);
    } else {
      await new Chargeback(rdrCase).save();
    }

    // Trigger mock ERP webhook integration sync
    const erpWebhookUrl = 'https://api.merchant-erp.internal/vrol-sync';
    console.log(`[ERP Webhook] Syncing RDR Case ${vrolCaseId} resolution to ${erpWebhookUrl}`);

    const responsePayload = {
      status: 'RDR_ACCEPTED',
      vrolCaseId,
      merchantSynced: true,
      message: 'Automated Rapid Dispute Resolution successfully accepted and ledger processed.'
    };

    logRTSIAudit('/rdr/alert', 'POST', payload, responsePayload, 200, `Automated RDR credit adjusted. ERP webhook synced.`);
    res.json(responsePayload);
  } catch (error) {
    console.error('RDR Ingestion Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// --- Webhook: Formal VROL Dispute Ingestion ---
router.post('/dispute/ingest', async (req, res) => {
  const payload = req.body;
  const { vrolCaseId, merchantCaid, merchantName, disputeCategory, disputeCondition, disputeAmount, currencyCode, networkDayLimit, networkSubmissionDate } = payload;

  try {
    const merchantUser = mockStore.mapCaidToMerchant(merchantCaid);

    // Compute SLA expiration
    const submission = networkSubmissionDate ? new Date(networkSubmissionDate) : new Date();
    const daysLimit = parseInt(networkDayLimit) || 30;
    const expiration = new Date(submission.getTime() + daysLimit * 24 * 60 * 60 * 1000);
    // Set to 23:59:59Z
    expiration.setUTCHours(23, 59, 59, 0);
    const slaTimestamp = expiration.toISOString();

    // Priority classification
    let queuePriority = 'Standard-Priority Queue';
    const amountVal = parseFloat(disputeAmount);
    if (disputeCategory === 'Fraud' && amountVal > 1000) {
      queuePriority = 'Critical-Escalation Corp';
    } else if (amountVal > 300 || disputeCategory === 'Fraud') {
      queuePriority = 'High-Priority Review';
    } else if (disputeCategory === 'Processing Error' && amountVal < 50) {
      queuePriority = 'Low-Priority Batch';
    }

    const timelineEntry = {
      by: 'VROL Dispute Ingestion Worker',
      time: new Date().toLocaleString(),
      title: 'Formal Dispute Ingested via RTSI',
      remarks: `Ingested dispute ${vrolCaseId}. SLA computed for ${daysLimit} days: expiring on ${slaTimestamp}. Priority queue: ${queuePriority}. Dispatching SLA alerts to merchant group.`,
      file: null
    };

    const newDispute = {
      id: vrolCaseId,
      caseId: vrolCaseId,
      visaId: vrolCaseId,
      userName: merchantUser,
      userId: merchantCaid,
      rrn: 'RRN-' + Math.floor(Math.random()*1000000),
      txnId: 'TXN-' + Math.floor(Math.random()*1000000),
      createdDate: new Date().toISOString().split('T')[0],
      txnDate: new Date().toISOString().split('T')[0],
      adjDate: new Date().toISOString().split('T')[0],
      respondByDate: slaTimestamp.split('T')[0],
      mStatus: 'VROL Chargeback',
      mSubStatus: 'Action Required - Awaiting Merchant Input',
      adjType: 'Formal Dispute Inflow',
      txnAmt: amountVal,
      adjAmt: amountVal,
      currency: currencyCode || 'USD',
      timeline: [timelineEntry],
      documents: [],
      resolution: 'Pending',
      queuePriority,
      networkDayLimit,
      networkSubmissionDate: networkSubmissionDate || new Date().toISOString().split('T')[0]
    };

    if (global.MOCK_MODE) {
      mockStore.addChargeback(newDispute);
    } else {
      await new Chargeback(newDispute).save();
    }

    const responsePayload = {
      status: 'INGESTED_SUCCESSFULLY',
      vrolCaseId,
      slaTimestamp,
      queuePriority,
      alertDispatched: true
    };

    logRTSIAudit('/dispute/ingest', 'POST', payload, responsePayload, 200, `Mapped to merchant: ${merchantUser}. Priority: ${queuePriority}. SLA: ${slaTimestamp}`);
    res.json(responsePayload);
  } catch (error) {
    console.error('Dispute Ingestion Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// --- Action: Submit representment evidence questionnaire ---
router.post('/dispute/:id/representment', async (req, res) => {
  const { id } = req.params;
  const payload = req.body;
  const { evidenceFile1, evidenceDescription1, evidenceFile2, evidenceDescription2, evidenceFile3, evidenceDescription3 } = payload;

  try {
    let dispute;
    if (global.MOCK_MODE) {
      dispute = mockStore.findChargebackById(id);
    } else {
      dispute = await Chargeback.findOne({ id });
    }

    if (!dispute) {
      return res.status(404).json({ error: 'Dispute not found' });
    }

    // ChargebackHelp-style automated validation script simulation
    const allowedExtensions = ['.pdf', '.json', '.csv', '.png', '.jpg'];
    const validateFile = (fileName) => {
      if (!fileName) return 'Missing file';
      const ext = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();
      if (!allowedExtensions.includes(ext)) {
        return `Format ${ext} not allowed. Supported formats: PDF, JSON, CSV, PNG, JPG.`;
      }
      return null;
    };

    const err1 = validateFile(evidenceFile1);
    const err2 = validateFile(evidenceFile2);
    const err3 = validateFile(evidenceFile3);

    if (err1 || err2 || err3) {
      const errMsg = `Validation Error: ${err1 || ''} ${err2 || ''} ${err3 || ''}`.trim();
      const responsePayload = { status: 'VALIDATION_FAILED', error: errMsg };
      logRTSIAudit(`/dispute/${id}/representment`, 'POST', payload, responsePayload, 400, errMsg);
      return res.status(400).json(responsePayload);
    }

    // Attach document binary links
    const addDoc = (fileName, desc, type) => {
      if (fileName) {
        dispute.documents.push({
          id: 'doc_' + Date.now() + '_' + Math.floor(Math.random()*100),
          filename: fileName,
          uploadedAt: new Date().toISOString(),
          status: 'Pending Review',
          uploadedBy: 'Merchant',
          rejectionRemarks: desc
        });
      }
    };

    addDoc(evidenceFile1, evidenceDescription1, 'Core');
    addDoc(evidenceFile2, evidenceDescription2, 'Supplementary');
    addDoc(evidenceFile3, evidenceDescription3, 'Historical');

    const timelineEntry = {
      by: dispute.userName || 'Merchant User',
      time: new Date().toLocaleString(),
      title: 'Representment Compelled Evidence Uploaded',
      remarks: `Uploaded: ${evidenceFile1}, ${evidenceFile2}, ${evidenceFile3}. Triggered ChargebackHelp validation script. Schema VROL Dispute Response Questionnaire compiled. API Response code: VROL_ACKNOWLEDGED_SUCCESS.`,
      file: evidenceFile1
    };

    dispute.mStatus = 'VROL Chargeback';
    dispute.mSubStatus = 'Representment Submitted - Awaiting Network Ruling';
    dispute.timeline.unshift(timelineEntry);

    if (global.MOCK_MODE) {
      await dispute.save();
    } else {
      await dispute.save();
    }

    const responsePayload = {
      status: 'VROL_ACKNOWLEDGED_SUCCESS',
      caseId: id,
      questionnaireCompiled: true,
      message: 'Questionnaire schema payload transmitted to VROL successfully.'
    };

    logRTSIAudit(`/dispute/${id}/representment`, 'POST', payload, responsePayload, 200, 'Representment compiled and validated successfully.');
    res.json(responsePayload);
  } catch (error) {
    console.error('Representment submission error:', error);
    res.status(500).json({ error: error.message });
  }
});

// --- Action: Collaboration Pre-Arbitration / DRM action ---
router.post('/dispute/:id/collaboration-action', async (req, res) => {
  const { id } = req.params;
  const { finalAction } = req.body; // ACCEPT_LIABILITY | ESCALATE_TO_DRM

  try {
    let dispute;
    if (global.MOCK_MODE) {
      dispute = mockStore.findChargebackById(id);
    } else {
      dispute = await Chargeback.findOne({ id });
    }

    if (!dispute) {
      return res.status(404).json({ error: 'Dispute not found' });
    }

    dispute.isLocked = true; // Block duplicate actions or manual refunds
    let nextStatus = '';
    let nextSubStatus = '';
    let resolution = 'Pending';
    let timelineTitle = '';
    let remarks = '';

    if (finalAction === 'ACCEPT_LIABILITY') {
      nextStatus = 'Collaboration Closed';
      nextSubStatus = 'Resolved Closed - Liability Accepted to Issuer';
      resolution = 'Lost';
      timelineTitle = 'Liability Accepted';
      remarks = 'Merchant reviewed Pre-Arbitration documentation and accepted liability. Balance debited from merchant settlement pool.';

      // Deduct balance
      await logAEM(dispute.userName, 'Debit', parseFloat(dispute.adjAmt), `Liability Accepted | Deflection closed for VROL Case ${dispute.id}`);
    } else if (finalAction === 'ESCALATE_TO_DRM') {
      // Differentiate between Processing Error (Compliance Filing) and others (Arbitration)
      if (dispute.reasonCode && (dispute.reasonCode.includes('12.3') || dispute.reasonCode.includes('Duplicate'))) {
        nextStatus = 'VROL Compliance';
        nextSubStatus = 'Pending Formal Compliance Case Filing - Assigned to Visa DRM';
        timelineTitle = 'DRM Compliance Filing Initiated';
        remarks = 'Merchant rejected Pre-Arbitration counter-statement. Compiled Compliance Filing Dossier. Triggered Visa DRM Case Review API.';
      } else {
        nextStatus = 'VROL Arbitration';
        nextSubStatus = 'Pending Formal Arbitration - Assigned to Visa DRM Queue';
        timelineTitle = 'DRM Arbitration Case Filed';
        remarks = 'Merchant rejected cardholder counter-declaration. Compiled Case Filing Dossier. Triggered Visa DRM Case Review API.';
      }
    } else {
      return res.status(400).json({ error: 'Invalid action' });
    }

    dispute.mStatus = nextStatus;
    dispute.mSubStatus = nextSubStatus;
    dispute.resolution = resolution;

    const timelineEntry = {
      by: dispute.userName || 'Merchant User',
      time: new Date().toLocaleString(),
      title: timelineTitle,
      remarks,
      file: null
    };
    dispute.timeline.unshift(timelineEntry);

    if (global.MOCK_MODE) {
      await dispute.save();
    } else {
      await dispute.save();
    }

    const responsePayload = {
      status: 'SUCCESS',
      caseId: id,
      finalState: nextSubStatus,
      isLocked: true,
      message: remarks
    };

    logRTSIAudit(`/dispute/${id}/collaboration-action`, 'POST', { finalAction }, responsePayload, 200, `Collaboration action completed: ${finalAction}`);
    res.json(responsePayload);
  } catch (error) {
    console.error('Collaboration action error:', error);
    res.status(500).json({ error: error.message });
  }
});

// --- Inbound simulator trigger for Collaboration Cases ---
router.post('/collaboration/ingest', async (req, res) => {
  const payload = req.body;
  const { vrolCaseId, merchantCaid, disputeCategory, disputeCondition, disputeAmount, currency, initialEvidence, preArbCounterReason } = payload;

  try {
    const merchantUser = mockStore.mapCaidToMerchant(merchantCaid);

    const timelineEntry = {
      by: 'VROL System Webhook',
      time: new Date().toLocaleString(),
      title: 'Collaboration Ingested via RTSI',
      remarks: `Ingested Collaboration Case ${vrolCaseId}. Current Case Phase: Collaboration Initial Ingestion.`,
      file: null
    };

    const newDispute = {
      id: vrolCaseId,
      caseId: vrolCaseId,
      visaId: vrolCaseId,
      userName: merchantUser,
      userId: merchantCaid,
      rrn: 'RRN-' + Math.floor(Math.random()*1000000),
      txnId: 'TXN-' + Math.floor(Math.random()*1000000),
      createdDate: new Date().toISOString().split('T')[0],
      txnDate: new Date().toISOString().split('T')[0],
      adjDate: new Date().toISOString().split('T')[0],
      respondByDate: new Date(Date.now() + 5*24*60*60*1000).toISOString().split('T')[0], // 5 days limit
      mStatus: 'Collaboration Initial Ingestion',
      mSubStatus: 'Pre-Arbitration - Review Required',
      adjType: 'Collaboration Workflow',
      txnAmt: parseFloat(disputeAmount),
      adjAmt: parseFloat(disputeAmount),
      currency: currency || 'USD',
      timeline: [
        {
          by: 'Issuer counter-reply',
          time: new Date(Date.now() - 1*24*60*60*1000).toLocaleString(),
          title: 'Issuer Pre-Arbitration Raised',
          remarks: `Issuer rejected merchant evidence (${initialEvidence}). Counter-Reason: ${preArbCounterReason}`,
          file: null
        },
        {
          by: 'Merchant Portal',
          time: new Date(Date.now() - 2*24*60*60*1000).toLocaleString(),
          title: 'Initial Collaboration Response Submitted',
          remarks: `Submitted response to VROL rejecting claim. Evidence attached: ${initialEvidence}`,
          file: initialEvidence
        },
        timelineEntry
      ],
      documents: initialEvidence ? [
        {
          id: 'doc_init',
          filename: initialEvidence,
          uploadedAt: new Date(Date.now() - 2*24*60*60*1000).toISOString(),
          status: 'Rejected',
          uploadedBy: 'Merchant',
          rejectionRemarks: 'Issuer counter-reply claims package stolen.'
        }
      ] : [],
      resolution: 'Pending',
      isCollaboration: true,
      collaborationPhase: 'Pre-Arbitration',
      preArbCounterReason,
      reasonCode: disputeCondition
    };

    if (global.MOCK_MODE) {
      mockStore.addChargeback(newDispute);
    } else {
      await new Chargeback(newDispute).save();
    }

    const responsePayload = {
      status: 'INGESTED_SUCCESSFULLY',
      vrolCaseId,
      phase: 'Pre-Arbitration - Review Required'
    };

    logRTSIAudit('/collaboration/ingest', 'POST', payload, responsePayload, 200, `Collaboration case created and set to Pre-Arb review.`);
    res.json(responsePayload);
  } catch (error) {
    console.error('Collaboration Ingestion Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// --- Get deflection and RDR rules ---
router.get('/oi/rules', (req, res) => {
  const user = req.headers['x-user-name'] || req.query.merchant;
  res.json(mockStore.getDeflectionRules(user));
});

router.post('/oi/rules', (req, res) => {
  const user = req.headers['x-user-name'] || req.body.merchant;
  const rules = req.body.rules || [];
  mockStore.saveDeflectionRules(user, rules);
  res.json({ status: 'SUCCESS', rules: mockStore.getDeflectionRules(user) });
});

router.get('/rdr/rules', (req, res) => {
  const user = req.headers['x-user-name'] || req.query.merchant;
  res.json(mockStore.getRdrRules(user));
});

router.post('/rdr/rules', (req, res) => {
  const user = req.headers['x-user-name'] || req.body.merchant;
  const rules = req.body.rules || [];
  mockStore.saveRdrRules(user, rules);
  res.json({ status: 'SUCCESS', rules: mockStore.getRdrRules(user) });
});

// --- RTSI API Audits ---
router.get('/rtsi-audits', (req, res) => {
  res.json(rtsiAuditLogs);
});

router.post('/rtsi-audits/clear', (req, res) => {
  rtsiAuditLogs.length = 0;
  res.json({ status: 'SUCCESS' });
});

// Keep existing file upload logic
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { path: filePath, originalname, mimetype } = req.file;
    const uploadedBy = req.body.uploadedBy || 'Admin';

    // Log the file import in memory
    const fileImport = {
      id: 'import_' + Date.now(),
      fileName: originalname,
      fileType: mimetype,
      uploadedBy,
      status: 'PROCESSING',
      createdAt: new Date().toISOString()
    };
    fileImports.unshift(fileImport);

    const parsedData = [];
    
    if (originalname.endsWith('.csv')) {
      await new Promise((resolve, reject) => {
        fs.createReadStream(filePath)
          .pipe(csv())
          .on('data', (data) => parsedData.push(data))
          .on('end', resolve)
          .on('error', reject);
      });
    } else if (originalname.endsWith('.xlsx')) {
      const workbook = xlsx.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const json = xlsx.utils.sheet_to_json(sheet);
      parsedData.push(...json);
    } else {
      fileImport.status = 'FAILED';
      fileImport.logs = 'Unsupported file format';
      return res.status(400).json({ error: 'Unsupported file format' });
    }

    let processedCount = 0;

    for (const row of parsedData) {
      const visaCaseNumber = row['Visa Case Number'] || row['visa_case_no'] || row['visaId'] || row['Visa ID'] || '';
      const disputeId = row['Dispute ID'] || row['dispute_id'] || row['id'] || `DISP-${Date.now()}-${Math.floor(Math.random()*1000)}`;
      const rrn = row['RRN'] || row['rrn'] || 'RRN-' + Math.floor(Math.random()*1000000);
      const txnId = row['Txn ID'] || row['txnId'] || row['txn_id'] || 'TXN-' + Math.floor(Math.random()*1000000);
      const adjAmt = parseFloat(row['Dispute Amount'] || row['dispute_amount'] || row['adjAmt'] || row['amount'] || 100);
      const txnAmt = parseFloat(row['Transaction Amount'] || row['transaction_amount'] || row['txnAmt'] || row['amount'] || 100);
      const reasonCode = String(row['Reason Code'] || row['reason_code'] || '10.4');
      const adjType = row['Dispute Type'] || row['dispute_type'] || row['adjType'] || 'Chargeback';
      const userName = row['Merchant Name'] || row['merchant_name'] || row['userName'] || 'masteruser';
      const userId = row['MID'] || row['mid'] || row['userId'] || 'MID-10515104';
      const partnerId = row['Partner ID'] || row['partner_id'] || row['partnerId'] || 'partner1';
      
      const createdDate = row['Created Date'] || row['created_date'] || new Date().toISOString().split('T')[0];
      const txnDate = row['Txn Date'] || row['txn_date'] || row['transactionDate'] || new Date().toISOString().split('T')[0];
      const adjDate = row['Adj Date'] || row['adj_date'] || new Date().toISOString().split('T')[0];
      
      let respondByDate = row['Respond By Date'] || row['respond_by_date'] || row['respondByDate'];
      if (!respondByDate) {
        const d = new Date();
        d.setDate(d.getDate() + 30);
        respondByDate = d.toISOString().split('T')[0];
      }

      const timelineEntry = {
        by: 'VROL System',
        time: new Date().toLocaleString(),
        title: 'Dispute Imported via VROL',
        remarks: `Dispute Case imported/updated via VROL Import by ${uploadedBy}.`,
        file: null
      };

      if (global.MOCK_MODE) {
        let dispute = mockStore.findChargebackById(disputeId);
        if (dispute) {
          dispute.mSubStatus = 'Document pending for Merchant';
          dispute.mStatus = adjType + ' Raise';
          dispute.adjAmt = adjAmt;
          dispute.reasonCode = reasonCode;
          dispute.respondByDate = respondByDate;
          dispute.timeline = dispute.timeline || [];
          dispute.timeline.unshift({
            ...timelineEntry,
            title: 'Dispute Updated via VROL',
            remarks: `Dispute Case updated via VROL Import. Previous Sub-Status: ${dispute.mSubStatus}`
          });
          await dispute.save();
        } else {
          mockStore.addChargeback({
            id: disputeId,
            caseId: disputeId,
            visaId: visaCaseNumber || disputeId,
            userName,
            userId,
            rrn,
            txnId,
            createdDate,
            txnDate,
            adjDate,
            respondByDate,
            mStatus: adjType + ' Raise',
            mSubStatus: 'Document pending for Merchant',
            adjType,
            txnAmt,
            adjAmt,
            partnerId,
            timeline: [timelineEntry],
            documents: []
          });
        }
      } else {
        let dispute = await Chargeback.findOne({ $or: [{ id: disputeId }, { visaId: visaCaseNumber }] });
        if (dispute) {
          dispute.mSubStatus = 'Document pending for Merchant';
          dispute.mStatus = adjType + ' Raise';
          dispute.adjAmt = adjAmt;
          dispute.reasonCode = reasonCode;
          dispute.respondByDate = respondByDate;
          dispute.timeline.unshift({
            ...timelineEntry,
            title: 'Dispute Updated via VROL',
            remarks: `Dispute Case updated via VROL Import. Previous Sub-Status: ${dispute.mSubStatus}`
          });
          await dispute.save();
        } else {
          dispute = new Chargeback({
            id: disputeId,
            caseId: disputeId,
            visaId: visaCaseNumber || disputeId,
            userName,
            userId,
            rrn,
            txnId,
            createdDate,
            txnDate,
            adjDate,
            respondByDate,
            mStatus: adjType + ' Raise',
            mSubStatus: 'Document pending for Merchant',
            adjType,
            txnAmt,
            adjAmt,
            partnerId,
            timeline: [timelineEntry],
            documents: []
          });
          await dispute.save();
        }
      }
      processedCount++;
    }

    fileImport.status = 'COMPLETED';
    fileImport.logs = `Successfully processed ${processedCount} records.`;

    res.json({ message: 'File processed successfully', recordsProcessed: processedCount });
  } catch (error) {
    console.error('Upload Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
