const express = require('express');
const router = express.Router();
const Chargeback = require('../models/Chargeback');

// Get disputes with filtering and RBAC
router.get('/', async (req, res) => {
  try {
    const { from, to, rrn, status, subStatus, search } = req.query;
    const userRole = req.headers['x-user-role'];
    const userName = req.headers['x-user-name'];

    let query = {};

    // Role-Based Access Control
    if (userRole === 'merchant') {
      if (!userName) return res.status(400).json({ message: 'Missing x-user-name header for merchant' });
      query.userName = userName;
    }
    // Admin sees all, no query restriction needed

    if (from || to) {
      query.createdDate = {};
      if (from) query.createdDate.$gte = from;
      if (to) query.createdDate.$lte = to;
    }
    if (rrn) {
      query.rrn = new RegExp(rrn, 'i');
    }
    if (status) {
      query.mStatus = status;
    }
    if (subStatus) {
      query.mSubStatus = subStatus;
    }
    if (search) {
      const searchRegex = new RegExp(search, 'i');
      query.$or = [
        { rrn: searchRegex },
        { txnId: searchRegex },
        { userName: searchRegex },
        { mStatus: searchRegex },
        { mSubStatus: searchRegex }
      ];
    }

    if (global.MOCK_MODE) {
      const mockStore = require('../mockStore');
      return res.json(mockStore.getChargebacks(query));
    }

    const disputes = await Chargeback.find(query).sort({ createdDate: -1 });
    res.json(disputes);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Create a single dispute
router.post('/', async (req, res) => {
  try {
    const newDispute = new Chargeback(req.body);
    const saved = await newDispute.save();
    res.status(201).json(saved);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Bulk upload disputes
router.post('/bulk-upload', async (req, res) => {
  try {
    const records = req.body;
    if (!Array.isArray(records)) {
      return res.status(400).json({ message: 'Payload must be an array of disputes' });
    }
    const inserted = await Chargeback.insertMany(records);
    res.status(201).json({ message: `Successfully imported ${inserted.length} records`, inserted });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Update a dispute (Take merchant action, timeline post, admin review)
router.put('/:id', async (req, res) => {
  try {
    if (global.MOCK_MODE) {
      const mockStore = require('../mockStore');
      const dispute = mockStore.findChargebackById(req.params.id);
      if (!dispute) return res.status(404).json({ message: 'Dispute not found' });
      const updates = req.body;
      if (updates.merchantAction !== undefined) dispute.merchantAction = updates.merchantAction;
      if (updates.acquirerAction !== undefined) dispute.acquirerAction = updates.acquirerAction;
      if (updates.mStatus !== undefined) dispute.mStatus = updates.mStatus;
      if (updates.mSubStatus !== undefined) dispute.mSubStatus = updates.mSubStatus;
      if (updates.rejectReason !== undefined) dispute.rejectReason = updates.rejectReason;
      if (updates.visaPending !== undefined) dispute.visaPending = updates.visaPending;
      if (updates.timelineEntry) {
        dispute.timeline = dispute.timeline || [];
        dispute.timeline.unshift(updates.timelineEntry);
      }
      const { save, toObject, ...rest } = dispute;
      return res.json({ ...rest });
    }

    const dispute = await Chargeback.findOne({ id: req.params.id });
    if (!dispute) {
      return res.status(404).json({ message: 'Dispute not found' });
    }

    // Apply any updates passed in body
    const updates = req.body;
    
    if (updates.merchantAction !== undefined) dispute.merchantAction = updates.merchantAction;
    if (updates.acquirerAction !== undefined) dispute.acquirerAction = updates.acquirerAction;
    if (updates.mStatus !== undefined) dispute.mStatus = updates.mStatus;
    if (updates.mSubStatus !== undefined) dispute.mSubStatus = updates.mSubStatus;
    if (updates.rejectReason !== undefined) dispute.rejectReason = updates.rejectReason;
    if (updates.visaPending !== undefined) dispute.visaPending = updates.visaPending;
    
    // If a timeline entry is provided in updates, push it to timeline array
    if (updates.timelineEntry) {
      dispute.timeline.unshift(updates.timelineEntry); // Prepend to show newest first
    }

    const updated = await dispute.save();
    res.json(updated);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});
// Process dispute action (accept, contest, escalate)
router.post('/:id/action', async (req, res) => {
  try {
    const { action, evidence, comments } = req.body;
    let dispute;
    if (global.MOCK_MODE) {
      const mockStore = require('../mockStore');
      dispute = mockStore.findChargebackById(req.params.id);
    } else {
      dispute = await Chargeback.findOne({ id: req.params.id });
    }
    if (!dispute) return res.status(404).json({ message: 'Dispute not found' });

    const user = req.headers['x-user-name'] || 'System';
    const role = req.headers['x-user-role'] || 'System';
    const prevStatus = dispute.mStatus;
    const prevSubStatus = dispute.mSubStatus;

    // Determine uploader role string
    let uploaderRole = 'Merchant';
    if (role === 'admin') {
      uploaderRole = 'Admin';
    }

    if (action === 'accept') {
      dispute.resolution = 'Lost';
      dispute.mSubStatus = dispute.mStatus.includes('Arbitration') ? 'Arbitration Lost' : 'Chargeback Lost';
      dispute.merchantAction = 'accepted';
      
      const remarks = `User: ${user} | Role: ${role} | Action: Accepted Liability | Prev Status: ${prevStatus}/${prevSubStatus} | New Status: ${dispute.mStatus}/${dispute.mSubStatus}`;
      dispute.timeline.unshift({ by: user, time: new Date().toISOString(), title: 'Accepted Liability', remarks, file: null });
    } else if (action === 'accept_partially') {
      dispute.resolution = 'Partially Accepted';
      dispute.mSubStatus = dispute.mStatus.includes('Arbitration') ? 'Arbitration Lost' : 'Chargeback Lost';
      dispute.merchantAction = 'accepted_partially';
      dispute.acceptedAmount = req.body.acceptedAmount || 0;
      
      let fileString = null;
      if (evidence) {
        if (!dispute.documents) dispute.documents = [];
        dispute.documents.push({
          id: 'doc_' + Date.now(),
          filename: evidence,
          uploadedAt: new Date().toISOString(),
          status: 'Pending Review',
          uploadedBy: uploaderRole
        });
        fileString = evidence;
      }
      
      const remarks = `User: ${user} | Role: ${role} | Action: Accepted Partial Liability | Amount: ${dispute.acceptedAmount} | Prev Status: ${prevStatus}/${prevSubStatus} | New Status: ${dispute.mStatus}/${dispute.mSubStatus} | Comments: ${comments || 'None'}`;
      dispute.timeline.unshift({ by: user, time: new Date().toISOString(), title: 'Partially Accepted Liability', remarks, file: fileString });
    } else if (action === 'admin_request_info') {
      const { rejectedDocs } = req.body;
      dispute.mSubStatus = 'Chargeback Resubmit';
      dispute.acquirerAction = 'request_info';
      dispute.merchantAction = 'rejected';
      dispute.rejectReason = comments;
      
      let rejectedDocsString = 'None';
      if (Array.isArray(rejectedDocs)) {
        rejectedDocs.forEach(rdoc => {
          const doc = dispute.documents.find(d => d.id === rdoc.id);
          if (doc) {
            doc.status = 'Rejected';
            doc.rejectionRemarks = rdoc.remarks;
            doc.rejectedAt = new Date().toISOString();
          }
        });
        rejectedDocsString = rejectedDocs.map(d => d.id).join(', ');
      }

      const remarks = `User: ${user} | Role: ${role} | Action: Request Info | Prev Status: ${prevStatus}/${prevSubStatus} | New Status: ${dispute.mStatus}/${dispute.mSubStatus} | Rejected Docs: ${rejectedDocsString} | Comments: ${comments || 'None'}`;
      dispute.timeline.unshift({ by: user, time: new Date().toISOString(), title: 'Documents Rejected / More Info Requested', remarks, file: null });
    } else if (action === 'contest') {
      dispute.mSubStatus = 'Chargeback In Progress';
      if (dispute.acquirerAction === 'considered') {
        dispute.merchantAction = 'additional_evidence';
      } else {
        dispute.merchantAction = 'evidence';
      }
      dispute.acquirerAction = null;
      
      let fileString = null;
      if (!dispute.documents) dispute.documents = [];
      if (Array.isArray(evidence)) {
        evidence.forEach((filename, idx) => {
          dispute.documents.push({
            id: 'doc_' + Date.now() + '_' + idx,
            filename: filename,
            uploadedAt: new Date().toISOString(),
            status: 'Pending Review',
            uploadedBy: uploaderRole
          });
        });
        fileString = evidence.join(', ');
      } else if (evidence) {
        dispute.documents.push({
          id: 'doc_' + Date.now(),
          filename: evidence,
          uploadedAt: new Date().toISOString(),
          status: 'Pending Review',
          uploadedBy: uploaderRole
        });
        fileString = evidence;
      }
      
      const remarks = `User: ${user} | Role: ${role} | Action: Contest Dispute | Prev Status: ${prevStatus}/${prevSubStatus} | New Status: ${dispute.mStatus}/${dispute.mSubStatus} | Uploaded Docs: ${fileString || 'None'} | Remarks: ${comments || 'None'}`;
      dispute.timeline.unshift({ by: user, time: new Date().toISOString(), title: 'Evidence Submitted', remarks, file: fileString });
    } else if (action === 'escalate') {
      dispute.mStatus = 'Pre-Arbitration Raise';
      dispute.mSubStatus = 'Chargeback In Progress';
      
      const remarks = `User: ${user} | Role: ${role} | Action: Escalated to Pre-Arb | Prev Status: ${prevStatus}/${prevSubStatus} | New Status: ${dispute.mStatus}/${dispute.mSubStatus}`;
      dispute.timeline.unshift({ by: user, time: new Date().toISOString(), title: 'Escalated to Pre-Arb', remarks, file: null });
    } else if (action === 'visa_accept') {
      dispute.mSubStatus = 'Chargeback In Progress';
      dispute.acquirerAction = 'visa_accept';
      dispute.visaPending = true;
      
      const remarks = `User: ${user} | Role: ${role} | Action: Admin Accepted - Sent to Visa | Prev Status: ${prevStatus}/${prevSubStatus} | New Status: ${dispute.mStatus}/${dispute.mSubStatus}`;
      dispute.timeline.unshift({ by: user, time: new Date().toISOString(), title: 'Admin Accepted - Sent to Visa', remarks, file: null });
    } else if (action === 'visa_accept_partially') {
      dispute.mSubStatus = 'Chargeback In Progress';
      dispute.acquirerAction = 'visa_accept_partially';
      dispute.visaPending = true;
      dispute.acceptedAmount = req.body.acceptedAmount || 0;
      
      const remarks = `User: ${user} | Role: ${role} | Action: Admin Partially Accepted - Sent to Visa | Accepted Amt: ${dispute.acceptedAmount} | Prev Status: ${prevStatus}/${prevSubStatus} | New Status: ${dispute.mStatus}/${dispute.mSubStatus} | Comments: ${comments || 'None'}`;
      dispute.timeline.unshift({ by: user, time: new Date().toISOString(), title: 'Admin Partially Accepted - Sent to Visa', remarks, file: evidence || null });
    } else if (action === 'visa_review') {
      dispute.mSubStatus = 'Chargeback In Progress';
      dispute.acquirerAction = 'visa_review';
      dispute.visaPending = true;
      
      const remarks = `User: ${user} | Role: ${role} | Action: Sent to Visa for Review | Prev Status: ${prevStatus}/${prevSubStatus} | New Status: ${dispute.mStatus}/${dispute.mSubStatus}`;
      dispute.timeline.unshift({ by: user, time: new Date().toISOString(), title: 'Sent to Visa for Review', remarks, file: null });
    } else if (action === 'admin_upload_evidence') {
      dispute.mSubStatus = 'Chargeback Resubmit';
      dispute.acquirerAction = 'evidence_uploaded';
      dispute.merchantAction = 'pending_admin_review';
      
      let fileString = null;
      if (Array.isArray(evidence)) {
        evidence.forEach((filename, idx) => {
          dispute.documents.push({
            id: 'doc_' + Date.now() + '_' + idx,
            filename: filename,
            uploadedAt: new Date().toISOString(),
            status: 'Pending Review',
            uploadedBy: 'Admin'
          });
        });
        fileString = evidence.join(', ');
      } else if (evidence) {
        dispute.documents.push({
          id: 'doc_' + Date.now(),
          filename: evidence,
          uploadedAt: new Date().toISOString(),
          status: 'Pending Review',
          uploadedBy: 'Admin'
        });
        fileString = evidence;
      }
      
      const remarks = `User: ${user} | Role: ${role} | Action: Admin Uploaded Evidence | Prev Status: ${prevStatus}/${prevSubStatus} | New Status: ${dispute.mStatus}/${dispute.mSubStatus} | Uploaded Docs: ${fileString || 'None'} | Remarks: ${comments || 'None'}`;
      dispute.timeline.unshift({ by: user, time: new Date().toISOString(), title: 'Admin Evidence Uploaded', remarks, file: fileString });
    } else if (action === 'merchant_accept_admin') {
      dispute.mSubStatus = 'Chargeback In Progress';
      dispute.merchantAction = 'accepted_admin';
      dispute.acquirerAction = null; // Send back to admin for final Visa routing
      
      // Update all pending Admin docs to Accepted
      dispute.documents.forEach(doc => {
        if (doc.uploadedBy === 'Admin' && doc.status === 'Pending Review') {
          doc.status = 'Accepted';
        }
      });
      
      const remarks = `User: ${user} | Role: ${role} | Action: Merchant Accepted Admin Evidence | Prev Status: ${prevStatus}/${prevSubStatus} | New Status: ${dispute.mStatus}/${dispute.mSubStatus}`;
      dispute.timeline.unshift({ by: user, time: new Date().toISOString(), title: 'Merchant Accepted Admin Evidence', remarks, file: null });
    } else if (action === 'merchant_reject_admin') {
      dispute.mSubStatus = 'Chargeback In Progress';
      dispute.merchantAction = 'rejected_admin';
      dispute.acquirerAction = null;
      
      const { rejectedDocs, evidence } = req.body;
      let rejectedDocsString = 'None';
      if (Array.isArray(rejectedDocs)) {
        rejectedDocs.forEach(rdoc => {
          const doc = dispute.documents.find(d => d.id === rdoc.id && d.uploadedBy === 'Admin');
          if (doc) {
            doc.status = 'Rejected';
            doc.rejectionRemarks = rdoc.remarks;
            doc.rejectedAt = new Date().toISOString();
          }
        });
        rejectedDocsString = rejectedDocs.map(d => d.id).join(', ');
      }

      let fileString = null;
      if (Array.isArray(evidence)) {
        evidence.forEach((filename, idx) => {
          dispute.documents.push({
            id: 'doc_' + Date.now() + '_' + idx,
            filename: filename,
            uploadedAt: new Date().toISOString(),
            status: 'Pending Review',
            uploadedBy: uploaderRole
          });
        });
        fileString = evidence.join(', ');
      } else if (evidence) {
        dispute.documents.push({
          id: 'doc_' + Date.now(),
          filename: evidence,
          uploadedAt: new Date().toISOString(),
          status: 'Pending Review',
          uploadedBy: uploaderRole
        });
        fileString = evidence;
      }
      
      const remarks = `User: ${user} | Role: ${role} | Action: Merchant Rejected Admin Evidence | Prev Status: ${prevStatus}/${prevSubStatus} | New Status: ${dispute.mStatus}/${dispute.mSubStatus} | Rejected Docs: ${rejectedDocsString} | Uploaded Docs: ${fileString || 'None'} | Remarks: ${comments || 'None'}`;
      dispute.timeline.unshift({ by: user, time: new Date().toISOString(), title: 'Merchant Rejected Admin Evidence', remarks, file: fileString });
    } else if (action === 'comment') {
      const remarks = comments || '';
      dispute.timeline.unshift({ by: user, time: new Date().toISOString(), title: 'Comment Added', remarks, file: null });
    }


    const updated = await dispute.save();
    res.json(updated);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

module.exports = router;
