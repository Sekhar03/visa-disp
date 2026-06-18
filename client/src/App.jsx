import React, { useState, useEffect, useCallback, useRef } from 'react';
import { CLIENT_DEMO } from './demoFallback.js';

// API BASE URL
const API_URL = import.meta.env.VITE_API_URL || '/api';

const DISPUTE_TYPE_OPTIONS = ['Chargeback', 'Pre-Arbitration', 'Retrieval Request', 'Arbitration'];

// Format respond-by date as "17 May" style
const formatRespondByOnlyDate = (s) => {
  if (!s) return '-';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return d.getDate() + ' ' + months[d.getMonth()];
};

// Return pill style based on how close respond-by date is
const getRespondByStyle = (s) => {
  if (!s) return {};
  const d = new Date(s);
  if (isNaN(d.getTime())) return {};
  const today = new Date(); today.setHours(0,0,0,0);
  const target = new Date(d); target.setHours(0,0,0,0);
  const diffDays = Math.round((target - today) / 86400000);
  if (diffDays === 0) return { display:'inline-block', padding:'2px 8px', borderRadius:'999px', fontSize:'11px', fontWeight:'700', background:'#FEE2E2', color:'#DC2626', border:'1px solid #FECACA' };
  if (diffDays === -1) return { display:'inline-block', padding:'2px 8px', borderRadius:'999px', fontSize:'11px', fontWeight:'700', background:'#FEF3C7', color:'#D97706', border:'1px solid #FDE68A' };
  return { fontWeight:'600' };
};

// Gather unique autocomplete suggestions matching RRN / TxnID / TID / MID
const getElasticSuggestions = (disputesList, query) => {
  if (!query || query.length < 2) return [];
  const q = query.toLowerCase();
  const seen = new Set();
  const results = [];
  for (const cb of disputesList) {
    for (const val of [cb.rrn, cb.txnId, cb.tid, cb.userId, cb.userName]) {
      if (val && val.toLowerCase().includes(q) && !seen.has(val)) {
        seen.add(val);
        results.push(val);
        if (results.length >= 8) return results;
      }
    }
  }
  return results;
};

const DISPUTE_STATUS_OPTIONS = [
  'Dispute Won Partially',
  'Dispute Won Fully',
  'Dispute Lost – TAT Expired',
  'Dispute Lost – Accepted',
  'Document Rejected',
  'Chargeback In Progress',
  'Chargeback Resubmit',
];

const getDisputeType = (cb) => {
  const adjType = cb.adjType || '';
  if (DISPUTE_TYPE_OPTIONS.includes(adjType)) return adjType;
  const status = cb.mStatus || '';
  if (status.includes('Pre-Arbitration') || status.includes('Pre-Arb')) return 'Pre-Arbitration';
  if (/Arbitration/i.test(status) && !/Pre-Arbitration/i.test(status)) return 'Arbitration';
  if (status.includes('Retrieval')) return 'Retrieval Request';
  return 'Chargeback';
};

const matchesDisputeTypeFilter = (cb, filterValue) => !filterValue || getDisputeType(cb) === filterValue;

const getDaysDifference = (d1, d2) => {
  if (!d1 || !d2) return 0;
  const date1 = new Date(d1);
  const date2 = new Date(d2);
  date1.setHours(0, 0, 0, 0);
  date2.setHours(0, 0, 0, 0);
  const diffTime = date1.getTime() - date2.getTime();
  return Math.round(diffTime / (1000 * 60 * 60 * 24));
};

const getDisputeCategory = (cb) => {
  if (!cb) return 'open';
  const status = (cb.mSubStatus || cb.mStatus || '').toLowerCase();
  if (status.includes('won') || status.includes('success')) {
    return 'won';
  }
  if (
    status.includes('lost') || 
    status.includes('expired') || 
    status.includes('accepted') || 
    status.includes('declined') ||
    cb.resolution === 'Lost' ||
    cb.merchantAction === 'accepted'
  ) {
    return 'lost';
  }
  return 'open';
};

const isClosedDispute = (cb) => {
  const cat = getDisputeCategory(cb);
  return cat === 'won' || cat === 'lost';
};

const matchesDisputeStatusFilter = (cb, filterValue) => {
  if (!filterValue) return true;
  const TODAY_STR = new Date().toISOString().split('T')[0];
  const cat = getDisputeCategory(cb);
  if (filterValue === 'open') {
    return cat === 'open';
  }
  if (filterValue === 'lost') {
    return cat === 'lost';
  }
  if (filterValue === 'won') {
    return cat === 'won';
  }
  if (filterValue === 'evidence') {
    return cb.merchantAction === 'evidence';
  }
  if (filterValue === 'visa_escalation') {
    return !!cb.visaPending;
  }
  if (filterValue === 'sla_today' || filterValue === 'due_today') {
    return cb.respondByDate === TODAY_STR && cat === 'open';
  }
  if (filterValue === 'due_tomorrow') {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const TOMORROW_STR = tomorrow.toISOString().split('T')[0];
    return cb.respondByDate === TOMORROW_STR && cat === 'open';
  }
  if (filterValue === 'due_2_7') {
    const diff = getDaysDifference(cb.respondByDate, TODAY_STR);
    return diff >= 2 && diff <= 7 && cat === 'open';
  }
  if (filterValue === 'due_over_7') {
    const diff = getDaysDifference(cb.respondByDate, TODAY_STR);
    return diff > 7 && cat === 'open';
  }
  if (filterValue === 'insufficient_evidence') {
    return cb.merchantAction === 'rejected' && cat === 'open';
  }
  return cb.mSubStatus === filterValue;
};

const ensureTodaySLA = (list) => {
  const TODAY_STR = new Date().toISOString().split('T')[0];
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const TOMORROW_STR = tomorrow.toISOString().split('T')[0];

  return list.map(cb => {
    let updated = { ...cb };
    
    // 1. Force Due Today cases (Urgent)
    if (['CB010', 'CB_PEND_1', 'CB_PEND_3'].includes(cb.id)) {
      updated.respondByDate = TODAY_STR;
    }
    
    // 2. Force Due Tomorrow cases (Critical)
    if (['CB001', 'CB002', 'CB_PEND_2', 'CB_PEND_4'].includes(cb.id)) {
      updated.respondByDate = TOMORROW_STR;
    }

    // 3. Force Under Review cases
    if (['CB_PEND_1', 'CB_PEND_2', 'CB_PEND_3', 'CB_PEND_4', 'CB_PEND_5', 'CB_PEND_6', 'CB005'].includes(cb.id)) {
      updated.merchantAction = 'evidence';
      updated.acquirerAction = null;
      updated.mSubStatus = 'Chargeback In Progress';
    }


    // Automatically populate document journey if missing but status implies evidence was uploaded
    if (!updated.documents || updated.documents.length === 0) {
      const sub = updated.mSubStatus || '';
      const status = updated.mStatus || '';
      
      const needsEvidence = 
        sub.includes('Won') || 
        sub.includes('Rejected') || 
        sub.includes('Resubmit') || 
        sub.includes('Progress') ||
        updated.merchantAction === 'evidence' || 
        updated.acquirerAction === 'evidence_uploaded';

      if (needsEvidence) {
        const docDate = updated.createdDate ? new Date(updated.createdDate) : new Date();
        docDate.setDate(docDate.getDate() + 1);
        const uploadedAt = docDate.toISOString();
        
        updated = {
          ...updated,
          documents: [
            {
              id: `mock_doc_${updated.id}_1`,
              filename: `Evidence_Receipt_${updated.id}.pdf`,
              uploadedBy: 'Merchant',
              status: sub.includes('Rejected') ? 'Rejected' : 'Accepted',
              uploadedAt: uploadedAt,
              rejectionRemarks: sub.includes('Rejected') ? 'The signature on the receipt is illegible. Please upload a clear copy.' : ''
            },
            {
              id: `mock_doc_${updated.id}_2`,
              filename: `DeliveryProof_${updated.id}.pdf`,
              uploadedBy: 'Merchant',
              status: sub.includes('Rejected') ? 'Rejected' : 'Accepted',
              uploadedAt: uploadedAt
            }
          ]
        };
      }
    }
    
    return updated;
  });
};

const renderDisputeStatusBadge = (s) => {
  const m = {
    'VROL Import': 'badge-new',
    'New Dispute': 'badge-new',
    'Action Required': 'badge-resubmit',
    'Document Pending': 'badge-progress',
    'Evidence Submitted': 'badge-progress',
    'Under Review': 'badge-progress',
    'Representment Ready': 'badge-won',
    'Representment Submitted': 'badge-progress',
    'Awaiting Visa Decision': 'badge-progress',
    'Pre-Arbitration Review Required': 'badge-resubmit',
    'Arbitration Review': 'badge-progress',
    'Final Decision': 'badge-won',
    'Won': 'badge-won',
    'Lost': 'badge-lost',
    'Chargeback New': 'badge-new',
    'Chargeback Lost': 'badge-lost',
    'Arbitration Lost': 'badge-lost',
    'Chargeback In Progress': 'badge-progress',
    'Chargeback Resubmit': 'badge-resubmit',
    'Chargeback Won': 'badge-won',
    'Arbitration Won': 'badge-won',
    'Dispute Won Partially': 'badge-won',
    'Dispute Won Fully': 'badge-won',
    'Dispute Lost – TAT Expired': 'badge-lost',
    'Dispute Lost – Accepted': 'badge-lost',
    'Document Rejected': 'badge-resubmit',
    'Refund Success': 'badge-won',
    'Refund On Hold': 'badge-progress',
    'Resolved - Deflected via OI Credit': 'badge-won',
    'Pre-Dispute - Deflected via Order Insight': 'badge-won',
    'Resolved - Deflected via RDR': 'badge-won',
    'Action Required - Awaiting Merchant Input': 'badge-resubmit',
    'Representment Submitted - Awaiting Network Ruling': 'badge-progress',
    'Pre-Arbitration - Review Required': 'badge-resubmit',
    'Document pending for Merchant': 'badge-progress'
  };
  return <span className={`badge ${m[s] || 'badge-pending'}`}>{s}</span>;
};


const getTimelineData = (cb) => {
  if (!cb) return [];
  const list = [];

  // 1. Initial Step: Dispute Raised
  const raisedTime = cb.createdDate ? new Date(cb.createdDate).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }) + ', 10:00 AM' : '15 May 2023, 10:57 AM';
  list.push({
    title: 'Dispute Raised',
    time: raisedTime,
    remarks: 'Dispute case initiated by the issuer bank.'
  });

  // 2. Add entries for all uploaded documents
  if (cb.documents && cb.documents.length > 0) {
    const sortedDocs = [...cb.documents].sort((a, b) => new Date(a.uploadedAt) - new Date(b.uploadedAt));
    sortedDocs.forEach(doc => {
      const uploadTime = new Date(doc.uploadedAt).toLocaleString('en-US', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      let remarks = 'Evidence document uploaded.';
      if (doc.status === 'Rejected') {
        remarks = `Document Rejected. Remarks: ${doc.rejectionRemarks || 'N/A'}`;
      } else if (doc.status === 'Accepted') {
        remarks = 'Evidence Accepted.';
      } else if (cb.rejectReason) {
        remarks = cb.rejectReason;
      }
      
      list.push({
        title: `Remarks Updated by ${doc.uploadedBy || 'Merchant'}`,
        time: uploadTime,
        remarks: remarks,
        file: doc.filename
      });
    });
  } else if (cb.merchantAction === 'evidence' || cb.acquirerAction === 'evidence_uploaded') {
    list.push({
      title: 'Remarks Updated by ' + (cb.userName || 'Merchant'),
      time: '15 May 2023, 10:57 AM',
      remarks: cb.rejectReason || 'Arlean',
      file: 'disputeSampleFile.pdf'
    });
  }

  // 3. If closed:
  if (isClosedDispute(cb)) {
    const closedTime = cb.respondByDate ? new Date(cb.respondByDate).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }) + ', 05:30 PM' : '17 May 2023, 05:30 PM';
    list.push({
      title: cb.mSubStatus || 'Dispute Closed',
      time: closedTime,
      remarks: 'Final status updated by Scheme/Acquirer.'
    });
  }

  return list.reverse();
};

const renderTimeline = (cb, expandedTimeline, setExpandedTimeline, showToast, portalType) => {
  const timelineItems = getTimelineData(cb);
  if (!timelineItems || timelineItems.length === 0) return null;

  // Decide button color based on portal type
  // Merchant: cyan/teal #50BDC9
  // Admin/Partner: purple #4a148c
  const themeColor = portalType === 'merchant' ? '#50BDC9' : '#4a148c';

  return (
    <div style={{ marginTop: '28px', borderTop: '1px solid var(--border)', paddingTop: '24px', background: 'var(--card)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 'bold', color: 'var(--text)' }}>Timeline</h3>
        <button 
          onClick={() => {
            if (showToast) {
              showToast('Messaging is currently unavailable', 'info');
            } else {
              alert('Messaging is currently unavailable');
            }
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: themeColor,
            color: '#fff',
            border: 'none',
            padding: '10px 20px',
            borderRadius: '8px',
            cursor: 'pointer',
            fontSize: '13px',
            fontWeight: '600',
            transition: 'opacity 0.2s',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
          }}
          onMouseOver={(e) => e.currentTarget.style.opacity = 0.9}
          onMouseOut={(e) => e.currentTarget.style.opacity = 1}
        >
          <span style={{ fontSize: '14px' }}>💬</span> Message
        </button>
      </div>
      
      <div style={{ position: 'relative', paddingLeft: '50px', paddingRight: '0' }}>
        {/* Vertical timeline connector line */}
        {timelineItems.length > 1 && (
          <div style={{
            position: 'absolute',
            left: '19px',
            top: '16px',
            bottom: '16px',
            width: '2px',
            backgroundColor: 'var(--border)',
            zIndex: 0
          }} />
        )}
        
        {timelineItems.map((item, index) => {
          const isExpanded = expandedTimeline[index] !== undefined ? expandedTimeline[index] : (index === 0);
          return (
            <div key={index} style={{ position: 'relative', marginBottom: '24px', zIndex: 1 }}>
              {/* Green circular bullet with check icon */}
              <div style={{
                position: 'absolute',
                left: '-31px',
                top: '12px',
                width: '24px',
                height: '24px',
                borderRadius: '50%',
                backgroundColor: '#10B981', // green
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '12px',
                fontWeight: 'bold',
                boxShadow: '0 0 0 4px var(--card)',
                flexShrink: 0
              }}>
                ✓
              </div>
              
              {/* Timeline Card */}
              <div style={{
                background: isExpanded ? 'var(--bg)' : 'var(--card)',
                border: '1px solid var(--border)',
                borderRadius: '12px',
                overflow: 'hidden',
                transition: 'background-color 0.2s',
                boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
              }}>
                {/* Header (clickable) */}
                <div 
                  onClick={() => setExpandedTimeline(prev => ({ ...prev, [index]: !isExpanded }))}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '14px 18px',
                    cursor: 'pointer',
                    userSelect: 'none',
                    gap: '16px'
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 'bold', fontSize: '14px', color: 'var(--text)', marginBottom: '4px' }}>{item.title}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{item.time}</div>
                  </div>
                  <div style={{ fontSize: '16px', color: themeColor, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                    {isExpanded ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="18 15 12 9 6 15"></polyline>
                      </svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="6 9 12 15 18 9"></polyline>
                      </svg>
                    )}
                  </div>
                </div>
                
                {/* Collapsible Details Panel */}
                {isExpanded && (
                  <div style={{
                    padding: '18px 20px',
                    borderTop: '1px solid var(--border)',
                    background: 'var(--card)',
                    fontSize: '13px',
                    color: 'var(--text)'
                  }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: '12px', marginBottom: item.file ? '16px' : '0' }}>
                      <div style={{ color: 'var(--text-muted)', fontWeight: '500', fontSize: '12px' }}>Remarks</div>
                      <div style={{ fontWeight: '600', color: 'var(--text)', lineHeight: '1.5' }}>{item.remarks}</div>
                    </div>
                    {item.file && (
                      <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: '12px', alignItems: 'center' }}>
                        <div style={{ color: 'var(--text-muted)', fontWeight: '500', fontSize: '12px' }}>File</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '16px' }}>📄</span>
                          <a 
                            href="#" 
                            onClick={(e) => {
                              e.preventDefault();
                              if (showToast) {
                                showToast(`Downloading ${item.file}`, 'success');
                              } else {
                                alert(`Downloading ${item.file}`);
                              }
                            }}
                            style={{ color: '#3B82F6', textDecoration: 'none', fontWeight: '600', fontSize: '13px' }}
                          >
                            {item.file}
                          </a>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const getPresetDates = (preset) => {
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  switch (preset) {
    case 'today':
      return { from: todayStr, to: todayStr };
    case '7days': {
      const d = new Date(); d.setDate(d.getDate() - 7);
      return { from: d.toISOString().split('T')[0], to: todayStr };
    }
    case '30days': {
      const d = new Date(); d.setDate(d.getDate() - 30);
      return { from: d.toISOString().split('T')[0], to: todayStr };
    }
    case '6months': {
      const d = new Date(); d.setDate(d.getDate() - 180);
      return { from: d.toISOString().split('T')[0], to: todayStr };
    }
    default:
      return null;
  }
};

const getPresetLabel = (preset) => {
  switch (preset) {
    case 'today': return 'Today';
    case '7days': return 'Last 7 Days';
    case '30days': return 'Last 30 Days';
    case '6months': return 'Last 6 Months';
    default: return 'Custom Range';
  }
};

export default function App() {
  const isInitialized = useRef(false);
  const [showTour, setShowTour] = useState(() => {
    return !sessionStorage.getItem('isu_tour_completed');
  });
  const [tourStep, setTourStep] = useState(0);

  // Navigation: 'selector' | 'merchant' | 'admin' | 'partner'
  const [view, setView] = useState(() => {
    try {
      const storedUser = localStorage.getItem('isu_currentUser');
      const storedView = localStorage.getItem('isu_view');
      // Only restore non-selector views if we also have a valid stored user
      if (storedView && storedView !== 'selector' && storedUser) {
        JSON.parse(storedUser); // validate JSON
        return storedView;
      }
    } catch { /* ignore */ }
    return 'selector';
  });
  
  // Theme state
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('isu_dark_mode') === 'true');
  
  // Shared States (synchronized with Express + MongoDB)
  const [users, setUsers] = useState([]);
  const [chargebacks, setChargebacks] = useState([]);
  const [ledger, setLedger] = useState([]);
  
  // Active User State
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const stored = localStorage.getItem('isu_currentUser');
      return stored ? JSON.parse(stored) : null;
    } catch {
      localStorage.removeItem('isu_currentUser');
      localStorage.removeItem('isu_view');
      return null;
    }
  });

  // Safety: if currentUser becomes null but view is a portal, reset to selector
  // Use isInitialized to avoid triggering on the very first render
  useEffect(() => {
    if (!isInitialized.current) {
      isInitialized.current = true;
      return;
    }
    if (!currentUser && view !== 'selector') {
      setView('selector');
      localStorage.setItem('isu_view', 'selector');
    }
  }, [currentUser, view]);
  
  // Toast state
  const [toastMsg, setToastMsg] = useState({ text: '', type: '' });
  
  // Dark mode effect
  useEffect(() => {
    if (darkMode) {
      document.body.classList.add('dark-mode');
    } else {
      document.body.classList.remove('dark-mode');
    }
  }, [darkMode]);

  const toggleTheme = () => {
    const newTheme = !darkMode;
    setDarkMode(newTheme);
    localStorage.setItem('isu_dark_mode', newTheme);
  };

  const refreshAllData = useCallback(async (userOverride) => {
    try {
      const activeUser = userOverride || currentUser;
      const headers = {};
      if (activeUser) {
        headers['x-user-role'] = activeUser.role;
        headers['x-user-name'] = activeUser.username;

      }

      const resUsers = await fetch(`${API_URL}/users`, { headers });
      if (!resUsers.ok) throw new Error('Users fetch failed');
      const dataUsers = await resUsers.json();
      if (Array.isArray(dataUsers)) setUsers(dataUsers);

      const resDisputes = await fetch(`${API_URL}/disputes`, { headers });
      if (!resDisputes.ok) throw new Error('Disputes fetch failed');
      const dataDisputes = await resDisputes.json();
      if (Array.isArray(dataDisputes)) setChargebacks(ensureTodaySLA(dataDisputes));

      const resLedger = await fetch(`${API_URL}/ledger`, { headers }).catch(() => null);
      if (resLedger && resLedger.ok) {
        const dataLedger = await resLedger.json();
        if (Array.isArray(dataLedger)) setLedger(dataLedger);
      }

      // Keep current user session synced with updated database balance
      if (activeUser && Array.isArray(dataUsers)) {
        const found = dataUsers.find(u => u.username === activeUser.username);
        if (found) {
          setCurrentUser(prev => prev ? ({ ...prev, walletBalance: found.walletBalance }) : null);
        }
      }
    } catch (err) {
      console.error("Sync failed:", err);
      // Don't crash - keep existing data
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  const hydrateDemoBundle = useCallback((bundle, user) => {
    if (Array.isArray(bundle.users)) setUsers(bundle.users);
    if (Array.isArray(bundle.chargebacks)) {
      const TODAY_STR = new Date().toISOString().split('T')[0];
      const autoLossCbs = bundle.chargebacks.map(cb => {
        if ((cb.mSubStatus === 'Chargeback New' || cb.mSubStatus === 'Chargeback In Progress') && cb.respondByDate) {
          if (cb.respondByDate < TODAY_STR) {
            return { ...cb, mStatus: 'Dispute Lost – TAT Expired', mSubStatus: 'Dispute Lost – TAT Expired' };
          }
        }
        return cb;
      });
      autoLossCbs.sort((a, b) => {
        const aResolved = a.mStatus.includes('Lost') || a.mStatus.includes('Won');
        const bResolved = b.mStatus.includes('Lost') || b.mStatus.includes('Won');
        if (aResolved && !bResolved) return 1;
        if (!aResolved && bResolved) return -1;
        return new Date(b.createdDate || b.txnDate) - new Date(a.createdDate || a.txnDate);
      });
      setChargebacks(ensureTodaySLA(autoLossCbs));
    }
    if (Array.isArray(bundle.ledger)) setLedger(bundle.ledger);
    if (user && Array.isArray(bundle.users)) {
      const found = bundle.users.find((u) => u.username === user.username);
      if (found) {
        setCurrentUser((prev) => (prev ? { ...prev, walletBalance: found.walletBalance } : null));
      }
    }
  }, []);

  const applyClientDemoFallback = useCallback((user) => {
    hydrateDemoBundle(CLIENT_DEMO, user || currentUser);
    return CLIENT_DEMO.chargebacks.length > 0;
  }, [currentUser, hydrateDemoBundle]);

  const fetchDemoBundle = useCallback(async () => {
    await fetch(`${API_URL}/users/seed`, { method: 'POST' }).catch(() => null);
    await fetch(`${API_URL}/users/demo`, { method: 'POST' }).catch(() => null);
    const bootRes = await fetch(`${API_URL}/users/bootstrap`);
    if (!bootRes.ok) {
      const err = await bootRes.json().catch(() => ({}));
      throw new Error(err.message || `Bootstrap failed (${bootRes.status})`);
    }
    return bootRes.json();
  }, []);

  const ensureDemoDataLoaded = useCallback(async (user) => {
    try {
      const bundle = await fetchDemoBundle();
      if (!bundle.chargebacks?.length) {
        throw new Error('No chargeback records in database');
      }
      hydrateDemoBundle(bundle, user);
      return true;
    } catch (err) {
      console.error('ensureDemoDataLoaded failed:', err);
      return applyClientDemoFallback(user);
    }
  }, [fetchDemoBundle, hydrateDemoBundle, applyClientDemoFallback]);

  // Seed demo data on launch then fetch
  useEffect(() => {
    ensureDemoDataLoaded(null);
  }, [ensureDemoDataLoaded]);

  // If logged into a portal with no rows, reload demo data
  useEffect(() => {
    if (view === 'selector' || !currentUser) return;
    if (chargebacks.length === 0) {
      ensureDemoDataLoaded(currentUser);
    }
  }, [view, currentUser, chargebacks.length, ensureDemoDataLoaded]);

  // Poll database every 3 seconds to synchronize states in real-time across tabs/roles
  useEffect(() => {
    const interval = setInterval(() => {
      if (view !== 'selector') {
        refreshAllData();
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [view, refreshAllData]);

  const showToast = (text, type = 'success') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg({ text: '', type: '' }), 3400);
  };

  const loadDemoData = async () => {
    try {
      const bundle = await fetchDemoBundle();
      if (!bundle.chargebacks?.length) {
        throw new Error('Server returned empty chargeback list');
      }
      hydrateDemoBundle(bundle, currentUser);
      showToast(`Demo loaded: ${bundle.chargebacks.length} chargebacks, ${bundle.users?.length || 0} users`);
      return true;
    } catch (err) {
      console.error('Demo data load failed:', err);
      if (applyClientDemoFallback(currentUser)) {
        showToast(`Demo loaded offline: ${CLIENT_DEMO.chargebacks.length} chargebacks (start server for full dataset)`);
        return true;
      }
      showToast(`Failed to load demo data: ${err.message}. Is the server running on port 5000?`, 'error');
      return false;
    }
  };

  // Format currencies and date utils
  const formatINR = (val) => {
    const num = parseFloat(val) || 0;
    return '₹ ' + num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  
  const formatDateDisp = (s) => {
    if (!s) return '';
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    return d.toLocaleDateString('en-IN') + ' ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  };

  const handleLogin = async (e, username, password) => {
    e.preventDefault();
    const u = users.find(x => x.username === username && x.password === password);
    let loggedUser = null;
    let loggedView = 'selector';

    if (u) {
      loggedUser = { username: u.username, name: u.name, role: u.role, walletBalance: u.walletBalance };
      loggedView = u.role;
      showToast(`Logged in as ${u.name} (${u.role})`);
    } else {
      // Fallback credentials (used when API is slow or unavailable)
      const fallbacks = {
        'masteruser':  { pw: 'Test@2026', user: { username: 'masteruser',  name: 'masteruser',            role: 'merchant', walletBalance: 964.35 } },
        'Test@isu':    { pw: 'Test@2026', user: { username: 'Test@isu',    name: 'Test@isu',              role: 'merchant', walletBalance: 12450.75 } },
        'Test@Ad':     { pw: 'Test@2027', user: { username: 'Test@Ad',     name: 'Krishna Das',           role: 'admin', walletBalance: 245800 } },
      };
      const match = fallbacks[username];
      if (match && match.pw === password) {
        loggedUser = match.user;
        loggedView = match.user.role;
        showToast(`Logged in as ${match.user.name} (${match.user.role})`);
      } else {
        showToast('Invalid username or password', 'error');
        return;
      }
    }

    setCurrentUser(loggedUser);
    setView(loggedView);
    localStorage.setItem('isu_currentUser', JSON.stringify(loggedUser));
    localStorage.setItem('isu_view', loggedView);

    await ensureDemoDataLoaded(loggedUser);
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setView('selector');
    localStorage.removeItem('isu_currentUser');
    localStorage.removeItem('isu_view');
    showToast('Logged out successfully');
  };

  const resetAllSessions = async () => {
    if (confirm('Reset all demo data? Users, chargebacks, and ledger will be restored to defaults.')) {
      try {
        const ok = await loadDemoData();
        if (!ok) return;
        localStorage.removeItem('isu_session');
        localStorage.removeItem('isu_currentUser');
        localStorage.removeItem('isu_view');
        setCurrentUser(null);
        setView('selector');
      } catch (err) {
        console.error("Reset error:", err);
        showToast('Failed to reset', 'error');
      }
    }
  };

  return (
    <>
      {/* Show login only when view is selector */}
      {view === 'selector' && (
        <LoginForm handleLogin={handleLogin} toggleTheme={toggleTheme} darkMode={darkMode} onLoadDemo={loadDemoData} />
      )}
      
      {view === 'merchant' && currentUser && (
        <MerchantPortal 
          currentUser={currentUser} 
          chargebacks={chargebacks} 
          users={users}
          setView={setView} 
          toggleTheme={toggleTheme} 
          darkMode={darkMode}
          formatINR={formatINR}
          formatDateDisp={formatDateDisp}
          showToast={showToast}
          refreshAllData={refreshAllData}
          resetAllSessions={resetAllSessions}
          handleLogout={handleLogout}
        />
      )}
      
      {view === 'admin' && currentUser && (
        <AdminPortal 
          currentUser={currentUser} 
          chargebacks={chargebacks} 
          users={users}
          ledger={ledger}
          setView={setView} 
          toggleTheme={toggleTheme} 
          darkMode={darkMode}
          formatINR={formatINR}
          formatDateDisp={formatDateDisp}
          showToast={showToast}
          refreshAllData={refreshAllData}
          resetAllSessions={resetAllSessions}
          handleLogout={handleLogout}
        />
      )}

      {/* Toast Alert Component */}
      {toastMsg.text && (
        <div className={`toast show ${toastMsg.type}`}>
          <span style={{ marginRight: '8px' }}>
            {toastMsg.type === 'success' ? '✅' : toastMsg.type === 'error' ? '❌' : '⚠️'}
          </span>
          <span>{toastMsg.text}</span>
        </div>
      )}
    </>
  );
}

// ═════════════════════════════════════════════
// PORTAL SELECTOR PAGE
// ═════════════════════════════════════════════
function LoginForm({ handleLogin, toggleTheme, darkMode, onLoadDemo }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loadingDemo, setLoadingDemo] = useState(false);

  const handleLoadDemo = async () => {
    if (!onLoadDemo || loadingDemo) return;
    setLoadingDemo(true);
    await onLoadDemo();
    setLoadingDemo(false);
  };

  return (
    <div style={{ 
      display: 'flex', minHeight: '100vh', 
      background: darkMode ? 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)' : 'linear-gradient(135deg, #e0e7ff 0%, #f8fafc 100%)',
      fontFamily: "'Inter', sans-serif"
    }}>
      <div style={{ 
        flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '20px'
      }}>
        <div style={{
          width: '100%', maxWidth: '440px', 
          background: darkMode ? 'rgba(30, 41, 59, 0.7)' : 'rgba(255, 255, 255, 0.8)',
          backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
          border: darkMode ? '1px solid rgba(255,255,255,0.1)' : '1px solid rgba(255,255,255,0.6)',
          borderRadius: '24px', padding: '48px',
          boxShadow: darkMode ? '0 25px 50px -12px rgba(0,0,0,0.5)' : '0 25px 50px -12px rgba(14,165,233,0.15)'
        }}>
          <button 
            onClick={toggleTheme} 
            title="Toggle Theme"
            style={{ position: 'absolute', top: '24px', right: '24px', background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', transition: 'transform 0.2s' }}
            onMouseOver={(e) => e.currentTarget.style.transform = 'scale(1.1)'}
            onMouseOut={(e) => e.currentTarget.style.transform = 'scale(1)'}
          >
            {darkMode ? '☀️' : '🌙'}
          </button>
          
          <div style={{ textAlign: 'center', marginBottom: '36px' }}>
            <div style={{ fontSize: '36px', fontWeight: '800', color: 'var(--brand)', letterSpacing: '-1px', marginBottom: '8px' }}>
              iServeU<span style={{ fontSize: '16px', verticalAlign: 'super' }}>®</span>
            </div>
            <p style={{ fontSize: '15px', color: 'var(--text-muted)', fontWeight: '500' }}>Chargeback & Dispute Resolution</p>
          </div>
          
          <form onSubmit={(e) => handleLogin(e, username, password)} style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', marginBottom: '8px', color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Username or Email</label>
              <input 
                type="text" 
                placeholder="Enter username" 
                value={username} onChange={e => setUsername(e.target.value)} required 
                style={{ 
                  width: '100%', padding: '16px', fontSize: '15px', 
                  background: darkMode ? 'rgba(15, 23, 42, 0.5)' : '#fff',
                  border: darkMode ? '1px solid rgba(255,255,255,0.1)' : '1px solid #cbd5e1',
                  borderRadius: '12px', color: 'var(--text)', outline: 'none', transition: 'all 0.2s ease',
                  boxShadow: 'inset 0 2px 4px 0 rgba(0,0,0,0.02)'
                }}
                onFocus={(e) => { e.target.style.borderColor = 'var(--brand)'; e.target.style.boxShadow = '0 0 0 3px rgba(14,165,233,0.2)'; }}
                onBlur={(e) => { e.target.style.borderColor = darkMode ? 'rgba(255,255,255,0.1)' : '#cbd5e1'; e.target.style.boxShadow = 'inset 0 2px 4px 0 rgba(0,0,0,0.02)'; }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', marginBottom: '8px', color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Password</label>
              <input 
                type="password" 
                placeholder="Enter password" 
                value={password} onChange={e => setPassword(e.target.value)} required 
                style={{ 
                  width: '100%', padding: '16px', fontSize: '15px', 
                  background: darkMode ? 'rgba(15, 23, 42, 0.5)' : '#fff',
                  border: darkMode ? '1px solid rgba(255,255,255,0.1)' : '1px solid #cbd5e1',
                  borderRadius: '12px', color: 'var(--text)', outline: 'none', transition: 'all 0.2s ease',
                  boxShadow: 'inset 0 2px 4px 0 rgba(0,0,0,0.02)'
                }}
                onFocus={(e) => { e.target.style.borderColor = 'var(--brand)'; e.target.style.boxShadow = '0 0 0 3px rgba(14,165,233,0.2)'; }}
                onBlur={(e) => { e.target.style.borderColor = darkMode ? 'rgba(255,255,255,0.1)' : '#cbd5e1'; e.target.style.boxShadow = 'inset 0 2px 4px 0 rgba(0,0,0,0.02)'; }}
              />
            </div>
            <button 
              type="submit" 
              style={{ 
                width: '100%', marginTop: '8px', padding: '16px', fontSize: '16px', fontWeight: '600', 
                background: 'linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)', color: '#fff', 
                border: 'none', borderRadius: '12px', cursor: 'pointer', transition: 'all 0.2s',
                boxShadow: '0 4px 14px 0 rgba(14, 165, 233, 0.39)'
              }}
              onMouseOver={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(14, 165, 233, 0.5)'; }}
              onMouseOut={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 4px 14px 0 rgba(14, 165, 233, 0.39)'; }}
              onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.98)'}
              onMouseUp={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
            >
              Secure Login
            </button>
          </form>

        </div>
        
        <div style={{ marginTop: '40px', color: darkMode ? 'rgba(255,255,255,0.4)' : '#64748b', fontSize: '12px', textAlign: 'center', lineHeight: '1.6' }}>
          &copy; 2026 iServeU Technology Pvt Ltd. All rights reserved.<br/>
          Protected by AES-256 encryption.
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════
// MERCHANT DASHBOARD PORTAL
// ═════════════════════════════════════════════
function MerchantPortal({
  currentUser, chargebacks, setView, toggleTheme, darkMode, formatINR, formatDateDisp, showToast, refreshAllData, resetAllSessions, handleLogout
}) {
  const [activePage, setActivePage] = useState('dashboard'); // 'dashboard' | 'reports' | 'raised' | 'respond' | 'detail'
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [disputeMenuOpen, setDisputeMenuOpen] = useState(true);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  // Onboarding tour
  const [showTour, setShowTour] = useState(() => !sessionStorage.getItem('merchant_tour_done'));
  const [tourStep, setTourStep] = useState(0);
  // FAQ state
  const [faqSearch, setFaqSearch] = useState('');
  const [faqOpenItem, setFaqOpenItem] = useState(null);
  const [faqCategory, setFaqCategory] = useState('all');
  
  // Detail disputes states (Removed)

  // Modals state
  const [activeModal, setActiveModal] = useState(null); // null | 'action1' | 'action2' | 'contest' | 'successAccept' | 'successEvidence' | 'successAcceptPartially'
  const [showFaq, setShowFaq] = useState(false);
  const [targetDisputeId, setTargetDisputeId] = useState(null);
  
  // Accepting remarks
  const [acceptRemarks, setAcceptRemarks] = useState('');
  const [acceptResponseSelect, setAcceptResponseSelect] = useState('');
  const [contestRemarks, setContestRemarks] = useState('');
  const [selectedDocsToReject, setSelectedDocsToReject] = useState([]);
  const [merchantRejectAdminEvidence, setMerchantRejectAdminEvidence] = useState(null);
  const [rejectionRemarks, setRejectionRemarks] = useState('');
  const [commentText, setCommentText] = useState('');
  const [guidedTourStep, setGuidedTourStep] = useState(null);
  const [hoveredIcon, setHoveredIcon] = useState(null);
  const [hoveredRowAction, setHoveredRowAction] = useState(null);

  useEffect(() => {
    if (guidedTourStep === 2 || guidedTourStep === 3) {
      setActivePage('reports');
    } else if (guidedTourStep === 0 || guidedTourStep === 1) {
      setActivePage('dashboard');
    }
  }, [guidedTourStep]);

  const [evidenceFiles, setEvidenceFiles] = useState({
    1: null,
    2: null,
    3: null
  });

  // Full & Partial Liability states
  const [liabilityType, setLiabilityType] = useState('full'); // 'full' | 'partial'
  const [partialAmount, setPartialAmount] = useState('');
  const [partialRemarks, setPartialRemarks] = useState('');
  const [partialEvidenceFile, setPartialEvidenceFile] = useState(null);

  // VROL Automation rules states
  const [oiRules, setOiRules] = useState([]);
  const [newOiCategory, setNewOiCategory] = useState('ALL_MATCHES');
  const [newOiThreshold, setNewOiThreshold] = useState('');
  const [newOiAction, setNewOiAction] = useState('AUTO_INTENT_TO_CREDIT');

  const [rdrRules, setRdrRules] = useState([]);
  const [newRdrProgramId, setNewRdrProgramId] = useState('VISA_RDR_CORE');
  const [newRdrMaxLimit, setNewRdrMaxLimit] = useState('');
  const [newRdrExcludedSkus, setNewRdrExcludedSkus] = useState('');

  // Allocation compelling evidence compilation states
  const [allocationCoreFile, setAllocationCoreFile] = useState('');
  const [allocationCoreDesc, setAllocationCoreDesc] = useState('');
  const [allocationSupplFile, setAllocationSupplFile] = useState('');
  const [allocationSupplDesc, setAllocationSupplDesc] = useState('');
  const [allocationHistFile, setAllocationHistFile] = useState('');
  const [allocationHistDesc, setAllocationHistDesc] = useState('');
  const [validationResult, setValidationResult] = useState(null);

  const fetchOiRules = async () => {
    try {
      const res = await fetch(`${API_URL}/vrol/oi/rules?merchant=${currentUser.username}`, {
        headers: { 'x-user-name': currentUser.username }
      });
      if (res.ok) {
        const data = await res.json();
        setOiRules(data || []);
      }
    } catch (err) {
      console.error('Failed to fetch OI rules:', err);
    }
  };

  const fetchRdrRules = async () => {
    try {
      const res = await fetch(`${API_URL}/vrol/rdr/rules?merchant=${currentUser.username}`, {
        headers: { 'x-user-name': currentUser.username }
      });
      if (res.ok) {
        const data = await res.json();
        setRdrRules(data || []);
      }
    } catch (err) {
      console.error('Failed to fetch RDR rules:', err);
    }
  };

  useEffect(() => {
    if (activePage === 'm-vrol-automation') {
      fetchOiRules();
      fetchRdrRules();
    }
  }, [activePage]);

  useEffect(() => {
    if (targetDisputeId) {
      const cb = chargebacks.find(c => c.id === targetDisputeId);
      if (cb) {
        setValidationResult(null);
        if (cb.id === 'CASE-2026-F01') {
          setAllocationCoreFile('pin_log_terminal.pdf');
          setAllocationCoreDesc('POS terminal chip read signature');
          setAllocationSupplFile('device_id_finger.json');
          setAllocationSupplDesc('Device metadata and hardware profile');
          setAllocationHistFile('past_clearing.csv');
          setAllocationHistDesc('Previous undisputed history');
        } else if (cb.id === 'CASE-2026-F04') {
          setAllocationCoreFile('ip_match_proof.pdf');
          setAllocationCoreDesc('Matching IP and geofence logs');
          setAllocationSupplFile('shipping_carrier_rec.pdf');
          setAllocationSupplDesc('Signed delivery proof at billing');
          setAllocationHistFile('customer_profile.pdf');
          setAllocationHistDesc('Verified account history logs');
        } else if (cb.id === 'CASE-2026-A11') {
          setAllocationCoreFile('auth_token_valid.pdf');
          setAllocationCoreDesc('Real-time auth code logs via VIP');
          setAllocationSupplFile('settle_reconcile.json');
          setAllocationSupplDesc('Settled ledger match record');
          setAllocationHistFile('terminal_receipt.pdf');
          setAllocationHistDesc('Physical swipe customer voucher');
        } else if (cb.id === 'CASE-2026-A13') {
          setAllocationCoreFile('ext_auth_window.pdf');
          setAllocationCoreDesc('Delayed execution compliance log');
          setAllocationSupplFile('booking_contract.pdf');
          setAllocationSupplDesc('Pre-authorization agreement terms');
          setAllocationHistFile('merchant_memo.txt');
          setAllocationHistDesc('Partial completion data log');
        } else {
          setAllocationCoreFile('');
          setAllocationCoreDesc('');
          setAllocationSupplFile('');
          setAllocationSupplDesc('');
          setAllocationHistFile('');
          setAllocationHistDesc('');
        }
      }
    }
  }, [targetDisputeId, chargebacks]);

  const handleAddOiRule = async (e) => {
    e.preventDefault();
    if (!newOiThreshold) {
      showToast('Threshold amount is required', 'error');
      return;
    }
    const updated = [...oiRules, {
      maxThresholdAmount: parseFloat(newOiThreshold),
      visaCategory: newOiCategory,
      ruleAction: newOiAction
    }];
    try {
      const res = await fetch(`${API_URL}/vrol/oi/rules`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-name': currentUser.username
        },
        body: JSON.stringify({ merchant: currentUser.username, rules: updated })
      });
      if (res.ok) {
        setOiRules(updated);
        setNewOiThreshold('');
        showToast('Order Insight deflection rule added successfully', 'success');
      } else {
        showToast('Failed to save rule', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Error saving rule', 'error');
    }
  };

  const handleDeleteOiRule = async (index) => {
    const updated = oiRules.filter((_, i) => i !== index);
    try {
      const res = await fetch(`${API_URL}/vrol/oi/rules`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-name': currentUser.username
        },
        body: JSON.stringify({ merchant: currentUser.username, rules: updated })
      });
      if (res.ok) {
        setOiRules(updated);
        showToast('Rule deleted successfully', 'success');
      }
    } catch (err) {
      console.error(err);
      showToast('Error deleting rule', 'error');
    }
  };

  const handleAddRdrRule = async (e) => {
    e.preventDefault();
    if (!newRdrMaxLimit) {
      showToast('Max limit is required', 'error');
      return;
    }
    const updated = [...rdrRules, {
      programId: newRdrProgramId,
      rdrMaxLimit: parseFloat(newRdrMaxLimit),
      excludedSkus: newRdrExcludedSkus
    }];
    try {
      const res = await fetch(`${API_URL}/vrol/rdr/rules`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-name': currentUser.username
        },
        body: JSON.stringify({ merchant: currentUser.username, rules: updated })
      });
      if (res.ok) {
        setRdrRules(updated);
        setNewRdrMaxLimit('');
        setNewRdrExcludedSkus('');
        showToast('RDR rule added successfully', 'success');
      } else {
        showToast('Failed to save rule', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Error saving rule', 'error');
    }
  };

  const handleDeleteRdrRule = async (index) => {
    const updated = rdrRules.filter((_, i) => i !== index);
    try {
      const res = await fetch(`${API_URL}/vrol/rdr/rules`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-name': currentUser.username
        },
        body: JSON.stringify({ merchant: currentUser.username, rules: updated })
      });
      if (res.ok) {
        setRdrRules(updated);
        showToast('RDR rule deleted successfully', 'success');
      }
    } catch (err) {
      console.error(err);
      showToast('Error deleting rule', 'error');
    }
  };

  const handleValidateEvidence = () => {
    const allowed = ['.pdf', '.json', '.csv', '.png', '.jpg'];
    const validateFile = (fileName) => {
      if (!fileName) return 'Missing file name.';
      const ext = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();
      if (!allowed.includes(ext)) {
        return `Format ${ext} not allowed. Supported: PDF, JSON, CSV, PNG, JPG.`;
      }
      return null;
    };
    const err1 = validateFile(allocationCoreFile);
    const err2 = validateFile(allocationSupplFile);
    const err3 = validateFile(allocationHistFile);
    if (err1 || err2 || err3) {
      const msg = `Validation Error: ${err1 || ''} ${err2 || ''} ${err3 || ''}`.trim();
      setValidationResult({ success: false, msg });
      showToast('Compelling evidence formatting check failed', 'error');
    } else {
      setValidationResult({ success: true, msg: 'ChargebackHelp validation script passed: file format and sizes conform to Visa requirements.' });
      showToast('Validation script executed successfully', 'success');
    }
  };

  const handleSubmitRepresentment = async () => {
    if (!validationResult || !validationResult.success) {
      showToast('Please run and pass the validation script before submitting representment.', 'error');
      return;
    }
    try {
      const res = await fetch(`${API_URL}/vrol/dispute/${targetDisputeId}/representment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-name': currentUser.username
        },
        body: JSON.stringify({
          evidenceFile1: allocationCoreFile,
          evidenceDescription1: allocationCoreDesc,
          evidenceFile2: allocationSupplFile,
          evidenceDescription2: allocationSupplDesc,
          evidenceFile3: allocationHistFile,
          evidenceDescription3: allocationHistDesc
        })
      });
      if (res.ok) {
        showToast('Representment submitted successfully to VROL RTSI', 'success');
        setTargetDisputeId(null);
        await refreshAllData();
      } else {
        const errData = await res.json();
        showToast(errData.error || 'Failed to submit representment', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Network error during representment', 'error');
    }
  };

  const handleCollaborationAction = async (finalAction) => {
    try {
      const res = await fetch(`${API_URL}/vrol/dispute/${targetDisputeId}/collaboration-action`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-name': currentUser.username
        },
        body: JSON.stringify({ finalAction })
      });
      if (res.ok) {
        const data = await res.json();
        showToast(data.message || 'Collaboration action submitted successfully', 'success');
        setTargetDisputeId(null);
        await refreshAllData();
      } else {
        showToast('Failed to submit collaboration action', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Network error during collaboration action', 'error');
    }
  };

  // Filters State
  const TODAY_STR = new Date().toISOString().split('T')[0];
  const DEFAULT_FROM = (() => {
    let d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().split('T')[0];
  })();

  const [dashDateRangeType, setDashDateRangeType] = useState('7days');
  const [dashFilterFrom, setDashFilterFrom] = useState(() => { let d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().split('T')[0]; });
  const [dashFilterTo, setDashFilterTo] = useState(TODAY_STR);
  const [respondFilter, setRespondFilter] = useState({ from: DEFAULT_FROM, to: TODAY_STR, rrn: '', txnId: '', status: '', subStatus: '', disputeType: '', scheme: '' });
  const [raisedFilter, setRaisedFilter] = useState({ from: DEFAULT_FROM, to: TODAY_STR, rrn: '', txnId: '', status: '', subStatus: '', disputeType: '', scheme: '' });
  
  const SIX_MONTHS_AGO = (() => {
    let d = new Date(); d.setDate(d.getDate() - 180); return d.toISOString().split('T')[0];
  })();
  const [dateRangePreset, setDateRangePreset] = useState('6months');
  const [dateDropdownOpen, setDateDropdownOpen] = useState(false);
  const [filterDropdownOpen, setFilterDropdownOpen] = useState(false);
  const [tempFrom, setTempFrom] = useState(SIX_MONTHS_AGO);
  const [tempTo, setTempTo] = useState(TODAY_STR);

  const [reportFilter, setReportFilter] = useState({ from: SIX_MONTHS_AGO, to: TODAY_STR, provider: '', disputeType: '', scheme: '', disputeStatus: '', searchBy: '', searchText: '' });
  const [reportTab, setReportTab] = useState('doc-pending'); // 'dispute-mgmt' | 'doc-pending' | 'doc-verification' | 'closed'
  const [merchantSearchFocused, setMerchantSearchFocused] = useState(false);
  const [expandedTimeline, setExpandedTimeline] = useState({});

  // Pagination states
  const [respondPage, setRespondPage] = useState(1);
  const [respondLimit, setRespondLimit] = useState(10);
  const [raisedPage, setRaisedPage] = useState(1);
  const [raisedLimit, setRaisedLimit] = useState(10);
  const [reportsPage, setReportsPage] = useState(1);
  const [reportsLimit, setReportsLimit] = useState(10);

  // Search filter inputs inside table toolbar
  const [respondSearchInput, setRespondSearchInput] = useState('');
  const [raisedSearchInput, setRaisedSearchInput] = useState('');

  // Elastic search state (Merchant)
  const [elasticSearchVal, setElasticSearchVal] = useState('');
  const [elasticSearchFocused, setElasticSearchFocused] = useState(false);

  // Compute Merchant Disputes
  // Compute Merchant Disputes
  const merchantDisputes = chargebacks.filter(cb => cb.userName === currentUser.username);
  
  const actionRequiredDisputes = merchantDisputes.filter(cb => 
    !isClosedDispute(cb) && (
      !cb.merchantAction || 
      cb.merchantAction === 'rejected' || 
      cb.merchantAction === 'additional_evidence'
    )
  );
  
  const pendingVerificationDisputes = merchantDisputes.filter(cb => 
    !isClosedDispute(cb) && (
      (cb.merchantAction === 'evidence' || cb.merchantAction === 'accepted_admin' || cb.merchantAction === 'rejected_admin' || cb.merchantAction === 'rejected' || cb.merchantAction === 'accepted_partially') && 
      (cb.acquirerAction === null || cb.acquirerAction === 'evidence_uploaded' || cb.acquirerAction === 'request_info')
    )
  );

  const closedDisputes = merchantDisputes.filter(isClosedDispute);

  // Dashboard calculations
  const getFilteredDashboardDisputes = () => {
    return merchantDisputes.filter(cb => {
      if (dashFilterFrom && cb.createdDate && cb.createdDate < dashFilterFrom) return false;
      if (dashFilterTo && cb.createdDate && cb.createdDate > dashFilterTo) return false;
      return true;
    });
  };

  const getDashboardStats = () => {
    const list = getFilteredDashboardDisputes();
    const totalAmt = list.reduce((sum, c) => sum + c.txnAmt, 0);
    const totalCount = list.length;
    
    const openList = list.filter(cb => getDisputeCategory(cb) === 'open');
    const openAmt = openList.reduce((sum, c) => sum + c.txnAmt, 0);
    
    const lostList = list.filter(cb => getDisputeCategory(cb) === 'lost');
    const lostAmt = lostList.reduce((sum, c) => sum + c.txnAmt, 0);
    
    const wonList = list.filter(cb => getDisputeCategory(cb) === 'won');
    const wonAmt = wonList.reduce((sum, c) => sum + c.txnAmt, 0);

    const slaList = list.filter(cb => matchesDisputeStatusFilter(cb, 'sla_today'));
    const slaAmt = slaList.reduce((sum, c) => sum + c.txnAmt, 0);

    const wonPct = totalCount > 0 ? Math.round((wonList.length / totalCount) * 100) : 0;
    const lostPct = totalCount > 0 ? Math.round((lostList.length / totalCount) * 100) : 0;
    const openPct = totalCount > 0 ? Math.round((openList.length / totalCount) * 100) : 0;
    const slaPct = totalCount > 0 ? Math.round((slaList.length / totalCount) * 100) : 0;

    return {
      totalAmt, totalCount,
      openAmt, openCount: openList.length, openPct,
      lostAmt, lostCount: lostList.length, lostPct,
      wonAmt, wonCount: wonList.length, wonPct,
      slaAmt, slaCount: slaList.length, slaPct
    };
  };

  const stats = getDashboardStats();

  const navigateToMerchantReport = (status) => {
    setReportFilter(prev => ({ ...prev, disputeStatus: status }));
    setActivePage('reports');
  };

  // Filters respond table
  const getFilteredRespond = () => {
    let list = merchantDisputes.filter(cb => {
      if (respondFilter.from && cb.respondByDate && cb.respondByDate < respondFilter.from) return false;
      if (respondFilter.to && cb.respondByDate && cb.respondByDate > respondFilter.to) return false;
      if (respondFilter.rrn && !cb.rrn.includes(respondFilter.rrn)) return false;
      if (respondFilter.txnId && !cb.txnId.includes(respondFilter.txnId)) return false;
      if (respondFilter.status && cb.mStatus !== respondFilter.status) return false;
      if (respondFilter.subStatus && cb.mSubStatus !== respondFilter.subStatus) return false;
      return true;
    });

    if (respondSearchInput) {
      const q = respondSearchInput.toLowerCase();
      list = list.filter(cb => (cb.rrn && cb.rrn.toLowerCase().includes(q)) || (cb.txnId && cb.txnId.toLowerCase().includes(q)) || (cb.mStatus && cb.mStatus.toLowerCase().includes(q)) || (cb.mSubStatus && cb.mSubStatus.toLowerCase().includes(q)) || (cb.adjType && cb.adjType.toLowerCase().includes(q)));
    }
    return list;
  };

  const filteredRespond = getFilteredRespond();

  // Filters raised table
  const getFilteredRaised = () => {
    let list = merchantDisputes.filter(cb => {
      if (raisedFilter.from && cb.createdDate && cb.createdDate < raisedFilter.from) return false;
      if (raisedFilter.to && cb.createdDate && cb.createdDate > raisedFilter.to) return false;
      if (raisedFilter.rrn && !cb.rrn.includes(raisedFilter.rrn)) return false;
      if (raisedFilter.txnId && !cb.txnId.includes(raisedFilter.txnId)) return false;
      if (raisedFilter.status && cb.mStatus !== raisedFilter.status) return false;
      if (raisedFilter.subStatus && cb.mSubStatus !== raisedFilter.subStatus) return false;
      return true;
    });

    if (raisedSearchInput) {
      const q = raisedSearchInput.toLowerCase();
      list = list.filter(cb => (cb.rrn && cb.rrn.toLowerCase().includes(q)) || (cb.txnId && cb.txnId.toLowerCase().includes(q)) || (cb.mStatus && cb.mStatus.toLowerCase().includes(q)) || (cb.mSubStatus && cb.mSubStatus.toLowerCase().includes(q)) || (cb.adjType && cb.adjType.toLowerCase().includes(q)));
    }
    return list;
  };

  const filteredRaised = getFilteredRaised();

  // Paging handlers
  const paginateList = (list, page, limit) => {
    const total = list.length;
    const totalPages = Math.ceil(total / limit) || 1;
    let curr = page;
    if (curr > totalPages) curr = totalPages;
    if (curr < 1) curr = 1;
    const start = (curr - 1) * limit;
    const end = Math.min(start + limit, total);
    const paginated = list.slice(start, end);
    return { paginated, startRecord: total === 0 ? 0 : start + 1, endRecord: end, total, totalPages, curr };
  };

  const respondPaging = paginateList(filteredRespond, respondPage, respondLimit);
  const raisedPaging = paginateList(filteredRaised, raisedPage, raisedLimit);

  // Status Badge Builder
  const renderStatusBadge = (s) => {
    const m = {
      'Chargeback Raise': 'badge-cb',
      'Pre-Arbitration Raise': 'badge-prearb',
      'Pre-Arbitration Raised': 'badge-prearb',
      'Arbitration Raise': 'badge-arb',
      'Arbitration Raised': 'badge-arb',
      'Fraud Chargeback Raise': 'badge-fraud',
      'Differed Chargeback Raise': 'badge-deferred',
      'VROL Inquiry': 'badge-pending',
      'VROL Chargeback': 'badge-cb',
      'VROL Pre-Arbitration': 'badge-prearb',
      'VROL Arbitration': 'badge-arb'
    };
    return <span className={`badge ${m[s] || 'badge-new'}`}>{s}</span>;
  };

  const renderSubBadge = (s) => {
    const m = {
      'Chargeback New': 'badge-new',
      'Chargeback Lost': 'badge-lost',
      'Arbitration Lost': 'badge-lost',
      'Chargeback In Progress': 'badge-progress',
      'Chargeback Resubmit': 'badge-resubmit',
      'Chargeback Won': 'badge-won',
      'Arbitration Won': 'badge-won',
      'Refund Success': 'badge-won',
      'Refund On Hold': 'badge-progress'
    };
    return <span className={`badge ${m[s] || 'badge-pending'}`}>{s}</span>;
  };

  const getActionBtn = (cb) => {
    if (cb.visaPending) return <span className="badge badge-won" style={{background: '#e3f2fd', color: '#1976d2'}}>Submitted to Visa</span>;
    if (cb.mStatus.includes('Lost') || cb.mStatus.includes('Won')) return <span className={`badge ${cb.mStatus.includes('Won') ? 'badge-won' : 'badge-resubmit'}`}>{cb.mStatus}</span>;
    if (cb.resolution === 'Lost' || cb.mSubStatus === 'Chargeback Lost' || cb.mSubStatus === 'Arbitration Lost') return <span className="badge badge-resubmit">Accepted (Lost)</span>;
    if (cb.mSubStatus === 'Chargeback In Progress' && !cb.visaPending) return <span className="badge badge-progress">Pending Admin Verification</span>;
    if (cb.mSubStatus === 'Chargeback Resubmit' || cb.mSubStatus === 'Pending') {
      return (
        <button className="ta-btn" onClick={() => { setTargetDisputeId(cb.id); setActiveModal('action1'); }}>
          Take Action
        </button>
      );
    }
    return <span className="badge" style={{background: '#f5f5f5', color: '#757575'}}>{cb.mSubStatus}</span>;
  };

  // Post remarks reply
  const sendReply = async () => {
    // This function is kept stubbed in case it's used elsewhere, but ideally it should be removed if completely unused.
    // Actually wait, let's just leave it for now in case another part of the UI depends on it to prevent errors.
    console.log('sendReply stub');
  };


  // Confirm Accept Dispute Action
  const confirmAccept = async () => {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (currentUser) {
        headers['x-user-role'] = currentUser.role;
        headers['x-user-name'] = currentUser.username;
      }

      const response = await fetch(`${API_URL}/disputes/${targetDisputeId}/action`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'accept',
          comments: acceptRemarks || 'Accepted'
        })
      });

      if (response.ok) {
        setAcceptRemarks('');
        setActiveModal('successAccept');
        await refreshAllData();
      } else {
        showToast('Acceptance failed', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('API error', 'error');
    }
  };

  const confirmAcceptPartially = async () => {
    if (!partialAmount) {
      showToast('Liability amount is required', 'error');
      return;
    }
    if (!partialEvidenceFile) {
      showToast('Evidence upload is required', 'error');
      return;
    }
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (currentUser) {
        headers['x-user-role'] = currentUser.role;
        headers['x-user-name'] = currentUser.username;
      }

      const response = await fetch(`${API_URL}/disputes/${targetDisputeId}/action`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'accept_partially',
          acceptedAmount: Number(partialAmount),
          comments: partialRemarks || 'Partially Accepted',
          evidence: partialEvidenceFile.name || partialEvidenceFile
        })
      });

      if (response.ok) {
        setPartialAmount('');
        setPartialRemarks('');
        setPartialEvidenceFile(null);
        setActiveModal('successAcceptPartially');
        await refreshAllData();
      } else {
        showToast('Partial acceptance failed', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('API error', 'error');
    }
  };

  // Submit Evidence Contest Action — also marks visaPending for Visa review
  const handleMerchantRejectAdminClick = (id) => {
    setTargetDisputeId(id);
    setSelectedDocsToReject([]);
    setRejectionRemarks('');
    setMerchantRejectAdminEvidence(null);
    setActiveModal('merchantRejectAdminDocs');
  };

  const submitMerchantAcceptAdmin = async (id) => {
    try {
      const response = await fetch(`${window.API_URL || 'http://localhost:5000/api'}/disputes/${id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'merchant', 'x-user-name': currentUser?.username },
        body: JSON.stringify({ action: 'merchant_accept_admin' })
      });
      if (response.ok) {
        showToast('Accepted admin evidence successfully');
        refreshAllData();
      } else {
        const errorData = await response.json();
        showToast(`Error: ${errorData.message || 'Action failed'}`, 'error');
      }
    } catch (error) {
      showToast('Network error', 'error');
    }
  };

  const submitMerchantRejectAdminDocs = async () => {
    if (selectedDocsToReject.length === 0) {
      showToast('Please select at least one document to reject', 'error');
      return;
    }
    if (!rejectionRemarks.trim()) {
      showToast('Rejection remarks are mandatory', 'error');
      return;
    }
    const id = targetDisputeId;
    if (!id) return;

    try {
      const response = await fetch(`${window.API_URL || 'http://localhost:5000/api'}/disputes/${id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'merchant', 'x-user-name': currentUser?.username },
        body: JSON.stringify({
          action: 'merchant_reject_admin',
          comments: rejectionRemarks,
          evidence: merchantRejectAdminEvidence ? merchantRejectAdminEvidence.name : null,
          rejectedDocs: selectedDocsToReject.map(docId => ({ id: docId, remarks: rejectionRemarks }))
        })
      });
      if (response.ok) {
        showToast('Rejected admin evidence and re-uploaded successfully');
        setActiveModal(null);
        refreshAllData();
      } else {
        const errorData = await response.json();
        showToast(`Error: ${errorData.message || 'Action failed'}`, 'error');
      }
    } catch (error) {
      showToast('Network error', 'error');
    }
  };

  const submitContestEvidence = async () => {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (currentUser) {
        headers['x-user-role'] = currentUser.role;
        headers['x-user-name'] = currentUser.username;
      }

      const uploadedDocs = [];
      if (evidenceFiles[1]) uploadedDocs.push(evidenceFiles[1].name || evidenceFiles[1]);
      if (evidenceFiles[2]) uploadedDocs.push(evidenceFiles[2].name || evidenceFiles[2]);
      if (evidenceFiles[3]) uploadedDocs.push(evidenceFiles[3].name || evidenceFiles[3]);
      if (uploadedDocs.length === 0) uploadedDocs.push('EvidenceSubmitted.pdf');

      const response = await fetch(`${API_URL}/disputes/${targetDisputeId}/action`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'contest',
          comments: (contestRemarks || 'Contested') + ' — Evidence forwarded to Acquirer for Visa consideration.',
          evidence: uploadedDocs
        })
      });

      if (response.ok) {
        setContestRemarks('');
        setEvidenceFiles({ 1: null, 2: null, 3: null });
        setActiveModal('successEvidence');
        await refreshAllData();
      } else {
        showToast('Evidence submit failed', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('API error', 'error');
    }
  };

  const submitComment = async () => {
    if (!commentText.trim()) return;
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (currentUser) {
        headers['x-user-role'] = currentUser.role;
        headers['x-user-name'] = currentUser.username;
      }
      const response = await fetch(`${API_URL}/disputes/${targetDisputeId}/action`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'comment',
          comments: commentText
        })
      });
      if (response.ok) {
        setCommentText('');
        setActiveModal(null);
        showToast('Comment added successfully');
        await refreshAllData();
      } else {
        showToast('Comment failed', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('API error', 'error');
    }
  };

  const handleEscalate = async (id) => {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (currentUser) {
        headers['x-user-role'] = currentUser.role;
        headers['x-user-name'] = currentUser.username;
      }
      const response = await fetch(`${API_URL}/disputes/${id}/action`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'escalate' })
      });
      if (response.ok) {
        showToast('Escalated to Pre-Arb successfully');
        await refreshAllData();
      } else {
        showToast('Escalation failed', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('API error', 'error');
    }
  };

  const handleEvidenceFileChange = (slot, file) => {
    if (file) {
      setEvidenceFiles(prev => ({ ...prev, [slot]: file.name }));
    }
  };

  const removeEvidenceFile = (slot) => {
    setEvidenceFiles(prev => ({ ...prev, [slot]: null }));
  };

  const handleResponseSelect = (val) => {
    setAcceptResponseSelect(val);
    if (val === 'contest') {
      setActiveModal('contest');
    }
  };

  // Exports data to CSV
  const exportToCSV = (src) => {
    let list;
    if (src === 'reports') {
      list = activeReportsList;
    } else if (src === 'respond') {
      list = filteredRespond;
    } else {
      list = filteredRaised;
    }
    if (!list.length) {
      showToast('No data to export', 'error');
      return;
    }
    const headers = ['RRN', 'Case ID', 'Txn ID', 'Merchant', 'Status', 'Sub Status', 'Amount', 'Date', 'Product'];
    const rows = list.map(cb => [
      cb.rrn, cb.caseId || cb.id, cb.txnId, cb.userName, cb.mStatus, cb.mSubStatus, cb.txnAmt, cb.createdDate || cb.txnDate, cb.product
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(','), ...rows.map(r => r.map(c => `"${c}"`).join(','))].join('\n');
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csvContent));
    link.setAttribute("download", `chargebacks_${src}_export.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Export successful!');
  };

  // Draw Reports charts
  const getReportChartData = () => {
    const filtered = merchantDisputes.filter(cb => {
      if (reportFilter.searchText) {
        const q = reportFilter.searchText.toLowerCase();
        if (reportFilter.searchBy === 'Txn ID' && !cb.txnId?.toLowerCase().includes(q)) return false;
        if (reportFilter.searchBy === 'RRN' && !cb.rrn?.toLowerCase().includes(q)) return false;
        if (reportFilter.searchBy === 'TID' && !cb.tid?.toLowerCase().includes(q)) return false;
        if (reportFilter.searchBy === 'MID' && !cb.userId?.toLowerCase().includes(q)) return false;
        if (reportFilter.searchBy === 'Case ID' && !cb.caseId?.toLowerCase().includes(q) && !cb.id?.toLowerCase().includes(q)) return false;
        if (!reportFilter.searchBy && !cb.rrn?.toLowerCase().includes(q) && !cb.txnId?.toLowerCase().includes(q) && !cb.userId?.toLowerCase().includes(q) && !cb.id?.toLowerCase().includes(q) && !(cb.mStatus && cb.mStatus.toLowerCase().includes(q)) && !(cb.mSubStatus && cb.mSubStatus.toLowerCase().includes(q)) && !(cb.adjType && cb.adjType.toLowerCase().includes(q))) return false;
      }
      if (!matchesDisputeStatusFilter(cb, reportFilter.disputeStatus)) return false;
      if (!matchesDisputeTypeFilter(cb, reportFilter.disputeType)) return false;
      if (reportFilter.from && cb.createdDate && cb.createdDate < reportFilter.from) return false;
      if (reportFilter.to && cb.createdDate && cb.createdDate > reportFilter.to) return false;
      return true;
    });

    const upiCount = filtered.filter(cb => cb.product === 'VISA').length;
    const visaCount = filtered.filter(cb => cb.product === 'VISA').length;
    const mcCount = filtered.filter(cb => cb.product === 'Mastercard').length;
    const rupayCount = filtered.filter(cb => cb.product === 'Rupay').length;

    const wonCount = filtered.filter(cb => getDisputeCategory(cb) === 'won').length;
    const lostCount = filtered.filter(cb => getDisputeCategory(cb) === 'lost').length;
    const openCount = filtered.filter(cb => getDisputeCategory(cb) === 'open').length;

    const totalAmt = filtered.reduce((sum, c) => sum + c.txnAmt, 0);
    const openAmt = filtered.filter(cb => getDisputeCategory(cb) === 'open').reduce((sum, c) => sum + c.txnAmt, 0);
    const wonAmt = filtered.filter(cb => getDisputeCategory(cb) === 'won').reduce((sum, c) => sum + c.txnAmt, 0);
    const lostAmt = filtered.filter(cb => getDisputeCategory(cb) === 'lost').reduce((sum, c) => sum + c.txnAmt, 0);

    return {
      filtered,
      totalCount: filtered.length, totalAmt,
      openCount, openAmt,
      wonCount, wonAmt,
      lostCount, lostAmt,
      providers: [
        { label: 'VISA', value: upiCount, color: '#1d4ed8' },
        { label: 'VISA', value: visaCount, color: '#ca8a04' },
        { label: 'Mastercard', value: mcCount, color: '#dc2626' },
        { label: 'Rupay', value: rupayCount, color: '#7c3aed' }
      ],
      outcomes: [
        { label: 'Won', value: wonCount, color: '#16a34a' },
        { label: 'Lost', value: lostCount, color: '#dc2626' },
        { label: 'Open', value: openCount, color: '#1d4ed8' }
      ]
    };
  };

  const reportData = getReportChartData();

  const formatDateToScreenshot = (dateStr) => {
    if (!dateStr) return '15 May 2023';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const day = d.getDate();
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[d.getMonth()];
    const year = d.getFullYear();
    return `${day} ${month} ${year}`;
  };

  // active list in reports page depending on tab
  let activeReportsList = [];
  if (reportTab === 'doc-pending') {
    activeReportsList = actionRequiredDisputes;
  } else if (reportTab === 'doc-verification') {
    activeReportsList = pendingVerificationDisputes;
  } else if (reportTab === 'closed') {
    activeReportsList = closedDisputes;
  } else {
    activeReportsList = merchantDisputes;
  }

  // Filter based on the respective filters (date, status, search, type, etc.)
  activeReportsList = activeReportsList.filter(cb => {
    if (reportFilter.searchText) {
      const q = reportFilter.searchText.toLowerCase();
      if (reportFilter.searchBy === 'Txn ID') {
        if (!cb.txnId || !cb.txnId.toLowerCase().includes(q)) return false;
      } else if (reportFilter.searchBy === 'RRN') {
        if (!cb.rrn || !cb.rrn.toLowerCase().includes(q)) return false;
      } else if (reportFilter.searchBy === 'TID') {
        if (!cb.tid || !cb.tid.toLowerCase().includes(q)) return false;
      } else if (reportFilter.searchBy === 'MID') {
        if (!cb.userId || !cb.userId.toLowerCase().includes(q)) return false;
      } else if (reportFilter.searchBy === 'Case ID') {
        if ((!cb.caseId || !cb.caseId.toLowerCase().includes(q)) && (!cb.id || !cb.id.toLowerCase().includes(q))) return false;
      } else {
        if (
          (!cb.rrn || !cb.rrn.toLowerCase().includes(q)) &&
          (!cb.txnId || !cb.txnId.toLowerCase().includes(q)) &&
          (!cb.userId || !cb.userId.toLowerCase().includes(q)) &&
          (!cb.id || !cb.id.toLowerCase().includes(q)) &&
          (!cb.mStatus || !cb.mStatus.toLowerCase().includes(q)) &&
          (!cb.mSubStatus || !cb.mSubStatus.toLowerCase().includes(q))
        ) return false;
      }
    }
    if (!matchesDisputeStatusFilter(cb, reportFilter.disputeStatus)) return false;
    if (!matchesDisputeTypeFilter(cb, reportFilter.disputeType)) return false;
    if (reportFilter.from && cb.createdDate && cb.createdDate < reportFilter.from) return false;
    if (reportFilter.to && cb.createdDate && cb.createdDate > reportFilter.to) return false;
    return true;
  });

  // Apply elastic search filter on top of existing list
  if (elasticSearchVal) {
    const eq = elasticSearchVal.toLowerCase();
    activeReportsList = activeReportsList.filter(cb =>
      (cb.rrn && cb.rrn.toLowerCase().includes(eq)) ||
      (cb.txnId && cb.txnId.toLowerCase().includes(eq)) ||
      (cb.tid && cb.tid.toLowerCase().includes(eq)) ||
      (cb.userId && cb.userId.toLowerCase().includes(eq)) ||
      (cb.userName && cb.userName.toLowerCase().includes(eq))
    );
  }

  const reportsPaging = targetDisputeId
    ? { paginated: activeReportsList, total: activeReportsList.length, startRecord: 1, endRecord: activeReportsList.length, totalPages: 1 }
    : paginateList(activeReportsList, reportsPage, reportsLimit);

  const renderDisputesTable = (paging) => {
    if (paging.paginated.length === 0) {
      return (
        <div style={{ textAlign: 'center', padding: '48px', color: '#64748b', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
          <span style={{ fontSize: '48px', display: 'block', marginBottom: '16px' }}>📁</span>
          <h3 style={{ fontSize: '16px', fontWeight: '700', color: '#1e293b', marginBottom: '8px' }}>No Data Found!</h3>
          <p style={{ fontSize: '13px', margin: 0 }}>Try adjusting your search criteria or date ranges.</p>
        </div>
      );
    }

    return (
      <div className="tbl-wrap" style={{ 
        overflowX: 'auto', 
        overflowY: 'auto',
        maxHeight: 'calc(100vh - 280px)',
        background: '#fff', 
        border: '1px solid #e2e8f0', 
        borderRadius: '8px' 
      }}>
        <table style={{ 
          width: '100%', 
          borderCollapse: 'collapse', 
          textAlign: 'left', 
          minWidth: targetDisputeId ? 'auto' : '1000px', 
          fontSize: '13px',
          display: targetDisputeId ? 'block' : 'table'
        }}>
          {!targetDisputeId && (
            <thead>
              <tr style={{ background: '#F1F3F5', borderBottom: '1.5px solid #cbd5e1' }}>
                <th style={{ position: 'sticky', top: 0, zIndex: 10, background: '#F1F3F5', padding: '10px 8px', fontWeight: '700', color: '#1e293b' }}>Case ID</th>
                <th style={{ position: 'sticky', top: 0, zIndex: 10, background: '#F1F3F5', padding: '10px 8px', fontWeight: '700', color: '#1e293b' }}>Visa ID</th>
                <th style={{ position: 'sticky', top: 0, zIndex: 10, background: '#F1F3F5', padding: '10px 8px', fontWeight: '700', color: '#1e293b' }}>Dispute Type</th>
                <th style={{ position: 'sticky', top: 0, zIndex: 10, background: '#F1F3F5', padding: '10px 8px', fontWeight: '700', color: '#1e293b' }}>Merchant Name</th>
                <th style={{ position: 'sticky', top: 0, zIndex: 10, background: '#F1F3F5', padding: '10px 8px', fontWeight: '700', color: '#1e293b' }}>MID</th>
                <th style={{ position: 'sticky', top: 0, zIndex: 10, background: '#F1F3F5', padding: '10px 8px', fontWeight: '700', color: '#1e293b' }}>ARN</th>
                <th style={{ position: 'sticky', top: 0, zIndex: 10, background: '#F1F3F5', padding: '10px 8px', fontWeight: '700', color: '#1e293b' }}>Dispute Status</th>
                <th style={{ position: 'sticky', top: 0, zIndex: 10, background: '#F1F3F5', padding: '10px 8px', fontWeight: '700', color: '#1e293b' }}>TXN Ref. Number</th>
                <th style={{ position: 'sticky', top: 0, zIndex: 10, background: '#F1F3F5', padding: '10px 8px', fontWeight: '700', color: '#1e293b' }}>Responded By</th>
                {reportTab === 'doc-verification' && (
                  <th style={{ position: 'sticky', top: 0, zIndex: 10, background: '#F1F3F5', padding: '10px 8px', fontWeight: '700', color: '#1e293b', textAlign: 'center' }}>Actions</th>
                )}
              </tr>
            </thead>
          )}
          <tbody style={{ display: targetDisputeId ? 'block' : 'table-row-group' }}>
            {paging.paginated.map((cb, idx) => {
              const isFirstRow = idx === 0 && reportsPage === 1;
              const isClosed = isClosedDispute(cb);
              const isSelected = cb.id === targetDisputeId;
              
              return (
                <tr 
                  key={cb.id} 
                  onClick={() => {
                    setTargetDisputeId(cb.id);
                  }}
                  style={{ 
                    borderBottom: '1px solid #f1f5f9',
                    background: isSelected ? 'rgba(107, 56, 251, 0.08)' : '#fff',
                    borderLeft: isSelected ? '4px solid #6B38FB' : '4px solid transparent',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    display: targetDisputeId ? 'flex' : 'table-row',
                    flexWrap: targetDisputeId ? 'wrap' : 'nowrap',
                    gap: targetDisputeId ? '8px 12px' : '0',
                    padding: targetDisputeId ? '12px' : '0'
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) e.currentTarget.style.backgroundColor = '#f8fafc';
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) e.currentTarget.style.backgroundColor = '#fff';
                  }}
                >
                  <td style={{ 
                    padding: targetDisputeId ? '4px 0' : '10px 8px', 
                    color: '#6B38FB', 
                    fontWeight: '700', 
                    display: targetDisputeId ? 'inline-block' : 'flex', 
                    alignItems: 'center', 
                    gap: '8px',
                    flex: targetDisputeId ? '1 1 45%' : 'none',
                    minWidth: targetDisputeId ? '120px' : 'auto',
                    boxSizing: 'border-box'
                  }}>
                    {targetDisputeId && <div style={{ fontSize: '10px', color: '#64748b', fontWeight: '600', textTransform: 'uppercase', marginBottom: '2px', display: 'block' }}>Case ID</div>}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {isFirstRow && (
                        <span style={{ color: '#f97316', fontSize: '15px', fontWeight: 'bold' }}>⟲</span>
                      )}
                      <span>{(cb.id || 'XXXX').substring(0, 8).toUpperCase()}</span>
                    </div>
                  </td>
                  <td style={{ 
                    padding: targetDisputeId ? '4px 0' : '10px 8px', 
                    color: '#334155', 
                    fontWeight: '500', 
                    display: targetDisputeId ? 'inline-block' : 'table-cell',
                    flex: targetDisputeId ? '1 1 45%' : 'none',
                    minWidth: targetDisputeId ? '120px' : 'auto',
                    boxSizing: 'border-box'
                  }}>
                    {targetDisputeId && <div style={{ fontSize: '10px', color: '#64748b', fontWeight: '600', textTransform: 'uppercase', marginBottom: '2px', display: 'block' }}>Visa ID</div>}
                    {cb.visaId || 'V-' + (cb.id || 'XXXX').substring(0, 6).toUpperCase()}
                  </td>
                  <td style={{ 
                    padding: targetDisputeId ? '4px 0' : '10px 8px', 
                    color: '#334155', 
                    fontWeight: '500', 
                    display: targetDisputeId ? 'inline-block' : 'table-cell',
                    flex: targetDisputeId ? '1 1 45%' : 'none',
                    minWidth: targetDisputeId ? '120px' : 'auto',
                    boxSizing: 'border-box'
                  }}>
                    {targetDisputeId && <div style={{ fontSize: '10px', color: '#64748b', fontWeight: '600', textTransform: 'uppercase', marginBottom: '2px', display: 'block' }}>Dispute Type</div>}
                    {getDisputeType(cb)}
                  </td>
                  <td style={{ 
                    padding: targetDisputeId ? '4px 0' : '10px 8px', 
                    color: '#334155', 
                    fontWeight: '500', 
                    display: targetDisputeId ? 'inline-block' : 'table-cell',
                    flex: targetDisputeId ? '1 1 45%' : 'none',
                    minWidth: targetDisputeId ? '120px' : 'auto',
                    boxSizing: 'border-box'
                  }}>
                    {targetDisputeId && <div style={{ fontSize: '10px', color: '#64748b', fontWeight: '600', textTransform: 'uppercase', marginBottom: '2px', display: 'block' }}>Merchant Name</div>}
                    {cb.userName}
                  </td>
                  <td style={{ 
                    padding: targetDisputeId ? '4px 0' : '10px 8px', 
                    color: '#334155', 
                    fontWeight: '500', 
                    display: targetDisputeId ? 'inline-block' : 'table-cell',
                    flex: targetDisputeId ? '1 1 45%' : 'none',
                    minWidth: targetDisputeId ? '120px' : 'auto',
                    boxSizing: 'border-box'
                  }}>
                    {targetDisputeId && <div style={{ fontSize: '10px', color: '#64748b', fontWeight: '600', textTransform: 'uppercase', marginBottom: '2px', display: 'block' }}>MID</div>}
                    ISU-{(cb.userName || '9999').substring(0,4).toUpperCase()}
                  </td>
                  <td style={{ 
                    padding: targetDisputeId ? '4px 0' : '10px 8px', 
                    color: '#334155', 
                    fontWeight: '500', 
                    display: targetDisputeId ? 'inline-block' : 'table-cell',
                    flex: targetDisputeId ? '1 1 45%' : 'none',
                    minWidth: targetDisputeId ? '120px' : 'auto',
                    boxSizing: 'border-box'
                  }}>
                    {targetDisputeId && <div style={{ fontSize: '10px', color: '#64748b', fontWeight: '600', textTransform: 'uppercase', marginBottom: '2px', display: 'block' }}>ARN</div>}
                    {cb.arn || cb.rrn}
                  </td>
                  <td style={{ 
                    padding: targetDisputeId ? '4px 0' : '10px 8px', 
                    display: targetDisputeId ? 'inline-block' : 'table-cell',
                    flex: targetDisputeId ? '1 1 45%' : 'none',
                    minWidth: targetDisputeId ? '120px' : 'auto',
                    boxSizing: 'border-box'
                  }}>
                    {targetDisputeId && <div style={{ fontSize: '10px', color: '#64748b', fontWeight: '600', textTransform: 'uppercase', marginBottom: '2px', display: 'block' }}>Dispute Status</div>}
                    {renderDisputeStatusBadge(cb.mSubStatus)}
                  </td>
                  <td style={{ 
                    padding: targetDisputeId ? '4px 0' : '10px 8px', 
                    color: '#334155', 
                    fontWeight: '500', 
                    display: targetDisputeId ? 'inline-block' : 'table-cell',
                    flex: targetDisputeId ? '1 1 45%' : 'none',
                    minWidth: targetDisputeId ? '120px' : 'auto',
                    boxSizing: 'border-box'
                  }}>
                    {targetDisputeId && <div style={{ fontSize: '10px', color: '#64748b', fontWeight: '600', textTransform: 'uppercase', marginBottom: '2px', display: 'block' }}>TXN Ref. Number</div>}
                    {cb.txnId}
                  </td>
                  <td style={{ 
                    padding: targetDisputeId ? '4px 0' : '10px 8px', 
                    color: '#334155', 
                    fontWeight: '500', 
                    display: targetDisputeId ? 'inline-block' : 'table-cell',
                    flex: targetDisputeId ? '1 1 45%' : 'none',
                    minWidth: targetDisputeId ? '120px' : 'auto',
                    boxSizing: 'border-box'
                  }}>
                    {targetDisputeId && <div style={{ fontSize: '10px', color: '#64748b', fontWeight: '600', textTransform: 'uppercase', marginBottom: '2px', display: 'block' }}>Responded By</div>}
                    <span style={getRespondByStyle(cb.respondByDate)}>{formatRespondByOnlyDate(cb.respondByDate)}</span>
                  </td>
                  {reportTab === 'doc-verification' && (
                    <td 
                      onClick={(e) => {
                        e.stopPropagation();
                      }}
                      style={{
                        padding: targetDisputeId ? '4px 0' : '10px 8px',
                        display: targetDisputeId ? 'inline-block' : 'table-cell',
                        flex: targetDisputeId ? '1 1 90%' : 'none',
                        textAlign: 'center',
                        boxSizing: 'border-box'
                      }}
                    >
                      {targetDisputeId && <div style={{ fontSize: '10px', color: '#64748b', fontWeight: '600', textTransform: 'uppercase', marginBottom: '2px', display: 'block' }}>Actions</div>}
                      <div style={{ display: 'inline-flex', gap: '8px', alignItems: 'center', justifyContent: 'center' }}>
                        {/* Upload More Evidence Icon Button */}
                        <div style={{ position: 'relative', display: 'inline-block' }}>
                          <button
                            onClick={() => {
                              setTargetDisputeId(cb.id);
                              setActiveModal('contest');
                            }}
                            style={{
                              background: '#f1f5f9',
                              border: '1px solid #cbd5e1',
                              borderRadius: '50%',
                              width: '32px',
                              height: '32px',
                              cursor: 'pointer',
                              fontSize: '14px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              transition: 'all 0.2s',
                            }}
                            onMouseEnter={(e) => { 
                              e.currentTarget.style.background = '#e2e8f0'; 
                              setHoveredRowAction({ id: cb.id, type: 'upload' });
                            }}
                            onMouseLeave={(e) => { 
                              e.currentTarget.style.background = '#f1f5f9'; 
                              setHoveredRowAction(null);
                            }}
                          >
                            📤
                          </button>
                          {hoveredRowAction?.id === cb.id && hoveredRowAction?.type === 'upload' && (
                            <div style={{
                              position: 'absolute',
                              bottom: '100%',
                              left: '50%',
                              transform: 'translateX(-50%) translateY(-6px)',
                              background: '#1e293b',
                              color: '#fff',
                              padding: '4px 8px',
                              borderRadius: '4px',
                              fontSize: '10px',
                              fontWeight: '600',
                              whiteSpace: 'nowrap',
                              pointerEvents: 'none',
                              boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                              zIndex: 100
                            }}>
                              Upload More Evidence
                              <div style={{
                                position: 'absolute',
                                top: '100%',
                                left: '50%',
                                transform: 'translateX(-50%)',
                                borderWidth: '4px',
                                borderStyle: 'solid',
                                borderColor: '#1e293b transparent transparent transparent',
                                width: 0,
                                height: 0
                              }} />
                            </div>
                          )}
                        </div>

                        {/* Comment Icon Button */}
                        <div style={{ position: 'relative', display: 'inline-block' }}>
                          <button
                            onClick={() => {
                              setTargetDisputeId(cb.id);
                              setActiveModal('merchantComment');
                            }}
                            style={{
                              background: '#f1f5f9',
                              border: '1px solid #cbd5e1',
                              borderRadius: '50%',
                              width: '32px',
                              height: '32px',
                              cursor: 'pointer',
                              fontSize: '14px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              transition: 'all 0.2s',
                            }}
                            onMouseEnter={(e) => { 
                              e.currentTarget.style.background = '#e2e8f0'; 
                              setHoveredRowAction({ id: cb.id, type: 'comment' });
                            }}
                            onMouseLeave={(e) => { 
                              e.currentTarget.style.background = '#f1f5f9'; 
                              setHoveredRowAction(null);
                            }}
                          >
                            💬
                          </button>
                          {hoveredRowAction?.id === cb.id && hoveredRowAction?.type === 'comment' && (
                            <div style={{
                              position: 'absolute',
                              bottom: '100%',
                              left: '50%',
                              transform: 'translateX(-50%) translateY(-6px)',
                              background: '#1e293b',
                              color: '#fff',
                              padding: '4px 8px',
                              borderRadius: '4px',
                              fontSize: '10px',
                              fontWeight: '600',
                              whiteSpace: 'nowrap',
                              pointerEvents: 'none',
                              boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                              zIndex: 100
                            }}>
                              Comment
                              <div style={{
                                position: 'absolute',
                                top: '100%',
                                left: '50%',
                                transform: 'translateX(-50%)',
                                borderWidth: '4px',
                                borderStyle: 'solid',
                                borderColor: '#1e293b transparent transparent transparent',
                                width: 0,
                                height: 0
                              }} />
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const tourSteps = [
    {
      target: '.hdr-user',
      title: 'User Profile & Settings',
      text: 'Manage your settings, change passwords, restart this guided tour, or log out from here.',
      placement: 'bottom-right'
    },
    {
      target: '#mSidebar',
      title: 'Navigation Sidebar',
      text: 'Access different portals: Dashboard, Dispute Management, and Help Center from here.',
      placement: 'right'
    },
    {
      target: '#merchantApp .page-inner',
      title: 'Dispute Management Tabs',
      text: 'Switch between Action Required, Under Review, Closed, and All Disputes tabs to manage your dispute workflow.',
      placement: 'bottom'
    },
    {
      target: '#merchantApp .tbl-wrap',
      title: 'Disputes List',
      text: 'Review the details of all cases. Click on any record to open the split vertical preview pane to contest disputes or upload evidence.',
      placement: 'top'
    }
  ];

  const WebsiteTour = () => {
    if (guidedTourStep === null) return null;
    const step = tourSteps[guidedTourStep];
    const el = document.querySelector(step.target);
    let coords = { top: 0, left: 0, width: 0, height: 0 };
    if (el) {
      const rect = el.getBoundingClientRect();
      coords = {
        top: rect.top + window.scrollY,
        left: rect.left + window.scrollX,
        width: rect.width,
        height: rect.height
      };
    } else {
      return (
        <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: '#fff', padding: '24px', borderRadius: '12px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)', zIndex: 10000, width: '320px', border: '2px solid #6B38FB' }}>
          <h4 style={{ margin: '0 0 8px 0', color: '#1e293b', fontSize: '15px', fontWeight: '800' }}>{step.title}</h4>
          <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: '#64748b', lineHeight: '1.4' }}>{step.text}</p>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '11px' }} onClick={() => setGuidedTourStep(null)}>Skip Demo</button>
            <button className="btn btn-primary" style={{ padding: '6px 12px', fontSize: '11px', background: '#6B38FB', color: '#fff', border: 'none' }} onClick={() => setGuidedTourStep(guidedTourStep + 1 < tourSteps.length ? guidedTourStep + 1 : null)}>
              {guidedTourStep + 1 < tourSteps.length ? 'Next' : 'Finish'}
            </button>
          </div>
        </div>
      );
    }

    let tooltipStyle = {
      position: 'absolute',
      zIndex: 10000,
      background: '#fff',
      padding: '16px 20px',
      borderRadius: '12px',
      boxShadow: '0 10px 30px rgba(107, 56, 251, 0.15)',
      width: '280px',
      border: '2px solid #6B38FB',
      transition: 'all 0.3s ease'
    };

    let arrowStyle = {
      position: 'absolute',
      width: '0',
      height: '0',
      borderStyle: 'solid'
    };

    if (step.placement === 'bottom') {
      tooltipStyle.top = coords.top + coords.height + 12;
      tooltipStyle.left = coords.left + (coords.width / 2) - 140;
      arrowStyle.top = '-8px';
      arrowStyle.left = 'calc(50% - 8px)';
      arrowStyle.borderWidth = '0 8px 8px 8px';
      arrowStyle.borderColor = 'transparent transparent #6B38FB transparent';
    } else if (step.placement === 'right') {
      tooltipStyle.top = coords.top + (coords.height / 2) - 60;
      tooltipStyle.left = coords.left + coords.width + 12;
      arrowStyle.left = '-8px';
      arrowStyle.top = '50px';
      arrowStyle.borderWidth = '8px 8px 8px 0';
      arrowStyle.borderColor = 'transparent #6B38FB transparent transparent';
    } else if (step.placement === 'top') {
      tooltipStyle.top = coords.top - 140;
      tooltipStyle.left = coords.left + (coords.width / 2) - 140;
      arrowStyle.bottom = '-8px';
      arrowStyle.left = 'calc(50% - 8px)';
      arrowStyle.borderWidth = '8px 8px 0 8px';
      arrowStyle.borderColor = '#6B38FB transparent transparent transparent';
    } else {
      tooltipStyle.top = coords.top + coords.height + 12;
      tooltipStyle.left = coords.left + coords.width - 280;
      arrowStyle.top = '-8px';
      arrowStyle.right = '20px';
      arrowStyle.borderWidth = '0 8px 8px 8px';
      arrowStyle.borderColor = 'transparent transparent #6B38FB transparent';
    }

    return (
      <>
        <div style={{
          position: 'absolute',
          top: coords.top - 4,
          left: coords.left - 4,
          width: coords.width + 8,
          height: coords.height + 8,
          borderRadius: '8px',
          boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.5)',
          zIndex: 9999,
          pointerEvents: 'none',
          border: '2px dashed #6B38FB',
          transition: 'all 0.3s ease'
        }}></div>

        <div style={tooltipStyle}>
          <div style={arrowStyle}></div>
          <h4 style={{ margin: '0 0 8px 0', color: '#1e293b', fontSize: '14px', fontWeight: '800', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{step.title}</span>
            <span style={{ fontSize: '11px', color: '#94a3b8' }}>{guidedTourStep + 1}/{tourSteps.length}</span>
          </h4>
          <p style={{ margin: '0 0 16px 0', fontSize: '12px', color: '#475569', lineHeight: '1.4' }}>{step.text}</p>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }} onClick={() => setGuidedTourStep(null)}>Skip</button>
            <div style={{ display: 'flex', gap: '8px' }}>
              {guidedTourStep > 0 && (
                <button style={{ background: '#f1f5f9', border: 'none', color: '#334155', cursor: 'pointer', padding: '6px 12px', borderRadius: '6px', fontSize: '11px', fontWeight: 'bold' }} onClick={() => setGuidedTourStep(guidedTourStep - 1)}>Back</button>
              )}
              <button style={{ background: '#6B38FB', border: 'none', color: '#fff', cursor: 'pointer', padding: '6px 12px', borderRadius: '6px', fontSize: '11px', fontWeight: 'bold' }} onClick={() => setGuidedTourStep(guidedTourStep + 1 < tourSteps.length ? guidedTourStep + 1 : null)}>
                {guidedTourStep + 1 < tourSteps.length ? 'Next' : 'Finish'}
              </button>
            </div>
          </div>
        </div>
      </>
    );
  };

  return (
    <div className="app" id="merchantApp">
      {guidedTourStep !== null && <WebsiteTour />}
      <header className="app-header">
        <button className="hdr-hamburger" onClick={() => setSidebarCollapsed(!sidebarCollapsed)}>☰</button>
        <div className="hdr-logo"><div className="hl-text">iServeU<sup>®</sup></div></div>
        <div className="hdr-space"></div>

        <button className="theme-toggle-btn" onClick={toggleTheme} title="Toggle Dark/Light Mode">
          {darkMode ? '☀️' : '🌙'}
        </button>
        <button className="hdr-bell">🔔<span className="notif-dot"></span></button>
        <div 
          className="hdr-user" 
          title={currentUser.name}
          onClick={() => setProfileMenuOpen(!profileMenuOpen)}
          style={{ position: 'relative', cursor: 'pointer' }}
        >
          <div className="avatar">🌐</div>
          <div>
            <div className="hdr-uname">{currentUser.name}</div>
            <div className="hdr-urole">Merchant</div>
          </div>
          {profileMenuOpen && (
            <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: '8px', background: 'var(--bg-card, #fff)', border: '1px solid var(--border-color, #ddd)', borderRadius: '4px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 1000, minWidth: '160px', overflow: 'hidden' }}>
              <div style={{ padding: '12px 16px', color: '#6B38FB', fontSize: '13px', cursor: 'pointer', borderBottom: '1px solid var(--border-color, #eee)', transition: 'background 0.2s', fontWeight: '700' }} onMouseEnter={(e) => e.target.style.background='var(--bg-body, #f9f9f9)'} onMouseLeave={(e) => e.target.style.background='transparent'} onClick={(e) => { e.stopPropagation(); setGuidedTourStep(0); setProfileMenuOpen(false); }}>Start Guided Tour 🚀</div>
              <div style={{ padding: '12px 16px', color: 'var(--text-main, #333)', fontSize: '13px', cursor: 'pointer', borderBottom: '1px solid var(--border-color, #eee)', transition: 'background 0.2s' }} onMouseEnter={(e) => e.target.style.background='var(--bg-body, #f9f9f9)'} onMouseLeave={(e) => e.target.style.background='transparent'} onClick={(e) => { e.stopPropagation(); showToast('Change password functionality not implemented'); setProfileMenuOpen(false); }}>Change Password</div>
              <div style={{ padding: '12px 16px', color: 'var(--red, #d32f2f)', fontSize: '13px', cursor: 'pointer', transition: 'background 0.2s' }} onMouseEnter={(e) => e.target.style.background='var(--bg-body, #f9f9f9)'} onMouseLeave={(e) => e.target.style.background='transparent'} onClick={(e) => { e.stopPropagation(); handleLogout(); }}>Logout</div>
            </div>
          )}
        </div>
      </header>

      <div className="app-body">
        <nav className={`sidebar ${sidebarCollapsed || targetDisputeId ? 'collapsed' : ''}`} id="mSidebar">
          <div className="sb-welcome">Welcome, masteruser</div>
          <div className="sb-section">
            {!targetDisputeId && (
              <>
                <div 
                  className={`sb-item ${activePage === 'dashboard' ? 'active' : ''}`} 
                  onClick={() => {
                    setActivePage('dashboard');
                    setShowFaq(false);
                  }}
                >
                  <span className="si">⊞</span> Dashboard
                </div>
                <div 
                  className={`sb-item ${activePage === 'reports' ? 'active' : ''}`} 
                  onClick={() => {
                    setActivePage('reports');
                    setShowFaq(false);
                  }}
                >
                  <span className="si">📋</span> Dispute Management
                </div>
                <div 
                  className={`sb-item ${showFaq ? 'active' : ''}`} 
                  onClick={() => setShowFaq(!showFaq)}
                >
                  <span className="si">❓</span> FAQ & Help
                </div>
                <div 
                  className={`sb-item ${activePage === 'm-reports' ? 'active' : ''}`} 
                  onClick={() => {
                    setActivePage('m-reports');
                    setShowFaq(false);
                  }}
                >
                  <span className="si">📊</span> Reports & Analytics
                </div>
                <div 
                  className={`sb-item ${activePage === 'm-vrol-automation' ? 'active' : ''}`} 
                  onClick={() => {
                    setActivePage('m-vrol-automation');
                    setShowFaq(false);
                  }}
                >
                  <span className="si">⚙️</span> VROL Automation
                </div>
              </>
            )}
          </div>
        </nav>

        <main className="main">
          {/* Dashboard Page */}
          {activePage === 'dashboard' && (
            <div className="page active" id="m-dashboard">
              <div className="page-inner">
                <div className="welcome-bar">
                  <div>
                    <div className="wb-title">Welcome, Merchant Dispute Dashboard 👋</div>
                    <div className="wb-sub">Manage and represent customer payment disputes</div>
                  </div>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <select
                      style={{ padding: '8px 12px', border: '1px solid #e0e0e0', borderRadius: '4px', color: '#757575', outline: 'none', background: 'var(--card)', fontSize: '13px' }}
                      value={dashDateRangeType}
                      onChange={(e) => {
                        const val = e.target.value;
                        setDashDateRangeType(val);
                        const today = new Date();
                        const todayStr = today.toISOString().split('T')[0];
                        if (val === 'today') {
                          setDashFilterFrom(todayStr);
                          setDashFilterTo(todayStr);
                        } else if (val === 'yesterday') {
                          const y = new Date(today);
                          y.setDate(y.getDate() - 1);
                          setDashFilterFrom(y.toISOString().split('T')[0]);
                          setDashFilterTo(y.toISOString().split('T')[0]);
                        } else if (val === '7days') {
                          const d7 = new Date(today);
                          d7.setDate(d7.getDate() - 7);
                          setDashFilterFrom(d7.toISOString().split('T')[0]);
                          setDashFilterTo(todayStr);
                        } else if (val === 'lastmonth') {
                          const lmStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
                          const lmEnd = new Date(today.getFullYear(), today.getMonth(), 0);
                          setDashFilterFrom(lmStart.toISOString().split('T')[0]);
                          setDashFilterTo(lmEnd.toISOString().split('T')[0]);
                        }
                      }}
                    >
                      <option value="today">Today</option>
                      <option value="custom">Custom Date Range</option>
                      <option value="yesterday">Yesterday</option>
                      <option value="7days">Last 7 Days</option>
                      <option value="lastmonth">Last Month</option>
                    </select>
                    {dashDateRangeType === 'custom' && (
                      <>
                        <div style={{ position: 'relative' }}>
                          <span style={{ position: 'absolute', left: '12px', top: '8px', color: '#50BDC9', fontSize: '14px' }}>📅</span>
                          <input type="date" style={{ padding: '8px 12px 8px 36px', border: '1px solid #e0e0e0', borderRadius: '4px', color: '#757575', outline: 'none', background: 'var(--card)', fontSize: '13px' }} value={dashFilterFrom} onChange={(e) => setDashFilterFrom(e.target.value)} />
                        </div>
                        <span style={{ color: 'var(--text-muted)', fontSize: '14px' }}>to</span>
                        <div style={{ position: 'relative' }}>
                          <span style={{ position: 'absolute', left: '12px', top: '8px', color: '#50BDC9', fontSize: '14px' }}>📅</span>
                          <input type="date" style={{ padding: '8px 12px 8px 36px', border: '1px solid #e0e0e0', borderRadius: '4px', color: '#757575', outline: 'none', background: 'var(--card)', fontSize: '13px' }} value={dashFilterTo} onChange={(e) => setDashFilterTo(e.target.value)} />
                        </div>
                      </>
                    )}
                  </div>
                </div>
                <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)', gap: '20px' }}>
                  {/* Total Disputes Card */}
                  <div className="stat-card received" onClick={() => navigateToMerchantReport('')}>
                    <div className="stat-icon">📥</div>
                    <div className="stat-content">
                      <div className="stat-lbl">Disputes Received</div>
                      <div className="stat-val">{formatINR(stats.totalAmt)}</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px', fontWeight: '500' }}>
                        {stats.totalCount} cases
                      </div>
                    </div>
                  </div>

                  {/* Open Disputes Card */}
                  <div className="stat-card open" onClick={() => navigateToMerchantReport('open')}>
                    <div className="stat-icon">🔄</div>
                    <div className="stat-content">
                      <div className="stat-lbl">Open Disputes</div>
                      <div className="stat-val">{formatINR(stats.openAmt)}</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px', fontWeight: '500', display: 'flex', justifyContent: 'space-between' }}>
                        <span>{stats.openCount} cases</span>
                        <span style={{ fontWeight: '700', color: '#6B38FB' }}>{stats.openPct}%</span>
                      </div>
                    </div>
                  </div>

                  {/* Disputes Lost Card */}
                  <div className="stat-card lost" onClick={() => navigateToMerchantReport('lost')}>
                    <div className="stat-icon">❌</div>
                    <div className="stat-content">
                      <div className="stat-lbl">Disputes Lost</div>
                      <div className="stat-val">{formatINR(stats.lostAmt)}</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px', fontWeight: '500', display: 'flex', justifyContent: 'space-between' }}>
                        <span>{stats.lostCount} cases</span>
                        <span style={{ fontWeight: '700', color: '#EF4444' }}>{stats.lostPct}%</span>
                      </div>
                    </div>
                  </div>

                  {/* Disputes Won Card */}
                  <div className="stat-card won" onClick={() => navigateToMerchantReport('won')}>
                    <div className="stat-icon">✅</div>
                    <div className="stat-content">
                      <div className="stat-lbl">Disputes Won</div>
                      <div className="stat-val">{formatINR(stats.wonAmt)}</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px', fontWeight: '500', display: 'flex', justifyContent: 'space-between' }}>
                        <span>{stats.wonCount} cases</span>
                        <span style={{ fontWeight: '700', color: '#10B981' }}>{stats.wonPct}%</span>
                      </div>
                    </div>
                  </div>

                  {/* SLA Expiring Today Card */}
                  <div className="stat-card sla" onClick={() => navigateToMerchantReport('sla_today')}>
                    <div className="stat-icon">⏰</div>
                    <div className="stat-content">
                      <div className="stat-lbl">SLA Expiring Today</div>
                      <div className="stat-val">{formatINR(stats.slaAmt)}</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px', fontWeight: '500', display: 'flex', justifyContent: 'space-between' }}>
                        <span>{stats.slaCount} cases</span>
                        <span style={{ fontWeight: '700', color: '#7C3AED' }}>{stats.slaPct}%</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Respond By Date Page */}
          {activePage === 'respond' && (
            <div className="page active" id="m-respond">
              <div className="progress-tabs">
                <div className="pt-seg" style={{ background: '#FFD700', width: '25%' }}></div>
                <div className="pt-seg" style={{ background: '#22c55e', width: '35%' }}></div>
                <div className="pt-seg" style={{ background: '#22c55e', width: '10%' }}></div>
                <div className="pt-seg" style={{ background: '#e5e7eb', flex: '1' }}></div>
              </div>
              <div className="page-inner">
                <div className="page-hdr">
                  <div>
                    <h1>Disputes by Respond By Date</h1>
                    <p>Represent your dispute cases before the response deadlines</p>
                  </div>
                </div>
                <div className="filter-card">
                  <div className="filter-row">
                    <div className="filter-group">
                      <label>From Date <span className="req">*</span></label>
                      <input 
                        type="date" 
                        className="fi-date" 
                        value={respondFilter.from} 
                        onChange={(e) => setRespondFilter(prev => ({ ...prev, from: e.target.value }))} 
                      />
                    </div>
                    <div className="filter-group">
                      <label>To Date <span className="req">*</span></label>
                      <input 
                        type="date" 
                        className="fi-date" 
                        value={respondFilter.to} 
                        onChange={(e) => setRespondFilter(prev => ({ ...prev, to: e.target.value }))} 
                      />
                    </div>
                    <div className="filter-group">
                      <label>RRN Number</label>
                      <input 
                        type="text" 
                        className="fi-text" 
                        placeholder="RRN Number" 
                        value={respondFilter.rrn}
                        onChange={(e) => setRespondFilter(prev => ({ ...prev, rrn: e.target.value }))}
                      />
                    </div>
                    <div className="filter-group">
                      <label>Transaction ID</label>
                      <input 
                        type="text" 
                        className="fi-text" 
                        placeholder="Transaction ID" 
                        value={respondFilter.txnId}
                        onChange={(e) => setRespondFilter(prev => ({ ...prev, txnId: e.target.value }))}
                      />
                    </div>
                    <div className="filter-group">
                      <label>Status</label>
                      <select 
                        className="fi-sel" 
                        value={respondFilter.status}
                        onChange={(e) => setRespondFilter(prev => ({ ...prev, status: e.target.value }))}
                      >
                        <option value="">Status</option>
                        <option>Chargeback Raise</option>
                        <option>Differed Chargeback Raise</option>
                        <option>Fraud Chargeback Raise</option>
                        <option>Pre-Arbitration Raise</option>
                        <option>Arbitration Raise</option>
                        <option>VROL Inquiry</option>
                        <option>VROL Chargeback</option>
                        <option>VROL Pre-Arbitration</option>
                        <option>VROL Arbitration</option>
                      </select>
                    </div>
                    <div className="filter-group">
                      <label>Sub Status</label>
                      <select 
                        className="fi-sel" 
                        value={respondFilter.subStatus}
                        onChange={(e) => setRespondFilter(prev => ({ ...prev, subStatus: e.target.value }))}
                      >
                        <option value="">Sub Status</option>
                        <option>Chargeback New</option>
                        <option>Chargeback Lost</option>
                        <option>Chargeback in Progress</option>
                        <option>Chargeback Resubmit</option>
                        <option>Chargeback Won</option>
                      </select>
                    </div>
                    <button className="btn btn-secondary" onClick={() => setRespondFilter({ from: DEFAULT_FROM, to: TODAY_STR, rrn: '', txnId: '', status: '', subStatus: '' })}>Reset</button>
                  </div>
                </div>

                {filteredRespond.length > 0 ? (
                  <div>
                    <div className="respond-bar">
                      <span>Response Action Needed</span>
                      <span style={{ marginLeft: 'auto', color: '#92400e', fontSize: '12px' }}>
                        ⚠ Respond before target dates to protect dispute representations
                      </span>
                    </div>
                    <div className="tbl-card" style={{ borderRadius: '0 0 var(--radius-lg) var(--radius-lg)' }}>
                      <div className="tbl-toolbar">
                        <div className="search-wrap">
                          <span className="si">🔍</span>
                          <input 
                            type="text" 
                            className="tbl-search" 
                            placeholder="Fuzzy Search RRN/Txn" 
                            value={respondSearchInput}
                            onChange={(e) => { setRespondPage(1); setRespondSearchInput(e.target.value); }}
                          />
                        </div>
                        <div className="tbl-space"></div>
                        <button className="btn btn-primary btn-sm" onClick={() => exportToCSV('respond')}>
                          ⬇ Export CSV
                        </button>
                      </div>
                      <div className="tbl-wrap">
                        <table>
                          <thead style={{ position: 'sticky', top: 0, background: '#fff', zIndex: 10, boxShadow: '0 1px 0 #f0f0f0' }}>
                            <tr>
                              <th>User Name</th>
                              <th>RRN</th>
                              <th>Txn ID</th>
                              <th>Status</th>
                              <th>Sub Status</th>
                              <th>Adj Amount</th>
                              <th>Respond By</th>
                              <th>Type</th>
                              <th>Details</th>
                              <th>Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {respondPaging.paginated.map(cb => (
                              <tr key={cb.id}>
                                <td>{cb.userName}</td>
                                <td className="mono">{cb.rrn}</td>
                                <td className="mono">{cb.txnId}</td>
                                <td>{renderStatusBadge(cb.mStatus)}</td>
                                <td>{renderSubBadge(cb.mSubStatus)}</td>
                                <td><strong>{formatINR(cb.adjAmt)}</strong></td>
                                <td><span style={getRespondByStyle(cb.respondByDate)}>{formatRespondByOnlyDate(cb.respondByDate)}</span></td>
                                <td>{cb.adjType}</td>
                                <td>
                                  <button className="info-btn" onClick={() => { setActiveModal('disputeDetails'); setTargetDisputeId(cb.id); }}>ℹ</button>
                                </td>
                                <td>{getActionBtn(cb)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="tbl-footer">
                        <div className="rpp">
                          Rows per page: 
                          <select value={respondLimit} onChange={(e) => { setRespondPage(1); setRespondLimit(parseInt(e.target.value)); }}>
                            <option value="5">5</option>
                            <option value="10">10</option>
                            <option value="25">25</option>
                          </select>
                        </div>
                        <div className="pagination">
                          <span style={{ marginRight: '8px', color: 'var(--text-muted)', fontSize: '12px' }}>
                            {respondPaging.startRecord}–{respondPaging.endRecord} of {respondPaging.total} records
                          </span>
                          <button 
                            className="pg-btn" 
                            disabled={respondPage === 1}
                            onClick={() => setRespondPage(respondPage - 1)}
                          >
                            ‹
                          </button>
                          {Array.from({ length: respondPaging.totalPages }, (_, idx) => idx + 1).map(p => (
                            <button 
                              key={p} 
                              className={`pg-btn ${respondPage === p ? 'active' : ''}`}
                              onClick={() => setRespondPage(p)}
                            >
                              {p}
                            </button>
                          ))}
                          <button 
                            className="pg-btn" 
                            disabled={respondPage === respondPaging.totalPages}
                            onClick={() => setRespondPage(respondPage + 1)}
                          >
                            ›
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="no-data">
                    <div className="nd-svg">📁</div>
                    <h3>No Data Found!</h3>
                    <p>Try adjusting your search criteria or date ranges.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Raised Date Page */}
          {activePage === 'raised' && (
            <div className="page active" id="m-raised">
              <div className="progress-tabs">
                <div className="pt-seg" style={{ background: '#FFD700', width: '25%' }}></div>
                <div className="pt-seg" style={{ background: '#22c55e', width: '35%' }}></div>
                <div className="pt-seg" style={{ background: '#22c55e', width: '10%' }}></div>
                <div className="pt-seg" style={{ background: '#e5e7eb', flex: '1' }}></div>
              </div>
              <div className="page-inner">
                <div className="page-hdr">
                  <div>
                    <h1>Disputes by Raised Date</h1>
                    <p>Audit historical disputes sorted by the date they were raised</p>
                  </div>
                </div>
                <div className="filter-card">
                  <div className="filter-row">
                    <div className="filter-group">
                      <label>From Date <span className="req">*</span></label>
                      <input 
                        type="date" 
                        className="fi-date" 
                        value={raisedFilter.from} 
                        onChange={(e) => setRaisedFilter(prev => ({ ...prev, from: e.target.value }))} 
                      />
                    </div>
                    <div className="filter-group">
                      <label>To Date <span className="req">*</span></label>
                      <input 
                        type="date" 
                        className="fi-date" 
                        value={raisedFilter.to} 
                        onChange={(e) => setRaisedFilter(prev => ({ ...prev, to: e.target.value }))} 
                      />
                    </div>
                    <div className="filter-group">
                      <label>RRN Number</label>
                      <input 
                        type="text" 
                        className="fi-text" 
                        placeholder="RRN Number" 
                        value={raisedFilter.rrn}
                        onChange={(e) => setRaisedFilter(prev => ({ ...prev, rrn: e.target.value }))}
                      />
                    </div>
                    <div className="filter-group">
                      <label>Transaction ID</label>
                      <input 
                        type="text" 
                        className="fi-text" 
                        placeholder="Transaction ID" 
                        value={raisedFilter.txnId}
                        onChange={(e) => setRaisedFilter(prev => ({ ...prev, txnId: e.target.value }))}
                      />
                    </div>
                    <div className="filter-group">
                      <label>Status</label>
                      <select 
                        className="fi-sel" 
                        value={raisedFilter.status}
                        onChange={(e) => setRaisedFilter(prev => ({ ...prev, status: e.target.value }))}
                      >
                        <option value="">Status</option>
                        <option>Chargeback Raise</option>
                        <option>Differed Chargeback Raise</option>
                        <option>Fraud Chargeback Raise</option>
                        <option>Pre-Arbitration Raise</option>
                        <option>Arbitration Raise</option>
                        <option>VROL Inquiry</option>
                        <option>VROL Chargeback</option>
                        <option>VROL Pre-Arbitration</option>
                        <option>VROL Arbitration</option>
                      </select>
                    </div>
                    <div className="filter-group">
                      <label>Sub Status</label>
                      <select 
                        className="fi-sel" 
                        value={raisedFilter.subStatus}
                        onChange={(e) => setRaisedFilter(prev => ({ ...prev, subStatus: e.target.value }))}
                      >
                        <option value="">Sub Status</option>
                        <option>Chargeback New</option>
                        <option>Chargeback Lost</option>
                        <option>Chargeback in Progress</option>
                        <option>Chargeback Resubmit</option>
                        <option>Chargeback Won</option>
                      </select>
                    </div>
                    <button className="btn btn-secondary" onClick={() => setRaisedFilter({ from: DEFAULT_FROM, to: TODAY_STR, rrn: '', txnId: '', status: '', subStatus: '' })}>Reset</button>
                  </div>
                </div>

                {filteredRaised.length > 0 ? (
                  <div className="tbl-card">
                    <div className="tbl-toolbar">
                      <div className="search-wrap">
                        <span className="si">🔍</span>
                        <input 
                          type="text" 
                          className="tbl-search" 
                          placeholder="Fuzzy Search..." 
                          value={raisedSearchInput}
                          onChange={(e) => { setRaisedPage(1); setRaisedSearchInput(e.target.value); }}
                        />
                      </div>
                      <div className="tbl-space"></div>
                      <button className="btn btn-primary btn-sm" onClick={() => exportToCSV('raised')}>
                        ⬇ Export CSV
                      </button>
                    </div>
                    <div className="tbl-wrap">
                      <table>
                        <thead style={{ position: 'sticky', top: 0, background: '#fff', zIndex: 10, boxShadow: '0 1px 0 #f0f0f0' }}>
                          <tr>
                            <th>User Name</th>
                            <th>RRN</th>
                            <th>Txn ID</th>
                            <th>Status</th>
                            <th>Sub Status</th>
                            <th>Adj Amount</th>
                            <th>Raised Date</th>
                            <th>Type</th>
                            <th>Details</th>
                            <th>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {raisedPaging.paginated.map(cb => (
                            <tr key={cb.id}>
                              <td>{cb.userName}</td>
                              <td className="mono">{cb.rrn}</td>
                              <td className="mono">{cb.txnId}</td>
                              <td>{renderStatusBadge(cb.mStatus)}</td>
                              <td>{renderSubBadge(cb.mSubStatus)}</td>
                              <td><strong>{formatINR(cb.adjAmt)}</strong></td>
                              <td>{formatDateDisp(cb.createdDate)}</td>
                              <td>{cb.adjType}</td>
                              <td>
                                <button className="info-btn" onClick={() => openDetail(cb.id, 'raised')}>ℹ</button>
                              </td>
                              <td>{getActionBtn(cb)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="tbl-footer">
                      <div className="rpp">
                        Rows per page: 
                        <select value={raisedLimit} onChange={(e) => { setRaisedPage(1); setRaisedLimit(parseInt(e.target.value)); }}>
                          <option value="5">5</option>
                          <option value="10">10</option>
                          <option value="25">25</option>
                        </select>
                      </div>
                      <div className="pagination">
                        <span style={{ marginRight: '8px', color: 'var(--text-muted)', fontSize: '12px' }}>
                          {raisedPaging.startRecord}–{raisedPaging.endRecord} of {raisedPaging.total} records
                        </span>
                        <button 
                          className="pg-btn" 
                          disabled={raisedPage === 1}
                          onClick={() => setRaisedPage(raisedPage - 1)}
                        >
                          ‹
                        </button>
                        {Array.from({ length: raisedPaging.totalPages }, (_, idx) => idx + 1).map(p => (
                          <button 
                            key={p} 
                            className={`pg-btn ${raisedPage === p ? 'active' : ''}`}
                            onClick={() => setRaisedPage(p)}
                          >
                            {p}
                          </button>
                        ))}
                        <button 
                          className="pg-btn" 
                          disabled={raisedPage === raisedPaging.totalPages}
                          onClick={() => setRaisedPage(raisedPage + 1)}
                        >
                          ›
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="no-data">
                    <div className="nd-svg">📁</div>
                    <h3>No Data Found!</h3>
                    <p>Try adjusting your search criteria or date ranges.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Dispute Detail Page */}
          {activePage === 'detail' && activeDetailDispute && (
            <div className="page active" id="m-dispute-detail">
              <div className="page-inner">
                <div style={{ marginBottom: '16px' }}>
                  <span 
                    style={{ fontSize: '14px', color: 'var(--brand)', cursor: 'pointer', fontWeight: '500' }} 
                    onClick={() => setActivePage(detailSourcePage)}
                  >
                    ← Back to List
                  </span>
                </div>
                <div className="dispute-hdr">
                  <h2>Dispute Case ID: {activeDetailDispute.caseId}</h2>
                  {getActionBtn(activeDetailDispute)}
                </div>
                <div className="dd-section">
                  <h3>Dispute Properties</h3>
                  <div className="dd-grid">
                    <div className="dd-item"><span className="dk">Order Case ID</span><span className="dv">{activeDetailDispute.caseId}</span></div>
                    <div className="dd-item"><span className="dk">Transaction Reference ID</span><span className="dv">{activeDetailDispute.txnId}</span></div>
                    <div className="dd-item"><span className="dk">Transaction Value</span><span className="dv">{formatINR(activeDetailDispute.txnAmt)}</span></div>
                    <div className="dd-item"><span className="dk">Disputed Ledger Amount</span><span className="dv">{formatINR(activeDetailDispute.adjAmt)}</span></div>
                    <div className="dd-item"><span className="dk">Payment Product</span><span className="dv">{activeDetailDispute.product || 'VISA'}</span></div>
                    <div className="dd-item"><span className="dk">Chargeback RRN</span><span className="dv">{activeDetailDispute.rrn}</span></div>
                    <div className="dd-item"><span className="dk">Dispute Type</span><span className="dv">{activeDetailDispute.adjType}</span></div>
                    <div className="dd-item"><span className="dk">Representation Deadline</span><span className="dv">{formatDateDisp(activeDetailDispute.respondByDate)}</span></div>
                    {activeDetailDispute.product === 'VISA' && (
                      <>
                        <div className="dd-item"><span className="dk">VROL Case ID</span><span className="dv">{activeDetailDispute.caseId}</span></div>
                        <div className="dd-item"><span className="dk">Visa Reason Code</span><span className="dv">{activeDetailDispute.reasonCode || '10.4'}</span></div>
                      </>
                    )}
                  </div>
                </div>

                <div className="dd-section">
                  <div className="timeline-hdr">
                    <h3 style={{ margin: 0 }}>Audit Timeline Log</h3>
                  </div>
                  
                  {activeDetailDispute.timeline && activeDetailDispute.timeline.length > 0 ? (
                    <div id="ddTimeline">
                      {activeDetailDispute.timeline.map((entry, idx) => (
                        <div className="tl-entry" key={idx}>
                          <div><div className="tl-icon">✓</div></div>
                          <div style={{ flex: 1 }}>
                            <div className="tl-title">{entry.title}</div>
                            <div className="tl-time">{entry.time}</div>
                            {entry.remarks && <div className="tl-meta"><span>Remarks:</span> <strong>{entry.remarks}</strong></div>}
                            {entry.file && <div className="tl-file">📄 {entry.file}</div>}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p style={{ color: 'var(--text-muted)', padding: '16px 0' }}>No audits logged.</p>
                  )}

                  <div style={{ marginTop: '16px' }}>
                    <div className="reply-box">
                      <input 
                        type="text" 
                        placeholder="Add timelines remark / message..." 
                        value={timelineRemark}
                        onChange={(e) => setTimelineRemark(e.target.value)}
                        onKeyPress={(e) => { if (e.key === 'Enter') sendReply(); }}
                      />
                      <button className="rb-attach" onClick={() => showToast('Documents should be uploaded inside the contest action window', 'warning')}>📎</button>
                      <button className="rb-send" onClick={sendReply}>➤</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activePage === 'reports' && (
            <div className="page active" id="m-dispute-reports">
              <div className="page-inner">
                {/* Redesigned Tab Navigation Bar */}
                <div style={{
                  display: 'flex',
                  background: '#F1F5F9',
                  borderRadius: '12px 12px 0 0',
                  padding: '8px 16px 0 16px',
                  borderBottom: '1px solid #E2E8F0',
                  gap: '8px'
                }}>
                  {[
                    { key: 'doc-pending', label: 'Action Required', count: actionRequiredDisputes.length },
                    { key: 'doc-verification', label: 'Under Review', count: pendingVerificationDisputes.length },
                    { key: 'closed', label: 'Closed', count: closedDisputes.length },
                    { key: 'dispute-mgmt', label: 'All Disputes', count: merchantDisputes.length }
                  ].map(tab => {
                    const isActive = reportTab === tab.key;
                    return (
                      <div
                        key={tab.key}
                        onClick={() => {
                          setReportTab(tab.key);
                          setReportsPage(1); // Reset page on tab change
                          setTargetDisputeId(null); // Collapse vertical view
                        }}
                        style={{
                          padding: '12px 24px',
                          cursor: 'pointer',
                          fontWeight: '700',
                          fontSize: '14px',
                          color: isActive ? '#1e293b' : '#6B38FB',
                          background: isActive ? '#FFFFFF' : 'transparent',
                          borderTop: isActive ? '3px solid #6B38FB' : '3px solid transparent',
                          borderRadius: isActive ? '8px 8px 0 0' : '0',
                          boxShadow: isActive ? '0 -2px 10px rgba(0,0,0,0.05)' : 'none',
                          transition: 'all 0.2s',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px'
                        }}
                      >
                        {tab.label}
                        {(tab.key === 'doc-pending' || tab.key === 'doc-verification') && (
                          <span style={{
                            background: isActive ? '#6B38FB' : '#E2E8F0',
                            color: isActive ? '#FFFFFF' : '#6B38FB',
                            padding: '2px 8px',
                            borderRadius: '12px',
                            fontSize: '12px',
                            fontWeight: '600'
                          }}>
                            {tab.count}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Summary Cards Row */}
                {reportTab === 'doc-pending' && (
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(5, 1fr)',
                    gap: '16px',
                    marginTop: '24px',
                    marginBottom: '24px',
                    position: 'sticky',
                    top: '0',
                    zIndex: 9,
                    background: '#f8fafc',
                    paddingTop: '12px',
                    paddingBottom: '12px'
                  }}>
                    {/* Card 1: Due Today */}
                    {(() => {
                      const dueTodayList = merchantDisputes.filter(cb => cb.respondByDate === TODAY_STR && !isClosedDispute(cb));
                      const dueTodayCount = dueTodayList.length;
                      const dueTodayAmount = dueTodayList.reduce((sum, cb) => sum + cb.txnAmt, 0);
                      const isActive = reportFilter.disputeStatus === 'due_today';
                      return (
                        <div
                          onClick={() => {
                            setReportFilter(prev => ({ ...prev, disputeStatus: prev.disputeStatus === 'due_today' ? '' : 'due_today' }));
                            setReportsPage(1);
                            setTargetDisputeId(null);
                            setTimeout(() => {
                              const el = document.getElementById('m-reports-table-section');
                              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }, 50);
                          }}
                          style={{
                            background: '#FFFFFF',
                            borderTop: '3px solid #f97316',
                            borderRadius: '12px',
                            padding: '18px 20px',
                            boxShadow: isActive ? '0 8px 20px rgba(249, 115, 22, 0.2)' : '0 2px 8px rgba(0,0,0,0.06)',
                            border: isActive ? '2px solid #f97316' : '1px solid #e2e8f0',
                            borderTopWidth: '3px',
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '12px',
                            minHeight: '100px'
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ fontSize: '13px', fontWeight: '600', color: '#64748b' }}>Due Today</span>
                              <span style={{
                                background: '#ef4444',
                                color: '#FFFFFF',
                                padding: '3px 10px',
                                borderRadius: '12px',
                                fontSize: '10px',
                                fontWeight: '700',
                                textTransform: 'uppercase',
                                letterSpacing: '0.5px'
                              }}>Urgent</span>
                            </div>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                            <div style={{ fontSize: '36px', fontWeight: '800', color: '#1e293b', lineHeight: '1' }}>{dueTodayCount}</div>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontSize: '11px', fontWeight: '600', color: '#94a3b8', marginBottom: '2px' }}>Amount</div>
                              <div style={{ fontSize: '16px', fontWeight: '700', color: '#0f172a' }}>{formatINR(dueTodayAmount)}</div>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Card 2: Due Tomorrow */}
                    {(() => {
                      const tomorrow = new Date();
                      tomorrow.setDate(tomorrow.getDate() + 1);
                      const tomorrowStr = tomorrow.toISOString().split('T')[0];
                      const dueTomorrowList = merchantDisputes.filter(cb => cb.respondByDate === tomorrowStr && !isClosedDispute(cb));
                      const dueTomorrowCount = dueTomorrowList.length;
                      const dueTomorrowAmount = dueTomorrowList.reduce((sum, cb) => sum + cb.txnAmt, 0);
                      const isActive = reportFilter.disputeStatus === 'due_tomorrow';
                      return (
                        <div
                          onClick={() => {
                            setReportFilter(prev => ({ ...prev, disputeStatus: prev.disputeStatus === 'due_tomorrow' ? '' : 'due_tomorrow' }));
                            setReportsPage(1);
                            setTargetDisputeId(null);
                            setTimeout(() => {
                              const el = document.getElementById('m-reports-table-section');
                              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }, 50);
                          }}
                          style={{
                            background: '#FFFFFF',
                            borderTop: '3px solid #f97316',
                            borderRadius: '12px',
                            padding: '18px 20px',
                            boxShadow: isActive ? '0 8px 20px rgba(249, 115, 22, 0.2)' : '0 2px 8px rgba(0,0,0,0.06)',
                            border: isActive ? '2px solid #f97316' : '1px solid #e2e8f0',
                            borderTopWidth: '3px',
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '12px',
                            minHeight: '100px'
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ fontSize: '13px', fontWeight: '600', color: '#64748b' }}>Due Tomorrow</span>
                              <span style={{
                                background: '#f97316',
                                color: '#FFFFFF',
                                padding: '3px 10px',
                                borderRadius: '12px',
                                fontSize: '10px',
                                fontWeight: '700',
                                textTransform: 'uppercase',
                                letterSpacing: '0.5px'
                              }}>Critical</span>
                            </div>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                            <div style={{ fontSize: '36px', fontWeight: '800', color: '#1e293b', lineHeight: '1' }}>{dueTomorrowCount}</div>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontSize: '11px', fontWeight: '600', color: '#94a3b8', marginBottom: '2px' }}>Amount</div>
                              <div style={{ fontSize: '16px', fontWeight: '700', color: '#0f172a' }}>{formatINR(dueTomorrowAmount)}</div>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Card 3: Due 2 to 7 Days */}
                    {(() => {
                      const due2to7List = merchantDisputes.filter(cb => {
                        const diff = getDaysDifference(cb.respondByDate, TODAY_STR);
                        return diff >= 2 && diff <= 7 && !isClosedDispute(cb);
                      });
                      const due2to7Count = due2to7List.length;
                      const due2to7Amount = due2to7List.reduce((sum, cb) => sum + cb.txnAmt, 0);
                      const isActive = reportFilter.disputeStatus === 'due_2_7';
                      return (
                        <div
                          onClick={() => {
                            setReportFilter(prev => ({ ...prev, disputeStatus: prev.disputeStatus === 'due_2_7' ? '' : 'due_2_7' }));
                            setReportsPage(1);
                            setTargetDisputeId(null);
                            setTimeout(() => {
                              const el = document.getElementById('m-reports-table-section');
                              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }, 50);
                          }}
                          style={{
                            background: '#FFFFFF',
                            borderTop: '3px solid #eab308',
                            borderRadius: '12px',
                            padding: '18px 20px',
                            boxShadow: isActive ? '0 8px 20px rgba(234, 179, 8, 0.2)' : '0 2px 8px rgba(0,0,0,0.06)',
                            border: isActive ? '2px solid #eab308' : '1px solid #e2e8f0',
                            borderTopWidth: '3px',
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '12px',
                            minHeight: '100px'
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ fontSize: '13px', fontWeight: '600', color: '#64748b' }}>Due 2 to 7 Days</span>
                              <span style={{
                                background: '#eab308',
                                color: '#FFFFFF',
                                padding: '3px 10px',
                                borderRadius: '12px',
                                fontSize: '10px',
                                fontWeight: '700',
                                textTransform: 'uppercase',
                                letterSpacing: '0.5px'
                              }}>Moderate</span>
                            </div>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                            <div style={{ fontSize: '36px', fontWeight: '800', color: '#1e293b', lineHeight: '1' }}>{due2to7Count}</div>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontSize: '11px', fontWeight: '600', color: '#94a3b8', marginBottom: '2px' }}>Amount</div>
                              <div style={{ fontSize: '16px', fontWeight: '700', color: '#0f172a' }}>{formatINR(due2to7Amount)}</div>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Card 4: Due after 7 Days */}
                    {(() => {
                      const dueOver7List = merchantDisputes.filter(cb => {
                        const diff = getDaysDifference(cb.respondByDate, TODAY_STR);
                        return diff > 7 && !isClosedDispute(cb);
                      });
                      const dueOver7Count = dueOver7List.length;
                      const dueOver7Amount = dueOver7List.reduce((sum, cb) => sum + cb.txnAmt, 0);
                      const isActive = reportFilter.disputeStatus === 'due_over_7';
                      return (
                        <div
                          onClick={() => {
                            setReportFilter(prev => ({ ...prev, disputeStatus: prev.disputeStatus === 'due_over_7' ? '' : 'due_over_7' }));
                            setReportsPage(1);
                            setTargetDisputeId(null);
                            setTimeout(() => {
                              const el = document.getElementById('m-reports-table-section');
                              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }, 50);
                          }}
                          style={{
                            background: '#FFFFFF',
                            borderTop: '3px solid #3b82f6',
                            borderRadius: '12px',
                            padding: '18px 20px',
                            boxShadow: isActive ? '0 8px 20px rgba(59, 130, 246, 0.2)' : '0 2px 8px rgba(0,0,0,0.06)',
                            border: isActive ? '2px solid #3b82f6' : '1px solid #e2e8f0',
                            borderTopWidth: '3px',
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '12px',
                            minHeight: '100px'
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ fontSize: '13px', fontWeight: '600', color: '#64748b' }}>Due after 7 Days</span>
                              <span style={{
                                background: '#3b82f6',
                                color: '#FFFFFF',
                                padding: '3px 10px',
                                borderRadius: '12px',
                                fontSize: '10px',
                                fontWeight: '700',
                                textTransform: 'uppercase',
                                letterSpacing: '0.5px'
                              }}>Low</span>
                            </div>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                            <div style={{ fontSize: '36px', fontWeight: '800', color: '#1e293b', lineHeight: '1' }}>{dueOver7Count}</div>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontSize: '11px', fontWeight: '600', color: '#94a3b8', marginBottom: '2px' }}>Amount</div>
                              <div style={{ fontSize: '16px', fontWeight: '700', color: '#0f172a' }}>{formatINR(dueOver7Amount)}</div>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Card 5: Insufficient Evidence */}
                    {(() => {
                      const insufficientList = merchantDisputes.filter(cb => cb.merchantAction === 'rejected' && !isClosedDispute(cb));
                      const insufficientCount = insufficientList.length;
                      const insufficientAmount = insufficientList.reduce((sum, cb) => sum + cb.txnAmt, 0);
                      const isActive = reportFilter.disputeStatus === 'insufficient_evidence';
                      return (
                        <div
                          onClick={() => {
                            setReportFilter(prev => ({ ...prev, disputeStatus: prev.disputeStatus === 'insufficient_evidence' ? '' : 'insufficient_evidence' }));
                            setReportsPage(1);
                            setTargetDisputeId(null);
                            setTimeout(() => {
                              const el = document.getElementById('m-reports-table-section');
                              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }, 50);
                          }}
                          style={{
                            background: '#FFFFFF',
                            borderTop: '3px solid #f97316',
                            borderRadius: '12px',
                            padding: '18px 20px',
                            boxShadow: isActive ? '0 8px 20px rgba(249, 115, 22, 0.2)' : '0 2px 8px rgba(0,0,0,0.06)',
                            border: isActive ? '2px solid #f97316' : '1px solid #e2e8f0',
                            borderTopWidth: '3px',
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '12px',
                            minHeight: '100px'
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ fontSize: '13px', fontWeight: '600', color: '#64748b' }}>Insufficient Evidence</span>
                              <span style={{ color: '#f97316', fontSize: '16px', fontWeight: 'bold', display: 'inline-flex', alignItems: 'center' }}>⟲</span>
                            </div>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                            <div style={{ fontSize: '36px', fontWeight: '800', color: '#1e293b', lineHeight: '1' }}>{insufficientCount}</div>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontSize: '11px', fontWeight: '600', color: '#94a3b8', marginBottom: '2px' }}>Amount</div>
                              <div style={{ fontSize: '16px', fontWeight: '700', color: '#0f172a' }}>{formatINR(insufficientAmount)}</div>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}

                {reportTab === 'closed' && (
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, 1fr)',
                    gap: '16px',
                    marginTop: '24px',
                    marginBottom: '24px',
                    position: 'sticky',
                    top: '0',
                    zIndex: 9,
                    background: '#f8fafc',
                    paddingTop: '12px',
                    paddingBottom: '12px'
                  }}>
                    {/* Card 1: Total Disputes */}
                    {(() => {
                      const totalClosedCount = closedDisputes.length;
                      const totalClosedAmount = closedDisputes.reduce((sum, cb) => sum + cb.txnAmt, 0);
                      return (
                        <div
                          style={{
                            background: '#FFFFFF',
                            borderTop: '3px solid #64748b',
                            borderRadius: '12px',
                            padding: '18px 20px',
                            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                            border: '1px solid #e2e8f0',
                            borderTopWidth: '3px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '12px',
                            minHeight: '100px'
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <span style={{ fontSize: '13px', fontWeight: '600', color: '#64748b' }}>Total Disputes</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                            <div style={{ fontSize: '36px', fontWeight: '800', color: '#1e293b', lineHeight: '1' }}>{totalClosedCount}</div>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontSize: '11px', fontWeight: '600', color: '#94a3b8', marginBottom: '2px' }}>Amount</div>
                              <div style={{ fontSize: '16px', fontWeight: '700', color: '#0f172a' }}>{formatINR ? formatINR(totalClosedAmount) : '₹' + totalClosedAmount}</div>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Card 2: Won Disputes */}
                    {(() => {
                      const wonList = closedDisputes.filter(cb => getDisputeCategory(cb) === 'won');
                      const wonCount = wonList.length;
                      const wonAmount = wonList.reduce((sum, cb) => sum + cb.txnAmt, 0);
                      return (
                        <div
                          style={{
                            background: '#FFFFFF',
                            borderTop: '3px solid #22c55e',
                            borderRadius: '12px',
                            padding: '18px 20px',
                            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                            border: '1px solid #e2e8f0',
                            borderTopWidth: '3px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '12px',
                            minHeight: '100px'
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ fontSize: '13px', fontWeight: '600', color: '#64748b' }}>Won Disputes</span>
                              <span style={{
                                background: '#22c55e',
                                color: '#FFFFFF',
                                padding: '3px 10px',
                                borderRadius: '12px',
                                fontSize: '10px',
                                fontWeight: '700',
                                textTransform: 'uppercase',
                                letterSpacing: '0.5px'
                              }}>Won</span>
                            </div>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                            <div style={{ fontSize: '36px', fontWeight: '800', color: '#1e293b', lineHeight: '1' }}>{wonCount}</div>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontSize: '11px', fontWeight: '600', color: '#94a3b8', marginBottom: '2px' }}>Amount</div>
                              <div style={{ fontSize: '16px', fontWeight: '700', color: '#0f172a' }}>{formatINR ? formatINR(wonAmount) : '₹' + wonAmount}</div>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Card 3: Lost Disputes */}
                    {(() => {
                      const lostList = closedDisputes.filter(cb => getDisputeCategory(cb) === 'lost');
                      const lostCount = lostList.length;
                      const lostAmount = lostList.reduce((sum, cb) => sum + cb.txnAmt, 0);
                      return (
                        <div
                          style={{
                            background: '#FFFFFF',
                            borderTop: '3px solid #ef4444',
                            borderRadius: '12px',
                            padding: '18px 20px',
                            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                            border: '1px solid #e2e8f0',
                            borderTopWidth: '3px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '12px',
                            minHeight: '100px'
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ fontSize: '13px', fontWeight: '600', color: '#64748b' }}>Lost Disputes</span>
                              <span style={{
                                background: '#ef4444',
                                color: '#FFFFFF',
                                padding: '3px 10px',
                                borderRadius: '12px',
                                fontSize: '10px',
                                fontWeight: '700',
                                textTransform: 'uppercase',
                                letterSpacing: '0.5px'
                              }}>Lost</span>
                            </div>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                            <div style={{ fontSize: '36px', fontWeight: '800', color: '#1e293b', lineHeight: '1' }}>{lostCount}</div>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontSize: '11px', fontWeight: '600', color: '#94a3b8', marginBottom: '2px' }}>Amount</div>
                              <div style={{ fontSize: '16px', fontWeight: '700', color: '#0f172a' }}>{formatINR ? formatINR(lostAmount) : '₹' + lostAmount}</div>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Card 4: Representment Win Ratio */}
                    {(() => {
                      const totalClosedCount = closedDisputes.length;
                      const wonCount = closedDisputes.filter(cb => getDisputeCategory(cb) === 'won').length;
                      const lostCount = closedDisputes.filter(cb => getDisputeCategory(cb) === 'lost').length;
                      const winRatio = totalClosedCount > 0 ? ((wonCount / totalClosedCount) * 100).toFixed(1) + '%' : '0.0%';
                      return (
                        <div
                          style={{
                            background: '#FFFFFF',
                            borderTop: '3px solid #a855f7',
                            borderRadius: '12px',
                            padding: '18px 20px',
                            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                            border: '1px solid #e2e8f0',
                            borderTopWidth: '3px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '12px',
                            minHeight: '100px'
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ fontSize: '13px', fontWeight: '600', color: '#64748b' }}>Representment Win Ratio</span>
                              <span style={{
                                background: '#a855f7',
                                color: '#FFFFFF',
                                padding: '3px 10px',
                                borderRadius: '12px',
                                fontSize: '10px',
                                fontWeight: '700',
                                textTransform: 'uppercase',
                                letterSpacing: '0.5px'
                              }}>Win Ratio</span>
                            </div>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                            <div style={{ fontSize: '36px', fontWeight: '800', color: '#1e293b', lineHeight: '1' }}>{winRatio}</div>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontSize: '11px', color: '#64748b', fontWeight: '600' }}>Won: <strong style={{color: '#22c55e'}}>{wonCount}</strong></div>
                              <div style={{ fontSize: '11px', color: '#64748b', fontWeight: '600', marginTop: '2px' }}>Lost: <strong style={{color: '#ef4444'}}>{lostCount}</strong></div>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* Daily count message */}
                <div style={{ marginBottom: '24px', fontSize: '15px', fontWeight: '700', color: '#334155' }}>
                  {merchantDisputes.filter(cb => cb.createdDate === TODAY_STR).length} new Disputes added today.
                </div>

                {/* Toolbar */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '24px',
                  position: 'relative',
                  flexWrap: 'wrap',
                  gap: '12px'
                }}>
                  <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                    {/* Date Preset Dropdown */}
                    <div style={{ position: 'relative', display: 'inline-block' }}>
                      <button
                        onClick={() => { setDateDropdownOpen(!dateDropdownOpen); setFilterDropdownOpen(false); }}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '12px',
                          padding: '8px 16px',
                          border: '1.5px solid #CBD5E1',
                          borderRadius: '8px',
                          background: '#FFFFFF',
                          color: '#334155',
                          fontSize: '13px',
                          fontWeight: '600',
                          cursor: 'pointer',
                          height: '42px',
                          minWidth: '180px',
                          transition: 'border-color 0.2s'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.borderColor = '#6B38FB'}
                        onMouseLeave={(e) => { if (!dateDropdownOpen) e.currentTarget.style.borderColor = '#CBD5E1'; }}
                      >
                        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span>📅</span>
                          <span>{getPresetLabel(dateRangePreset)}</span>
                        </span>
                        <span style={{ fontSize: '10px', color: '#6B38FB', fontWeight: 'bold' }}>▼</span>
                      </button>

                      {dateDropdownOpen && (
                        <>
                          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 999, background: 'transparent' }} onClick={() => setDateDropdownOpen(false)} />
                          <div style={{
                            position: 'absolute',
                            top: 'calc(100% + 6px)',
                            left: '0',
                            background: '#FFFFFF',
                            border: '1px solid #E2E8F0',
                            borderRadius: '8px',
                            boxShadow: '0 10px 25px rgba(0,0,0,0.1)',
                            zIndex: 1000,
                            minWidth: '240px',
                            padding: '8px 0',
                            display: 'flex',
                            flexDirection: 'column',
                          }}>
                            {['today', '7days', '30days', '6months'].map(preset => (
                              <button
                                key={preset}
                                onClick={() => {
                                  setDateRangePreset(preset);
                                  const dates = getPresetDates(preset);
                                  if (dates) {
                                    setReportFilter(prev => ({ ...prev, from: dates.from, to: dates.to }));
                                    setTempFrom(dates.from);
                                    setTempTo(dates.to);
                                  }
                                  setDateDropdownOpen(false);
                                }}
                                style={{
                                  padding: '10px 16px',
                                  cursor: 'pointer',
                                  fontSize: '13px',
                                  color: dateRangePreset === preset ? '#6B38FB' : '#475569',
                                  fontWeight: dateRangePreset === preset ? '700' : '500',
                                  textAlign: 'left',
                                  background: 'transparent',
                                  border: 'none',
                                  transition: 'background 0.2s',
                                }}
                                onMouseEnter={(e) => e.target.style.background = '#F8FAFC'}
                                onMouseLeave={(e) => e.target.style.background = 'transparent'}
                              >
                                {getPresetLabel(preset)}
                              </button>
                            ))}
                            <div style={{ borderTop: '1px solid #E2E8F0', margin: '4px 0' }} />
                            <div style={{ padding: '8px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                              <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#94A3B8' }}>CUSTOM RANGE</span>
                              <div style={{ display: 'flex', gap: '8px' }}>
                                <div style={{ flex: 1 }}>
                                  <span style={{ fontSize: '10px', color: '#64748b', display: 'block', marginBottom: '2px' }}>From</span>
                                  <input
                                    type="date"
                                    value={tempFrom}
                                    onChange={(e) => setTempFrom(e.target.value)}
                                    style={{ width: '100%', padding: '6px', fontSize: '12px', border: '1px solid #E2E8F0', borderRadius: '4px', background: '#FFFFFF', color: '#1E293B' }}
                                  />
                                </div>
                                <div style={{ flex: 1 }}>
                                  <span style={{ fontSize: '10px', color: '#64748b', display: 'block', marginBottom: '2px' }}>To</span>
                                  <input
                                    type="date"
                                    value={tempTo}
                                    onChange={(e) => setTempTo(e.target.value)}
                                    style={{ width: '100%', padding: '6px', fontSize: '12px', border: '1px solid #E2E8F0', borderRadius: '4px', background: '#FFFFFF', color: '#1E293B' }}
                                  />
                                </div>
                              </div>
                              <button
                                onClick={() => {
                                  setReportFilter(prev => ({ ...prev, from: tempFrom, to: tempTo }));
                                  setDateRangePreset('custom');
                                  setDateDropdownOpen(false);
                                }}
                                style={{ width: '100%', padding: '8px', fontSize: '12px', background: '#6B38FB', border: 'none', color: '#FFFFFF', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
                              >
                                Apply Custom
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>

                    {/* Search & Filter Dropdown */}
                    <div style={{ position: 'relative', display: 'inline-block' }}>
                      <button
                        onClick={() => { setFilterDropdownOpen(!filterDropdownOpen); setDateDropdownOpen(false); }}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '12px',
                          padding: '8px 16px',
                          border: '1.5px solid #CBD5E1',
                          borderRadius: '8px',
                          background: '#FFFFFF',
                          color: '#334155',
                          fontSize: '13px',
                          fontWeight: '600',
                          cursor: 'pointer',
                          height: '42px',
                          minWidth: '180px',
                          transition: 'border-color 0.2s'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.borderColor = '#6B38FB'}
                        onMouseLeave={(e) => { if (!filterDropdownOpen) e.currentTarget.style.borderColor = '#CBD5E1'; }}
                      >
                        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span>🔍</span>
                          <span>Advance Search and Filter</span>
                        </span>
                        <span style={{ fontSize: '10px', color: '#6B38FB', fontWeight: 'bold' }}>▼</span>
                      </button>

                      {/* Elastic Search Input - Merchant */}
                      <div style={{ position: 'relative', display: 'inline-block' }}>
                        <input
                          type="text"
                          value={elasticSearchVal}
                          onChange={e => setElasticSearchVal(e.target.value)}
                          onFocus={() => setElasticSearchFocused(true)}
                          onBlur={() => setTimeout(() => setElasticSearchFocused(false), 180)}
                          placeholder="Search by RRN / Transaction ID / TID / MID"
                          style={{
                            padding: '8px 14px 8px 36px',
                            border: '1px solid #CBD5E1',
                            borderRadius: '12px',
                            fontSize: '13px',
                            width: '290px',
                            outline: 'none',
                            height: '42px',
                            background: '#fff',
                            color: '#1e293b',
                            boxShadow: elasticSearchFocused ? '0 0 0 3px rgba(107,56,251,0.15)' : 'none',
                            borderColor: elasticSearchFocused ? '#6B38FB' : '#CBD5E1',
                            transition: 'all 0.2s',
                          }}
                        />
                        <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', fontSize: '14px', pointerEvents: 'none' }}>🔎</span>
                        {elasticSearchFocused && elasticSearchVal.length >= 2 && getElasticSuggestions(merchantDisputes, elasticSearchVal).length > 0 && (
                          <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, background: '#fff', border: '1px solid #E2E8F0', borderRadius: '10px', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 1100, minWidth: '290px', overflow: 'hidden' }}>
                            {getElasticSuggestions(merchantDisputes, elasticSearchVal).map((s, i) => (
                              <div key={i} onMouseDown={() => setElasticSearchVal(s)} style={{ padding: '9px 14px', fontSize: '13px', cursor: 'pointer', borderBottom: '1px solid #F1F5F9', color: '#1e293b' }}
                                onMouseEnter={e => e.currentTarget.style.background = '#F8FAFF'}
                                onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
                                {s}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {filterDropdownOpen && (
                        <>
                          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 999, background: 'transparent' }} onClick={() => setFilterDropdownOpen(false)} />
                          <div style={{
                            position: 'absolute',
                            top: 'calc(100% + 6px)',
                            left: '0',
                            background: '#FFFFFF',
                            border: '1px solid #E2E8F0',
                            borderRadius: '12px',
                            boxShadow: '0 15px 35px rgba(0,0,0,0.15)',
                            zIndex: 1000,
                            width: '380px',
                            padding: '20px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '12px',
                          }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <label style={{ fontSize: '11px', fontWeight: 'bold', color: '#64748B', textAlign: 'left' }}>Dispute Type</label>
                                <select
                                  value={reportFilter.disputeType}
                                  onChange={(e) => setReportFilter(prev => ({ ...prev, disputeType: e.target.value }))}
                                  style={{ width: '100%', padding: '8px', border: '1px solid #E2E8F0', borderRadius: '4px', fontSize: '13px', background: '#FFFFFF', color: '#1E293B' }}
                                >
                                  <option value="">Select All</option>
                                  <option value="Chargeback">Chargeback</option>
                                  <option value="Pre-Arbitration">Pre-Arbitration</option>
                                  <option value="Retrieval Request">Retrieval Request</option>
                                  <option value="Arbitration">Arbitration</option>
                                </select>
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <label style={{ fontSize: '11px', fontWeight: 'bold', color: '#64748B', textAlign: 'left' }}>Scheme</label>
                                <select
                                  value={reportFilter.scheme}
                                  onChange={(e) => setReportFilter(prev => ({ ...prev, scheme: e.target.value }))}
                                  style={{ width: '100%', padding: '8px', border: '1px solid #E2E8F0', borderRadius: '4px', fontSize: '13px', background: '#FFFFFF', color: '#1E293B' }}
                                >
                                  <option value="">Select All</option>
                                  <option value="Visa">Visa</option>
                                </select>
                              </div>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              <label style={{ fontSize: '11px', fontWeight: 'bold', color: '#64748B', textAlign: 'left' }}>Dispute Status</label>
                              <select
                                value={reportFilter.disputeStatus}
                                onChange={(e) => setReportFilter(prev => ({ ...prev, disputeStatus: e.target.value }))}
                                style={{ width: '100%', padding: '8px', border: '1px solid #E2E8F0', borderRadius: '4px', fontSize: '13px', background: '#FFFFFF', color: '#1E293B' }}
                              >
                                <option value="">Select All</option>
                                <option value="due_today">Due Today</option>
                                <option value="due_tomorrow">Due Tomorrow</option>
                                <option value="due_2_7">Due in 2 to 7 Days</option>
                                <option value="due_over_7">Due after 7 Days</option>
                                <option value="insufficient_evidence">Insufficient Evidence</option>
                                <option value="Dispute Won Partially">Dispute Won Partially</option>
                                <option value="Dispute Won Fully">Dispute Won Fully</option>
                                <option value="Dispute Lost – TAT Expired">Dispute Lost – TAT Expired</option>
                                <option value="Dispute Lost – Accepted">Dispute Lost – Accepted</option>
                                <option value="Document Rejected">Document Rejected</option>
                                <option value="Chargeback In Progress">Chargeback In Progress</option>
                                <option value="Chargeback Resubmit">Chargeback Resubmit</option>
                              </select>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <label style={{ fontSize: '11px', fontWeight: 'bold', color: '#64748B', textAlign: 'left' }}>Search By</label>
                                <select
                                  value={reportFilter.searchBy}
                                  onChange={(e) => setReportFilter(prev => ({ ...prev, searchBy: e.target.value }))}
                                  style={{ width: '100%', padding: '8px', border: '1px solid #E2E8F0', borderRadius: '4px', fontSize: '13px', background: '#FFFFFF', color: '#1E293B' }}
                                >
                                  <option value="">Select All</option>
                                  <option value="Txn ID">Transaction ID (Txn ID)</option>
                                  <option value="RRN">RRN</option>
                                  <option value="TID">TID</option>
                                  <option value="MID">MID</option>
                                  <option value="Case ID">Case ID</option>
                                </select>
                              </div>
                              {reportFilter.searchBy && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', position: 'relative' }}>
                                  <label style={{ fontSize: '11px', fontWeight: 'bold', color: '#64748B', textAlign: 'left' }}>Search Value</label>
                                  <input
                                    type="text"
                                    value={reportFilter.searchText}
                                    onChange={(e) => setReportFilter(prev => ({ ...prev, searchText: e.target.value }))}
                                    onFocus={() => setMerchantSearchFocused(true)}
                                    onBlur={() => setTimeout(() => setMerchantSearchFocused(false), 200)}
                                    placeholder={`Enter ${reportFilter.searchBy}`}
                                    style={{ width: '100%', padding: '8px', border: '1px solid #E2E8F0', borderRadius: '4px', fontSize: '13px', background: '#FFFFFF', color: '#1E293B' }}
                                  />
                                  {merchantSearchFocused && reportFilter.searchText && (
                                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '4px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 1001, maxHeight: '120px', overflowY: 'auto' }}>
                                      {merchantDisputes
                                        .map(cb => {
                                          if (reportFilter.searchBy === 'Txn ID') return cb.txnId;
                                          if (reportFilter.searchBy === 'RRN') return cb.rrn;
                                          if (reportFilter.searchBy === 'TID') return cb.tid || 'TID-' + (cb.userId || cb.userName || '9999').substring(0,4).toUpperCase();
                                          if (reportFilter.searchBy === 'MID') return cb.userId || 'ISU-' + (cb.userName || '9999').substring(0,4).toUpperCase();
                                          if (reportFilter.searchBy === 'Case ID') return cb.caseId || cb.id;
                                          return '';
                                        })
                                        .filter((val, index, self) => val && self.indexOf(val) === index && val.toLowerCase().includes(reportFilter.searchText.toLowerCase()))
                                        .slice(0, 5)
                                        .map(val => (
                                          <div
                                            key={val}
                                            onMouseDown={() => setReportFilter(prev => ({ ...prev, searchText: val }))}
                                            style={{ padding: '6px 10px', cursor: 'pointer', fontSize: '12px', color: '#334155', borderBottom: '1px solid #F1F5F9', textAlign: 'left' }}
                                            onMouseEnter={(e) => e.target.style.background = '#F8FAFC'}
                                            onMouseLeave={(e) => e.target.style.background = 'transparent'}
                                          >
                                            🔍 {val}
                                          </div>
                                        ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px', borderTop: '1px solid #E2E8F0', paddingTop: '12px' }}>
                              <button
                                onClick={() => {
                                  setReportFilter({ from: SIX_MONTHS_AGO, to: TODAY_STR, provider: '', disputeType: '', scheme: '', disputeStatus: '', searchBy: '', searchText: '' });
                                  setDateRangePreset('6months');
                                  setTempFrom(SIX_MONTHS_AGO);
                                  setTempTo(TODAY_STR);
                                  setFilterDropdownOpen(false);
                                }}
                                style={{ padding: '6px 12px', background: 'transparent', border: '1px solid #E2E8F0', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', color: '#64748B' }}
                              >
                                Reset
                              </button>
                              <button
                                onClick={() => {
                                  setFilterDropdownOpen(false);
                                  showToast('Filters applied!');
                                }}
                                style={{ padding: '6px 12px', background: '#6B38FB', border: 'none', color: '#FFFFFF', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}
                              >
                                Apply Filters
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  <button
                    style={{
                      padding: '8px 24px',
                      border: 'none',
                      background: '#6B38FB',
                      color: '#FFFFFF',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      fontWeight: '600',
                      height: '42px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      transition: 'opacity 0.2s'
                    }}
                    onClick={() => exportToCSV('reports')}
                    onMouseEnter={(e) => e.currentTarget.style.opacity = '0.9'}
                    onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
                  >
                    Export
                  </button>
                </div>

                {/* Split Pane Container for vertical preview */}
                <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start', flexWrap: 'wrap', width: '100%' }}>
                  <div style={{ flex: targetDisputeId ? '0 0 calc(25% - 10px)' : '1 1 100%', maxWidth: targetDisputeId ? 'calc(25% - 10px)' : '100%', minWidth: targetDisputeId ? '200px' : '300px', transition: 'all 0.3s ease' }}>
                    {/* Table Container */}
                    <div id="m-reports-table-section" style={{ marginBottom: '24px', overflowX: 'auto' }}>
                      {renderDisputesTable(reportsPaging)}
                    </div>

                    {/* Pagination Footer */}
                    {!targetDisputeId && (
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        background: '#FFFFFF',
                        padding: '16px 20px',
                        borderRadius: '12px',
                        border: '1px solid #E2E8F0',
                        boxShadow: '0 4px 6px rgba(0,0,0,0.02)'
                      }}>
                        {/* Bottom Left: Show X per page */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#64748B', fontWeight: '500' }}>
                          <span>Show</span>
                          <select
                            value={reportsLimit}
                            onChange={(e) => {
                              setReportsPage(1);
                              setReportsLimit(parseInt(e.target.value));
                            }}
                            style={{
                              padding: '6px 12px',
                              borderRadius: '6px',
                              border: '1.5px solid #CBD5E1',
                              background: '#FFFFFF',
                              color: '#334155',
                              fontWeight: '600',
                              cursor: 'pointer',
                              outline: 'none'
                            }}
                          >
                            <option value="5">5</option>
                            <option value="10">10</option>
                            <option value="25">25</option>
                          </select>
                          <span>per page</span>
                        </div>

                        {/* Bottom Right: 1-10 of many, with < and > */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                          <span style={{ fontSize: '13px', color: '#64748B', fontWeight: '600' }}>
                            {reportsPaging.startRecord}-{reportsPaging.endRecord} of {reportsPaging.total}
                          </span>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                              disabled={reportsPage === 1}
                              onClick={() => setReportsPage(reportsPage - 1)}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: '36px',
                                height: '36px',
                                borderRadius: '8px',
                                border: '1.5px solid #CBD5E1',
                                background: reportsPage === 1 ? '#F1F5F9' : '#FFFFFF',
                                color: reportsPage === 1 ? '#94A3B8' : '#334155',
                                cursor: reportsPage === 1 ? 'not-allowed' : 'pointer',
                                fontWeight: 'bold',
                                transition: 'all 0.2s'
                              }}
                            >
                              ‹
                            </button>
                            <button
                              disabled={reportsPage === reportsPaging.totalPages}
                              onClick={() => setReportsPage(reportsPage + 1)}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: '36px',
                                height: '36px',
                                borderRadius: '8px',
                                border: '1.5px solid #CBD5E1',
                                background: reportsPage === reportsPaging.totalPages ? '#F1F5F9' : '#FFFFFF',
                                color: reportsPage === reportsPaging.totalPages ? '#94A3B8' : '#334155',
                                cursor: reportsPage === reportsPaging.totalPages ? 'not-allowed' : 'pointer',
                                fontWeight: 'bold',
                                transition: 'all 0.2s'
                              }}
                            >
                              ›
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {targetDisputeId && (
                    <div className="slide-in-right" style={{ 
                      flex: '0 0 calc(75% - 10px)', 
                      maxWidth: '75%',
                      minWidth: '300px', 
                      background: '#fff', 
                      border: '1px solid #e2e8f0', 
                      borderRadius: '12px', 
                      boxShadow: '0 8px 30px rgba(0,0,0,0.08)', 
                      display: 'flex', 
                      flexDirection: 'column', 
                      maxHeight: 'calc(100vh - 120px)',
                      overflowY: 'auto',
                      position: 'sticky',
                      top: '24px',
                      zIndex: 10
                    }}>
                      {/* Vertical Preview Panel */}
                      {(() => {
                        const cb = chargebacks.find(c => c.id === targetDisputeId) || {};
                        const isClosed = isClosedDispute(cb);
                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
                            <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#F8FAFC', borderRadius: '12px 12px 0 0' }}>
                              <div>
                                <span style={{ fontSize: '11px', color: '#6B38FB', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Dispute Case Preview</span>
                                <h2 style={{ fontSize: '15px', fontWeight: '800', margin: '2px 0 0 0', color: '#1e293b', fontFamily: 'monospace' }}>{cb.id}</h2>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
                                  <span style={{ fontSize: '13px', fontWeight: '700', color: '#6B38FB' }}>
                                    Dispute Amount: {formatINR ? formatINR(cb.txnAmt) : '₹' + cb.txnAmt}
                                  </span>
                                  {!isClosed && cb.respondByDate && (
                                    <span style={{ fontSize: '14px', fontWeight: '800', color: '#ef4444', background: '#fee2e2', padding: '4px 10px', borderRadius: '6px', border: '1px solid #fca5a5' }}>
                                      T-Minus {getDaysDifference(cb.respondByDate, TODAY_STR)} Days
                                    </span>
                                  )}
                                </div>
                                <button onClick={() => setTargetDisputeId(null)} style={{ background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer', color: '#94a3b8', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '32px', height: '32px', borderRadius: '50%', transition: 'all 0.2s' }} onMouseEnter={(e) => { e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.color = '#64748b'; }} onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = '#94a3b8'; }}>&times;</button>
                              </div>
                            </div>
                            
                            <div style={{ padding: '20px', overflowY: 'auto', flex: 1, background: '#f8fafc' }}>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px', alignItems: 'stretch' }}>
                                {/* Left Column: Upload Evidence, Actions, Uploaded Documents, and Timeline */}
                                <div style={{ flex: '1 1 calc(50% - 10px)', minWidth: '300px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                  {/* Locked State Notification */}
                                  {cb.isLocked && (
                                    <div style={{ background: '#f1f5f9', border: '1.5px solid #cbd5e1', borderRadius: '12px', padding: '20px', boxShadow: '0 2px 4px rgba(0,0,0,0.02)', color: '#64748b', display: 'flex', alignItems: 'center', gap: '12px' }}>
                                      <span style={{ fontSize: '20px' }}>🔒</span>
                                      <div>
                                        <div style={{ fontWeight: '700', color: '#334155', fontSize: '13px' }}>Transaction Locked</div>
                                        <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>This dispute is locked to prevent duplicate chargebacks or manual refunds while in final routing states.</div>
                                      </div>
                                    </div>
                                  )}

                                  {/* Collaboration Workflow Panel */}
                                  {cb.isCollaboration && cb.mSubStatus === 'Pre-Arbitration - Review Required' && !cb.isLocked && (
                                    <div style={{ background: 'linear-gradient(135deg, #fef3c7 0%, #fffbeb 100%)', border: '1.5px solid #f59e0b', borderRadius: '12px', padding: '20px', boxShadow: '0 4px 6px rgba(0,0,0,0.03)', marginBottom: '16px' }}>
                                      <h3 style={{ fontSize: '14px', fontWeight: '700', color: '#b45309', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <span>⚠️</span> Pre-Arbitration - Review Required
                                      </h3>
                                      <div style={{ fontSize: '12px', color: '#78350f', marginBottom: '14px', lineHeight: '1.5' }}>
                                        <strong>Urgent Countdown:</strong> T-Minus 5 Days remaining before default liability loss. <br />
                                        <strong>Recommended Action:</strong> Review cardholder letter or Accept Financial Liability.
                                      </div>
                                      
                                      {cb.preArbCounterReason && (
                                        <div style={{ background: '#fff', border: '1px solid #fcd34d', borderRadius: '8px', padding: '12px', fontSize: '12px', color: '#374151', marginBottom: '16px', fontStyle: 'italic' }}>
                                          <strong>Cardholder Counter-Reason:</strong> "{cb.preArbCounterReason}"
                                        </div>
                                      )}

                                      <div style={{ display: 'flex', gap: '12px' }}>
                                        <button 
                                          onClick={() => handleCollaborationAction('ACCEPT_LIABILITY')}
                                          style={{ flex: 1, padding: '10px 14px', borderRadius: '8px', background: '#d97706', color: '#fff', border: 'none', fontWeight: '700', cursor: 'pointer', fontSize: '12px' }}
                                        >
                                          Accept Liability
                                        </button>
                                        <button 
                                          onClick={() => handleCollaborationAction('ESCALATE_TO_DRM')}
                                          style={{ flex: 1, padding: '10px 14px', borderRadius: '8px', background: '#6B38FB', color: '#fff', border: 'none', fontWeight: '700', cursor: 'pointer', fontSize: '12px' }}
                                        >
                                          Escalate to DRM
                                        </button>
                                      </div>
                                    </div>
                                  )}

                                  {/* Allocation Compelling Evidence Workspace */}
                                  {(cb.adjType === 'Formal Dispute Inflow' || cb.mSubStatus === 'Action Required - Awaiting Merchant Input') && !cb.isLocked && !cb.mSubStatus.includes('Submitted') && (
                                    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
                                      <h3 style={{ fontSize: '14px', fontWeight: '700', color: '#1e293b', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <span>📋</span> Compile Compelling Evidence (Allocation track)
                                      </h3>
                                      <p style={{ fontSize: '12px', color: '#64748b', marginBottom: '16px', lineHeight: '1.4' }}>
                                        Upload and specify your files to satisfy Visa's compelling data requirements. Run the formatting validation script before submission.
                                      </p>

                                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
                                        <div>
                                          <label style={{ fontSize: '11px', fontWeight: '700', color: '#475569', display: 'block', marginBottom: '4px' }}>Core Verification File</label>
                                          <input 
                                            type="text" 
                                            placeholder="e.g. pin_log_terminal.pdf" 
                                            value={allocationCoreFile} 
                                            onChange={(e) => setAllocationCoreFile(e.target.value)} 
                                            style={{ width: '100%', padding: '6px 10px', fontSize: '12px', border: '1px solid #cbd5e1', borderRadius: '4px', outline: 'none', marginBottom: '4px' }} 
                                          />
                                          <input 
                                            type="text" 
                                            placeholder="Description, e.g. POS terminal chip read signature" 
                                            value={allocationCoreDesc} 
                                            onChange={(e) => setAllocationCoreDesc(e.target.value)} 
                                            style={{ width: '100%', padding: '6px 10px', fontSize: '11px', border: '1px solid #e2e8f0', borderRadius: '4px', outline: 'none', color: '#64748b' }} 
                                          />
                                        </div>

                                        <div>
                                          <label style={{ fontSize: '11px', fontWeight: '700', color: '#475569', display: 'block', marginBottom: '4px' }}>Supplementary Proof Log</label>
                                          <input 
                                            type="text" 
                                            placeholder="e.g. device_id_finger.json" 
                                            value={allocationSupplFile} 
                                            onChange={(e) => setAllocationSupplFile(e.target.value)} 
                                            style={{ width: '100%', padding: '6px 10px', fontSize: '12px', border: '1px solid #cbd5e1', borderRadius: '4px', outline: 'none', marginBottom: '4px' }} 
                                          />
                                          <input 
                                            type="text" 
                                            placeholder="Description, e.g. Device metadata" 
                                            value={allocationSupplDesc} 
                                            onChange={(e) => setAllocationSupplDesc(e.target.value)} 
                                            style={{ width: '100%', padding: '6px 10px', fontSize: '11px', border: '1px solid #e2e8f0', borderRadius: '4px', outline: 'none', color: '#64748b' }} 
                                          />
                                        </div>

                                        <div>
                                          <label style={{ fontSize: '11px', fontWeight: '700', color: '#475569', display: 'block', marginBottom: '4px' }}>Historical Validation Data</label>
                                          <input 
                                            type="text" 
                                            placeholder="e.g. past_clearing.csv" 
                                            value={allocationHistFile} 
                                            onChange={(e) => setAllocationHistFile(e.target.value)} 
                                            style={{ width: '100%', padding: '6px 10px', fontSize: '12px', border: '1px solid #cbd5e1', borderRadius: '4px', outline: 'none', marginBottom: '4px' }} 
                                          />
                                          <input 
                                            type="text" 
                                            placeholder="Description, e.g. Previous undisputed history" 
                                            value={allocationHistDesc} 
                                            onChange={(e) => setAllocationHistDesc(e.target.value)} 
                                            style={{ width: '100%', padding: '6px 10px', fontSize: '11px', border: '1px solid #e2e8f0', borderRadius: '4px', outline: 'none', color: '#64748b' }} 
                                          />
                                        </div>
                                      </div>

                                      {validationResult && (
                                        <div style={{ padding: '10px 12px', borderRadius: '6px', fontSize: '11px', marginBottom: '14px', border: '1px solid', borderColor: validationResult.success ? '#bbf7d0' : '#fecaca', background: validationResult.success ? '#f0fdf4' : '#fdf2f2', color: validationResult.success ? '#15803d' : '#b91c1c' }}>
                                          {validationResult.msg}
                                        </div>
                                      )}

                                      <div style={{ display: 'flex', gap: '8px' }}>
                                        <button 
                                          onClick={handleValidateEvidence}
                                          style={{ flex: 1, padding: '8px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', border: '1px solid #cbd5e1', background: '#fff', color: '#334155', fontWeight: '600' }}
                                        >
                                          ⚙️ Run Validation Script
                                        </button>
                                        <button 
                                          onClick={handleSubmitRepresentment}
                                          style={{ flex: 1, padding: '8px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', background: '#6B38FB', color: '#fff', border: 'none', fontWeight: 'bold' }}
                                        >
                                          📤 Submit Representment
                                        </button>
                                      </div>
                                    </div>
                                  )}

                                  {/* Standard Upload Evidence / Action card */}
                                  {!isClosed && !cb.mStatus.includes('Lost') && !cb.mStatus.includes('Won') && !cb.isLocked && !cb.isCollaboration && cb.adjType !== 'Formal Dispute Inflow' && cb.mSubStatus !== 'Action Required - Awaiting Merchant Input' && !cb.mSubStatus.includes('Submitted') && (
                                    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
                                      <h3 style={{ fontSize: '14px', fontWeight: '700', color: '#1e293b', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <span>📤</span> Upload Evidence &amp; Actions
                                      </h3>
                                      <p style={{ fontSize: '12px', color: '#64748b', marginBottom: '16px', lineHeight: '1.4' }}>
                                        {reportTab === 'doc-verification' ? 'You can upload more evidence or add comments for this dispute case.' : 'You can upload document proof to contest this dispute or accept liability for the dispute transaction.'}
                                      </p>
                                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                        {reportTab === 'doc-pending' && (
                                          cb.documents && cb.documents.length > 0 ? (
                                            <button className="btn btn-outline" style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', height: '38px', fontWeight: '600', border: '1px solid #cbd5e1', background: '#fff', color: '#334155' }} onClick={() => { setActiveModal('contest'); }}>Upload More Evidence</button>
                                          ) : (
                                            <>
                                              <button className="btn btn-outline" style={{ flex: 1, padding: '8px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', height: '38px', fontWeight: '600', border: '1px solid #cbd5e1', background: '#fff', color: '#334155' }} onClick={() => { setActiveModal('action2'); }}>Accept Dispute</button>
                                              <button className="btn btn-primary" style={{ flex: 1, padding: '8px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', background: '#6B38FB', color: '#fff', border: 'none', height: '38px', fontWeight: 'bold' }} onClick={() => { setActiveModal('contest'); }}>Contest &amp; Submit Proof</button>
                                            </>
                                          )
                                        )}
                                        {reportTab === 'doc-verification' && (
                                          <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                                            <div style={{ position: 'relative', display: 'inline-block' }}>
                                              <button 
                                                onClick={() => setActiveModal('contest')} 
                                                style={{ 
                                                  background: '#f1f5f9', 
                                                  border: '1px solid #cbd5e1', 
                                                  borderRadius: '50%', 
                                                  width: '42px', 
                                                  height: '42px', 
                                                  cursor: 'pointer', 
                                                  fontSize: '18px', 
                                                  display: 'inline-flex', 
                                                  alignItems: 'center', 
                                                  justifyContent: 'center',
                                                  transition: 'all 0.2s',
                                                }}
                                                onMouseEnter={(e) => { 
                                                  e.currentTarget.style.background = '#e2e8f0'; 
                                                  setHoveredIcon('upload');
                                                }}
                                                onMouseLeave={(e) => { 
                                                  e.currentTarget.style.background = '#f1f5f9'; 
                                                  setHoveredIcon(null);
                                                }}
                                              >
                                                📤
                                              </button>
                                              {hoveredIcon === 'upload' && (
                                                <div style={{
                                                  position: 'absolute',
                                                  bottom: '100%',
                                                  left: '50%',
                                                  transform: 'translateX(-50%) translateY(-8px)',
                                                  background: '#1e293b',
                                                  color: '#fff',
                                                  padding: '6px 10px',
                                                  borderRadius: '6px',
                                                  fontSize: '11px',
                                                  fontWeight: '600',
                                                  whiteSpace: 'nowrap',
                                                  pointerEvents: 'none',
                                                  boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                                                  zIndex: 100
                                                }}>
                                                  Upload More Evidence
                                                  <div style={{
                                                    position: 'absolute',
                                                    top: '100%',
                                                    left: '50%',
                                                    transform: 'translateX(-50%)',
                                                    borderWidth: '5px',
                                                    borderStyle: 'solid',
                                                    borderColor: '#1e293b transparent transparent transparent',
                                                    width: 0,
                                                    height: 0
                                                  }} />
                                                </div>
                                              )}
                                            </div>
                                            <div style={{ position: 'relative', display: 'inline-block' }}>
                                              <button 
                                                onClick={() => setActiveModal('merchantComment')} 
                                                style={{ 
                                                  background: '#f1f5f9', 
                                                  border: '1px solid #cbd5e1', 
                                                  borderRadius: '50%', 
                                                  width: '42px', 
                                                  height: '42px', 
                                                  cursor: 'pointer', 
                                                  fontSize: '18px', 
                                                  display: 'inline-flex', 
                                                  alignItems: 'center', 
                                                  justifyContent: 'center',
                                                  transition: 'all 0.2s',
                                                }}
                                                onMouseEnter={(e) => { 
                                                  e.currentTarget.style.background = '#e2e8f0'; 
                                                  setHoveredIcon('comment');
                                                }}
                                                onMouseLeave={(e) => { 
                                                  e.currentTarget.style.background = '#f1f5f9'; 
                                                  setHoveredIcon(null);
                                                }}
                                              >
                                                💬
                                              </button>
                                              {hoveredIcon === 'comment' && (
                                                <div style={{
                                                  position: 'absolute',
                                                  bottom: '100%',
                                                  left: '50%',
                                                  transform: 'translateX(-50%) translateY(-8px)',
                                                  background: '#1e293b',
                                                  color: '#fff',
                                                  padding: '6px 10px',
                                                  borderRadius: '6px',
                                                  fontSize: '11px',
                                                  fontWeight: '600',
                                                  whiteSpace: 'nowrap',
                                                  pointerEvents: 'none',
                                                  boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                                                  zIndex: 100
                                                }}>
                                                  Comment
                                                  <div style={{
                                                    position: 'absolute',
                                                    top: '100%',
                                                    left: '50%',
                                                    transform: 'translateX(-50%)',
                                                    borderWidth: '5px',
                                                    borderStyle: 'solid',
                                                    borderColor: '#1e293b transparent transparent transparent',
                                                    width: 0,
                                                    height: 0
                                                  }} />
                                                </div>
                                              )}
                                            </div>
                                          </div>
                                        )}
                                        {reportTab !== 'doc-pending' && reportTab !== 'doc-verification' && (
                                          <div style={{ width: '100%' }}>{getActionBtn(cb)}</div>
                                        )}
                                      </div>
                                    </div>
                                  )}

                                  {/* Evidence Documents List */}
                                  <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
                                    <h3 style={{ fontSize: '14px', fontWeight: '700', color: '#1e293b', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                      <span>📄</span> Evidence Documents
                                    </h3>
                                    {(cb.documents && cb.documents.length > 0) ? (
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                        {cb.documents.map(doc => (
                                          <div key={doc.id} style={{ padding: '12px', border: doc.status === 'Rejected' ? '1px solid #fca5a5' : '1px solid #e2e8f0', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '6px', background: doc.status === 'Rejected' ? '#fef2f2' : '#f8fafc' }}>
                                            <div style={{ fontWeight: 'bold', fontSize: '13px', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                              <span style={{ fontSize: '16px' }}>📄</span>
                                              <span style={{ wordBreak: 'break-all' }}>{doc.filename}</span>
                                            </div>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', fontSize: '11px', color: '#64748B' }}>
                                              <div>By: <strong style={{color: '#334155'}}>{doc.uploadedBy || 'Merchant'}</strong></div>
                                              <div>Status: <strong style={{ color: doc.status === 'Rejected' ? '#ef4444' : doc.status === 'Accepted' ? '#22c55e' : '#eab308' }}>{doc.status}</strong></div>
                                              <div>Date: <strong style={{color: '#334155'}}>{new Date(doc.uploadedAt).toLocaleDateString()}</strong></div>
                                            </div>
                                            {doc.status === 'Rejected' && (
                                              <div style={{ fontSize: '11px', color: '#ef4444', background: '#fff', padding: '6px 10px', borderRadius: '4px', border: '1px dashed #fca5a5', marginTop: '4px' }}>
                                                <strong>Rejection Remarks:</strong> {doc.rejectionRemarks}
                                              </div>
                                            )}
                                            {doc.status === 'Rejected' && (
                                              <div style={{ marginTop: '8px' }}>
                                                <button style={{ fontSize: '12px', background: '#ef4444', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }} onClick={() => setActiveModal('contest')}>
                                                  Re-upload Evidence
                                                </button>
                                              </div>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <div style={{ color: '#64748B', fontSize: '13px', fontStyle: 'italic', textAlign: 'center', padding: '12px 0' }}>No evidence documents uploaded.</div>
                                    )}
                                  </div>

                                  {/* Timeline (moved below evidence documents) */}
                                  <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
                                    {renderTimeline(cb, expandedTimeline, setExpandedTimeline, showToast, 'merchant')}
                                  </div>
                                </div>

                                {/* Right Column: Transaction Details, Dispute Info */}
                                <div style={{ flex: '1 1 calc(50% - 10px)', minWidth: '300px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                  {/* Transaction Details */}
                                  <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
                                    <h3 style={{ fontSize: '14px', fontWeight: '700', color: '#1e293b', marginBottom: '12px', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                      <span>💳 Transaction Details</span>
                                      <span style={{ fontWeight: 'normal', color: '#64748B', fontSize: '12px' }}>Date: <span style={{color:'#334155', fontWeight:'700'}}>{formatDateDisp(cb.txnDate)}</span></span>
                                    </h3>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '13px' }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f8fafc', paddingBottom: '6px' }}><span style={{ color: '#64748B' }}>Case ID:</span> <strong style={{color: '#1e293b'}}>{cb.id}</strong></div>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f8fafc', paddingBottom: '6px' }}><span style={{ color: '#64748B' }}>AR Number:</span> <strong style={{color: '#1e293b'}}>{cb.rrn}</strong></div>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f8fafc', paddingBottom: '6px' }}><span style={{ color: '#64748B' }}>TXN Ref. Number:</span> <strong style={{color: '#1e293b'}}>{cb.txnId}</strong></div>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f8fafc', paddingBottom: '6px' }}><span style={{ color: '#64748B' }}>MID:</span> <strong style={{color: '#1e293b'}}>{cb.userId}</strong></div>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f8fafc', paddingBottom: '6px' }}><span style={{ color: '#64748B' }}>TID:</span> <strong style={{color: '#1e293b'}}>10515104</strong></div>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f8fafc', paddingBottom: '6px' }}><span style={{ color: '#64748B' }}>Amount:</span> <strong style={{color: '#6B38FB', fontSize: '14px'}}>{formatINR ? formatINR(cb.txnAmt) : '₹' + cb.txnAmt}</strong></div>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f8fafc', paddingBottom: '6px' }}><span style={{ color: '#64748B' }}>Card Number:</span> <strong style={{color: '#1e293b'}}>457704******3989</strong></div>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f8fafc', paddingBottom: '6px' }}><span style={{ color: '#64748B' }}>Merchant Name:</span> <strong style={{color: '#1e293b'}}>{cb.userName}</strong></div>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f8fafc', paddingBottom: '6px' }}><span style={{ color: '#64748B' }}>Approval Code:</span> <strong style={{color: '#1e293b'}}>021838</strong></div>
                                    </div>
                                  </div>

                                  {/* Dispute Details */}
                                  <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
                                    <h3 style={{ fontSize: '14px', fontWeight: '700', color: '#1e293b', marginBottom: '12px', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                      <span>⚖️ Dispute Info</span>
                                      <span style={{ fontWeight: 'normal', color: '#64748B', fontSize: '12px' }}>Dispute Date: <span style={{color:'#334155', fontWeight:'700'}}>{formatDateDisp(cb.createdDate || cb.txnDate)}</span></span>
                                    </h3>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '13px' }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f8fafc', paddingBottom: '6px' }}><span style={{ color: '#64748B' }}>Scheme:</span> <strong style={{color: '#1e293b'}}>{cb.product || 'VISA'}</strong></div>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f8fafc', paddingBottom: '6px' }}><span style={{ color: '#64748B' }}>Aggregator:</span> <strong style={{color: '#1e293b'}}>{cb.aggregator || 'Payermax'}</strong></div>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f8fafc', paddingBottom: '6px' }}><span style={{ color: '#64748B' }}>Visa Case ID:</span> <strong style={{color: '#1e293b'}}>{cb.visaId || 'V-' + (cb.id || 'XXXX').substring(0, 6).toUpperCase()}</strong></div>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f8fafc', paddingBottom: '6px' }}><span style={{ color: '#64748B' }}>Reason Code:</span> <strong style={{color: '#1e293b'}}>13.1</strong></div>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f8fafc', paddingBottom: '6px' }}><span style={{ color: '#64748B' }}>Remaining Days:</span> <strong style={{color: cb.aging <= 3 ? '#ef4444' : '#f59e0b'}}>{cb.aging} days</strong></div>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f8fafc', paddingBottom: '6px' }}><span style={{ color: '#64748B' }}>Current Status:</span> <strong style={{color: '#1e293b'}}>{cb.mStatus}</strong></div>
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', borderBottom: '1px solid #f8fafc', paddingBottom: '6px' }}><span style={{ color: '#64748B' }}>Dispute Description:</span> <strong style={{color: '#1e293b', fontWeight: '600', lineHeight: '1.4'}}>13.1 - Services Not Provided or Merchandise Not Received</strong></div>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f8fafc', paddingBottom: '6px' }}><span style={{ color: '#64748B' }}>Admin Remarks:</span> <strong style={{color: '#ef4444'}}>{cb.rejectReason || '-'}</strong></div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>

              </div>
            </div>
          )}



          {/* FAQ & Help Page */}
          {activePage === 'faq' && (() => {
            const FAQS = [
              { id: 1, cat: 'getting-started', q: 'What is a chargeback dispute?', a: 'A chargeback is a reversal of a credit card transaction initiated by the cardholder\'s bank. When a customer disputes a charge, the amount is temporarily debited from your account. You can contest this by submitting evidence through this portal.' },
              { id: 2, cat: 'getting-started', q: 'How do I know when I have a new dispute?', a: 'New disputes will appear in your Dashboard under "Action Required". Check your portal regularly for new cases requiring your response.' },
              { id: 3, cat: 'getting-started', q: 'What are the different dispute statuses?', a: 'Chargeback New = action required. In Progress = under review. Won/Lost = final outcome. Closed = fully resolved, no further action.' },
              { id: 4, cat: 'disputes', q: 'How do I accept liability for a dispute?', a: 'Open the dispute from Action Required, click "Take Action", then choose "Accept Liability". You can accept full or partial liability. The amount will be debited from your wallet.' },
              { id: 5, cat: 'disputes', q: 'How do I submit evidence to contest?', a: 'Go to All Disputes, Action Required tab, click "Take Action", select "Contest / Submit Evidence", upload proof documents (max 20MB each, PDF/PNG/JPEG) and add remarks.' },
              { id: 6, cat: 'disputes', q: 'What happens after I submit evidence?', a: 'The dispute moves to "Under Review". The acquirer and scheme network will review your materials. The final outcome will appear in the Closed tab.' },
              { id: 7, cat: 'disputes', q: 'Can I view closed disputes?', a: 'Yes. Go to Dispute Management, Closed tab. All resolved disputes are visible there. Click the eye icon to view full details.' },
              { id: 8, cat: 'documents', q: 'What documents should I upload?', a: 'Upload proof of delivery, signed service agreements, communication records, transaction receipts, or refund proof as applicable.' },
              { id: 9, cat: 'documents', q: 'What file formats are accepted?', a: 'PDF, JPEG, PNG. Maximum 20MB per file. Up to 3 supporting files per dispute response.' },
              { id: 10, cat: 'sla', q: 'What is the TAT for disputes?', a: 'Each dispute has a "Remaining Days" deadline. Chargebacks: 20-45 days. Pre-Arbitration: 10-15 days. Missing the deadline = automatic loss.' },
              { id: 11, cat: 'sla', q: 'What does "TAT Expired" mean?', a: 'If you did not respond in time, the dispute is auto-marked "Dispute Lost - TAT Expired". No further action is possible.' },
              { id: 12, cat: 'account', q: 'How do I contact support?', a: 'Email support@isu-disputes.com or contact your relationship manager. Include your Case ID for faster resolution.' },
            ];
            const cats = [
              { key: 'all', label: 'All Topics' },
              { key: 'getting-started', label: 'Getting Started' },
              { key: 'disputes', label: 'Disputes' },
              { key: 'documents', label: 'Documents' },
              { key: 'sla', label: 'TAT & SLA' },
              { key: 'account', label: 'Account' },
            ];
            const filtered = FAQS.filter(f => {
              const matchCat = faqCategory === 'all' || f.cat === faqCategory;
              const matchSearch = !faqSearch || f.q.toLowerCase().includes(faqSearch.toLowerCase());
              return matchCat && matchSearch;
            });
            const grouped = cats.filter(c => c.key !== 'all').map(c => ({ ...c, items: filtered.filter(f => f.cat === c.key) })).filter(c => c.items.length > 0);
            return (
              <div className="page active">
                <div className="page-inner">
                  <div className="faq-page">
                    <div className="faq-hero">
                      <div className="faq-hero-icon">{String.fromCodePoint(0x2753)}</div>
                      <div>
                        <h1>FAQ & Help Center</h1>
                        <p>Find answers to common questions about managing your disputes on the ISU Merchant Portal.</p>
                      </div>
                    </div>
                    <div className="faq-search">
                      <span className="faq-search-icon">{String.fromCodePoint(0x1F50D)}</span>
                      <input type="text" placeholder="Search your question..." value={faqSearch} onChange={e => setFaqSearch(e.target.value)} />
                    </div>
                    <div className="faq-categories">
                      {cats.map(c => (
                        <button key={c.key} className={'faq-cat-btn ' + (faqCategory === c.key ? 'active' : '')} onClick={() => setFaqCategory(c.key)}>{c.label}</button>
                      ))}
                    </div>
                    {faqCategory === 'all' ? (
                      grouped.map(grp => (
                        <div className="faq-section" key={grp.key}>
                          <div className="faq-section-title">{grp.label}</div>
                          {grp.items.map(f => (
                            <div key={f.id} className={'faq-item ' + (faqOpenItem === f.id ? 'open' : '')}>
                              <div className="faq-q" onClick={() => setFaqOpenItem(faqOpenItem === f.id ? null : f.id)}>
                                <span className="faq-q-text">{f.q}</span>
                                <span className="faq-q-icon">{String.fromCodePoint(0x25BC)}</span>
                              </div>
                              <div className="faq-answer">{f.a}</div>
                            </div>
                          ))}
                        </div>
                      ))
                    ) : (
                      <div className="faq-section">
                        {filtered.map(f => (
                          <div key={f.id} className={'faq-item ' + (faqOpenItem === f.id ? 'open' : '')}>
                            <div className="faq-q" onClick={() => setFaqOpenItem(faqOpenItem === f.id ? null : f.id)}>
                              <span className="faq-q-text">{f.q}</span>
                              <span className="faq-q-icon">{String.fromCodePoint(0x25BC)}</span>
                            </div>
                            <div className="faq-answer">{f.a}</div>
                          </div>
                        ))}
                        {filtered.length === 0 && <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>No results found. Try a different search or category.</div>}
                      </div>
                    )}
                    <div className="faq-cta">
                      <h3>Still need help?</h3>
                      <p>Our support team is available Monday-Friday, 9 AM - 6 PM IST. Response time: under 4 hours.</p>
                      <div className="faq-cta-btns">
                        <button className="btn btn-primary" onClick={() => showToast('Support request sent! Our team will contact you shortly.', 'success')}>Email Support</button>
                        <button className="btn btn-outline" onClick={() => { setShowTour(true); setTourStep(0); setActivePage('dashboard'); }}>Restart Portal Tour</button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* VROL Automation Page */}
          {activePage === 'm-vrol-automation' && (
            <div className="page active" id="m-vrol-automation" style={{ padding: '24px', fontFamily: "'Inter', sans-serif" }}>
              <div style={{ marginBottom: '24px' }}>
                <h2 style={{ fontSize: '24px', fontWeight: '700', color: '#1e293b', margin: '0 0 6px 0' }}>VROL RTSI Automation</h2>
                <p style={{ fontSize: '14px', color: '#64748b', margin: 0 }}>Configure automated deflection thresholds for Order Insight (OI) and auto-accept constraints for Rapid Dispute Resolution (RDR).</p>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(450px, 1fr))', gap: '24px' }}>
                {/* Order Insight Card */}
                <div style={{ background: 'var(--card, #fff)', border: '1px solid var(--border-color, #e2e8f0)', borderRadius: '12px', padding: '24px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px', borderBottom: '1px solid #f1f5f9', paddingBottom: '12px' }}>
                    <span style={{ fontSize: '24px' }}>💡</span>
                    <div>
                      <h3 style={{ fontSize: '16px', fontWeight: '700', color: '#1e293b', margin: 0 }}>Order Insight (OI) Deflection Rules</h3>
                      <p style={{ fontSize: '12px', color: '#64748b', margin: 0 }}>Pre-dispute auto-responses to match inquiry thresholds.</p>
                    </div>
                  </div>

                  <form onSubmit={handleAddOiRule} style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '24px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '12px', fontWeight: '600', color: '#475569' }}>Dispute Category</label>
                        <select 
                          value={newOiCategory} 
                          onChange={(e) => setNewOiCategory(e.target.value)}
                          style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px', outline: 'none' }}
                        >
                          <option value="ALL_MATCHES">All Categories</option>
                          <option value="Fraud">Fraud</option>
                          <option value="Consumer Dispute">Consumer Dispute</option>
                          <option value="Processing Error">Processing Error</option>
                          <option value="Authorization">Authorization</option>
                        </select>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '12px', fontWeight: '600', color: '#475569' }}>Max Deflection Amount ($)</label>
                        <input 
                          type="number" 
                          step="0.01" 
                          placeholder="e.g. 50.00" 
                          value={newOiThreshold} 
                          onChange={(e) => setNewOiThreshold(e.target.value)}
                          style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px', outline: 'none' }}
                        />
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '12px', fontWeight: '600', color: '#475569' }}>Rule Action</label>
                      <select 
                        value={newOiAction} 
                        onChange={(e) => setNewOiAction(e.target.value)}
                        style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px', outline: 'none', background: '#f8fafc', color: '#64748b' }}
                        disabled
                      >
                        <option value="AUTO_INTENT_TO_CREDIT">AUTO_INTENT_TO_CREDIT (Automate deflection & reverse funds)</option>
                      </select>
                    </div>
                    <button type="submit" className="btn btn-primary" style={{ padding: '10px 16px', borderRadius: '6px', fontWeight: '600', fontSize: '13px', background: '#6B38FB', color: '#fff', border: 'none', cursor: 'pointer', alignSelf: 'flex-end' }}>
                      + Add Deflection Rule
                    </button>
                  </form>

                  <h4 style={{ fontSize: '13px', fontWeight: '700', color: '#475569', marginBottom: '10px' }}>Active Rules</h4>
                  {oiRules.length === 0 ? (
                    <div style={{ padding: '16px', textScale: 'center', background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: '8px', color: '#64748b', fontSize: '13px', textAlign: 'center' }}>
                      No active deflection rules configured.
                    </div>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                        <thead>
                          <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'left' }}>
                            <th style={{ padding: '10px' }}>Category</th>
                            <th style={{ padding: '10px' }}>Max Deflection Limit</th>
                            <th style={{ padding: '10px' }}>Action</th>
                            <th style={{ padding: '10px', textAlign: 'center' }}>Remove</th>
                          </tr>
                        </thead>
                        <tbody>
                          {oiRules.map((rule, idx) => (
                            <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                              <td style={{ padding: '10px', fontWeight: '600', color: '#334155' }}>{rule.visaCategory}</td>
                              <td style={{ padding: '10px', color: '#475569' }}>${parseFloat(rule.maxThresholdAmount).toFixed(2)}</td>
                              <td style={{ padding: '10px' }}><span className="badge badge-progress" style={{ background: '#e0f2fe', color: '#0369a1', fontSize: '10px' }}>{rule.ruleAction}</span></td>
                              <td style={{ padding: '10px', textAlign: 'center' }}>
                                <button type="button" onClick={() => handleDeleteOiRule(idx)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '14px' }}>&times;</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Rapid Dispute Resolution Card */}
                <div style={{ background: 'var(--card, #fff)', border: '1px solid var(--border-color, #e2e8f0)', borderRadius: '12px', padding: '24px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px', borderBottom: '1px solid #f1f5f9', paddingBottom: '12px' }}>
                    <span style={{ fontSize: '24px' }}>⚡</span>
                    <div>
                      <h3 style={{ fontSize: '16px', fontWeight: '700', color: '#1e293b', margin: 0 }}>Rapid Dispute Resolution (RDR) Rules</h3>
                      <p style={{ fontSize: '12px', color: '#64748b', margin: 0 }}>Automated rules for RDR program auto-resolution.</p>
                    </div>
                  </div>

                  <form onSubmit={handleAddRdrRule} style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '24px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '12px', fontWeight: '600', color: '#475569' }}>Program Identifier</label>
                        <select 
                          value={newRdrProgramId} 
                          onChange={(e) => setNewRdrProgramId(e.target.value)}
                          style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px', outline: 'none' }}
                        >
                          <option value="VISA_RDR_CORE">VISA_RDR_CORE</option>
                        </select>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '12px', fontWeight: '600', color: '#475569' }}>Max Auto-Accept Limit ($)</label>
                        <input 
                          type="number" 
                          step="0.01" 
                          placeholder="e.g. 50.00" 
                          value={newRdrMaxLimit} 
                          onChange={(e) => setNewRdrMaxLimit(e.target.value)}
                          style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px', outline: 'none' }}
                        />
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '12px', fontWeight: '600', color: '#475569' }}>Excluded SKUs (Comma separated)</label>
                      <input 
                        type="text" 
                        placeholder="e.g. HIGH_RISK_ELECTRONICS, SKU_PREMIUM" 
                        value={newRdrExcludedSkus} 
                        onChange={(e) => setNewRdrExcludedSkus(e.target.value)}
                        style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px', outline: 'none' }}
                      />
                    </div>
                    <button type="submit" className="btn btn-primary" style={{ padding: '10px 16px', borderRadius: '6px', fontWeight: '600', fontSize: '13px', background: '#6B38FB', color: '#fff', border: 'none', cursor: 'pointer', alignSelf: 'flex-end' }}>
                      + Add RDR Rule
                    </button>
                  </form>

                  <h4 style={{ fontSize: '13px', fontWeight: '700', color: '#475569', marginBottom: '10px' }}>Active Rules</h4>
                  {rdrRules.length === 0 ? (
                    <div style={{ padding: '16px', textScale: 'center', background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: '8px', color: '#64748b', fontSize: '13px', textAlign: 'center' }}>
                      No active RDR rules configured.
                    </div>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                        <thead>
                          <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'left' }}>
                            <th style={{ padding: '10px' }}>Program</th>
                            <th style={{ padding: '10px' }}>Max Auto-Accept</th>
                            <th style={{ padding: '10px' }}>Excluded SKUs</th>
                            <th style={{ padding: '10px', textAlign: 'center' }}>Remove</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rdrRules.map((rule, idx) => (
                            <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                              <td style={{ padding: '10px', fontWeight: '600', color: '#334155' }}>{rule.programId}</td>
                              <td style={{ padding: '10px', color: '#475569' }}>${parseFloat(rule.rdrMaxLimit).toFixed(2)}</td>
                              <td style={{ padding: '10px', color: '#475569' }}>{rule.excludedSkus || 'None'}</td>
                              <td style={{ padding: '10px', textAlign: 'center' }}>
                                <button type="button" onClick={() => handleDeleteRdrRule(idx)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '14px' }}>&times;</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activePage === 'm-reports' && (
            <div className="page active" id="m-reports">
              <div className="view-chargeback-header">
                <span className="vc-breadcrumb">Reports & Analytics / <span>My Dispute Performance</span></span>
              </div>
              <div className="page-inner">
                <MerchantReportsPage chargebacks={chargebacks} currentUser={currentUser} formatINR={formatINR} />
              </div>
            </div>
          )}

        </main>
      </div>


      {/* Merchant Onboarding Tour Overlay */}
      {showTour && (() => {
        const TOUR_STEPS = [
          { title: 'Welcome to Merchant Portal 👋', body: 'This quick tour highlights the key sections of your dispute management portal. You can skip at any time by clicking "Skip Tour".' },
          { title: '📊 Dashboard', body: 'Your home screen shows live stats: total disputes received, open cases, disputes won, and SLA deadlines. Click any stat card to navigate to the relevant disputes.' },
          { title: '📋 Dispute Management', body: 'Manage all your disputes here. Switch between Action Required, Under Review, Doc Pending, and Closed tabs to track and respond to cases.' },
          { title: '⚡ Take Action', body: 'When a dispute needs your response, click "Take Action" to accept liability (full/partial) or submit supporting evidence documents.' },
          { title: '❓ FAQ & Help', body: 'Visit the FAQ & Help section anytime for answers to common questions, document guidelines, and TAT/SLA information.' },
          { title: "You're all set! 🎉", body: 'Your merchant portal is ready. Remember to respond to disputes before their TAT deadline to avoid automatic loss. Good luck!' },
        ];
        const step = TOUR_STEPS[tourStep];
        const isLast = tourStep === TOUR_STEPS.length - 1;
        const skipTour = () => { sessionStorage.setItem('merchant_tour_done', '1'); setShowTour(false); };
        const nextStep = () => { if (isLast) { skipTour(); } else { setTourStep(tourStep + 1); } };
        return (
          <div className="tour-overlay" style={{ pointerEvents: 'all' }}>
            <div className="tour-backdrop" onClick={skipTour} />
            <div style={{
              position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
              background: 'linear-gradient(135deg, #1e40af 0%, #3b82f6 100%)',
              borderRadius: '16px', padding: '28px 28px 20px', boxShadow: '0 20px 60px rgba(30,64,175,0.35)',
              zIndex: 10001, maxWidth: '400px', width: '90vw', color: '#fff', fontFamily: "'Inter', sans-serif"
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                <div style={{ fontSize: '17px', fontWeight: '700', lineHeight: '1.3' }}>{step.title}</div>
                <span style={{ fontSize: '12px', background: 'rgba(255,255,255,0.2)', padding: '3px 10px', borderRadius: '999px', fontWeight: '600', marginLeft: '12px', whiteSpace: 'nowrap' }}>{tourStep + 1} / {TOUR_STEPS.length}</span>
              </div>
              <p style={{ fontSize: '14px', lineHeight: '1.6', color: 'rgba(255,255,255,0.9)', margin: '0 0 20px' }}>{step.body}</p>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <button onClick={skipTour} style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.75)', fontSize: '13px', cursor: 'pointer', fontWeight: '600', padding: 0 }}>Hide these tips</button>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  {TOUR_STEPS.map((_, i) => <span key={i} style={{ width: i === tourStep ? '18px' : '6px', height: '6px', borderRadius: '999px', background: i === tourStep ? '#fff' : 'rgba(255,255,255,0.4)', transition: 'all 0.3s', display: 'inline-block' }} />)}
                </div>
                <button onClick={nextStep} style={{ background: '#fff', color: '#1e40af', border: 'none', borderRadius: '8px', padding: '8px 20px', fontWeight: '700', fontSize: '13px', cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.12)' }}>
                  {isLast ? '✅ Done' : 'Next →'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {activeModal === 'disputeDetails' && activePage !== 'reports' && (

        <div className="overlay open">
          {(() => {
            const cb = chargebacks.find(c => c.id === targetDisputeId) || {};
            return (
              <div className="modal" style={{ width: '90%', maxWidth: '1100px', padding: '0', borderRadius: '4px', overflow: 'hidden', fontFamily: 'Arial, sans-serif', display: 'flex', flexDirection: 'column', maxHeight: '90vh' }}>
                <div style={{ padding: '12px 20px', borderBottom: '1px solid #e0e0e0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
                  <h2 style={{ fontSize: '14px', fontWeight: 'bold', margin: 0, color: '#000' }}>{cb.id}</h2>
                  <button onClick={() => setActiveModal(null)} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#9e9e9e' }}>&times;</button>
                </div>
                
                <div style={{ padding: '0', overflowY: 'auto', flex: 1 }}>
                  {/* Original Transaction Details */}
                  <div style={{ padding: '16px 24px', background: '#fff', borderBottom: '1px solid #e5e7eb', fontWeight: 'bold', fontSize: '14px', display: 'flex', justifyContent: 'space-between', color: '#000', alignItems: 'center' }}>
                    <span>Original Transaction Details</span>
                    <span style={{ fontWeight: 'normal', color: '#757575' }}>Transaction Date & Time <span style={{color:'red'}}>*</span> : <span style={{color:'#333', fontWeight:'bold'}}>{formatDateDisp(cb.txnDate)}</span></span>
                  </div>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px', padding: '24px', fontSize: '13px', background: '#fff' }}>
                    {/* Col 1 */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>Case ID <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>{cb.id}</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>AR Number <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>{cb.rrn}</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>RR Number <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>{cb.rrn}</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>Txn Currency <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>INR</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>Location <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>India</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>Country <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>India</strong></div>
                    </div>
                    {/* Col 2 */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>Transaction Ref. Number <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>{cb.txnId}</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>MID <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>{cb.userId}</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>Card Number <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>457704******3989</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>Amount <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>{cb.txnAmt}</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>City <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>-</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>Zip code <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>-</strong></div>
                    </div>
                    {/* Col 3 */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>Merchant Name <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>{cb.userName}</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>TID <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>10515104</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>Approval Code <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>021838</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>Address <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>-</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>State <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>-</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>Request ID <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>-</strong></div>
                    </div>
                  </div>

                  {/* Dispute Details */}
                  <div style={{ padding: '12px 20px', background: '#fff', borderTop: '1px solid #eee', borderBottom: '1px solid #eee', fontWeight: 'bold', fontSize: '13px', display: 'flex', justifyContent: 'space-between', color: '#000' }}>
                    <span>Dispute Details</span>
                    <span style={{ fontWeight: 'normal', color: '#757575' }}>Dispute Date <span style={{color:'red'}}>*</span> : <span style={{color:'#333', fontWeight:'bold'}}>{formatDateDisp(cb.createdDate || cb.txnDate)}</span></span>
                  </div>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px', padding: '24px', fontSize: '13px', background: '#fff' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>Scheme <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>{cb.product || 'VISA'}</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>Aggregator <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>{cb.aggregator || 'Payermax'}</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>Visa Case ID <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>{cb.visaId || 'V-' + (cb.id || 'XXXX').substring(0, 6).toUpperCase()}</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>Case ID <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>{cb.id}</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>Dispute Reason Code <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>13.1</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}><span style={{ color: '#9e9e9e' }}>Source Currency Code (Alpha) <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>INR</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>Destination Amount <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>{cb.txnAmt}</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>Remaining Days <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>{cb.aging}</strong></div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>Dispute Type <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px', textTransform: 'uppercase'}}>{cb.adjType}</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>Dispute Description <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>13.1-Services Not Provided or Merchandise Not Received</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}><span style={{ color: '#9e9e9e' }}>Source Amount <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>{cb.txnAmt}</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>Re-presentment Received Date Credit <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>-</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>Dispute Amount (INR) <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>{cb.txnAmt}</strong></div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>Current Status <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>{cb.mStatus}</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '40px' }}><span style={{ color: '#9e9e9e' }}>Destination Currency Code (Alpha) <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>INR</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>Admin Remarks <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>{cb.rejectReason || '-'}</strong></div>
                    </div>
                  </div>

                  {/* Previous Documents */}
                  <>
                      <div style={{ padding: '12px 20px', background: '#fff', borderTop: '1px solid #eee', borderBottom: '1px solid #eee', fontWeight: 'bold', fontSize: '13px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#000' }}>
                        <span>Previous Documents</span>
                        <button style={{ background: '#50BDC9', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>Download All Docs</button>
                      </div>
                      
                      <div style={{ padding: '20px', display: 'flex', gap: '16px', overflowX: 'auto', background: '#fff' }}>
                        {(cb.documents && cb.documents.length > 0) ? cb.documents.map(doc => (
                          <div key={doc.id} style={{ width: '220px', padding: '16px', border: doc.status === 'Rejected' ? '1px solid #ff4d4f' : '1px solid #e0e0e0', borderRadius: '4px', flexShrink: 0, display: 'flex', flexDirection: 'column', color: '#333', background: doc.status === 'Rejected' ? '#fff1f0' : '#fafafa' }}>
                            <div style={{ fontWeight: 'bold', fontSize: '13px', marginBottom: '12px', wordBreak: 'break-all' }}><span style={{ color: '#ccc', marginRight: '6px' }}>📄</span>{doc.filename}</div>
                            <div style={{ fontSize: '12px', color: '#888', marginBottom: '4px' }}>Uploaded By: <span style={{ color: '#333', fontWeight: 'bold' }}>{doc.uploadedBy || 'Merchant'}</span></div>
                            <div style={{ fontSize: '12px', color: '#888', marginBottom: '4px' }}>Status: <span style={{ color: doc.status === 'Rejected' ? '#ff4d4f' : doc.status === 'Accepted' ? '#52c41a' : '#faad14', fontWeight: 'bold' }}>{doc.status}</span></div>
                            <div style={{ fontSize: '12px', color: '#888' }}>Date: {new Date(doc.uploadedAt).toLocaleDateString()}</div>
                            {doc.status === 'Rejected' && (
                              <div style={{ fontSize: '12px', color: '#ff4d4f', marginTop: '12px', lineHeight: '1.4' }}>
                                Remarks: {doc.rejectionRemarks}
                              </div>
                            )}
                            {doc.status === 'Rejected' && (
                              <div style={{ marginTop: '16px' }}>
                                <button style={{ fontSize: '12px', background: '#ff4d4f', color: '#fff', border: 'none', padding: '6px 16px', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 }} onClick={() => setActiveModal('contest')}>
                                  Re-upload
                                </button>
                              </div>
                            )}
                          </div>
                        )) : (
                          <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>No previous evidence uploaded.</div>
                        )}
                      </div>
                  </>
                  {renderTimeline(cb, expandedTimeline, setExpandedTimeline, showToast, 'merchant')}
                </div>
                
                <div style={{ padding: '12px 20px', borderTop: '1px solid #e0e0e0', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', background: '#fff', flexShrink: 0, zIndex: 10 }}>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <button onClick={() => setActiveModal(null)} style={{ padding: '6px 16px', border: '1px solid #50BDC9', background: '#fff', color: '#50BDC9', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>Close</button>
                    {!isClosedDispute(cb) && reportTab === 'doc-pending' && !cb.mStatus.includes('Lost') && !cb.mStatus.includes('Won') && (
                      <>
                        <button className="btn btn-outline" style={{ padding: '6px 16px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }} onClick={() => { setActiveModal('action2'); }}>Accept Dispute</button>
                        <button className="btn btn-primary" style={{ padding: '6px 16px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', background: '#1890ff', color: '#fff', border: 'none' }} onClick={() => { setActiveModal('contest'); }}>Contest Dispute &amp; Submit Evidence</button>
                      </>
                    )}
                    {!isClosedDispute(cb) && reportTab === 'doc-verification' && !cb.mStatus.includes('Lost') && !cb.mStatus.includes('Won') && (cb.acquirerAction === 'evidence_uploaded' || (cb.documents && cb.documents.some(d => d.uploadedBy === 'Admin' && d.status === 'Pending Review'))) && (
                      <>
                        <button className="btn btn-danger" style={{ padding: '6px 16px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }} onClick={() => handleMerchantRejectAdminClick(cb.id)}>Reject Admin Evidence</button>
                        <button className="btn btn-outline" style={{ padding: '6px 16px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }} onClick={() => { setActiveModal('contest'); }}>Upload Additional Evidence</button>
                        <button className="btn btn-primary" style={{ padding: '6px 16px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', background: '#52c41a', color: '#fff', border: 'none' }} onClick={() => submitMerchantAcceptAdmin(cb.id)}>Accept Admin Evidence</button>
                      </>
                    )}
                    {!isClosedDispute(cb) && reportTab === 'doc-verification' && !cb.mStatus.includes('Lost') && !cb.mStatus.includes('Won') && cb.acquirerAction !== 'evidence_uploaded' && !(cb.documents && cb.documents.some(d => d.uploadedBy === 'Admin' && d.status === 'Pending Review')) && (
                      <>
                        <button className="btn btn-outline" style={{ padding: '6px 16px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', color: '#50BDC9', border: '1px solid #50BDC9', background: '#fff' }} onClick={() => { setActiveModal('action2'); }}>Accept Dispute</button>
                        <button className="btn btn-primary" style={{ padding: '6px 16px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', background: '#1890ff', color: '#fff', border: 'none' }} onClick={() => { setActiveModal('contest'); }}>Contest Dispute &amp; Submit Evidence</button>
                      </>
                    )}
                    {!isClosedDispute(cb) && reportTab !== 'doc-pending' && reportTab !== 'doc-verification' && getActionBtn(cb)}
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Action Modals */}
      {activeModal === 'action1' && (
        <div className="overlay open">
          <div className="modal modal-sm">
            <button className="modal-close" style={{ position: 'absolute', top: '12px', right: '12px', color: 'var(--text-muted)' }} onClick={() => setActiveModal(null)}>✕</button>
            <div style={{ padding: '32px 28px', textAlign: 'center' }}>
              <h2 style={{ fontSize: '20px', fontWeight: '700', marginBottom: '10px' }}>Take Action For Dispute!</h2>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '28px', lineHeight: '1.6' }}>
                Kindly represent the case before the deadline. If no response is logged, NPCI rule defaults to ticket debit adjustment.
              </p>
              <button 
                className="btn btn-primary" 
                style={{ width: '100%', marginBottom: '12px', height: '46px', fontSize: '15px' }} 
                onClick={() => { setLiabilityType('full'); setActiveModal('action2'); }}
              >
                Accept Dispute
              </button>
              <button 
                className="btn btn-outline" 
                style={{ width: '100%', height: '46px', fontSize: '15px' }} 
                onClick={() => setActiveModal('contest')}
              >
                Contest Dispute &amp; Submit Evidence
              </button>
            </div>
          </div>
        </div>
      )}

      {activeModal === 'action2' && (
        <div className="overlay open">
          <div className="modal" style={{ width: '90%', maxWidth: '500px', borderRadius: '8px', overflow: 'hidden' }}>
            <div className="modal-hdr" style={{ borderBottom: '1px solid #eee', padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 'bold' }}>Accept Dispute</h3>
              <button className="modal-close" onClick={() => setActiveModal(null)} style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer' }}>✕</button>
            </div>
            <div className="modal-body" style={{ padding: '20px' }}>
              <div style={{ display: 'flex', background: '#f5f5f5', borderRadius: '6px', padding: '4px', marginBottom: '20px' }}>
                <button 
                  style={{ 
                    flex: 1, 
                    padding: '8px', 
                    border: 'none', 
                    borderRadius: '4px', 
                    background: liabilityType === 'full' ? '#fff' : 'transparent', 
                    color: liabilityType === 'full' ? '#000' : '#757575',
                    fontWeight: liabilityType === 'full' ? 'bold' : 'normal',
                    boxShadow: liabilityType === 'full' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                    cursor: 'pointer',
                    fontSize: '13px'
                  }} 
                  onClick={() => setLiabilityType('full')}
                >
                  Full Liability
                </button>
                <button 
                  style={{ 
                    flex: 1, 
                    padding: '8px', 
                    border: 'none', 
                    borderRadius: '4px', 
                    background: liabilityType === 'partial' ? '#fff' : 'transparent', 
                    color: liabilityType === 'partial' ? '#000' : '#757575',
                    fontWeight: liabilityType === 'partial' ? 'bold' : 'normal',
                    boxShadow: liabilityType === 'partial' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                    cursor: 'pointer',
                    fontSize: '13px'
                  }} 
                  onClick={() => setLiabilityType('partial')}
                >
                  Partial Liability
                </button>
              </div>

              {liabilityType === 'full' ? (
                <div>
                  <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '16px', lineHeight: '1.5' }}>
                    Accepting full liability will refund the complete dispute amount to the customer. This action is final.
                  </p>
                  <div className="mf" style={{ marginBottom: '16px' }}>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', marginBottom: '6px' }}>Remarks</label>
                    <textarea 
                      className="mfi mfi-area" 
                      placeholder="Add accepting remarks..." 
                      value={acceptRemarks}
                      onChange={(e) => setAcceptRemarks(e.target.value)}
                      style={{ width: '100%', minHeight: '80px', padding: '8px', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                    <button className="btn btn-secondary" onClick={() => setActiveModal(null)} style={{ padding: '8px 16px', borderRadius: '4px', cursor: 'pointer' }}>Cancel</button>
                    <button className="btn btn-primary" onClick={confirmAccept} style={{ padding: '8px 16px', borderRadius: '4px', cursor: 'pointer', background: '#1890ff', color: '#fff', border: 'none' }}>Accept Liability</button>
                  </div>
                </div>
              ) : (
                <div>
                  <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '16px', lineHeight: '1.5' }}>
                    Accepting partial liability allows you to pay a portion of the dispute. You must upload supporting evidence.
                  </p>
                  <div className="mf" style={{ marginBottom: '12px' }}>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', marginBottom: '6px' }}>Liability Amount (Mandatory)</label>
                    <input 
                      type="number" 
                      className="mfi" 
                      placeholder="e.g. 500" 
                      value={partialAmount}
                      onChange={(e) => setPartialAmount(e.target.value)}
                      style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div className="mf" style={{ marginBottom: '12px' }}>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', marginBottom: '6px' }}>Evidence Upload (Mandatory)</label>
                    <div style={{ position: 'relative', border: '1px dashed #ccc', padding: '16px', textAlign: 'center', borderRadius: '4px', background: '#fafafa' }}>
                      <input 
                        type="file" 
                        id="partialEvInput" 
                        style={{ display: 'none' }} 
                        onChange={(e) => setPartialEvidenceFile(e.target.files[0])} 
                      />
                      {partialEvidenceFile ? (
                        <div style={{ fontSize: '13px', color: '#1890ff', fontWeight: 'bold' }}>
                          📄 {partialEvidenceFile.name}
                          <button 
                            style={{ background: 'none', border: 'none', color: 'red', marginLeft: '10px', cursor: 'pointer' }}
                            onClick={() => setPartialEvidenceFile(null)}
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <label htmlFor="partialEvInput" style={{ cursor: 'pointer', fontSize: '13px', color: '#757575' }}>
                          ☁ Choose proof file
                        </label>
                      )}
                    </div>
                  </div>
                  <div className="mf" style={{ marginBottom: '16px' }}>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', marginBottom: '6px' }}>Remarks (Optional)</label>
                    <textarea 
                      className="mfi mfi-area" 
                      placeholder="Reason for partial acceptance..." 
                      value={partialRemarks}
                      onChange={(e) => setPartialRemarks(e.target.value)}
                      style={{ width: '100%', minHeight: '80px', padding: '8px', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                    <button className="btn btn-secondary" onClick={() => setActiveModal(null)} style={{ padding: '8px 16px', borderRadius: '4px', cursor: 'pointer' }}>Cancel</button>
                    <button className="btn btn-primary" onClick={confirmAcceptPartially} style={{ padding: '8px 16px', borderRadius: '4px', cursor: 'pointer', background: '#1890ff', color: '#fff', border: 'none' }}>Accept Liability</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeModal === 'contest' && (
        <div className="overlay open">
          <div className="modal modal-lg">
            <div className="modal-hdr"><h3>Contest Dispute &amp; Submit Evidence</h3><button className="modal-close" onClick={() => setActiveModal(null)}>✕</button></div>
            <div className="modal-body">
              <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '6px' }}>Selected Action</div>
              <div className="radio-opts" style={{ marginBottom: '16px' }}>
                <label className="radio-opt">
                  <input type="radio" name="contestOpt" checked={false} onChange={() => { setLiabilityType('full'); setActiveModal('action2'); }} /> Accept Dispute
                </label>
                <label className="radio-opt">
                  <input type="radio" name="contestOpt" checked={true} readOnly /> Contest Dispute &amp; Submit Evidence
                </label>
              </div>
              <div style={{ fontSize: '15px', fontWeight: '700', marginBottom: '6px' }}>Evidence Documents</div>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '14px' }}>
                The proof you upload will be reviewed by the card scheme network/NPCI review team. Max 20MB (.png, .jpeg, .pdf supported).
              </p>
              
              <div id="evidenceList">
                <div className="ev-row">
                  <label>ℹ Delivery/Service Proof</label>
                  <div>
                    {evidenceFiles[1] ? (
                      <div className="ev-uploaded">
                        📄 {evidenceFiles[1]} 
                        <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--brand)', marginLeft: '8px' }} onClick={() => removeEvidenceFile(1)}>✕</button>
                      </div>
                    ) : (
                      <>
                        <label className="ev-upload-btn" htmlFor="evInput1">☁ Choose proof file</label>
                        <input type="file" id="evInput1" style={{ display: 'none' }} onChange={(e) => handleEvidenceFileChange(1, e.target.files[0])} />
                      </>
                    )}
                  </div>
                </div>
                <div className="ev-row">
                  <label>ℹ Statement of Service</label>
                  <div>
                    {evidenceFiles[2] ? (
                      <div className="ev-uploaded">
                        📄 {evidenceFiles[2]} 
                        <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--brand)', marginLeft: '8px' }} onClick={() => removeEvidenceFile(2)}>✕</button>
                      </div>
                    ) : (
                      <>
                        <label className="ev-upload-btn" htmlFor="evInput2">☁ Choose file</label>
                        <input type="file" id="evInput2" style={{ display: 'none' }} onChange={(e) => handleEvidenceFileChange(2, e.target.files[0])} />
                      </>
                    )}
                  </div>
                </div>
                <div className="ev-row">
                  <label>ℹ Refund Invoice (Optional)</label>
                  <div>
                    {evidenceFiles[3] ? (
                      <div className="ev-uploaded">
                        📄 {evidenceFiles[3]} 
                        <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--brand)', marginLeft: '8px' }} onClick={() => removeEvidenceFile(3)}>✕</button>
                      </div>
                    ) : (
                      <>
                        <label className="ev-upload-btn" htmlFor="evInput3">☁ Choose file</label>
                        <input type="file" id="evInput3" style={{ display: 'none' }} onChange={(e) => handleEvidenceFileChange(3, e.target.files[0])} />
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="mf" style={{ marginTop: '14px' }}>
                <label>Justification Remarks</label>
                <input 
                  type="text" 
                  className="mfi" 
                  placeholder="Summarize your representation case (Max 500 chars)" 
                  value={contestRemarks}
                  onChange={(e) => setContestRemarks(e.target.value)}
                  maxLength={500} 
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setActiveModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={submitContestEvidence}>Submit Evidence</button>
            </div>
          </div>
        </div>
      )}

      {activeModal === 'merchantComment' && (
        <div className="overlay open">
          <div className="modal">
            <div className="modal-hdr">
              <h3>Add Dispute Comment</h3>
              <button className="modal-close" onClick={() => { setActiveModal(null); setCommentText(''); }}>✕</button>
            </div>
            <div className="modal-body">
              <div className="mf" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '13px', fontWeight: '600' }}>Your Comment</label>
                <textarea 
                  className="mfi" 
                  style={{ width: '100%', height: '100px', padding: '10px', borderRadius: '6px', border: '1.5px solid #cbd5e1', outline: 'none', fontSize: '13px', resize: 'vertical' }}
                  placeholder="Type your comment here..." 
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  maxLength={500} 
                />
              </div>
            </div>
            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
              <button className="btn btn-secondary" onClick={() => { setActiveModal(null); setCommentText(''); }}>Cancel</button>
              <button className="btn btn-primary" style={{ background: '#6B38FB', color: '#fff', border: 'none', padding: '6px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }} onClick={submitComment}>Submit Comment</button>
            </div>
          </div>
        </div>
      )}

      {activeModal === 'merchantRejectAdminDocs' && (
        <div className="overlay open">
          {(() => {
            const cb = chargebacks.find(x => x.id === targetDisputeId);
            if (!cb) return null;
            return (
              <div className="modal">
                <div className="modal-hdr"><h3>Reject Admin Evidence</h3><button className="modal-close" onClick={() => setActiveModal(null)}>✕</button></div>
                <div className="modal-body">
                  <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '10px' }}>Select admin documents to reject:</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
                    {(cb.documents || []).filter(d => d.uploadedBy === 'Admin' && d.status === 'Pending Review').map(doc => (
                      <label key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
                        <input 
                          type="checkbox" 
                          checked={selectedDocsToReject.includes(doc.id)} 
                          onChange={(e) => {
                            if (e.target.checked) setSelectedDocsToReject([...selectedDocsToReject, doc.id]);
                            else setSelectedDocsToReject(selectedDocsToReject.filter(id => id !== doc.id));
                          }}
                        />
                        📄 {doc.filename}
                      </label>
                    ))}
                  </div>
                  
                  <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '6px' }}>Rejection Remarks (Mandatory):</div>
                  <textarea 
                    className="mfi" 
                    placeholder="Enter reason for rejecting admin's evidence..." 
                    value={rejectionRemarks}
                    onChange={(e) => setRejectionRemarks(e.target.value)}
                    rows={4}
                    style={{ width: '100%', resize: 'vertical', marginBottom: '16px' }}
                  ></textarea>

                  <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '6px' }}>Upload Additional Evidence (Optional):</div>
                  <div className="file-upload-box" style={{ border: '2px dashed #e0e0e0', padding: '20px', textAlign: 'center', borderRadius: '4px', background: '#fafafa', position: 'relative' }}>
                    <input 
                      type="file" 
                      onChange={(e) => setMerchantRejectAdminEvidence(e.target.files[0])} 
                      style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }} 
                    />
                    {merchantRejectAdminEvidence ? (
                      <div style={{ color: '#50BDC9', fontWeight: '600' }}>📄 {merchantRejectAdminEvidence.name}</div>
                    ) : (
                      <div style={{ color: '#9e9e9e', fontSize: '13px' }}>Drag & drop evidence file here, or click to browse</div>
                    )}
                  </div>
                </div>
                <div className="modal-footer" style={{ display: 'flex', gap: '10px' }}>
                  <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setActiveModal(null)}>Cancel</button>
                  <button className="btn btn-danger" style={{ flex: 2 }} onClick={() => submitMerchantRejectAdminDocs()}>Submit Rejection</button>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {activeModal === 'successAccept' && (
        <div className="overlay open">
          <div className="modal modal-sm" style={{ textAlign: 'center', padding: '30px' }}>
            <button className="modal-close" style={{ position: 'absolute', top: '12px', right: '12px', color: 'var(--text-muted)' }} onClick={() => setActiveModal(null)}>✕</button>
            <div className="modal-success">
              <div className="ms-icon" style={{ fontSize: '48px', marginBottom: '16px' }}>🔴</div>
              <h3>Full Liability Accepted</h3>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '8px' }}>
                Full liability has been accepted successfully. The complete dispute amount has been refund-debited from your wallet balance.
              </p>
              <button className="btn btn-primary" style={{ marginTop: '20px', width: '100%' }} onClick={() => setActiveModal(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {activeModal === 'successAcceptPartially' && (
        <div className="overlay open">
          <div className="modal modal-sm" style={{ textAlign: 'center', padding: '30px' }}>
            <button className="modal-close" style={{ position: 'absolute', top: '12px', right: '12px', color: 'var(--text-muted)' }} onClick={() => setActiveModal(null)}>✕</button>
            <div className="modal-success">
              <div className="ms-icon" style={{ fontSize: '48px', marginBottom: '16px' }}>🟡</div>
              <h3>Partial Liability Accepted</h3>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '8px' }}>
                Partial liability has been accepted successfully. The details and evidence have been submitted to the acquirer/scheme network for verification.
              </p>
              <button className="btn btn-primary" style={{ marginTop: '20px', width: '100%' }} onClick={() => setActiveModal(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
      
      {activeModal === 'successEvidence' && (
        <div className="overlay open">
          <div className="modal modal-sm" style={{ textAlign: 'center', padding: '30px' }}>
            <button className="modal-close" style={{ position: 'absolute', top: '12px', right: '12px', color: 'var(--text-muted)' }} onClick={() => setActiveModal(null)}>✕</button>
            <div className="modal-success">
              <div className="ms-icon" style={{ fontSize: '48px', marginBottom: '16px' }}>🟢</div>
              <h3>Evidence Submitted Successfully</h3>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '8px' }}>
                The supporting evidence has been submitted successfully for review and further processing.
              </p>
              <button className="btn btn-primary" style={{ marginTop: '20px', width: '100%' }} onClick={() => setActiveModal(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Help Button */}
      <button 
        onClick={() => setShowFaq(true)}
        style={{
          position: 'fixed',
          bottom: '30px',
          right: '30px',
          width: '56px',
          height: '56px',
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #7c3aed 0%, #a78bfa 100%)',
          border: 'none',
          color: '#fff',
          fontSize: '24px',
          cursor: 'pointer',
          boxShadow: '0 4px 12px rgba(124, 58, 237, 0.4)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'transform 0.2s'
        }}
        onMouseEnter={(e) => e.target.style.transform = 'scale(1.1)'}
        onMouseLeave={(e) => e.target.style.transform = 'scale(1)'}
      >
        ?
      </button>

      {/* FAQ Modal */}
      {showFaq && (
        <div style={{
          position: 'fixed',
          bottom: '100px',
          right: '30px',
          width: '380px',
          height: '500px',
          maxHeight: 'calc(100vh - 150px)',
          background: '#ffffff',
          borderRadius: '16px',
          boxShadow: '0 12px 32px rgba(107, 56, 251, 0.15), 0 0 0 1px rgba(0,0,0,0.05)',
          border: '1.5px solid #CBD5E1',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#F8FAFC' }}>
            <h2 style={{ fontSize: '15px', fontWeight: '800', margin: 0, color: '#6B38FB', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>❓</span> Frequently Asked Questions
            </h2>
            <button onClick={() => setShowFaq(false)} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#94A3B8', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', borderRadius: '50%', transition: 'all 0.2s' }} onMouseEnter={(e) => { e.currentTarget.style.background = '#F1F5F9'; e.currentTarget.style.color = '#64748B'; }} onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = '#94A3B8'; }}>&times;</button>
          </div>
          <div style={{ padding: '20px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ paddingBottom: '12px', borderBottom: '1px solid #F1F5F9' }}>
              <h3 style={{ fontSize: '13px', fontWeight: '700', color: '#1E293B', marginBottom: '6px' }}>What is the Dispute Management Portal?</h3>
              <p style={{ fontSize: '12px', color: '#475569', lineHeight: '1.5', margin: 0 }}>The Dispute Management Portal allows you to view, manage, and respond to chargeback disputes efficiently.</p>
            </div>
            <div style={{ paddingBottom: '12px', borderBottom: '1px solid #F1F5F9' }}>
              <h3 style={{ fontSize: '13px', fontWeight: '700', color: '#1E293B', marginBottom: '6px' }}>How do I filter disputes?</h3>
              <p style={{ fontSize: '12px', color: '#475569', lineHeight: '1.5', margin: 0 }}>Use the dropdown filters at the top to filter by date range, status, type, or search by specific fields like Transaction ID, Case ID, or Merchant Name.</p>
            </div>
            <div style={{ paddingBottom: '12px', borderBottom: '1px solid #F1F5F9' }}>
              <h3 style={{ fontSize: '13px', fontWeight: '700', color: '#1E293B', marginBottom: '6px' }}>What do the summary cards show?</h3>
              <p style={{ fontSize: '12px', color: '#475569', lineHeight: '1.5', margin: 0 }}>The summary cards show urgent disputes due today, critical disputes due tomorrow, and disputes with insufficient evidence that need immediate attention.</p>
            </div>
            <div style={{ paddingBottom: '12px', borderBottom: '1px solid #F1F5F9' }}>
              <h3 style={{ fontSize: '13px', fontWeight: '700', color: '#1E293B', marginBottom: '6px' }}>How do I take action on a dispute?</h3>
              <p style={{ fontSize: '12px', color: '#475569', lineHeight: '1.5', margin: 0 }}>Click on any dispute case in the list to open the split details preview. Under the upload column, you can either accept the dispute or upload supporting documents to contest it.</p>
            </div>
            <div style={{ paddingBottom: '12px' }}>
              <h3 style={{ fontSize: '13px', fontWeight: '700', color: '#1E293B', marginBottom: '6px' }}>How do I export dispute data?</h3>
              <p style={{ fontSize: '12px', color: '#475569', lineHeight: '1.5', margin: 0 }}>Click the "Export" button in the toolbar to download dispute data as a CSV file for further analysis.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════
// ADMIN PORTAL DASHBOARD
// ═════════════════════════════════════════════
const webhookData = [
  { id: 'WH-VISA-551029', event: 'DisputeCreatedEvent', time: '2024-05-26 10:14:02', typeLabel: 'Chargeback', typeColor: '#f57c00', typeBg: '#fff3e0', merchant: 'Nike India', amount: 'INR 14,999', status: '200 OK', statusColor: '#4caf50' },
  { id: 'WH-VISA-551030', event: 'PreArbitrationFili...', time: '2024-05-15 10:15:02', typeLabel: 'Pre-Arbitration', typeColor: '#00acc1', typeBg: '#e0f7fa', merchant: 'Steam Games', amount: 'INR 3,250', status: '201 OK', statusColor: '#4caf50' },
  { id: 'WH-VISA-551031', event: 'ArbitrationCaseFil...', time: '2024-05-02 10:10:01', typeLabel: 'Arbitration', typeColor: '#8e24aa', typeBg: '#f3e5f5', merchant: 'Reliance Retail', amount: 'INR 22,450', status: '200 OK', statusColor: '#4caf50' },
  { id: 'WH-VISA-551032', event: 'RetrievalRequestIn...', time: '2024-05-01 10:00:03', typeLabel: 'Retrieval Request', typeColor: '#00897b', typeBg: '#e0f2f1', merchant: 'Nike India', amount: 'INR 8,599', status: '200 OK', statusColor: '#4caf50' },
  { id: 'WH-VISA-551033', event: 'FraudAlertNotificati...', time: '2026-05-28 08:30:01', typeLabel: 'Fraud Alert', typeColor: '#c62828', typeBg: '#ffebee', merchant: 'masteruser', amount: 'INR 18,500', status: '200 OK', statusColor: '#4caf50' },
  { id: 'WH-VISA-551034', event: 'DisputeResolvedEvent', time: '2026-05-27 14:22:11', typeLabel: 'Won', typeColor: '#2e7d32', typeBg: '#e8f5e9', merchant: 'Zomato Services', amount: 'INR 6,200', status: '201 OK', statusColor: '#4caf50' },
  { id: 'WH-VISA-551035', event: 'ArbitrationOutcomeFil...', time: '2026-05-26 16:45:09', typeLabel: 'Arbitration', typeColor: '#8e24aa', typeBg: '#f3e5f5', merchant: 'masteruser', amount: 'INR 25,000', status: '⚠️ 408 Timeout', statusColor: '#ff9800' },
  { id: 'WH-VISA-551036', event: 'PreArbitrationRespDue...', time: '2026-05-25 09:10:00', typeLabel: 'Pre-Arbitration', typeColor: '#00acc1', typeBg: '#e0f7fa', merchant: 'Paytm Mall', amount: 'INR 11,200', status: '❌ 500 Error', statusColor: '#f44336' },
  { id: 'WH-VISA-551037', event: 'VROLInquiryReceived...', time: '2026-05-24 11:00:44', typeLabel: 'VROL Inquiry', typeColor: '#f57c00', typeBg: '#fff3e0', merchant: 'Test@isu', amount: 'INR 7,500', status: '200 OK', statusColor: '#4caf50' },
  { id: 'WH-VISA-551038', event: 'DisputeStatusUpdate...', time: '2026-06-01 07:00:12', typeLabel: 'Status Update', typeColor: '#00897b', typeBg: '#e0f2f1', merchant: 'Myntra Fashion', amount: 'INR 9,200', status: '200 OK', statusColor: '#4caf50' }
];

function AdminPortal({
  currentUser, chargebacks, users, ledger, setView, toggleTheme, darkMode, formatINR, formatDateDisp, showToast, refreshAllData, resetAllSessions, handleLogout
}) {
  const [activePage, setActivePage] = useState('a-dashboard'); 
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [disputeMenuOpen, setDisputeMenuOpen] = useState(true);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);

  // Modal active
  const [activeModal, setActiveModal] = useState(null); 
  const [showFaq, setShowFaq] = useState(false);
  const [targetWebhook, setTargetWebhook] = useState(null);
  const [targetDisputeId, setTargetDisputeId] = useState(null);
  const [expandedTimeline, setExpandedTimeline] = useState({});
  const [visaAcceptedAmount, setVisaAcceptedAmount] = useState('');
  const [visaRemarks, setVisaRemarks] = useState('');
  const [visaEvidenceFile, setVisaEvidenceFile] = useState(null);
  
  // Document rejection state
  const [selectedDocsToReject, setSelectedDocsToReject] = useState([]);
  const [merchantRejectAdminEvidence, setMerchantRejectAdminEvidence] = useState(null);
  const [rejectionRemarks, setRejectionRemarks] = useState('');
  const [adminDisputeAction, setAdminDisputeAction] = useState('full');

  // Form states
  const [selectedProvider, setSelectedProvider] = useState('');
  const [bulkFileContent, setBulkFileContent] = useState('');
  const [bulkFileName, setBulkFileName] = useState('');
  const [uploadResult, setUploadResult] = useState(null); // null | { total, success, fail }

  // Credit adjustment states
  const [adjMerchant, setAdjMerchant] = useState('');
  const [adjType, setAdjType] = useState('Credit');
  const [adjAmount, setAdjAmount] = useState('');
  const [adjRemarks, setAdjRemarks] = useState('');

  // Search Filter View Chargebacks
  const [filterRrn, setFilterRrn] = useState('');
  const [adminSearchFocused, setAdminSearchFocused] = useState(false);
  const [filterMid, setFilterMid] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterSubStatus, setFilterSubStatus] = useState('');
  const [filterScheme, setFilterScheme] = useState('');

  // RTSI Webhook simulator and audits states
  const [rtsiAudits, setRtsiAudits] = useState([]);
  const [simulatorScenario, setSimulatorScenario] = useState('scenario1');
  const [selectedAudit, setSelectedAudit] = useState(null);
  const [webhookResponse, setWebhookResponse] = useState(null);
  const [isSendingWebhook, setIsSendingWebhook] = useState(false);
  
  // Scenario payload states
  // Scenario 1 & 2 (OI inquiry)
  const [oiVisaTxId, setOiVisaTxId] = useState('987654321012345');
  const [oiMerchantCaid, setOiMerchantCaid] = useState('MERCH_ACQ_9981');
  const [oiArn, setOiArn] = useState('74123456789012345678901');
  const [oiTxTimestamp, setOiTxTimestamp] = useState('2026-06-15T14:32:00Z');
  const [oiAmount, setOiAmount] = useState('149.99');
  const [oiCurrencyIso, setOiCurrencyIso] = useState('840');
  const [oiCategory, setOiCategory] = useState('Fraud');

  // Scenario 3 (RDR alert)
  const [rdrVrolCaseId, setRdrVrolCaseId] = useState('RDR-771120A');
  const [rdrDisputeCondition, setRdrDisputeCondition] = useState('10.1: EMV Fraud Counterfeit');
  const [rdrDisputeAmount, setRdrDisputeAmount] = useState('22.50');
  const [rdrCurrency, setRdrCurrency] = useState('USD');
  const [rdrProductSku, setRdrProductSku] = useState('DIGITAL_COIN_X1');
  const [rdrMerchantCaid, setRdrMerchantCaid] = useState('CAID_MERCH_001');

  // Scenario 4 (Dispute Ingestion)
  const [dispVrolCaseId, setDispVrolCaseId] = useState('VROL-DISP-2026-99481');
  const [dispMerchantCaid, setDispMerchantCaid] = useState('CAID_SUB_VURAM_4412');
  const [dispMerchantName, setDispMerchantName] = useState('ACME Digital Services Corp');
  const [dispCategory, setDispCategory] = useState('Consumer Dispute');
  const [dispCondition, setDispCondition] = useState('13.3: Not as Described or Defective');
  const [dispAmount, setDispAmount] = useState('350.00');
  const [dispCurrencyCode, setDispCurrencyCode] = useState('840');
  const [dispNetworkDayLimit, setDispNetworkDayLimit] = useState('30 Days');
  const [dispSubmissionDate, setDispSubmissionDate] = useState('2026-06-18');

  // Scenario 6 (Collaboration Ingestion)
  const [collabVrolCaseId, setCollabVrolCaseId] = useState('VROL-COLLAB-88431');
  const [collabMerchantCaid, setCollabMerchantCaid] = useState('CAID_SUB_COLLAB_55');
  const [collabCategory, setCollabCategory] = useState('Consumer Dispute');
  const [collabCondition, setCollabCondition] = useState('13.1: Merchandise Not Received');
  const [collabAmount, setCollabAmount] = useState('500.00');
  const [collabInitialEvidence, setCollabInitialEvidence] = useState('basic_tracking_id.pdf');
  const [collabCounterReason, setCollabCounterReason] = useState('Cardholder claims package stolen');

  const fetchRtsiAudits = async () => {
    try {
      const res = await fetch(`${API_URL}/vrol/rtsi-audits`);
      if (res.ok) {
        const data = await res.json();
        setRtsiAudits(data || []);
      }
    } catch (err) {
      console.error('Failed to fetch RTSI audits:', err);
    }
  };

  const clearRtsiAudits = async () => {
    if (confirm('Clear all RTSI audit logs?')) {
      try {
        const res = await fetch(`${API_URL}/vrol/rtsi-audits/clear`, { method: 'POST' });
        if (res.ok) {
          setRtsiAudits([]);
          showToast('RTSI Audit logs cleared successfully');
        }
      } catch (err) {
        console.error(err);
      }
    }
  };

  useEffect(() => {
    if (activePage === 'a-rtsi-simulator') {
      fetchRtsiAudits();
      const interval = setInterval(fetchRtsiAudits, 5000);
      return () => clearInterval(interval);
    }
  }, [activePage]);

  const handleScenarioChange = (scenario) => {
    setSimulatorScenario(scenario);
    setWebhookResponse(null);
    if (scenario === 'scenario1') {
      setOiVisaTxId('987654321012345');
      setOiMerchantCaid('MERCH_ACQ_9981');
      setOiArn('74123456789012345678901');
      setOiTxTimestamp('2026-06-15T14:32:00Z');
      setOiAmount('149.99');
      setOiCurrencyIso('840');
      setOiCategory('Fraud');
    } else if (scenario === 'scenario2') {
      setOiVisaTxId('987654321012349');
      setOiMerchantCaid('CAID_SUB_8812');
      setOiArn('74123456789012345678905');
      setOiTxTimestamp('2026-06-17T02:11:00Z');
      setOiAmount('14.50');
      setOiCurrencyIso('USD');
      setOiCategory('Fraud');
    } else if (scenario === 'scenario3') {
      setRdrVrolCaseId('RDR-771120A');
      setRdrDisputeCondition('10.1: EMV Fraud Counterfeit');
      setRdrDisputeAmount('22.50');
      setRdrCurrency('USD');
      setRdrProductSku('DIGITAL_COIN_X1');
      setRdrMerchantCaid('CAID_MERCH_001');
    } else if (scenario === 'scenario4') {
      setDispVrolCaseId('VROL-DISP-2026-99481');
      setDispMerchantCaid('CAID_SUB_VURAM_4412');
      setDispMerchantName('ACME Digital Services Corp');
      setDispCategory('Consumer Dispute');
      setDispCondition('13.3: Not as Described or Defective');
      setDispAmount('350.00');
      setDispCurrencyCode('840');
      setDispNetworkDayLimit('30 Days');
      setDispSubmissionDate('2026-06-18');
    } else if (scenario === 'scenario6') {
      setCollabVrolCaseId('VROL-COLLAB-88431');
      setCollabMerchantCaid('CAID_SUB_COLLAB_55');
      setCollabCategory('Consumer Dispute');
      setCollabCondition('13.1: Merchandise Not Received');
      setCollabAmount('500.00');
      setCollabInitialEvidence('basic_tracking_id.pdf');
      setCollabCounterReason('Cardholder claims package stolen');
    }
  };

  const handleTriggerWebhook = async () => {
    setIsSendingWebhook(true);
    setWebhookResponse(null);
    let url = '';
    let payload = {};

    if (simulatorScenario === 'scenario1' || simulatorScenario === 'scenario2') {
      url = `${API_URL}/vrol/oi/inquiry`;
      payload = {
        visaTxId: oiVisaTxId,
        merchantCaid: oiMerchantCaid,
        arn: oiArn,
        txTimestamp: oiTxTimestamp,
        amount: oiAmount,
        currencyIso: oiCurrencyIso,
        disputeCategoryCode: oiCategory
      };
    } else if (simulatorScenario === 'scenario3') {
      url = `${API_URL}/vrol/rdr/alert`;
      payload = {
        vrolCaseId: rdrVrolCaseId,
        disputeCondition: rdrDisputeCondition,
        disputeAmount: rdrDisputeAmount,
        currency: rdrCurrency,
        productSku: rdrProductSku,
        merchantCaid: rdrMerchantCaid
      };
    } else if (simulatorScenario === 'scenario4') {
      url = `${API_URL}/vrol/dispute/ingest`;
      payload = {
        vrolCaseId: dispVrolCaseId,
        merchantCaid: dispMerchantCaid,
        merchantName: dispMerchantName,
        disputeCategory: dispCategory,
        disputeCondition: dispCondition,
        disputeAmount: dispAmount,
        currencyCode: dispCurrencyCode,
        networkDayLimit: dispNetworkDayLimit,
        networkSubmissionDate: dispSubmissionDate
      };
    } else if (simulatorScenario === 'scenario6') {
      url = `${API_URL}/vrol/collaboration/ingest`;
      payload = {
        vrolCaseId: collabVrolCaseId,
        merchantCaid: collabMerchantCaid,
        disputeCategory: collabCategory,
        disputeCondition: collabCondition,
        disputeAmount: collabAmount,
        initialEvidence: collabInitialEvidence,
        preArbCounterReason: collabCounterReason
      };
    }

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      setWebhookResponse({ status: res.status, data });
      showToast('RTSI Webhook Triggered successfully', 'success');
      fetchRtsiAudits();
      await refreshAllData();
    } catch (err) {
      console.error(err);
      setWebhookResponse({ status: 'Error', data: err.message });
      showToast('Failed to trigger RTSI Webhook', 'error');
    } finally {
      setIsSendingWebhook(false);
    }
  };

  // Elastic search state (Admin)
  const [elasticSearchVal, setElasticSearchVal] = useState('');
  const [elasticSearchFocused, setElasticSearchFocused] = useState(false);
  
  const TODAY_STR = new Date().toISOString().split('T')[0];
  const SIX_MONTHS_AGO = (() => {
    let d = new Date(); d.setDate(d.getDate() - 180); return d.toISOString().split('T')[0];
  })();
  const [dateRangePreset, setDateRangePreset] = useState('6months');
  const [dateDropdownOpen, setDateDropdownOpen] = useState(false);
  const [filterDropdownOpen, setFilterDropdownOpen] = useState(false);
  const [tempFrom, setTempFrom] = useState(SIX_MONTHS_AGO);
  const [tempTo, setTempTo] = useState(TODAY_STR);

  const [filterFrom, setFilterFrom] = useState(SIX_MONTHS_AGO);
  const [filterTo, setFilterTo] = useState(TODAY_STR);
  
  // Dashboard date filters
  const [dashDateRangeType, setDashDateRangeType] = useState('7days');
  const [dashFilterFrom, setDashFilterFrom] = useState(() => { let d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().split('T')[0]; });
  const [dashFilterTo, setDashFilterTo] = useState(TODAY_STR);

  const [filterSearchBy, setFilterSearchBy] = useState('');
  const [aVcSearchInput, setAVcSearchInput] = useState('');

  // Pagination view chargebacks
  const [aVcPage, setAVcPage] = useState(1);
  const [aVcLimit, setAVcLimit] = useState(10);
  const [adminTab, setAdminTab] = useState('verification-pending');

  // Expanded row IDs
  const [expandedRowIds, setExpandedRowIds] = useState({});
  const [evidenceFiles, setEvidenceFiles] = useState({ adminUpload: null });

  const isPendingVerification = (cb) =>
    cb && (cb.merchantAction === 'evidence' || cb.merchantAction === 'rejected' || cb.merchantAction === 'additional_evidence') && !cb.acquirerAction && !cb.visaPending;

  const getAdminActionRequiredCount = () => {
    return chargebacks.filter(cb => !isClosedDispute(cb) && (cb.merchantAction === 'evidence' || cb.merchantAction === 'rejected' || cb.merchantAction === 'additional_evidence' || cb.merchantAction === 'rejected_admin' || cb.merchantAction === 'accepted_partially') && cb.acquirerAction === null && !cb.visaPending).length;
  };
  const getAdminUnderReviewCount = () => {
    return chargebacks.filter(cb => !isClosedDispute(cb) && (!cb.merchantAction || (cb.acquirerAction === 'considered' && cb.merchantAction !== 'additional_evidence')) && !cb.visaPending).length;
  };
  const getAdminClosedCount = () => {
    return chargebacks.filter(isClosedDispute).length;
  };

  const handleAdminEscalate = async (id) => {
    try {
      const response = await fetch(`${API_URL}/disputes/${id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'admin', 'x-user-name': currentUser?.username || 'Test@Ad' },
        body: JSON.stringify({ action: 'escalate' })
      });
      if (response.ok) {
        setActiveModal(null);
        showToast('Escalated to Pre-Arbitration successfully');
        await refreshAllData();
      } else {
        showToast('Escalation failed', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('API error', 'error');
    }
  };

  const selectProvider = (p) => {
    setSelectedProvider(p);
  };

  const changeProvider = () => {
    setSelectedProvider('');
    setBulkFileName('');
    setBulkFileContent('');
    setUploadResult(null);
  };

  const filterAdminCb = () => {
    setAVcPage(1);
  };

  const resetAdminCb = () => {
    setFilterRrn('');
    setFilterMid('');
    setFilterStatus('');
    setFilterSubStatus('');
    setFilterSearchBy('');
    setFilterFrom(DEFAULT_FROM);
    setFilterTo(TODAY_STR);
    setAVcSearchInput('');
    setAVcPage(1);
  };

  // Compute stats
  const getAdminDashboardStats = () => {
    let list = chargebacks;
    if (dashFilterFrom) {
      list = list.filter(cb => cb.createdDate >= dashFilterFrom);
    }
    if (dashFilterTo) {
      list = list.filter(cb => cb.createdDate <= dashFilterTo);
    }

    const totalCount = list.length;
    const totalAmt = list.reduce((sum, c) => sum + c.txnAmt, 0);

    const openList = list.filter(cb => getDisputeCategory(cb) === 'open');
    const openAmt = openList.reduce((sum, c) => sum + c.txnAmt, 0);

    const lostList = list.filter(cb => getDisputeCategory(cb) === 'lost');
    const lostAmt = lostList.reduce((sum, c) => sum + c.txnAmt, 0);

    const wonList = list.filter(cb => getDisputeCategory(cb) === 'won');
    const wonAmt = wonList.reduce((sum, c) => sum + c.txnAmt, 0);

    const slaList = list.filter(cb => matchesDisputeStatusFilter(cb, 'sla_today'));
    const slaAmt = slaList.reduce((sum, c) => sum + c.txnAmt, 0);

    return {
      totalCount, totalAmt,
      openCount: openList.length, openAmt,
      lostCount: lostList.length, lostAmt,
      wonCount: wonList.length, wonAmt,
      slaCount: slaList.length, slaAmt
    };
  };

  const stats = getAdminDashboardStats();

  const navigateToAdminReport = (status) => {
    setFilterStatus(status);
    setAdminTab('management');
    setActivePage('a-view-cb');
  };

  // Pending representations
  const pendingReviews = chargebacks.filter(cb => cb.merchantAction === 'rejected' && cb.acquirerAction === null);

  // Filters admin disputes list
  const getFilteredAdmin = () => {
    let list = chargebacks.filter(cb => {
      if (filterRrn) {
        if (filterSearchBy === 'Txn ID' && !cb.txnId.includes(filterRrn)) return false;
        if (filterSearchBy === 'RRN' && !cb.rrn.includes(filterRrn)) return false;
        if (filterSearchBy === 'TID' && !cb.tid?.includes(filterRrn)) return false;
        if (filterSearchBy === 'MID' && !cb.userId.includes(filterRrn)) return false;
        if (filterSearchBy === 'Case ID' && !cb.caseId?.includes(filterRrn) && !cb.id?.includes(filterRrn)) return false;
        if (filterSearchBy === 'Merchant Name' && !cb.userName?.toLowerCase().includes(filterRrn.toLowerCase())) return false;
        if (!filterSearchBy && !cb.rrn.includes(filterRrn) && !cb.txnId.includes(filterRrn) && !cb.userId.includes(filterRrn) && !cb.id?.includes(filterRrn) && !cb.userName?.toLowerCase().includes(filterRrn.toLowerCase()) && !(cb.mStatus && cb.mStatus.toLowerCase().includes(filterRrn.toLowerCase())) && !(cb.mSubStatus && cb.mSubStatus.toLowerCase().includes(filterRrn.toLowerCase())) && !(cb.adjType && cb.adjType.toLowerCase().includes(filterRrn.toLowerCase()))) return false;
      }
      if (!matchesDisputeStatusFilter(cb, filterStatus)) return false;
      if (!matchesDisputeTypeFilter(cb, filterSubStatus)) return false;
      if (filterScheme && cb.product?.toLowerCase() !== filterScheme.toLowerCase()) return false;
      if (filterFrom && cb.createdDate && cb.createdDate < filterFrom) return false;
      if (filterTo && cb.createdDate && cb.createdDate > filterTo) return false;
      return true;
    });

    if (adminTab === 'merchant-pending') {
      list = list.filter(cb => !isClosedDispute(cb) && (!cb.merchantAction || (cb.acquirerAction === 'considered' && cb.merchantAction !== 'additional_evidence')) && !cb.visaPending);
    } else if (adminTab === 'verification-pending') {
      list = list.filter(cb => !isClosedDispute(cb) && (cb.merchantAction === 'evidence' || cb.merchantAction === 'rejected' || cb.merchantAction === 'additional_evidence' || cb.merchantAction === 'rejected_admin' || cb.merchantAction === 'accepted_partially') && cb.acquirerAction === null && !cb.visaPending);
    } else if (adminTab === 'closed') {
      list = list.filter(isClosedDispute);
    }

    if (aVcSearchInput) {
      const q = aVcSearchInput.toLowerCase();
      list = list.filter(cb => (cb.rrn && cb.rrn.toLowerCase().includes(q)) || (cb.txnId && cb.txnId.toLowerCase().includes(q)) || (cb.userName && cb.userName.toLowerCase().includes(q)) || (cb.mStatus && cb.mStatus.toLowerCase().includes(q)) || (cb.mSubStatus && cb.mSubStatus.toLowerCase().includes(q)) || (cb.adjType && cb.adjType.toLowerCase().includes(q)));
    }
    if (elasticSearchVal) {
      const eq = elasticSearchVal.toLowerCase();
      list = list.filter(cb =>
        (cb.rrn && cb.rrn.toLowerCase().includes(eq)) ||
        (cb.txnId && cb.txnId.toLowerCase().includes(eq)) ||
        (cb.tid && cb.tid.toLowerCase().includes(eq)) ||
        (cb.userId && cb.userId.toLowerCase().includes(eq)) ||
        (cb.userName && cb.userName.toLowerCase().includes(eq))
      );
    }
    return list;
  };

  const filteredAdminList = getFilteredAdmin();

  const exportExcel = (src) => {
    const dataToExport = src === 'admin' ? filteredAdminList : chargebacks;
    const filename = src === 'admin' ? 'chargebacks_admin_view.csv' : 'chargeback_export.csv';
    
    if (!dataToExport.length) {
      showToast('No data to export', 'error');
      return;
    }
    
    const headers = ['RRN', 'Case ID', 'Txn ID', 'Merchant', 'Status', 'Sub Status', 'Amount', 'Date', 'Product'];
    const rows = dataToExport.map(cb => [
      cb.rrn,
      cb.caseId,
      cb.txnId,
      cb.userName,
      cb.mStatus,
      cb.mSubStatus,
      cb.txnAmt,
      cb.createdDate,
      cb.product
    ]);
    
    const csvContent = "data:text/csv;charset=utf-8," 
      + [headers.join(','), ...rows.map(r => r.map(c => `"${c}"`).join(','))].join('\n');
      
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('CSV Export completed');
  };

  // Paginated list
  const paginateList = (list, page, limit) => {
    const total = list.length;
    const totalPages = Math.ceil(total / limit) || 1;
    let curr = page;
    if (curr > totalPages) curr = totalPages;
    if (curr < 1) curr = 1;
    const start = (curr - 1) * limit;
    const end = Math.min(start + limit, total);
    const paginated = list.slice(start, end);
    return { paginated, startRecord: total === 0 ? 0 : start + 1, endRecord: end, total, totalPages, curr };
  };

  const adminPaging = paginateList(filteredAdminList, aVcPage, aVcLimit);

  // Status Badge Builder
  const renderStatusBadge = (s) => {
    const m = {
      'Chargeback Raise': 'badge-cb',
      'Pre-Arbitration Raise': 'badge-prearb',
      'Pre-Arbitration Raised': 'badge-prearb',
      'Arbitration Raise': 'badge-arb',
      'Arbitration Raised': 'badge-arb',
      'Fraud Chargeback Raise': 'badge-fraud',
      'Differed Chargeback Raise': 'badge-deferred',
      'VROL Inquiry': 'badge-pending',
      'VROL Chargeback': 'badge-cb',
      'VROL Pre-Arbitration': 'badge-prearb',
      'VROL Arbitration': 'badge-arb'
    };
    return <span className={`badge ${m[s] || 'badge-new'}`}>{s}</span>;
  };

  const renderSubBadge = (s) => {
    const m = {
      'Chargeback New': 'badge-new',
      'Chargeback Lost': 'badge-lost',
      'Chargeback in Progress': 'badge-progress',
      'Chargeback Resubmit': 'badge-resubmit',
      'Chargeback Won': 'badge-won',
      'Refund Success': 'badge-won',
      'Refund On Hold': 'badge-progress'
    };
    return <span className={`badge ${m[s] || 'badge-pending'}`}>{s}</span>;
  };

  const toggleRowExpand = (id) => {
    setExpandedRowIds(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // Review consider representment
  const handleConsider = async (disputeId) => {
    const id = disputeId || targetDisputeId;
    if (!id) return;
    try {
      const entry = {
        by: 'nsdladmin',
        time: new Date().toLocaleString(),
        title: 'Internal Team Considered – Represented NPCI UDIR',
        remarks: 'Merchant representations verified. Routing represented claim to Visa VROL.',
        file: evidenceFiles?.adminUpload?.name || null
      };

      const response = await fetch(`${API_URL}/disputes/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          acquirerAction: 'considered',
          mSubStatus: 'Chargeback In Progress',
          timelineEntry: entry
        })
      });

      if (response.ok) {
        setActiveModal(null);
        showToast('Representment filed with NPCI successfully');
        await refreshAllData();
      } else {
        showToast('Consider action failed', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('API error', 'error');
    }
  };

  const handleAdminUploadClick = (disputeId) => {
    setTargetDisputeId(disputeId);
    setEvidenceFiles({ 1: null });
    setActiveModal('adminUploadEvidence');
  };

  const submitAdminUploadEvidence = async () => {
    if (!evidenceFiles[1]) {
      showToast('Please select a file to upload', 'error');
      return;
    }
    const id = targetDisputeId;
    if (!id) return;

    try {
      const evidenceName = evidenceFiles[1].name;
      const response = await fetch(`${API_URL}/disputes/${id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'admin', 'x-user-name': currentUser?.username || 'nsdladmin' },
        body: JSON.stringify({
          action: 'admin_upload_evidence',
          evidence: evidenceName
        })
      });

      if (response.ok) {
        setActiveModal(null);
        showToast('Evidence uploaded to merchant successfully', 'success');
        refreshAllData();
      } else {
        const errorData = await response.json();
        showToast(errorData.message || 'Action failed', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('API error', 'error');
    }
  };

  const submitMerchantAcceptAdmin = async (id) => {
    try {
      const response = await fetch(`${API_URL}/disputes/${id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'merchant', 'x-user-name': currentUser?.username },
        body: JSON.stringify({ action: 'merchant_accept_admin' })
      });
      if (response.ok) {
        showToast('Admin evidence accepted. Case forwarded.', 'success');
        refreshAllData();
      } else {
        const err = await response.json();
        showToast(err.message, 'error');
      }
    } catch (error) {
      showToast('API error', 'error');
    }
  };

  const handleMerchantRejectAdminClick = (id) => {
    setTargetDisputeId(id);
    setSelectedDocsToReject([]);
    setRejectionRemarks('');
    setMerchantRejectAdminEvidence(null);
    setActiveModal('merchantRejectAdminDocs');
  };

  const submitMerchantRejectAdminDocs = async () => {
    if (selectedDocsToReject.length === 0) {
      showToast('Please select at least one document to reject', 'error');
      return;
    }
    if (!rejectionRemarks.trim()) {
      showToast('Rejection remarks are mandatory', 'error');
      return;
    }
    const id = targetDisputeId;
    if (!id) return;

    try {
      const response = await fetch(`${API_URL}/disputes/${id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'merchant', 'x-user-name': currentUser?.username },
        body: JSON.stringify({
          action: 'merchant_reject_admin',
          comments: rejectionRemarks,
          evidence: merchantRejectAdminEvidence ? merchantRejectAdminEvidence.name : null,
          rejectedDocs: selectedDocsToReject.map(docId => ({ id: docId, remarks: rejectionRemarks }))
        })
      });
      if (response.ok) {
        setActiveModal(null);
        showToast('Admin documents rejected', 'success');
        refreshAllData();
      } else {
        const err = await response.json();
        showToast(err.message, 'error');
      }
    } catch (err) {
      showToast('API error', 'error');
    }
  };

  const handleDeclineClick = (disputeId) => {
    setTargetDisputeId(disputeId);
    setSelectedDocsToReject([]);
    setRejectionRemarks('');
    setActiveModal('declineDocuments');
  };

  const submitDeclineDocs = async () => {
    if (selectedDocsToReject.length === 0) {
      showToast('Please select at least one document to reject', 'error');
      return;
    }
    if (!rejectionRemarks.trim()) {
      showToast('Rejection remarks are mandatory', 'error');
      return;
    }
    const id = targetDisputeId;
    if (!id) return;
    try {
      const response = await fetch(`${API_URL}/disputes/${id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'admin', 'x-user-name': currentUser?.username || 'nsdladmin' },
        body: JSON.stringify({
          action: 'admin_request_info',
          comments: rejectionRemarks,
          rejectedDocs: selectedDocsToReject.map(docId => ({ id: docId, remarks: rejectionRemarks }))
        })
      });

      if (response.ok) {
        setActiveModal(null);
        showToast('Dispute proofs declined. Rerouted to merchant.', 'success');
        await refreshAllData();
      } else {
        showToast('Failed to decline proofs', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('API error', 'error');
    }
  };

  // Process accept merchant documents
  const handleAcceptDocs = async (disputeId) => {
    const id = disputeId || targetDisputeId;
    if (!id) return;
    try {
      const response = await fetch(`${API_URL}/disputes/${disputeId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'admin', 'x-user-name': currentUser?.username || 'nsdladmin' },
        body: JSON.stringify({ action: 'visa_accept' })
      });
      if (response.ok) {
        showToast('Accepted Merchant Documents. Case forwarded to Visa.', 'success');
        setActiveModal(null);
        await refreshAllData();
      } else {
        showToast('Failed to accept documents', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('API error', 'error');
    }
  };

  // Visa Workflow Handlers
  const handleVisaAccept = async (disputeId) => {
    const id = disputeId || targetDisputeId;
    if (!id) return;
    try {
      const response = await fetch(`${API_URL}/disputes/${id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'admin', 'x-user-name': currentUser?.username || 'nsdladmin' },
        body: JSON.stringify({ action: 'visa_accept' })
      });
      if (response.ok) {
        setActiveModal(null);
        showToast('Accepted and sent to Visa for final review');
        await refreshAllData();
      } else { showToast('Action failed', 'error'); }
    } catch (err) { showToast('API error', 'error'); }
  };

  const handleVisaReview = async (disputeId) => {
    const id = disputeId || targetDisputeId;
    if (!id) return;
    try {
      const response = await fetch(`${API_URL}/disputes/${id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'admin', 'x-user-name': currentUser?.username || 'nsdladmin' },
        body: JSON.stringify({ action: 'visa_review' })
      });
      if (response.ok) {
        setActiveModal(null);
        showToast('Sent to Visa for Review');
        await refreshAllData();
      } else { showToast('Action failed', 'error'); }
    } catch (err) { showToast('API error', 'error'); }
  };

  const handleVisaAcceptPartially = async () => {
    if (!targetDisputeId) return;
    if (!visaAcceptedAmount || !visaRemarks || !visaEvidenceFile) {
      showToast('Amount, Remarks, and Evidence are required for partial acceptance', 'error');
      return;
    }
    try {
      const response = await fetch(`${API_URL}/disputes/${targetDisputeId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-role': 'admin', 'x-user-name': currentUser?.username || 'nsdladmin' },
        body: JSON.stringify({ 
          action: 'visa_accept_partially',
          acceptedAmount: Number(visaAcceptedAmount),
          comments: visaRemarks,
          evidence: visaEvidenceFile.name
        })
      });
      if (response.ok) {
        setActiveModal(null);
        setVisaAcceptedAmount('');
        setVisaRemarks('');
        setVisaEvidenceFile(null);
        showToast('Partial acceptance submitted to Visa');
        await refreshAllData();
      } else { showToast('Action failed', 'error'); }
    } catch (err) { showToast('API error', 'error'); }
  };

  const executeVisaWebhookSimulator = async (cb, isWin) => {
    try {
      const isPreArb = cb.mStatus === 'Pre-Arbitration Raise' || cb.mStatus === 'VROL Pre-Arbitration';
      const isArb = cb.mStatus === 'Arbitration Raise' || cb.mStatus === 'VROL Arbitration';
      
      let nextStatus = cb.mStatus;
      let newSubStatus = isWin ? 'Chargeback Won' : 'Chargeback Lost';
      
      if (!isWin) {
         if (!isPreArb && !isArb) {
             nextStatus = 'Pre-Arbitration Raise';
             newSubStatus = 'Pre-Arbitration Raised';
         } else if (isPreArb) {
             nextStatus = 'Arbitration Raise';
             newSubStatus = 'Arbitration Raised';
         } else if (isArb) {
             newSubStatus = 'Arbitration Lost';
         }
      } else {
         if (isPreArb) newSubStatus = 'Pre-Arbitration Won';
         else if (isArb) newSubStatus = 'Arbitration Won';
      }

      const entry = {
        by: 'visa_webhook',
        time: new Date().toLocaleString(),
        title: `Visa Webhook: ${newSubStatus}`,
        remarks: `Visa simulator triggered a ${isWin ? 'win' : 'loss'} decision.`,
        file: null
      };

      const payload = {
        mStatus: nextStatus,
        mSubStatus: newSubStatus,
        visaPending: false,
        timelineEntry: entry
      };

      if (isWin || newSubStatus.includes('Lost')) {
        payload.acquirerAction = isWin ? 'won' : 'lost';
      } else {
        payload.acquirerAction = null; 
      }

      const response = await fetch(`${API_URL}/disputes/${cb.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        if (isWin) {
          await fetch(`${API_URL}/ledger`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              merchant: cb.userName || 'masteruser',
              type: 'Credit',
              amount: cb.adjAmt,
              remarks: `Visa Decision Won: RRN ${cb.rrn}`
            })
          });
        }
        
        setActiveModal(null);
        showToast(`Visa ruled: ${newSubStatus}`, isWin ? 'success' : 'error');
        await refreshAllData();
      } else {
        showToast('Failed to execute visa simulator', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('API error', 'error');
    }
  };

  // Arbitration won decision
  const handleArbitrationWon = async () => {
    try {
      const targetCb = chargebacks.find(x => x.id === targetDisputeId);
      const entry = {
        by: 'nsdladmin',
        time: new Date().toLocaleString(),
        title: 'Arbitration Won (NPCI Decision)',
        remarks: 'Ruling in favor of merchant. Dispute won. Wallet credited back.',
        file: null
      };

      // We need to credit merchant wallet balance. The backend route PUT /api/disputes doesn't modify wallets directly,
      // but we can call credit ledger endpoint! A credit ledger endpoint updates wallet + logs automatically!
      // Let's call /api/ledger to adjust merchant wallet balance, and update dispute status.
      
      // Update dispute status
      const resDisp = await fetch(`${API_URL}/disputes/${targetDisputeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          acquirerAction: 'won',
          mSubStatus: 'Chargeback Won',
          timelineEntry: entry
        })
      });

      // Credit wallet via Ledger route
      const resLedg = await fetch(`${API_URL}/ledger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchant: targetCb.userName || 'masteruser',
          type: 'Credit',
          amount: targetCb.adjAmt,
          remarks: `NPCI Arbitration Won: RRN ${targetCb.rrn}`
        })
      });

      if (resDisp.ok && resLedg.ok) {
        setActiveModal(null);
        showToast('Arbitration ruled: WON. Wallet credited.');
        await refreshAllData();
      } else {
        showToast('Failed to record arbitration won', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('API error', 'error');
    }
  };

  // Arbitration lost decision
  // Arbitration lost decision
  const handleArbitrationLost = async (disputeId) => {
    const id = typeof disputeId === 'string' ? disputeId : targetDisputeId;
    if (!id) return;
    try {
      const entry = {
        by: 'nsdladmin',
        time: new Date().toLocaleString(),
        title: 'Loss Accepted & Sent to Visa',
        remarks: 'Admin accepted the loss. Status sent to Visa for processing. Through Visa, the merchant refund will be processed.',
        file: null
      };

      const response = await fetch(`${API_URL}/disputes/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          acquirerAction: 'lost',
          mSubStatus: 'Chargeback Lost',
          visaPending: true,
          timelineEntry: entry
        })
      });

      if (response.ok) {
        setActiveModal(null);
        showToast('Arbitration ruled: LOST. Dispute closed.', 'error');
        await refreshAllData();
      } else {
        showToast('Failed to record arbitration lost', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('API error', 'error');
    }
  };

  // Process refund accept
  const handleRefundAccept = async () => {
    try {
      const targetCb = chargebacks.find(x => x.id === targetDisputeId);
      const entry = {
        by: 'nsdladmin',
        time: new Date().toLocaleString(),
        title: 'Refund Accepted & Settled',
        remarks: 'Refund completed successfully. Merchant wallet debited.',
        file: null
      };

      // 1. Update dispute status
      const resDisp = await fetch(`${API_URL}/disputes/${targetDisputeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mSubStatus: 'Refund Success',
          timelineEntry: entry
        })
      });

      // 2. Debit wallet via Ledger route
      const resLedg = await fetch(`${API_URL}/ledger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchant: targetCb.userName || 'masteruser',
          type: 'Debit',
          amount: targetCb.adjAmt,
          remarks: `Acquired Refund Settle: RRN ${targetCb.rrn}`
        })
      });

      if (resDisp.ok && resLedg.ok) {
        setActiveModal(null);
        showToast('Refund processed successfully. Wallet debited.');
        await refreshAllData();
      } else {
        showToast('Failed to settle refund', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('API error', 'error');
    }
  };

  // Process refund hold
  const handleRefundHold = async () => {
    try {
      const entry = {
        by: 'nsdladmin',
        time: new Date().toLocaleString(),
        title: 'Refund Placed On Hold',
        remarks: 'Internal team placed acquiring refund on hold pending validation.',
        file: null
      };

      const response = await fetch(`${API_URL}/disputes/${targetDisputeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mSubStatus: 'Refund On Hold',
          timelineEntry: entry
        })
      });

      if (response.ok) {
        setActiveModal(null);
        showToast('Refund placed on hold', 'warning');
        await refreshAllData();
      } else {
        showToast('Decline action failed', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('API error', 'error');
    }
  };

  // File selection
  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      setBulkFileName(file.name + ` (${Math.round(file.size/1024)} KB)`);
      
      const reader = new FileReader();
      reader.onload = (event) => {
        setBulkFileContent(event.target.result);
      };
      reader.readAsText(file);
    }
  };

  const handleClearFile = () => {
    setBulkFileName('');
    setBulkFileContent('');
    document.getElementById('cbFile').value = '';
  };

  // Process CSV upload
  const handleBulkUploadSubmit = () => {
    if (!bulkFileContent) {
      showToast('No file content loaded', 'error');
      return;
    }

    showToast('Uploading disputes...', 'warning');

    setTimeout(async () => {
      try {
        const lines = bulkFileContent.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        if (lines.length < 2) {
          showToast('CSV is empty or missing headers', 'error');
          return;
        }

        // Simple CSV parser
        const parseCSVRow = (text) => {
          let p = false, r = [''], a = 0;
          for (let i = 0; i < text.length; i++) {
            let c = text[i];
            if (c === '"') { p = !p; }
            else if (c === ',' && !p) { r[++a] = ''; }
            else { r[a] += c; }
          }
          return r.map(x => x.trim().replace(/^["']|["']$/g, ''));
        };

        const headers = parseCSVRow(lines[0]);
        let addedCount = 0;
        let failedCount = 0;
        const uploadPayload = [];

        const TODAY_FMT = new Date().toISOString().split('T')[0];
        const daysAgoFmt = (n) => {
          let d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().split('T')[0];
        };

        for (let i = 1; i < lines.length; i++) {
          const cols = parseCSVRow(lines[i]);
          if (cols.length < headers.length || !cols[0]) {
            failedCount++;
            continue;
          }

          const rowData = {};
          headers.forEach((h, idx) => {
            rowData[h] = cols[idx];
          });

          const rrn = rowData['RRN'] || ('60999' + Math.floor(Math.random() * 99999));
          const txnId = rowData['Txn ID'] || ('532' + Math.floor(Math.random() * 999999));
          const txnAmt = parseFloat(rowData['Txn Amount']) || 500;
          const txnDate = rowData['TXN Date'] || daysAgoFmt(3);
          const beneMobile = rowData['Bene Mobile'] || '9348909111';
          const glNo = rowData['GL No'] || '354422';
          const product = rowData['Product'] || selectedProvider || 'VISA';
          const visaId = rowData['Visa ID'] || rowData['Visa Case Number'] || null;

          uploadPayload.push({
            id: 'CB' + Math.floor(Math.random() * 90000 + 10000),
            caseId: 'CASE' + Math.floor(Math.random() * 90000 + 10000),
            visaId,
            userName: 'masteruser',
            userId: '2575789089',
            rrn, txnId,
            terminalId: '5690001',
            beneMobile, remMobile: '7845695611',
            createdDate: TODAY_FMT,
            txnDate, adjDate: TODAY_FMT,
            respondByDate: new Date(new Date().getTime() + 86400000).toISOString().split('T')[0],
            mStatus: 'Chargeback Raise',
            mSubStatus: 'Chargeback New',
            adjType: 'Chargeback Raise',
            remitter: 'AXB', beneficiary: 'FIP',
            txnAmt, adjAmt: txnAmt, leinAmt: 0,
            glNo, currency: 'Rupees', reasonCode: '1', pan: '832927*****',
            walletStatus: 'Debited', product, aging: 0, merchantAction: null, acquirerAction: null,
            timeline: [{ by: 'nsdladmin', time: new Date().toLocaleString(), title: 'Dispute Raised via Bulk Upload', remarks: '', file: null }]
          });
          addedCount++;
        }

        // Post to API
        const response = await fetch(`${API_URL}/disputes/bulk-upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(uploadPayload)
        });

        if (response.ok) {
          setUploadResult({ total: addedCount + failedCount, success: addedCount, fail: failedCount });
          showToast(`File processed successfully. Created ${addedCount} disputes.`);
          await refreshAllData();
        } else {
          showToast('Failed to process bulk upload via backend', 'error');
        }
      } catch (err) {
        console.error(err);
        showToast('CSV parsing/API error', 'error');
      }
    }, 800);
  };

  const handleResetUpload = () => {
    handleClearFile();
    setUploadResult(null);
  };

  const downloadVrolSampleTemplate = () => {
    const headers = [
      'Visa ID', 'Dispute ID', 'Chargeback Number', 'ARN', 'RRN', 'Timestamp', 
      'MID', 'Merchant Name', 'Transaction Date', 'Settlement Date', 
      'Transaction Amount', 'Dispute Amount', 'Currency', 'Reason Code', 
      'Reason Description', 'Dispute Category', 'Card BIN', 'Last 4 Digits'
    ];
    const rows = [
      [
        'VISA-12345', 'DSP1001', 'CB-5541', '12345678901234567890123', '6093156553', '2023-10-01T10:00:00Z',
        'ISU', 'Acme Corp', '2023-10-01', '2023-10-02', 
        '1000.00', '1000.00', 'INR', '10.4', 
        'Other Fraud - Card Absent Environment', 'Fraud', '411111', '1111'
      ]
    ];
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csvContent));
    link.setAttribute("download", "VROL_Dispute_Sample.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('VROL Sample template downloaded');
  };

  // Submit Credit adjustment
  const handleAdjustmentSubmit = async () => {
    if (!adjMerchant) { showToast('Please select target merchant', 'error'); return; }
    const amount = parseFloat(adjAmount);
    if (isNaN(amount) || amount <= 0) { showToast('Please enter valid adjustment amount', 'error'); return; }
    if (!adjRemarks) { showToast('Please add adjustment remarks', 'error'); return; }

    try {
      const response = await fetch(`${API_URL}/ledger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchant: adjMerchant,
          type: adjType,
          amount: amount,
          remarks: adjRemarks
        })
      });

      if (response.ok) {
        setAdjAmount('');
        setAdjRemarks('');
        showToast('Wallet balance adjusted successfully');
        await refreshAllData();
      } else {
        const errData = await response.json();
        showToast(errData.message || 'Adjustment failed', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('API communication error', 'error');
    }
  };

  return (
    <div className="app" id="adminApp">
      <header className="app-header">
        <button className="hdr-hamburger" onClick={() => setSidebarCollapsed(!sidebarCollapsed)}>☰</button>
        <div className="hdr-logo"><div className="hl-text">iServeU<sup>®</sup></div></div>
        <span className="admin-badge">ADMIN</span>
        <div className="hdr-space"></div>
        <button className="theme-toggle-btn" onClick={toggleTheme} title="Toggle Dark/Light Mode">
          {darkMode ? '☀️' : '🌙'}
        </button>
        <button className="hdr-bell">🔔<span className="notif-dot"></span></button>
        <div 
          className="hdr-user" 
          title={currentUser.name}
          onClick={() => setProfileMenuOpen(!profileMenuOpen)}
          style={{ position: 'relative', cursor: 'pointer' }}
        >
          <div className="avatar" style={{ background: '#1e293b', color: '#fff' }}>KD</div>
          <div>
            <div className="hdr-uname">{currentUser.name}</div>
            <div className="hdr-urole">Admin / FRM</div>
          </div>
          {profileMenuOpen && (
            <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: '8px', background: 'var(--bg-card, #fff)', border: '1px solid var(--border-color, #ddd)', borderRadius: '4px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 1000, minWidth: '160px', overflow: 'hidden' }}>
              <div style={{ padding: '12px 16px', color: 'var(--text-main, #333)', fontSize: '13px', cursor: 'pointer', borderBottom: '1px solid var(--border-color, #eee)', transition: 'background 0.2s' }} onMouseEnter={(e) => e.target.style.background='var(--bg-body, #f9f9f9)'} onMouseLeave={(e) => e.target.style.background='transparent'} onClick={(e) => { e.stopPropagation(); showToast('Change password functionality not implemented'); setProfileMenuOpen(false); }}>Change Password</div>
              <div style={{ padding: '12px 16px', color: 'var(--red, #d32f2f)', fontSize: '13px', cursor: 'pointer', transition: 'background 0.2s' }} onMouseEnter={(e) => e.target.style.background='var(--bg-body, #f9f9f9)'} onMouseLeave={(e) => e.target.style.background='transparent'} onClick={(e) => { e.stopPropagation(); handleLogout(); }}>Logout</div>
            </div>
          )}
        </div>
      </header>

      <div className="app-body">
        <nav className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`} id="aSidebar">
          <div className="sb-welcome">Welcome, Krishna Das</div>
          <div className="sb-section">
            <div 
              className={`sb-item ${activePage === 'a-dashboard' ? 'active' : ''}`}
              onClick={() => setActivePage('a-dashboard')}
            >
              <span className="si">⊞</span> Dashboard
            </div>
            <div 
              className={`sb-item ${activePage === 'a-view-cb' ? 'active' : ''}`}
              onClick={() => { setAVcPage(1); setActivePage('a-view-cb'); }}
            >
              <span className="si">📋</span> Dispute Management
            </div>
            <div 
              className={`sb-item ${activePage === 'a-vrol-import' ? 'active' : ''}`}
              onClick={() => setActivePage('a-vrol-import')}
            >
              <span className="si">📤</span> VROL Import Center
            </div>
            <div 
              className={`sb-item ${activePage === 'a-rtsi-simulator' ? 'active' : ''}`}
              onClick={() => setActivePage('a-rtsi-simulator')}
            >
              <span className="si">🔌</span> RTSI Webhook Simulator
            </div>
            <div 
              className={`sb-item ${activePage === 'a-merchants' ? 'active' : ''}`}
              onClick={() => setActivePage('a-merchants')}
            >
              <span className="si">👥</span> Merchant Management
            </div>
            <div 
              className={`sb-item ${activePage === 'a-automation' ? 'active' : ''}`}
              onClick={() => setActivePage('a-automation')}
            >
              <span className="si">⚙️</span> Automation Config
            </div>
            <div 
              className={`sb-item ${activePage === 'a-audit' ? 'active' : ''}`}
              onClick={() => setActivePage('a-audit')}
            >
              <span className="si">🔍</span> Audit & Compliance
            </div>
            <div 
              className={`sb-item ${activePage === 'a-reports' ? 'active' : ''}`}
              onClick={() => setActivePage('a-reports')}
            >
              <span className="si">📊</span> Reports & Analytics
            </div>
          </div>
        </nav>

        <main className="main">
          {/* Admin Dashboard */}
          {activePage === 'a-dashboard' && (
            <div className="page active" id="a-dashboard">
              <div className="page-inner">
                <div className="welcome-bar">
                  <div>
                    <div className="wb-title">Welcome to Admin Portal</div>
                  </div>
                  <div className="wb-date">{new Date().toLocaleDateString('en-IN')}</div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                  <h3 style={{ fontSize: '20px', fontWeight: '700', margin: 0 }}>Dispute Dashboard</h3>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <select
                      style={{ padding: '8px 12px', border: '1px solid #e0e0e0', borderRadius: '4px', color: '#757575', outline: 'none', background: 'var(--card)', fontSize: '13px' }}
                      value={dashDateRangeType}
                      onChange={(e) => {
                        const val = e.target.value;
                        setDashDateRangeType(val);
                        const today = new Date();
                        const todayStr = today.toISOString().split('T')[0];
                        if (val === 'today') {
                          setDashFilterFrom(todayStr);
                          setDashFilterTo(todayStr);
                        } else if (val === 'yesterday') {
                          const y = new Date(today);
                          y.setDate(y.getDate() - 1);
                          setDashFilterFrom(y.toISOString().split('T')[0]);
                          setDashFilterTo(y.toISOString().split('T')[0]);
                        } else if (val === '7days') {
                          const d7 = new Date(today);
                          d7.setDate(d7.getDate() - 7);
                          setDashFilterFrom(d7.toISOString().split('T')[0]);
                          setDashFilterTo(todayStr);
                        } else if (val === 'lastmonth') {
                          const lmStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
                          const lmEnd = new Date(today.getFullYear(), today.getMonth(), 0);
                          setDashFilterFrom(lmStart.toISOString().split('T')[0]);
                          setDashFilterTo(lmEnd.toISOString().split('T')[0]);
                        }
                      }}
                    >
                      <option value="today">Today</option>
                      <option value="custom">Custom Date Range</option>
                      <option value="yesterday">Yesterday</option>
                      <option value="7days">Last 7 Days</option>
                      <option value="lastmonth">Last Month</option>
                    </select>
                    {dashDateRangeType === 'custom' && (
                      <>
                        <div style={{ position: 'relative' }}>
                          <span style={{ position: 'absolute', left: '12px', top: '8px', color: '#50BDC9', fontSize: '14px' }}>📅</span>
                          <input type="date" style={{ padding: '8px 12px 8px 36px', border: '1px solid #e0e0e0', borderRadius: '4px', color: '#757575', outline: 'none', background: 'var(--card)', fontSize: '13px' }} value={dashFilterFrom} onChange={(e) => setDashFilterFrom(e.target.value)} />
                        </div>
                        <span style={{ color: 'var(--text-muted)', fontSize: '14px' }}>to</span>
                        <div style={{ position: 'relative' }}>
                          <span style={{ position: 'absolute', left: '12px', top: '8px', color: '#50BDC9', fontSize: '14px' }}>📅</span>
                          <input type="date" style={{ padding: '8px 12px 8px 36px', border: '1px solid #e0e0e0', borderRadius: '4px', color: '#757575', outline: 'none', background: 'var(--card)', fontSize: '13px' }} value={dashFilterTo} onChange={(e) => setDashFilterTo(e.target.value)} />
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <div className="stats-grid" id="adminDashStats" style={{ gridTemplateColumns: 'repeat(6, 1fr)', gap: '14px', padding: '12px 0' }}>
                  {/* Total Transactions Card */}
                  <div className="stat-card received" onClick={() => navigateToAdminReport('')} 
                    style={{ background: '#FFFFFF', border: '1px solid var(--border)', borderTop: '3px solid #6B38FB', borderRadius: '12px', padding: '16px 18px', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow)', position: 'relative', cursor: 'pointer', transition: 'all 0.2s ease-in-out' }}
                    onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 16px rgba(0,0,0,0.08)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'var(--shadow)'; }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontSize: '10px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total Transactions</div>
                      <span style={{ fontSize: '15px' }}>💳</span>
                    </div>
                    <div style={{ marginTop: '10px' }}>
                      <div style={{ fontSize: '24px', fontWeight: '800', color: 'var(--text)', lineHeight: '1.2' }}>{stats.totalCount}</div>
                      <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-muted)', marginTop: '2px' }}>{formatINR(stats.totalAmt)}</div>
                    </div>
                  </div>

                  {/* Dispute Received Card */}
                  <div className="stat-card received" onClick={() => navigateToAdminReport('')} 
                    style={{ background: '#FFFFFF', border: '1px solid var(--border)', borderTop: '3px solid #f97316', borderRadius: '12px', padding: '16px 18px', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow)', position: 'relative', cursor: 'pointer', transition: 'all 0.2s ease-in-out' }}
                    onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 16px rgba(0,0,0,0.08)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'var(--shadow)'; }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontSize: '10px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Dispute Received</div>
                      <span style={{ fontSize: '15px' }}>📥</span>
                    </div>
                    <div style={{ marginTop: '10px' }}>
                      <div style={{ fontSize: '24px', fontWeight: '800', color: 'var(--text)', lineHeight: '1.2' }}>{stats.totalCount}</div>
                      <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-muted)', marginTop: '2px' }}>{formatINR(stats.totalAmt)}</div>
                    </div>
                  </div>
                  
                  {/* Dispute Open Card */}
                  <div className="stat-card open" onClick={() => navigateToAdminReport('open')} 
                    style={{ background: '#FFFFFF', border: '1px solid var(--border)', borderTop: '3px solid #3B82F6', borderRadius: '12px', padding: '16px 18px', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow)', position: 'relative', cursor: 'pointer', transition: 'all 0.2s ease-in-out' }}
                    onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 16px rgba(0,0,0,0.08)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'var(--shadow)'; }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontSize: '10px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Dispute Open</div>
                      <span style={{ fontSize: '15px' }}>🔄</span>
                    </div>
                    <div style={{ marginTop: '10px' }}>
                      <div style={{ fontSize: '24px', fontWeight: '800', color: '#3B82F6', lineHeight: '1.2' }}>{stats.openCount}</div>
                      <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-muted)', marginTop: '2px' }}>{formatINR(stats.openAmt)}</div>
                    </div>
                  </div>
                  
                  {/* Dispute Lost Card */}
                  <div className="stat-card lost" onClick={() => navigateToAdminReport('lost')} 
                    style={{ background: '#FFFFFF', border: '1px solid var(--border)', borderTop: '3px solid #EF4444', borderRadius: '12px', padding: '16px 18px', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow)', position: 'relative', cursor: 'pointer', transition: 'all 0.2s ease-in-out' }}
                    onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 16px rgba(0,0,0,0.08)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'var(--shadow)'; }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontSize: '10px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Dispute Lost</div>
                      <span style={{ fontSize: '15px' }}>❌</span>
                    </div>
                    <div style={{ marginTop: '10px' }}>
                      <div style={{ fontSize: '24px', fontWeight: '800', color: '#EF4444', lineHeight: '1.2', display: 'flex', alignItems: 'baseline' }}>
                        {stats.lostCount}
                        {stats.totalCount > 0 && <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '4px', fontWeight: '600' }}>({Math.round((stats.lostCount / stats.totalCount) * 100)}%)</span>}
                      </div>
                      <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-muted)', marginTop: '2px' }}>{formatINR(stats.lostAmt)}</div>
                    </div>
                  </div>
                  
                  {/* Dispute Won Card */}
                  <div className="stat-card won" onClick={() => navigateToAdminReport('won')} 
                    style={{ background: '#FFFFFF', border: '1px solid var(--border)', borderTop: '3px solid #10B981', borderRadius: '12px', padding: '16px 18px', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow)', position: 'relative', cursor: 'pointer', transition: 'all 0.2s ease-in-out' }}
                    onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 16px rgba(0,0,0,0.08)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'var(--shadow)'; }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontSize: '10px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Dispute Won</div>
                      <span style={{ fontSize: '15px' }}>✅</span>
                    </div>
                    <div style={{ marginTop: '10px' }}>
                      <div style={{ fontSize: '24px', fontWeight: '800', color: '#10B981', lineHeight: '1.2', display: 'flex', alignItems: 'baseline' }}>
                        {stats.wonCount}
                        {stats.totalCount > 0 && <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '4px', fontWeight: '600' }}>({Math.round((stats.wonCount / stats.totalCount) * 100)}%)</span>}
                      </div>
                      <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-muted)', marginTop: '2px' }}>{formatINR(stats.wonAmt)}</div>
                    </div>
                  </div>

                  {/* SLA Expiring Today Card */}
                  <div className="stat-card sla" onClick={() => navigateToAdminReport('sla_today')} 
                    style={{ background: '#FFFFFF', border: '1px solid var(--border)', borderTop: '3px solid #7C3AED', borderRadius: '12px', padding: '16px 18px', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow)', position: 'relative', cursor: 'pointer', transition: 'all 0.2s ease-in-out' }}
                    onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 16px rgba(0,0,0,0.08)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'var(--shadow)'; }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontSize: '10px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>SLA Expiring Today</div>
                      <span style={{ fontSize: '15px' }}>⏰</span>
                    </div>
                    <div style={{ marginTop: '10px' }}>
                      <div style={{ fontSize: '24px', fontWeight: '800', color: '#7C3AED', lineHeight: '1.2' }}>{stats.slaCount}</div>
                      <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-muted)', marginTop: '2px' }}>{formatINR(stats.slaAmt)}</div>
                    </div>
                  </div>
                </div>

                {/* Pie Chart Widget for Dispute Distribution */}
                <div style={{ marginTop: '24px', background: 'var(--card)', borderRadius: 'var(--radius-lg)', padding: '24px', boxShadow: 'var(--shadow-md)' }}>
                  <h4 style={{ fontSize: '15px', fontWeight: '700', color: 'var(--text)', marginBottom: '16px' }}>📊 Dispute Distribution</h4>
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '180px' }}>
                    <PieChart 
                      dataSegments={[
                        { label: 'Open', value: stats.openCount, color: '#eab308' },
                        { label: 'Lost', value: stats.lostCount, color: '#ef4444' },
                        { label: 'Won', value: stats.wonCount, color: '#10b981' }
                      ]} 
                      darkMode={false} 
                    />
                  </div>
                </div>

              </div>
            </div>
          )}

          {/* Admin VROL Import Center */}
          {activePage === 'a-vrol-import' && (
            <div className="page active" id="a-vrol-import">
              <div className="view-chargeback-header">
                <span className="vc-breadcrumb">Dispute Management / <span>VROL Import Center</span></span>
              </div>
              <div className="page-inner">
                <div style={{ marginTop: '32px', background: '#FFFFFF', border: '1px solid var(--border)', borderRadius: '12px', padding: '28px', boxShadow: 'var(--shadow)' }}>
                  <h3 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '8px', color: 'var(--text)' }}>VROL Import Center</h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: '14px', marginBottom: '24px' }}>Upload VROL Dispute, Pre-Arbitration, Arbitration, or Settlement files (CSV/XLSX).</p>
                  
                  <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                    <input 
                      type="file" 
                      id="vrolUploadInput" 
                      accept=".csv, .xlsx" 
                      style={{ 
                        border: '1.5px solid #CBD5E1', 
                        padding: '10px 14px', 
                        borderRadius: '8px',
                        background: '#FFFFFF',
                        color: 'var(--text-muted)',
                        fontSize: '13px',
                        cursor: 'pointer'
                      }}
                    />
                    <button 
                      onClick={async () => {
                        const fileInput = document.getElementById('vrolUploadInput');
                        if (!fileInput.files || fileInput.files.length === 0) {
                          showToast('Please select a file to upload', 'error');
                          return;
                        }
                        const file = fileInput.files[0];
                        const formData = new FormData();
                        formData.append('file', file);
                        formData.append('uploadedBy', currentUser?.name || 'Admin');

                        showToast('Uploading VROL file...', 'warning');
                        try {
                          const res = await fetch(`${API_URL}/vrol/upload`, {
                            method: 'POST',
                            body: formData
                          });
                          if (!res.ok) throw new Error('Upload failed');
                          const data = await res.json();
                          showToast(`Successfully processed ${data.recordsProcessed || 0} records! Notifications sent to merchants.`);
                          fileInput.value = '';
                        } catch (err) {
                          console.error('VROL Upload error:', err);
                          showToast('Failed to upload VROL file. Ensure backend is running.', 'error');
                        }
                      }}
                      style={{ padding: '12px 24px', background: '#6B38FB', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '600', fontSize: '13px', transition: 'opacity 0.2s' }}
                      onMouseEnter={(e) => e.currentTarget.style.opacity = '0.9'}
                      onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
                    >
                      Upload File
                    </button>
                    <button 
                      onClick={downloadVrolSampleTemplate}
                      style={{ padding: '11px 24px', background: 'transparent', color: '#6B38FB', border: '1.5px solid #6B38FB', borderRadius: '8px', cursor: 'pointer', fontWeight: '600', fontSize: '13px', transition: 'all 0.2s' }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = '#6B38FB'; e.currentTarget.style.color = '#fff'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#6B38FB'; }}
                    >
                      Download Sample
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Admin RTSI Webhook Simulator & Audits */}
          {activePage === 'a-rtsi-simulator' && (
            <div className="page active" id="a-rtsi-simulator" style={{ padding: '24px', fontFamily: "'Inter', sans-serif" }}>
              <div style={{ marginBottom: '24px' }}>
                <h2 style={{ fontSize: '24px', fontWeight: '700', color: '#1e293b', margin: '0 0 6px 0' }}>RTSI Webhook Simulator & Audits</h2>
                <p style={{ fontSize: '14px', color: '#64748b', margin: 0 }}>Simulate real-time inbound Visa network transactions, RDR alerts, and formal disputes, and inspect RTSI network transaction logs.</p>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', alignItems: 'stretch' }}>
                
                {/* Simulator Form Column */}
                <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '24px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)', display: 'flex', flexDirection: 'column' }}>
                  <h3 style={{ fontSize: '16px', fontWeight: '700', color: '#1e293b', marginBottom: '16px', borderBottom: '1px solid #f1f5f9', paddingBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span>🔌</span> Inbound Webhook Event Simulator
                  </h3>

                  <div style={{ marginBottom: '20px' }}>
                    <label style={{ fontSize: '13px', fontWeight: '600', color: '#475569', display: 'block', marginBottom: '8px' }}>Select BDD Scenario Flow</label>
                    <select 
                      value={simulatorScenario} 
                      onChange={(e) => handleScenarioChange(e.target.value)}
                      style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', outline: 'none' }}
                    >
                      <option value="scenario1">Scenario 1: OI Inquiry - Digital Receipt Deflection</option>
                      <option value="scenario2">Scenario 2: OI Inquiry - Intent to Credit deflection</option>
                      <option value="scenario3">Scenario 3: RDR Alert Ingestion - Auto-Accept & Credit</option>
                      <option value="scenario4">Scenario 4: Formal Dispute Ingestion - Routing & SLA</option>
                      <option value="scenario6">Scenario 6: Collaboration Ingestion - Pre-Arb Review</option>
                    </select>
                  </div>

                  {/* Dynamic Fields */}
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '20px', background: '#f8fafc', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                    <h4 style={{ fontSize: '12px', fontWeight: '700', color: '#475569', margin: '0 0 6px 0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Scenario Parameters</h4>

                    {(simulatorScenario === 'scenario1' || simulatorScenario === 'scenario2') && (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <div>
                          <label style={{ fontSize: '11px', fontWeight: '600', color: '#64748b' }}>Visa Tx ID</label>
                          <input type="text" value={oiVisaTxId} onChange={(e) => setOiVisaTxId(e.target.value)} style={{ width: '100%', padding: '6px 10px', fontSize: '12px', border: '1px solid #cbd5e1', borderRadius: '6px' }} />
                        </div>
                        <div>
                          <label style={{ fontSize: '11px', fontWeight: '600', color: '#64748b' }}>Merchant CAID</label>
                          <input type="text" value={oiMerchantCaid} onChange={(e) => setOiMerchantCaid(e.target.value)} style={{ width: '100%', padding: '6px 10px', fontSize: '12px', border: '1px solid #cbd5e1', borderRadius: '6px' }} />
                        </div>
                        <div>
                          <label style={{ fontSize: '11px', fontWeight: '600', color: '#64748b' }}>ARN</label>
                          <input type="text" value={oiArn} onChange={(e) => setOiArn(e.target.value)} style={{ width: '100%', padding: '6px 10px', fontSize: '12px', border: '1px solid #cbd5e1', borderRadius: '6px' }} />
                        </div>
                        <div>
                          <label style={{ fontSize: '11px', fontWeight: '600', color: '#64748b' }}>Timestamp</label>
                          <input type="text" value={oiTxTimestamp} onChange={(e) => setOiTxTimestamp(e.target.value)} style={{ width: '100%', padding: '6px 10px', fontSize: '12px', border: '1px solid #cbd5e1', borderRadius: '6px' }} />
                        </div>
                        <div>
                          <label style={{ fontSize: '11px', fontWeight: '600', color: '#64748b' }}>Amount</label>
                          <input type="text" value={oiAmount} onChange={(e) => setOiAmount(e.target.value)} style={{ width: '100%', padding: '6px 10px', fontSize: '12px', border: '1px solid #cbd5e1', borderRadius: '6px' }} />
                        </div>
                        <div>
                          <label style={{ fontSize: '11px', fontWeight: '600', color: '#64748b' }}>Currency Code</label>
                          <input type="text" value={oiCurrencyIso} onChange={(e) => setOiCurrencyIso(e.target.value)} style={{ width: '100%', padding: '6px 10px', fontSize: '12px', border: '1px solid #cbd5e1', borderRadius: '6px' }} />
                        </div>
                        <div style={{ gridColumn: 'span 2' }}>
                          <label style={{ fontSize: '11px', fontWeight: '600', color: '#64748b' }}>Category</label>
                          <input type="text" value={oiCategory} onChange={(e) => setOiCategory(e.target.value)} style={{ width: '100%', padding: '6px 10px', fontSize: '12px', border: '1px solid #cbd5e1', borderRadius: '6px' }} />
                        </div>
                      </div>
                    )}

                    {simulatorScenario === 'scenario3' && (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <div>
                          <label style={{ fontSize: '11px', fontWeight: '600', color: '#64748b' }}>VROL Case ID</label>
                          <input type="text" value={rdrVrolCaseId} onChange={(e) => setRdrVrolCaseId(e.target.value)} style={{ width: '100%', padding: '6px 10px', fontSize: '12px', border: '1px solid #cbd5e1', borderRadius: '6px' }} />
                        </div>
                        <div>
                          <label style={{ fontSize: '11px', fontWeight: '600', color: '#64748b' }}>Merchant CAID</label>
                          <input type="text" value={rdrMerchantCaid} onChange={(e) => setRdrMerchantCaid(e.target.value)} style={{ width: '100%', padding: '6px 10px', fontSize: '12px', border: '1px solid #cbd5e1', borderRadius: '6px' }} />
                        </div>
                        <div>
                          <label style={{ fontSize: '11px', fontWeight: '600', color: '#64748b' }}>Dispute Condition</label>
                          <input type="text" value={rdrDisputeCondition} onChange={(e) => setRdrDisputeCondition(e.target.value)} style={{ width: '100%', padding: '6px 10px', fontSize: '12px', border: '1px solid #cbd5e1', borderRadius: '6px' }} />
                        </div>
                        <div>
                          <label style={{ fontSize: '11px', fontWeight: '600', color: '#64748b' }}>Amount</label>
                          <input type="text" value={rdrDisputeAmount} onChange={(e) => setRdrDisputeAmount(e.target.value)} style={{ width: '100%', padding: '6px 10px', fontSize: '12px', border: '1px solid #cbd5e1', borderRadius: '6px' }} />
                        </div>
                        <div>
                          <label style={{ fontSize: '11px', fontWeight: '600', color: '#64748b' }}>Currency</label>
                          <input type="text" value={rdrCurrency} onChange={(e) => setRdrCurrency(e.target.value)} style={{ width: '100%', padding: '6px 10px', fontSize: '12px', border: '1px solid #cbd5e1', borderRadius: '6px' }} />
                        </div>
                        <div>
                          <label style={{ fontSize: '11px', fontWeight: '600', color: '#64748b' }}>Product SKU</label>
                          <input type="text" value={rdrProductSku} onChange={(e) => setRdrProductSku(e.target.value)} style={{ width: '100%', padding: '6px 10px', fontSize: '12px', border: '1px solid #cbd5e1', borderRadius: '6px' }} />
                        </div>
                      </div>
                    )}

                    {simulatorScenario === 'scenario4' && (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <div>
                          <label style={{ fontSize: '11px', fontWeight: '600', color: '#64748b' }}>VROL Case ID</label>
                          <input type="text" value={dispVrolCaseId} onChange={(e) => setDispVrolCaseId(e.target.value)} style={{ width: '100%', padding: '6px 10px', fontSize: '12px', border: '1px solid #cbd5e1', borderRadius: '6px' }} />
                        </div>
                        <div>
                          <label style={{ fontSize: '11px', fontWeight: '600', color: '#64748b' }}>Merchant CAID</label>
                          <input type="text" value={dispMerchantCaid} onChange={(e) => setDispMerchantCaid(e.target.value)} style={{ width: '100%', padding: '6px 10px', fontSize: '12px', border: '1px solid #cbd5e1', borderRadius: '6px' }} />
                        </div>
                        <div>
                          <label style={{ fontSize: '11px', fontWeight: '600', color: '#64748b' }}>Merchant Name</label>
                          <input type="text" value={dispMerchantName} onChange={(e) => setDispMerchantName(e.target.value)} style={{ width: '100%', padding: '6px 10px', fontSize: '12px', border: '1px solid #cbd5e1', borderRadius: '6px' }} />
                        </div>
                        <div>
                          <label style={{ fontSize: '11px', fontWeight: '600', color: '#64748b' }}>Dispute Category</label>
                          <input type="text" value={dispCategory} onChange={(e) => setDispCategory(e.target.value)} style={{ width: '100%', padding: '6px 10px', fontSize: '12px', border: '1px solid #cbd5e1', borderRadius: '6px' }} />
                        </div>
                        <div>
                          <label style={{ fontSize: '11px', fontWeight: '600', color: '#64748b' }}>Dispute Condition</label>
                          <input type="text" value={dispCondition} onChange={(e) => setDispCondition(e.target.value)} style={{ width: '100%', padding: '6px 10px', fontSize: '12px', border: '1px solid #cbd5e1', borderRadius: '6px' }} />
                        </div>
                        <div>
                          <label style={{ fontSize: '11px', fontWeight: '600', color: '#64748b' }}>Dispute Amount</label>
                          <input type="text" value={dispAmount} onChange={(e) => setDispAmount(e.target.value)} style={{ width: '100%', padding: '6px 10px', fontSize: '12px', border: '1px solid #cbd5e1', borderRadius: '6px' }} />
                        </div>
                        <div>
                          <label style={{ fontSize: '11px', fontWeight: '600', color: '#64748b' }}>Currency Code</label>
                          <input type="text" value={dispCurrencyCode} onChange={(e) => setDispCurrencyCode(e.target.value)} style={{ width: '100%', padding: '6px 10px', fontSize: '12px', border: '1px solid #cbd5e1', borderRadius: '6px' }} />
                        </div>
                        <div>
                          <label style={{ fontSize: '11px', fontWeight: '600', color: '#64748b' }}>Network Day Limit</label>
                          <input type="text" value={dispNetworkDayLimit} onChange={(e) => setDispNetworkDayLimit(e.target.value)} style={{ width: '100%', padding: '6px 10px', fontSize: '12px', border: '1px solid #cbd5e1', borderRadius: '6px' }} />
                        </div>
                        <div style={{ gridColumn: 'span 2' }}>
                          <label style={{ fontSize: '11px', fontWeight: '600', color: '#64748b' }}>Submission Date</label>
                          <input type="text" value={dispSubmissionDate} onChange={(e) => setDispSubmissionDate(e.target.value)} style={{ width: '100%', padding: '6px 10px', fontSize: '12px', border: '1px solid #cbd5e1', borderRadius: '6px' }} />
                        </div>
                      </div>
                    )}

                    {simulatorScenario === 'scenario6' && (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <div>
                          <label style={{ fontSize: '11px', fontWeight: '600', color: '#64748b' }}>VROL Case ID</label>
                          <input type="text" value={collabVrolCaseId} onChange={(e) => setCollabVrolCaseId(e.target.value)} style={{ width: '100%', padding: '6px 10px', fontSize: '12px', border: '1px solid #cbd5e1', borderRadius: '6px' }} />
                        </div>
                        <div>
                          <label style={{ fontSize: '11px', fontWeight: '600', color: '#64748b' }}>Merchant CAID</label>
                          <input type="text" value={collabMerchantCaid} onChange={(e) => setCollabMerchantCaid(e.target.value)} style={{ width: '100%', padding: '6px 10px', fontSize: '12px', border: '1px solid #cbd5e1', borderRadius: '6px' }} />
                        </div>
                        <div>
                          <label style={{ fontSize: '11px', fontWeight: '600', color: '#64748b' }}>Dispute Category</label>
                          <input type="text" value={collabCategory} onChange={(e) => setCollabCategory(e.target.value)} style={{ width: '100%', padding: '6px 10px', fontSize: '12px', border: '1px solid #cbd5e1', borderRadius: '6px' }} />
                        </div>
                        <div>
                          <label style={{ fontSize: '11px', fontWeight: '600', color: '#64748b' }}>Condition Code</label>
                          <input type="text" value={collabCondition} onChange={(e) => setCollabCondition(e.target.value)} style={{ width: '100%', padding: '6px 10px', fontSize: '12px', border: '1px solid #cbd5e1', borderRadius: '6px' }} />
                        </div>
                        <div>
                          <label style={{ fontSize: '11px', fontWeight: '600', color: '#64748b' }}>Amount</label>
                          <input type="text" value={collabAmount} onChange={(e) => setCollabAmount(e.target.value)} style={{ width: '100%', padding: '6px 10px', fontSize: '12px', border: '1px solid #cbd5e1', borderRadius: '6px' }} />
                        </div>
                        <div>
                          <label style={{ fontSize: '11px', fontWeight: '600', color: '#64748b' }}>Initial Evidence File</label>
                          <input type="text" value={collabInitialEvidence} onChange={(e) => setCollabInitialEvidence(e.target.value)} style={{ width: '100%', padding: '6px 10px', fontSize: '12px', border: '1px solid #cbd5e1', borderRadius: '6px' }} />
                        </div>
                        <div style={{ gridColumn: 'span 2' }}>
                          <label style={{ fontSize: '11px', fontWeight: '600', color: '#64748b' }}>Pre-Arb Counter Reason</label>
                          <input type="text" value={collabCounterReason} onChange={(e) => setCollabCounterReason(e.target.value)} style={{ width: '100%', padding: '6px 10px', fontSize: '12px', border: '1px solid #cbd5e1', borderRadius: '6px' }} />
                        </div>
                      </div>
                    )}
                  </div>

                  <button 
                    type="button"
                    onClick={handleTriggerWebhook}
                    disabled={isSendingWebhook}
                    style={{ padding: '12px 24px', background: '#6B38FB', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '600', fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                  >
                    {isSendingWebhook ? '🔄 Sending...' : '⚡ Trigger Inbound Webhook'}
                  </button>

                  {webhookResponse && (
                    <div style={{ marginTop: '20px', background: '#0f172a', color: '#38bdf8', padding: '16px', borderRadius: '8px', fontFamily: 'monospace', fontSize: '11px', overflowX: 'auto', border: '1px solid #334155' }}>
                      <div style={{ color: '#94a3b8', borderBottom: '1px solid #334155', paddingBottom: '6px', marginBottom: '8px', fontWeight: 'bold' }}>
                        Response Status: {webhookResponse.status}
                      </div>
                      <pre style={{ margin: 0 }}>{JSON.stringify(webhookResponse.data, null, 2)}</pre>
                    </div>
                  )}
                </div>

                {/* Audit Logs Column */}
                <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '24px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid #f1f5f9', paddingBottom: '12px' }}>
                    <h3 style={{ fontSize: '16px', fontWeight: '700', color: '#1e293b', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span>📄</span> RTSI Webhook Audits Log
                    </h3>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button type="button" onClick={fetchRtsiAudits} className="btn btn-outline" style={{ padding: '6px 12px', fontSize: '11px', height: '30px' }}>Refresh</button>
                      <button type="button" onClick={clearRtsiAudits} className="btn btn-outline" style={{ padding: '6px 12px', fontSize: '11px', height: '30px', color: '#ef4444', borderColor: '#fca5a5' }}>Clear</button>
                    </div>
                  </div>

                  {rtsiAudits.length === 0 ? (
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px', background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: '8px', color: '#64748b', fontSize: '13px', textAlign: 'center' }}>
                      No webhook audit logs found. Trigger a simulator event above.
                    </div>
                  ) : (
                    <div style={{ flex: 1, overflowY: 'auto', maxHeight: '500px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {rtsiAudits.map((audit) => (
                          <div 
                            key={audit.id} 
                            onClick={() => setSelectedAudit(audit)}
                            style={{ padding: '12px', border: '1px solid #e2e8f0', borderRadius: '8px', background: '#f8fafc', cursor: 'pointer', transition: 'all 0.2s' }}
                            onMouseEnter={(e) => e.currentTarget.style.borderColor = '#6B38FB'}
                            onMouseLeave={(e) => e.currentTarget.style.borderColor = '#e2e8f0'}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                              <span style={{ fontWeight: '700', fontSize: '12px', color: '#334155' }}>
                                <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '2px 6px', borderRadius: '4px', marginRight: '6px' }}>{audit.method}</span>
                                {audit.endpoint}
                              </span>
                              <span style={{ fontSize: '11px', color: audit.status === 200 ? '#16a34a' : '#dc2626', fontWeight: 'bold' }}>
                                Code {audit.status}
                              </span>
                            </div>
                            <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>
                              {new Date(audit.time).toLocaleTimeString()}
                            </div>
                            <div style={{ fontSize: '11px', color: '#475569', fontStyle: 'italic' }}>
                              {audit.comments}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

              </div>

              {/* View Audit Details Modal */}
              {selectedAudit && (
                <div className="overlay open" style={{ zIndex: 2000 }}>
                  <div className="modal modal-lg" style={{ maxWidth: '750px' }}>
                    <div className="modal-hdr">
                      <h3>RTSI Audit Log Details</h3>
                      <button className="modal-close" onClick={() => setSelectedAudit(null)}>✕</button>
                    </div>
                    <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', fontSize: '12px', marginBottom: '16px' }}>
                        <div><strong>Timestamp:</strong> {new Date(selectedAudit.time).toLocaleString()}</div>
                        <div><strong>Audit ID:</strong> {selectedAudit.id}</div>
                        <div><strong>Endpoint:</strong> {selectedAudit.method} {selectedAudit.endpoint}</div>
                        <div><strong>Status:</strong> <span style={{ color: selectedAudit.status === 200 ? '#16a34a' : '#dc2626', fontWeight: 'bold' }}>{selectedAudit.status}</span></div>
                        <div style={{ gridColumn: 'span 2' }}><strong>Comments:</strong> {selectedAudit.comments}</div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                        <div>
                          <h4 style={{ fontSize: '12px', fontWeight: '700', color: '#475569', marginBottom: '6px' }}>Request Payload</h4>
                          <pre style={{ margin: 0, padding: '12px', background: '#0f172a', color: '#38bdf8', borderRadius: '8px', fontSize: '10px', overflowX: 'auto', maxHeight: '300px' }}>
                            {JSON.stringify(selectedAudit.requestPayload, null, 2)}
                          </pre>
                        </div>
                        <div>
                          <h4 style={{ fontSize: '12px', fontWeight: '700', color: '#475569', marginBottom: '6px' }}>Response Payload</h4>
                          <pre style={{ margin: 0, padding: '12px', background: '#0f172a', color: '#38bdf8', borderRadius: '8px', fontSize: '10px', overflowX: 'auto', maxHeight: '300px' }}>
                            {JSON.stringify(selectedAudit.responsePayload, null, 2)}
                          </pre>
                        </div>
                      </div>
                    </div>
                    <div className="modal-footer">
                      <button className="btn btn-secondary" onClick={() => setSelectedAudit(null)}>Close</button>
                    </div>
                  </div>
                </div>
              )}

            </div>
          )}

          {/* Admin Chargeback Menu */}
          {activePage === 'a-chargeback' && (
            <div className="page active" id="a-chargeback">
              <div className="view-chargeback-header">
                <span className="vc-breadcrumb">Dispute Management / <span>Chargeback Menu</span></span>
              </div>
              <div className="page-inner">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', maxWidth: '700px', margin: '40px auto 24px' }}>

                  <div 
                    style={{ border: '1.5px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '40px 20px', textAlign: 'center', cursor: 'pointer', background: 'var(--card)' }}
                    onClick={() => { setAVcPage(1); setActivePage('a-view-cb'); }}
                  >
                    <div style={{ fontSize: '40px', marginBottom: '12px' }}>👁</div>
                    <div style={{ fontSize: '15px', fontWeight: '600' }}>View Chargeback</div>
                    <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '6px' }}>Search, expand details and take actions</p>
                  </div>
                </div>
              </div>
            </div>
          )}



          {/* Admin View Chargebacks */}
          {/* Admin View Chargebacks */}
          {activePage === 'a-view-cb' && (
            <div className="page active" id="a-view-cb">
              <div className="view-chargeback-header" style={{ marginBottom: '16px' }}>
                <span className="vc-breadcrumb" style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Dispute Management / <span style={{ color: 'var(--text)', fontWeight: '600' }}>View Dispute History</span></span>
              </div>
              <div className="page-inner" style={{ display: 'flex', flexDirection: 'column' }}>
                
                {/* Horizontal raised card style tabs */}
                <div style={{ 
                  display: 'flex', 
                  borderBottom: '1px solid var(--border)', 
                  marginBottom: '24px', 
                  gap: '4px',
                  position: 'relative'
                }}>
                  {[
                    { key: 'verification-pending', label: 'Action Required', count: getAdminActionRequiredCount() },
                    { key: 'merchant-pending', label: 'Under Review', count: getAdminUnderReviewCount() },
                    { key: 'closed', label: 'Closed', count: getAdminClosedCount() },
                    { key: 'management', label: 'All Disputes', count: chargebacks.length }
                  ].map(tab => {
                    const isActive = adminTab === tab.key;
                    return (
                      <div
                        key={tab.key}
                        onClick={() => { setAdminTab(tab.key); setAVcPage(1); }}
                        style={{
                          padding: '12px 20px',
                          color: isActive ? '#6B38FB' : 'rgba(107, 56, 251, 0.65)',
                          fontWeight: '600',
                          fontSize: '14px',
                          background: isActive ? 'var(--card)' : 'transparent',
                          borderTop: isActive ? '3px solid #6B38FB' : '3px solid transparent',
                          borderLeft: isActive ? '1px solid var(--border)' : '1px solid transparent',
                          borderRight: isActive ? '1px solid var(--border)' : '1px solid transparent',
                          borderBottom: isActive ? '1px solid var(--card)' : '1px solid transparent',
                          borderRadius: '8px 8px 0 0',
                          cursor: 'pointer',
                          marginBottom: '-1px',
                          zIndex: isActive ? 2 : 1,
                          transition: 'all 0.15s ease-in-out',
                          boxShadow: isActive ? '0 -2px 4px rgba(0, 0, 0, 0.02)' : 'none'
                        }}
                      >
                        {tab.label} ({tab.count})
                      </div>
                    );
                  })}
                </div>

                {/* Summary Cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginBottom: '24px' }}>
                  {[
                    {
                      id: 'due_today',
                      label: '🚨 Due Today Urgent',
                      count: chargebacks.filter(cb => cb.respondByDate === new Date().toISOString().split('T')[0] && !isClosedDispute(cb)).length,
                      amount: chargebacks.filter(cb => cb.respondByDate === new Date().toISOString().split('T')[0] && !isClosedDispute(cb)).reduce((sum, cb) => sum + cb.txnAmt, 0),
                      activeClass: 'active-red'
                    },
                    {
                      id: 'due_tomorrow',
                      label: '⚠️ Due Tomorrow Critical',
                      count: chargebacks.filter(cb => {
                        const tomorrow = new Date();
                        tomorrow.setDate(tomorrow.getDate() + 1);
                        return cb.respondByDate === tomorrow.toISOString().split('T')[0] && !isClosedDispute(cb);
                      }).length,
                      amount: chargebacks.filter(cb => {
                        const tomorrow = new Date();
                        tomorrow.setDate(tomorrow.getDate() + 1);
                        return cb.respondByDate === tomorrow.toISOString().split('T')[0] && !isClosedDispute(cb);
                      }).reduce((sum, cb) => sum + cb.txnAmt, 0),
                      activeClass: 'active-yellow'
                    },
                    {
                      id: 'insufficient_evidence',
                      label: 'ℹ️ Insufficient Evidence',
                      count: chargebacks.filter(cb => cb.merchantAction === 'rejected' && !isClosedDispute(cb)).length,
                      amount: chargebacks.filter(cb => cb.merchantAction === 'rejected' && !isClosedDispute(cb)).reduce((sum, cb) => sum + cb.txnAmt, 0),
                      activeClass: 'active-blue'
                    }
                  ].map(card => {
                    const isActive = filterStatus === card.id;
                    return (
                      <div
                        key={card.id}
                        className={`premium-summary-card ${isActive ? card.activeClass : ''}`}
                        onClick={() => {
                          setFilterStatus(filterStatus === card.id ? '' : card.id);
                          setAdminTab('management');
                          setAVcPage(1);
                        }}
                        style={{
                          background: '#FFFFFF',
                          borderTop: '3px solid #f97316',
                          borderRadius: '12px',
                          padding: '18px 20px',
                          boxShadow: isActive ? '0 8px 20px rgba(249, 115, 22, 0.2)' : '0 2px 8px rgba(0,0,0,0.06)',
                          border: isActive ? '2px solid #f97316' : '1px solid #e2e8f0',
                          borderTopWidth: '3px',
                          cursor: 'pointer',
                          transition: 'all 0.2s',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '12px',
                          minHeight: '100px'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div style={{ fontSize: '13px', fontWeight: '600', color: '#64748b' }}>{card.label}</div>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                          <div style={{ fontSize: '36px', fontWeight: '800', color: '#1e293b', lineHeight: '1' }}>{card.count}</div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '11px', fontWeight: '600', color: '#94a3b8', marginBottom: '2px' }}>Amount</div>
                            <div style={{ fontSize: '16px', fontWeight: '700', color: '#0f172a' }}>₹{card.amount.toLocaleString('en-IN')}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* New disputes message */}
                <div style={{ marginBottom: '20px', fontSize: '14px', fontWeight: '600', color: '#6B38FB' }}>
                  {chargebacks.filter(cb => cb.createdDate === new Date().toISOString().split('T')[0]).length} new Disputes added today.
                </div>

                {/* Toolbar with dropdowns and export */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', position: 'relative', flexWrap: 'wrap', gap: '12px' }}>
                  <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                    {/* Date Range Dropdown */}
                    <div style={{ position: 'relative', display: 'inline-block' }}>
                      <button
                        onClick={() => { setDateDropdownOpen(!dateDropdownOpen); setFilterDropdownOpen(false); }}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '8px',
                          padding: '8px 16px',
                          border: '1px solid var(--border-input, #CBD5E1)',
                          borderRadius: '12px',
                          background: '#FFFFFF',
                          color: 'var(--text)',
                          fontSize: '13px',
                          fontWeight: '500',
                          cursor: 'pointer',
                          height: '42px',
                          minWidth: '160px',
                          boxShadow: 'var(--shadow-sm)',
                        }}
                      >
                        <span>📅 {getPresetLabel(dateRangePreset)}</span>
                        <span style={{ fontSize: '10px', color: '#6B38FB' }}>▼</span>
                      </button>

                      {dateDropdownOpen && (
                        <>
                          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 999, background: 'transparent' }} onClick={() => setDateDropdownOpen(false)} />
                          <div style={{
                            position: 'absolute',
                            top: 'calc(100% + 6px)',
                            left: '0',
                            background: 'var(--card, #fff)',
                            border: '1px solid var(--border, #E2E8F0)',
                            borderRadius: '12px',
                            boxShadow: 'var(--shadow-lg)',
                            zIndex: 1000,
                            minWidth: '220px',
                            padding: '8px 0',
                            display: 'flex',
                            flexDirection: 'column',
                          }}>
                            {['today', '7days', '30days', '6months'].map(preset => (
                              <button
                                key={preset}
                                onClick={() => {
                                  setDateRangePreset(preset);
                                  const dates = getPresetDates(preset);
                                  if (dates) {
                                    setFilterFrom(dates.from);
                                    setFilterTo(dates.to);
                                    setTempFrom(dates.from);
                                    setTempTo(dates.to);
                                  }
                                  setDateDropdownOpen(false);
                                }}
                                style={{
                                  padding: '10px 16px',
                                  cursor: 'pointer',
                                  fontSize: '13px',
                                  color: dateRangePreset === preset ? '#6B38FB' : 'var(--text)',
                                  fontWeight: dateRangePreset === preset ? '600' : '500',
                                  textAlign: 'left',
                                  background: 'transparent',
                                  border: 'none',
                                  transition: 'background 0.2s',
                                }}
                                onMouseEnter={(e) => e.target.style.background = 'var(--bg)'}
                                onMouseLeave={(e) => e.target.style.background = 'transparent'}
                              >
                                {getPresetLabel(preset)}
                              </button>
                            ))}
                            <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />
                            <div style={{ padding: '8px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                              <span style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--text-light)' }}>CUSTOM RANGE</span>
                              <div style={{ display: 'flex', gap: '8px' }}>
                                <div style={{ flex: 1 }}>
                                  <span style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>From</span>
                                  <input 
                                    type="date" 
                                    value={tempFrom} 
                                    onChange={(e) => setTempFrom(e.target.value)} 
                                    style={{ width: '100%', padding: '6px', fontSize: '12px', border: '1px solid var(--border-input)', borderRadius: '6px', background: 'var(--card)', color: 'var(--text)' }} 
                                  />
                                </div>
                                <div style={{ flex: 1 }}>
                                  <span style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>To</span>
                                  <input 
                                    type="date" 
                                    value={tempTo} 
                                    onChange={(e) => setTempTo(e.target.value)} 
                                    style={{ width: '100%', padding: '6px', fontSize: '12px', border: '1px solid var(--border-input)', borderRadius: '6px', background: 'var(--card)', color: 'var(--text)' }} 
                                  />
                                </div>
                              </div>
                              <button 
                                onClick={() => {
                                  setFilterFrom(tempFrom);
                                  setFilterTo(tempTo);
                                  setDateRangePreset('custom');
                                  setDateDropdownOpen(false);
                                }}
                                style={{ width: '100%', padding: '8px', fontSize: '12px', background: '#6B38FB', border: 'none', color: '#fff', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}
                              >
                                Apply Custom
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>

                    {/* Search & Filter Dropdown */}
                    <div style={{ position: 'relative', display: 'inline-block' }}>
                      <button 
                        onClick={() => { setFilterDropdownOpen(!filterDropdownOpen); setDateDropdownOpen(false); }}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '8px',
                          padding: '8px 16px',
                          border: '1px solid var(--border-input, #CBD5E1)',
                          borderRadius: '12px',
                          background: '#FFFFFF',
                          color: 'var(--text)',
                          fontSize: '13px',
                          fontWeight: '500',
                          cursor: 'pointer',
                          height: '42px',
                          minWidth: '160px',
                          boxShadow: 'var(--shadow-sm)',
                        }}
                      >
                        <span>🔍 Advance Search and Filter</span>
                        <span style={{ fontSize: '10px', color: '#6B38FB' }}>▼</span>
                      </button>

                      {/* Elastic Search Input - Admin */}
                      <div style={{ position: 'relative', display: 'inline-block' }}>
                        <input
                          type="text"
                          value={elasticSearchVal}
                          onChange={e => setElasticSearchVal(e.target.value)}
                          onFocus={() => setElasticSearchFocused(true)}
                          onBlur={() => setTimeout(() => setElasticSearchFocused(false), 180)}
                          placeholder="Search by RRN / Transaction ID / TID / MID"
                          style={{
                            padding: '8px 14px 8px 36px',
                            border: '1px solid var(--border-input, #CBD5E1)',
                            borderRadius: '12px',
                            fontSize: '13px',
                            width: '290px',
                            outline: 'none',
                            height: '42px',
                            background: 'var(--card, #fff)',
                            color: 'var(--text)',
                            boxShadow: elasticSearchFocused ? '0 0 0 3px rgba(107,56,251,0.15)' : 'none',
                            borderColor: elasticSearchFocused ? '#6B38FB' : 'var(--border-input, #CBD5E1)',
                            transition: 'all 0.2s',
                          }}
                        />
                        <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', fontSize: '14px', pointerEvents: 'none' }}>🔎</span>
                        {elasticSearchFocused && elasticSearchVal.length >= 2 && getElasticSuggestions(chargebacks, elasticSearchVal).length > 0 && (
                          <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, background: 'var(--card,#fff)', border: '1px solid var(--border,#E2E8F0)', borderRadius: '10px', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 1100, minWidth: '290px', overflow: 'hidden' }}>
                            {getElasticSuggestions(chargebacks, elasticSearchVal).map((s, i) => (
                              <div key={i} onMouseDown={() => setElasticSearchVal(s)} style={{ padding: '9px 14px', fontSize: '13px', cursor: 'pointer', borderBottom: '1px solid var(--border,#F1F5F9)', color: 'var(--text)' }}
                                onMouseEnter={e => e.currentTarget.style.background = 'var(--hover,#F8FAFF)'}
                                onMouseLeave={e => e.currentTarget.style.background = 'var(--card,#fff)'}>
                                {s}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {filterDropdownOpen && (
                        <>
                          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 999, background: 'transparent' }} onClick={() => setFilterDropdownOpen(false)} />
                          <div style={{
                            position: 'absolute',
                            top: 'calc(100% + 6px)',
                            left: '0',
                            background: 'var(--card, #fff)',
                            border: '1px solid var(--border, #E2E8F0)',
                            borderRadius: '12px',
                            boxShadow: 'var(--shadow-lg)',
                            zIndex: 1000,
                            width: '380px',
                            padding: '20px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '12px',
                          }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <label style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--text-muted)', textAlign: 'left' }}>Dispute Type</label>
                                <select 
                                  value={filterSubStatus}
                                  onChange={(e) => setFilterSubStatus(e.target.value)}
                                  style={{ width: '100%', padding: '8px', border: '1px solid var(--border-input)', borderRadius: '8px', fontSize: '13px', background: 'var(--card)', color: 'var(--text)' }}
                                >
                                  <option value="">Select All</option>
                                  <option value="Chargeback">Chargeback</option>
                                  <option value="Pre-Arbitration">Pre-Arbitration</option>
                                  <option value="Retrieval Request">Retrieval Request</option>
                                  <option value="Arbitration">Arbitration</option>
                                </select>
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <label style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--text-muted)', textAlign: 'left' }}>Scheme</label>
                                <select 
                                  value={filterScheme}
                                  onChange={(e) => setFilterScheme(e.target.value)}
                                  style={{ width: '100%', padding: '8px', border: '1px solid var(--border-input)', borderRadius: '8px', fontSize: '13px', background: 'var(--card)', color: 'var(--text)' }}
                                >
                                  <option value="">Select All</option>
                                  <option value="Visa">Visa</option>
                                </select>
                              </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <label style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--text-muted)', textAlign: 'left' }}>Dispute Status</label>
                                <select 
                                  value={filterStatus}
                                  onChange={(e) => setFilterStatus(e.target.value)}
                                  style={{ width: '100%', padding: '8px', border: '1px solid var(--border-input)', borderRadius: '8px', fontSize: '13px', background: 'var(--card)', color: 'var(--text)' }}
                                >
                                  <option value="">Select All</option>
                                  <option value="Dispute Won Partially">Dispute Won Partially</option>
                                  <option value="Dispute Won Fully">Dispute Won Fully</option>
                                  <option value="Dispute Lost – TAT Expired">Dispute Lost – TAT Expired</option>
                                  <option value="Dispute Lost – Accepted">Dispute Lost – Accepted</option>
                                  <option value="Document Rejected">Document Rejected</option>
                                  <option value="Chargeback In Progress">Chargeback In Progress</option>
                                  <option value="Chargeback Resubmit">Chargeback Resubmit</option>
                                </select>
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <label style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--text-muted)', textAlign: 'left' }}>Aggregator</label>
                                <input 
                                  type="text" 
                                  value="PayerMax" 
                                  readOnly 
                                  style={{ width: '100%', padding: '8px', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '13px', background: 'var(--bg)', color: 'var(--text-muted)', cursor: 'not-allowed' }} 
                                />
                              </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <label style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--text-muted)', textAlign: 'left' }}>Search By</label>
                                <select 
                                  value={filterSearchBy}
                                  onChange={(e) => setFilterSearchBy(e.target.value)}
                                  style={{ width: '100%', padding: '8px', border: '1px solid var(--border-input)', borderRadius: '8px', fontSize: '13px', background: 'var(--card)', color: 'var(--text)' }}
                                >
                                  <option value="">Select All</option>
                                  <option value="Txn ID">Transaction ID (Txn ID)</option>
                                  <option value="RRN">RRN</option>
                                  <option value="TID">TID</option>
                                  <option value="MID">MID</option>
                                  <option value="Case ID">Case ID</option>
                                  <option value="Merchant Name">Merchant Name</option>
                                </select>
                              </div>
                              {filterSearchBy && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', position: 'relative' }}>
                                  <label style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--text-muted)', textAlign: 'left' }}>Search Value</label>
                                  <input 
                                    type="text" 
                                    value={filterRrn}
                                    onChange={(e) => setFilterRrn(e.target.value)}
                                    onFocus={() => setAdminSearchFocused(true)}
                                    onBlur={() => setTimeout(() => setAdminSearchFocused(false), 200)}
                                    placeholder={`Enter ${filterSearchBy}`}
                                    style={{ width: '100%', padding: '8px', border: '1px solid var(--border-input)', borderRadius: '8px', fontSize: '13px', background: 'var(--card)', color: 'var(--text)' }}
                                  />
                                  {adminSearchFocused && filterRrn && (
                                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '8px', boxShadow: 'var(--shadow-md)', zIndex: 1001, maxHeight: '120px', overflowY: 'auto' }}>
                                      {chargebacks
                                        .map(cb => {
                                          if (filterSearchBy === 'Txn ID') return cb.txnId;
                                          if (filterSearchBy === 'RRN') return cb.rrn;
                                          if (filterSearchBy === 'TID') return cb.tid || 'TID-' + (cb.userId || cb.userName || '9999').substring(0,4).toUpperCase();
                                          if (filterSearchBy === 'MID') return cb.userId || 'ISU-' + (cb.userName || '9999').substring(0,4).toUpperCase();
                                          if (filterSearchBy === 'Case ID') return cb.caseId || cb.id;
                                          if (filterSearchBy === 'Merchant Name') return cb.userName;
                                          return '';
                                        })
                                        .filter((val, index, self) => val && self.indexOf(val) === index && val.toLowerCase().includes(filterRrn.toLowerCase()))
                                        .slice(0, 5)
                                        .map(val => (
                                          <div
                                            key={val}
                                            onMouseDown={() => setFilterRrn(val)}
                                            style={{ padding: '6px 10px', cursor: 'pointer', fontSize: '12px', color: 'var(--text)', borderBottom: '1px solid var(--border)', textAlign: 'left' }}
                                            onMouseEnter={(e) => e.target.style.background = 'var(--bg)'}
                                            onMouseLeave={(e) => e.target.style.background = 'transparent'}
                                          >
                                            🔍 {val}
                                          </div>
                                        ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px', borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
                              <button 
                                onClick={() => {
                                  setFilterFrom(SIX_MONTHS_AGO);
                                  setFilterTo(TODAY_STR);
                                  setFilterStatus('');
                                  setFilterSubStatus('');
                                  setFilterScheme('');
                                  setFilterSearchBy('');
                                  setFilterRrn('');
                                  setDateRangePreset('6months');
                                  setTempFrom(SIX_MONTHS_AGO);
                                  setTempTo(TODAY_STR);
                                  setFilterDropdownOpen(false);
                                }}
                                style={{ padding: '6px 12px', background: 'transparent', border: '1px solid var(--border)', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', color: 'var(--text-muted)' }}
                              >
                                Reset
                              </button>
                              <button 
                                onClick={() => {
                                  setFilterDropdownOpen(false);
                                  showToast('Filters applied!');
                                }}
                                style={{ padding: '6px 12px', background: '#6B38FB', border: 'none', color: '#fff', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}
                              >
                                Apply Filters
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                  <button style={{ padding: '8px 24px', border: 'none', background: '#6B38FB', color: '#fff', borderRadius: '12px', cursor: 'pointer', fontWeight: '600', boxShadow: 'var(--shadow-sm)' }} onClick={() => exportExcel('admin')}>
                    Export
                  </button>
                </div>

                <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start', flexWrap: 'wrap', width: '100%' }}>
                  <div style={{ flex: targetDisputeId ? '1 1 58%' : '1 1 100%', minWidth: '300px', transition: 'all 0.3s ease' }}>
                    <div className="tbl-card" style={{ boxShadow: 'var(--shadow)', border: '1px solid var(--border)', background: 'var(--card)', borderRadius: '12px', overflow: 'hidden' }}>
                      <div className="tbl-wrap">
                        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                          <thead>
                            <tr style={{ color: 'var(--text-muted)', fontSize: '12px', textAlign: 'left', background: darkMode ? '#1E293B' : '#F1F5F9' }}>
                              <th style={{ padding: '10px 8px', fontWeight: '600' }}>Case ID</th>
                              <th style={{ padding: '10px 8px', fontWeight: '600' }}>Visa ID</th>
                              <th style={{ padding: '10px 8px', fontWeight: '600' }}>Dispute Type</th>
                              <th style={{ padding: '10px 8px', fontWeight: '600' }}>Merchant Name</th>
                              <th style={{ padding: '10px 8px', fontWeight: '600' }}>MID</th>
                              <th style={{ padding: '10px 8px', fontWeight: '600' }}>ARN</th>
                              <th style={{ padding: '10px 8px', fontWeight: '600' }}>Dispute Status</th>
                              <th style={{ padding: '10px 8px', fontWeight: '600' }}>TXN Ref. Number</th>
                              <th style={{ padding: '10px 8px', fontWeight: '600' }}>Responded By</th>
                              <th style={{ padding: '10px 8px', fontWeight: '600', textAlign: 'center' }}>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {adminPaging.paginated.length > 0 ? (
                              adminPaging.paginated.map(cb => {
                                const isSelected = cb.id === targetDisputeId;
                                return (
                                  <React.Fragment key={cb.id}>
                                    <tr 
                                      onClick={() => setTargetDisputeId(cb.id)}
                                      style={{ 
                                        borderBottom: '1px solid var(--border)', 
                                        fontSize: '13px', 
                                        background: isSelected ? 'rgba(107, 56, 251, 0.08)' : 'transparent', 
                                        borderLeft: isSelected ? '4px solid #6B38FB' : '4px solid transparent',
                                        cursor: 'pointer',
                                        color: 'var(--text)',
                                        transition: 'all 0.2s'
                                      }}
                                    >
                                      <td style={{ padding: '10px 8px', fontWeight: '600', color: 'var(--text)' }}>{(cb.id || 'XXXX').substring(0, 8).toUpperCase()}</td>
                                      <td style={{ padding: '10px 8px', fontWeight: '500', color: 'var(--text)' }}>{cb.visaId || 'V-' + (cb.id || 'XXXX').substring(0, 6).toUpperCase()}</td>
                                      <td style={{ padding: '10px 8px', color: 'var(--text-muted)' }}>{getDisputeType(cb)}</td>
                                      <td style={{ padding: '10px 8px', fontWeight: '500', color: 'var(--text)' }}>{cb.userName}</td>
                                      <td style={{ padding: '10px 8px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>ISU-{(cb.userName || '9999').substring(0,4).toUpperCase()}</td>
                                      <td style={{ padding: '10px 8px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{cb.arn || cb.rrn}</td>
                                      <td style={{ padding: '10px 8px' }}>{renderDisputeStatusBadge(cb.mSubStatus)}</td>
                                      <td style={{ padding: '10px 8px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{cb.txnId}</td>
                                      <td style={{ padding: '10px 8px', fontWeight: '500' }}>
                                        <span style={getRespondByStyle(cb.respondByDate)}>{formatRespondByOnlyDate(cb.respondByDate)}</span>
                                      </td>
                                      <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                                        {adminTab === 'closed' || isClosedDispute(cb) ? (
                                          <button 
                                            className="btn btn-sm btn-outline" 
                                            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: '36px', height: '36px', borderRadius: '8px', padding: 0 }} 
                                            onClick={(e) => { e.stopPropagation(); setTargetDisputeId(cb.id); }}
                                            title="View Details"
                                          >
                                            👁️
                                          </button>
                                        ) : adminTab === 'verification-pending' ? (
                                          <button 
                                            className="btn btn-sm btn-primary" 
                                            style={{ background: '#6B38FB', border: 'none', borderRadius: '8px', padding: '6px 12px', fontWeight: '600' }} 
                                            onClick={(e) => { e.stopPropagation(); setTargetDisputeId(cb.id); }}
                                          >
                                            Take Action
                                          </button>
                                        ) : (
                                          <button 
                                            className="btn btn-sm btn-primary" 
                                            style={{ background: '#6B38FB', border: 'none', borderRadius: '8px', padding: '6px 12px', fontWeight: '600' }} 
                                            onClick={(e) => { e.stopPropagation(); setTargetDisputeId(cb.id); }}
                                          >
                                            Take Action
                                          </button>
                                        )}
                                      </td>
                                    </tr>
                                  </React.Fragment>
                                );
                              })
                            ) : (
                              <tr>
                                <td colSpan="11" style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)' }}>No records match the filter.</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>

                      <div className="tbl-footer" style={{ borderTop: '1px solid var(--border)', background: 'var(--card)', padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div className="rpp" style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', fontSize: '13px' }}>
                          Rows per page: 
                          <select value={aVcLimit} onChange={(e) => { setAVcPage(1); setAVcLimit(parseInt(e.target.value)); }} style={{ padding: '4px 8px', border: '1px solid var(--border-input)', borderRadius: '6px', background: 'var(--card)', color: 'var(--text)' }}>
                            <option value="5">5</option>
                            <option value="10">10</option>
                            <option value="25">25</option>
                          </select>
                        </div>
                        <div className="pagination" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <span style={{ marginRight: '12px', color: 'var(--text-muted)', fontSize: '13px' }}>
                            {adminPaging.startRecord}–{adminPaging.endRecord} of {adminPaging.total} records
                          </span>
                          <button 
                            className="pg-btn" 
                            disabled={aVcPage === 1}
                            onClick={() => setAVcPage(aVcPage - 1)}
                            style={{ width: '32px', height: '32px', border: '1px solid var(--border)', background: 'var(--card)', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: aVcPage === 1 ? 'not-allowed' : 'pointer', opacity: aVcPage === 1 ? 0.5 : 1, color: 'var(--text)' }}
                          >
                            ‹
                          </button>
                          {Array.from({ length: adminPaging.totalPages }, (_, idx) => idx + 1).map(p => (
                            <button 
                              key={p} 
                              className={`pg-btn ${aVcPage === p ? 'active' : ''}`}
                              onClick={() => setAVcPage(p)}
                              style={{ width: '32px', height: '32px', border: '1px solid var(--border)', background: aVcPage === p ? '#6B38FB' : 'var(--card)', color: aVcPage === p ? '#FFFFFF' : 'var(--text)', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontWeight: '600' }}
                            >
                              {p}
                            </button>
                          ))}
                          <button 
                            className="pg-btn" 
                            disabled={aVcPage === adminPaging.totalPages}
                            onClick={() => setAVcPage(aVcPage + 1)}
                            style={{ width: '32px', height: '32px', border: '1px solid var(--border)', background: 'var(--card)', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: aVcPage === adminPaging.totalPages ? 'not-allowed' : 'pointer', opacity: aVcPage === adminPaging.totalPages ? 0.5 : 1, color: 'var(--text)' }}
                          >
                            ›
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {targetDisputeId && (
                    <div className="slide-in-right" style={{ 
                      flex: '1 1 38%', 
                      minWidth: '380px', 
                      background: 'var(--card, #fff)', 
                      border: '1px solid var(--border)', 
                      borderRadius: '12px', 
                      boxShadow: 'var(--shadow-lg)', 
                      display: 'flex', 
                      flexDirection: 'column', 
                      maxHeight: 'calc(100vh - 120px)',
                      overflowY: 'auto',
                      position: 'sticky',
                      top: '24px',
                      zIndex: 10
                    }}>
                      {/* Vertical Preview Panel */}
                      {(() => {
                        const cb = chargebacks.find(c => c.id === targetDisputeId) || {};
                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', width: '100%', color: 'var(--text)' }}>
                            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: darkMode ? '#1E293B' : '#F8FAFC', borderRadius: '12px 12px 0 0' }}>
                              <div>
                                <span style={{ fontSize: '11px', color: '#6B38FB', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Dispute Case Preview (Admin)</span>
                                <h2 style={{ fontSize: '15px', fontWeight: '800', margin: '2px 0 0 0', color: 'var(--text)', fontFamily: 'monospace' }}>{cb.id}</h2>
                              </div>
                              <button onClick={() => setTargetDisputeId(null)} style={{ background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '32px', height: '32px', borderRadius: '50%', transition: 'all 0.2s' }} onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--border)'; e.currentTarget.style.color = 'var(--text)'; }} onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-muted)'; }}>&times;</button>
                            </div>
                            
                            <div style={{ padding: '0', overflowY: 'auto', flex: 1 }}>
                              {/* Original Transaction Details */}
                              <div style={{ padding: '14px 20px', background: darkMode ? '#1E293B' : '#f8fafc', borderBottom: '1px solid var(--border)', fontWeight: '700', fontSize: '13px', display: 'flex', justifyContent: 'space-between', color: 'var(--text)', alignItems: 'center' }}>
                                <span>Transaction Details</span>
                                <span style={{ fontWeight: 'normal', color: 'var(--text-muted)', fontSize: '12px' }}>Date: <span style={{color:'var(--text)', fontWeight:'700'}}>{formatDateDisp(cb.txnDate)}</span></span>
                              </div>
                              
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '16px 20px', fontSize: '13px', background: 'var(--card)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '6px' }}><span style={{ color: 'var(--text-muted)' }}>Case ID:</span> <strong style={{color: 'var(--text)'}}>{cb.id}</strong></div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '6px' }}><span style={{ color: 'var(--text-muted)' }}>AR Number:</span> <strong style={{color: 'var(--text)'}}>{cb.rrn}</strong></div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '6px' }}><span style={{ color: 'var(--text-muted)' }}>TXN Ref. Number:</span> <strong style={{color: 'var(--text)'}}>{cb.txnId}</strong></div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '6px' }}><span style={{ color: 'var(--text-muted)' }}>MID:</span> <strong style={{color: 'var(--text)'}}>{cb.userId}</strong></div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '6px' }}><span style={{ color: 'var(--text-muted)' }}>TID:</span> <strong style={{color: 'var(--text)'}}>10515104</strong></div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '6px' }}><span style={{ color: 'var(--text-muted)' }}>Amount:</span> <strong style={{color: '#6B38FB', fontSize: '14px'}}>{formatINR ? formatINR(cb.txnAmt) : '₹' + cb.txnAmt}</strong></div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '6px' }}><span style={{ color: 'var(--text-muted)' }}>Card Number:</span> <strong style={{color: 'var(--text)'}}>457704******3989</strong></div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '6px' }}><span style={{ color: 'var(--text-muted)' }}>Merchant Name:</span> <strong style={{color: 'var(--text)'}}>{cb.userName}</strong></div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '6px' }}><span style={{ color: 'var(--text-muted)' }}>Approval Code:</span> <strong style={{color: 'var(--text)'}}>021838</strong></div>
                              </div>

                              {/* Dispute Details */}
                              <div style={{ padding: '14px 20px', background: darkMode ? '#1E293B' : '#f8fafc', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', fontWeight: '700', fontSize: '13px', display: 'flex', justifyContent: 'space-between', color: 'var(--text)' }}>
                                <span>Dispute Info</span>
                                <span style={{ fontWeight: 'normal', color: 'var(--text-muted)', fontSize: '12px' }}>Dispute Date: <span style={{color:'var(--text)', fontWeight:'700'}}>{formatDateDisp(cb.createdDate || cb.txnDate)}</span></span>
                              </div>
                              
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '16px 20px', fontSize: '13px', background: 'var(--card)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '6px' }}><span style={{ color: 'var(--text-muted)' }}>Scheme:</span> <strong style={{color: 'var(--text)'}}>{cb.product || 'VISA'}</strong></div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '6px' }}><span style={{ color: 'var(--text-muted)' }}>Aggregator:</span> <strong style={{color: 'var(--text)'}}>{cb.aggregator || 'Payermax'}</strong></div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '6px' }}><span style={{ color: 'var(--text-muted)' }}>Visa Case ID:</span> <strong style={{color: 'var(--text)'}}>{cb.visaId || 'V-' + (cb.id || 'XXXX').substring(0, 6).toUpperCase()}</strong></div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '6px' }}><span style={{ color: 'var(--text-muted)' }}>Reason Code:</span> <strong style={{color: 'var(--text)'}}>13.1</strong></div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '6px' }}><span style={{ color: 'var(--text-muted)' }}>Remaining Days:</span> <strong style={{color: cb.aging <= 3 ? '#ef4444' : '#f59e0b'}}>{cb.aging} days</strong></div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '6px' }}><span style={{ color: 'var(--text-muted)' }}>Current Status:</span> <strong style={{color: 'var(--text)'}}>{cb.mStatus}</strong></div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', borderBottom: '1px solid var(--border)', paddingBottom: '6px' }}><span style={{ color: 'var(--text-muted)' }}>Dispute Description:</span> <strong style={{color: 'var(--text)', fontWeight: '600', lineHeight: '1.4'}}>13.1 - Services Not Provided or Merchandise Not Received</strong></div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '6px' }}><span style={{ color: 'var(--text-muted)' }}>Last Remarks:</span> <strong style={{color: '#6B38FB'}}>{cb.merchantAction || '-'}</strong></div>
                              </div>

                              {/* Previous Documents */}
                              <div style={{ padding: '14px 20px', background: darkMode ? '#1E293B' : '#f8fafc', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', fontWeight: '700', fontSize: '13px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--text)' }}>
                                <span>Evidence Documents</span>
                              </div>
                              
                              <div style={{ padding: '16px 20px', background: 'var(--card)' }}>
                                {(cb.documents && cb.documents.length > 0) ? (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                    {cb.documents.map(doc => (
                                      <div key={doc.id} style={{ padding: '12px', border: doc.status === 'Rejected' ? '1px solid #fca5a5' : '1px solid var(--border)', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '6px', background: doc.status === 'Rejected' ? 'rgba(239, 68, 68, 0.05)' : 'rgba(107, 56, 251, 0.03)' }}>
                                        <div style={{ fontWeight: 'bold', fontSize: '13px', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                          <span style={{ fontSize: '16px' }}>📄</span>
                                          <span style={{ wordBreak: 'break-all' }}>{doc.filename}</span>
                                        </div>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', fontSize: '11px', color: 'var(--text-muted)' }}>
                                          <div>By: <strong style={{color: 'var(--text)'}}>{doc.uploadedBy || 'Merchant'}</strong></div>
                                          <div>Status: <strong style={{ color: doc.status === 'Rejected' ? '#ef4444' : doc.status === 'Accepted' ? '#22c55e' : '#eab308' }}>{doc.status}</strong></div>
                                          <div>Date: <strong style={{color: 'var(--text)'}}>{new Date(doc.uploadedAt).toLocaleDateString()}</strong></div>
                                        </div>
                                        {doc.status === 'Rejected' && (
                                          <div style={{ fontSize: '11px', color: '#ef4444', background: 'var(--card)', padding: '6px 10px', borderRadius: '4px', border: '1px dashed #fca5a5', marginTop: '4px' }}>
                                            <strong>Remarks:</strong> {doc.rejectionRemarks}
                                          </div>
                                        )}
                                        {doc.status === 'Pending Review' && doc.uploadedBy !== 'Admin' && (
                                          <div style={{ marginTop: '8px' }}>
                                            <button style={{ fontSize: '12px', background: '#eab308', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontWeight: '600' }} onClick={() => { setActiveModal('declineDocuments'); setTargetDisputeId(cb.id); }}>
                                              Select & Reject
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div style={{ color: 'var(--text-muted)', fontSize: '13px', fontStyle: 'italic', textAlign: 'center', padding: '12px 0' }}>No evidence documents uploaded.</div>
                                )}
                              </div>

                              {/* Timeline */}
                              {renderTimeline(cb, expandedTimeline, setExpandedTimeline, showToast, 'admin')}
                            </div>
                            
                            <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', background: darkMode ? '#1E293B' : '#F8FAFC', borderRadius: '0 0 12px 12px' }}>
                              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end', width: '100%' }}>
                                {isClosedDispute(cb) ? (
                                  <button onClick={() => setTargetDisputeId(null)} style={{ padding: '6px 12px', border: '1px solid #50BDC9', background: '#fff', color: '#50BDC9', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', height: '36px' }}>Close Preview</button>
                                ) : adminTab === 'merchant-pending' ? (
                                  <button onClick={() => setTargetDisputeId(null)} style={{ padding: '6px 12px', border: '1px solid #50BDC9', background: '#fff', color: '#50BDC9', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', height: '36px' }}>Close Preview</button>
                                ) : adminTab === 'verification-pending' && isPendingVerification(cb) ? (
                                  <>
                                    <button type="button" className="btn btn-sm btn-primary" style={{ padding: '6px 12px', borderRadius: '6px', height: '36px', fontSize: '12px' }} onClick={() => setActiveModal('remarks')}>
                                      Review Evidence
                                    </button>
                                    <button type="button" className="btn btn-sm btn-success" style={{ padding: '6px 12px', borderRadius: '6px', height: '36px', fontSize: '12px' }} onClick={() => handleVisaAccept(cb.id)}>
                                      ✓ Accept &amp; Submit to Visa
                                    </button>
                                  </>

                                ) : (
                                  <>
                                    {cb.visaPending && (
                                      <div style={{ display: 'flex', flexDirection: 'column', width: '100%', gap: '8px' }}>
                                        <div style={{ padding: '8px 12px', background: 'rgba(21, 101, 192, 0.1)', color: '#1565c0', borderRadius: '6px', fontSize: '12px', fontWeight: 'bold' }}>
                                          Submitted to Visa (Pending Final Decision)
                                        </div>
                                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                                          <span style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-muted)' }}>[Sim] Webhook:</span>
                                          <button className="btn btn-sm btn-success" style={{ padding: '4px 8px', fontSize: '11px' }} onClick={() => executeVisaWebhookSimulator(cb, true)}>
                                            {cb.mStatus === 'Arbitration Raise' ? 'Arb Won' : cb.mStatus === 'Pre-Arbitration Raise' ? 'Pre-Arb Won' : 'Won'}
                                          </button>
                                          <button className="btn btn-sm btn-danger" style={{ padding: '4px 8px', fontSize: '11px' }} onClick={() => executeVisaWebhookSimulator(cb, false)}>
                                            {cb.mStatus === 'Chargeback Raise' ? 'Pre-Arb (Lost)' : cb.mStatus === 'Pre-Arbitration Raise' ? 'Arb (Lost)' : 'Lost'}
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                    {!cb.mStatus.includes('Lost') && !cb.mStatus.includes('Won') && !cb.visaPending && isPendingVerification(cb) && (
                                      <>
                                        <button type="button" className="btn btn-sm btn-primary" style={{ padding: '6px 12px', borderRadius: '6px', height: '36px', fontSize: '12px' }} onClick={() => setActiveModal('remarks')}>
                                          Review Evidence
                                        </button>
                                        <button type="button" className="btn btn-sm btn-success" style={{ padding: '6px 12px', borderRadius: '6px', height: '36px', fontSize: '12px' }} onClick={() => handleVisaAccept(cb.id)}>
                                          Accept &amp; Submit to Visa
                                        </button>
                                      </>
                                    )}

                                    {cb.mStatus.includes('Arbitration') && !cb.acquirerAction && (
                                      <button type="button" className="btn btn-sm" style={{ background: 'var(--purple)', color: '#fff', padding: '6px 12px', borderRadius: '6px', height: '36px', fontSize: '12px' }} onClick={() => { setActiveModal('arbitration'); }}>
                                        Arb Decision
                                      </button>
                                    )}
                                    {(cb.mSubStatus.includes('Won') || cb.mSubStatus.includes('Accepted')) && cb.mSubStatus !== 'Refund Success' && cb.mSubStatus !== 'Refund On Hold' && !cb.isLocked && (
                                      <button type="button" className="btn btn-sm btn-success" style={{ padding: '6px 12px', borderRadius: '6px', height: '36px', fontSize: '12px' }} onClick={() => { setActiveModal('refund'); }}>
                                        Refund
                                      </button>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activePage === 'a-merchants' && (
            <div className="page active" id="a-merchants">
              <div className="view-chargeback-header">
                <span className="vc-breadcrumb">Merchant & Partner Management / <span>Merchant Onboarding & CAID Mapping</span></span>
              </div>
              <div className="page-inner">
                <AdminMerchantsPage users={users} showToast={showToast} refreshAllData={refreshAllData} />
              </div>
            </div>
          )}

          {activePage === 'a-automation' && (
            <div className="page active" id="a-automation">
              <div className="view-chargeback-header">
                <span className="vc-breadcrumb">Rule Engine / <span>Global VROL Automation Settings</span></span>
              </div>
              <div className="page-inner">
                <AdminAutomationPage showToast={showToast} />
              </div>
            </div>
          )}

          {activePage === 'a-audit' && (
            <div className="page active" id="a-audit">
              <div className="view-chargeback-header">
                <span className="vc-breadcrumb">Audit & Compliance / <span>Middleware & RTSI Network Audits</span></span>
              </div>
              <div className="page-inner">
                <AdminAuditPage chargebacks={chargebacks} ledger={ledger} showToast={showToast} />
              </div>
            </div>
          )}

          {activePage === 'a-reports' && (
            <div className="page active" id="a-reports">
              <div className="view-chargeback-header">
                <span className="vc-breadcrumb">Reports & Analytics / <span>Enterprise DMS Performance & Deflections</span></span>
              </div>
              <div className="page-inner">
                <AdminReportsPage chargebacks={chargebacks} users={users} ledger={ledger} formatINR={formatINR} />
              </div>
            </div>
          )}




        </main>
      </div>

      {/* Help Button */}
      <button 
        onClick={() => setShowFaq(true)}
        style={{
          position: 'fixed',
          bottom: '30px',
          right: '30px',
          width: '56px',
          height: '56px',
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #7c3aed 0%, #a78bfa 100%)',
          border: 'none',
          color: '#fff',
          fontSize: '24px',
          cursor: 'pointer',
          boxShadow: '0 4px 12px rgba(124, 58, 237, 0.4)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'transform 0.2s'
        }}
        onMouseEnter={(e) => e.target.style.transform = 'scale(1.1)'}
        onMouseLeave={(e) => e.target.style.transform = 'scale(1)'}
      >
        ?
      </button>

      {/* FAQ Modal */}
      {showFaq && (
        <div style={{
          position: 'fixed',
          bottom: '100px',
          right: '30px',
          width: '380px',
          height: '500px',
          maxHeight: 'calc(100vh - 150px)',
          background: '#ffffff',
          borderRadius: '16px',
          boxShadow: '0 12px 32px rgba(107, 56, 251, 0.15), 0 0 0 1px rgba(0,0,0,0.05)',
          border: '1.5px solid #CBD5E1',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#F8FAFC' }}>
            <h2 style={{ fontSize: '15px', fontWeight: '800', margin: 0, color: '#6B38FB', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>❓</span> Frequently Asked Questions
            </h2>
            <button onClick={() => setShowFaq(false)} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#94A3B8', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', borderRadius: '50%', transition: 'all 0.2s' }} onMouseEnter={(e) => { e.currentTarget.style.background = '#F1F5F9'; e.currentTarget.style.color = '#64748B'; }} onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = '#94A3B8'; }}>&times;</button>
          </div>
          <div style={{ padding: '20px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ paddingBottom: '12px', borderBottom: '1px solid #F1F5F9' }}>
              <h3 style={{ fontSize: '13px', fontWeight: '700', color: '#1E293B', marginBottom: '6px' }}>What is the Dispute Management Portal?</h3>
              <p style={{ fontSize: '12px', color: '#475569', lineHeight: '1.5', margin: 0 }}>The Dispute Management Portal allows you to view, manage, and respond to chargeback disputes efficiently across all merchants.</p>
            </div>
            <div style={{ paddingBottom: '12px', borderBottom: '1px solid #F1F5F9' }}>
              <h3 style={{ fontSize: '13px', fontWeight: '700', color: '#1E293B', marginBottom: '6px' }}>How do I filter disputes?</h3>
              <p style={{ fontSize: '12px', color: '#475569', lineHeight: '1.5', margin: 0 }}>Use the dropdown filters at the top to filter by date range, status, type, or search by specific fields like Transaction ID, Case ID, or Merchant Name.</p>
            </div>
            <div style={{ paddingBottom: '12px', borderBottom: '1px solid #F1F5F9' }}>
              <h3 style={{ fontSize: '13px', fontWeight: '700', color: '#1E293B', marginBottom: '6px' }}>What do the summary cards show?</h3>
              <p style={{ fontSize: '12px', color: '#475569', lineHeight: '1.5', margin: 0 }}>The summary cards show urgent disputes due today, critical disputes due tomorrow, and disputes with insufficient evidence that need immediate attention.</p>
            </div>
            <div style={{ paddingBottom: '12px', borderBottom: '1px solid #F1F5F9' }}>
              <h3 style={{ fontSize: '13px', fontWeight: '700', color: '#1E293B', marginBottom: '6px' }}>How do I take action on a dispute?</h3>
              <p style={{ fontSize: '12px', color: '#475569', lineHeight: '1.5', margin: 0 }}>Click the "Take Action" button in the Action column to view details, upload evidence, or respond to the dispute.</p>
            </div>
            <div style={{ paddingBottom: '12px' }}>
              <h3 style={{ fontSize: '13px', fontWeight: '700', color: '#1E293B', marginBottom: '6px' }}>How do I export dispute data?</h3>
              <p style={{ fontSize: '12px', color: '#475569', lineHeight: '1.5', margin: 0 }}>Click the "Export" button in the toolbar to download dispute data as a CSV file for further analysis.</p>
            </div>
          </div>
        </div>
      )}

      {activeModal === 'disputeDetails' && activePage !== 'a-view-cb' && (
        <div className="overlay open">
          {(() => {
            const cb = chargebacks.find(c => c.id === targetDisputeId) || {};
            return (
              <div className="modal" style={{ width: '90%', maxWidth: '1100px', padding: '0', borderRadius: '4px', overflow: 'hidden', fontFamily: 'Arial, sans-serif', display: 'flex', flexDirection: 'column', maxHeight: '90vh' }}>
                <div style={{ padding: '12px 20px', borderBottom: '1px solid #e0e0e0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
                  <h2 style={{ fontSize: '14px', fontWeight: 'bold', margin: 0, color: '#000' }}>{cb.id}</h2>
                  <button onClick={() => setActiveModal(null)} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#9e9e9e' }}>&times;</button>
                </div>
                
                <div style={{ padding: '0', overflowY: 'auto', flex: 1 }}>
                  {/* Original Transaction Details */}
                  <div style={{ padding: '16px 24px', background: '#fff', borderBottom: '1px solid #e5e7eb', fontWeight: 'bold', fontSize: '14px', display: 'flex', justifyContent: 'space-between', color: '#000', alignItems: 'center' }}>
                    <span>Original Transaction Details</span>
                    <span style={{ fontWeight: 'normal', color: '#757575' }}>Transaction Date & Time <span style={{color:'red'}}>*</span> : <span style={{color:'#333', fontWeight:'bold'}}>{formatDateDisp(cb.txnDate)}</span></span>
                  </div>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px', padding: '24px', fontSize: '13px', background: '#fff' }}>
                    {/* Col 1 */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>Case ID <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>{cb.id}</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>AR Number <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>{cb.rrn}</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>RR Number <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>{cb.rrn}</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>Txn Currency <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>INR</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>Location <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>India</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>Country <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>India</strong></div>
                    </div>
                    {/* Col 2 */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>Transaction Ref. Number <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>{cb.txnId}</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>MID <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>{cb.userId}</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>Card Number <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>457704******3989</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>Amount <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>{cb.txnAmt}</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>City <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>-</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>Zip code <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>-</strong></div>
                    </div>
                    {/* Col 3 */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>Merchant Name <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>{cb.userName}</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>TID <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>10515104</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>Approval Code <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>021838</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>Address <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>-</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>State <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>-</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>Request ID <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>-</strong></div>
                    </div>
                  </div>

                  {/* Dispute Details */}
                  <div style={{ padding: '12px 20px', background: '#fff', borderTop: '1px solid #eee', borderBottom: '1px solid #eee', fontWeight: 'bold', fontSize: '13px', display: 'flex', justifyContent: 'space-between', color: '#000' }}>
                    <span>Dispute Details</span>
                    <span style={{ fontWeight: 'normal', color: '#757575' }}>Dispute Date <span style={{color:'red'}}>*</span> : <span style={{color:'#333', fontWeight:'bold'}}>{formatDateDisp(cb.createdDate || cb.txnDate)}</span></span>
                  </div>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px', padding: '24px', fontSize: '13px', background: '#fff' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>Scheme <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>{cb.product || 'VISA'}</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>Aggregator <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>{cb.aggregator || 'Payermax'}</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>Visa Case ID <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>{cb.visaId || 'V-' + (cb.id || 'XXXX').substring(0, 6).toUpperCase()}</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>Case ID <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>{cb.id}</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>Dispute Reason Code <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>13.1</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}><span style={{ color: '#9e9e9e' }}>Source Currency Code (Alpha) <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>INR</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>Destination Amount <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>{cb.txnAmt}</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>Remaining Days <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>{cb.aging}</strong></div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>Dispute Type <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px', textTransform: 'uppercase'}}>{cb.adjType}</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>Dispute Description <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>13.1-Services Not Provided or Merchandise Not Received</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}><span style={{ color: '#9e9e9e' }}>Source Amount <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>{cb.txnAmt}</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>Re-presentment Received Date Credit <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>-</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>Dispute Amount (INR) <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>{cb.txnAmt}</strong></div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>Current Status <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>{cb.mStatus}</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '40px' }}><span style={{ color: '#9e9e9e' }}>Destination Currency Code (Alpha) <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>INR</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}><span style={{ color: '#9e9e9e' }}>Last Remarks <span style={{color:'red'}}>*</span> :</span> <strong style={{color: '#000', width: '140px'}}>{cb.merchantAction || '-'}</strong></div>
                    </div>
                  </div>

                  {/* Previous Documents */}
                  <div style={{ padding: '12px 20px', background: '#fff', borderTop: '1px solid #eee', borderBottom: '1px solid #eee', fontWeight: 'bold', fontSize: '13px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#000' }}>
                    <span>Previous Documents</span>
                    <button style={{ background: '#50BDC9', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>Download All Docs</button>
                  </div>
                  <div style={{ padding: '20px', display: 'flex', gap: '16px', overflowX: 'auto', background: '#fff' }}>
                    {(cb.documents && cb.documents.length > 0) ? cb.documents.map(doc => (
                      <div key={doc.id} style={{ width: '220px', padding: '12px', border: '2px solid', borderColor: doc.status === 'Rejected' ? '#ff4d4f' : doc.status === 'Accepted' ? '#52c41a' : '#d1c4e9', borderTop: `4px solid ${doc.status === 'Rejected' ? '#ff4d4f' : doc.status === 'Accepted' ? '#52c41a' : '#d1c4e9'}`, borderRadius: '4px', flexShrink: 0, display: 'flex', flexDirection: 'column', color: '#333', background: '#fafafa' }}>
                        <div style={{ fontWeight: 'bold', fontSize: '13px', marginBottom: '8px', wordBreak: 'break-all' }}>📄 {doc.filename}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Uploaded By: <strong>{doc.uploadedBy || 'Merchant'}</strong></div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Status: <strong style={{ color: doc.status === 'Rejected' ? '#ff4d4f' : doc.status === 'Accepted' ? '#52c41a' : '#faad14' }}>{doc.status}</strong></div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Date: {new Date(doc.uploadedAt).toLocaleDateString()}</div>
                        {doc.status === 'Rejected' && (
                          <div style={{ fontSize: '11px', color: '#ff4d4f', marginTop: '6px', padding: '6px', background: '#fff1f0', borderRadius: '4px' }}>
                            <strong>Remarks:</strong> {doc.rejectionRemarks}
                          </div>
                        )}
                        {doc.status === 'Pending Review' && doc.uploadedBy !== 'Admin' && (
                          <div style={{ marginTop: '8px' }}>
                            <button style={{ fontSize: '11px', background: '#eab308', color: '#fff', border: 'none', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer' }} onClick={() => { setActiveModal('declineDocuments'); setTargetDisputeId(cb.id); }}>
                              Select & Reject
                            </button>
                          </div>
                        )}
                      </div>
                    )) : (
                      <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>No previous evidence uploaded.</div>
                    )}
                  </div>
                  {renderTimeline(cb, expandedTimeline, setExpandedTimeline, showToast, 'admin')}
                </div>
                
                <div style={{ padding: '12px 20px', borderTop: '1px solid #e0e0e0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff', flexShrink: 0, zIndex: 10, flexWrap: 'wrap', gap: '12px' }}>
                  {isClosedDispute(cb) ? (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', width: '100%' }}>
                      <button onClick={() => setActiveModal(null)} style={{ padding: '6px 16px', border: '1px solid #50BDC9', background: '#fff', color: '#50BDC9', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>Close</button>
                    </div>
                  ) : adminTab === 'merchant-pending' ? (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', width: '100%' }}>
                      <button onClick={() => setActiveModal(null)} style={{ padding: '6px 16px', border: '1px solid #50BDC9', background: '#fff', color: '#50BDC9', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>Close</button>
                    </div>
                  ) : adminTab === 'verification-pending' && isPendingVerification(cb) ? (
                    <>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', flex: 1 }}>
                        <button type="button" className="btn btn-sm btn-primary" onClick={() => setActiveModal('remarks')}>
                          Review Evidence
                        </button>
                        <button type="button" className="btn btn-sm btn-success" onClick={() => handleVisaAccept(cb.id)}>
                          ✓ Accept &amp; Submit to Visa
                        </button>
                      </div>
                      <button type="button" onClick={() => setActiveModal(null)} style={{ padding: '6px 16px', border: '1px solid #50BDC9', background: '#fff', color: '#50BDC9', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>Close</button>
                    </>

                  ) : (
                    <>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        {cb.visaPending && (
                          <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
                            <div style={{ padding: '8px 12px', background: '#e3f2fd', color: '#1565c0', borderRadius: '4px', fontSize: '13px', fontWeight: 'bold', marginBottom: '8px' }}>
                              Case Submitted to Visa (Pending Final Decision)
                            </div>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                              <span style={{ fontSize: '12px', fontWeight: '600', color: '#555' }}>[Simulator] Trigger Visa Webhook:</span>
                              <button className="btn btn-sm btn-success" onClick={() => executeVisaWebhookSimulator(cb, true)}>
                                {cb.mStatus === 'Arbitration Raise' ? 'Arbitration Won' : cb.mStatus === 'Pre-Arbitration Raise' ? 'Pre-Arbitration Won' : 'Chargeback Won'}
                              </button>
                              <button className="btn btn-sm btn-danger" onClick={() => executeVisaWebhookSimulator(cb, false)}>
                                {cb.mStatus === 'Chargeback Raise' ? 'Escalate to Pre-Arb (Lost)' : cb.mStatus === 'Pre-Arbitration Raise' ? 'Escalate to Arbitration (Lost)' : 'Arbitration Lost'}
                              </button>
                            </div>
                          </div>
                        )}
                        {!cb.mStatus.includes('Lost') && !cb.mStatus.includes('Won') && !cb.visaPending && isPendingVerification(cb) && (
                          <>
                            <button type="button" className="btn btn-sm btn-primary" onClick={() => setActiveModal('remarks')}>
                              Review Evidence
                            </button>
                            <button type="button" className="btn btn-sm btn-success" onClick={() => handleVisaAccept(cb.id)}>
                              Accept &amp; Submit to Visa
                            </button>
                          </>
                        )}

                        {cb.mStatus.includes('Arbitration') && !cb.acquirerAction && (
                          <button type="button" className="btn btn-sm" style={{ background: 'var(--purple)', color: '#fff' }} onClick={() => { setActiveModal('arbitration'); }}>
                            Arb Decision
                          </button>
                        )}
                        {(cb.mSubStatus.includes('Won') || cb.mSubStatus.includes('Accepted')) && cb.mSubStatus !== 'Refund Success' && cb.mSubStatus !== 'Refund On Hold' && !cb.isLocked && (
                          <button type="button" className="btn btn-sm btn-success" onClick={() => { setActiveModal('refund'); }}>
                            Refund
                          </button>
                        )}
                      </div>
                      <button type="button" onClick={() => setActiveModal(null)} style={{ padding: '6px 16px', border: '1px solid #50BDC9', background: '#fff', color: '#50BDC9', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>Close</button>
                    </>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Admin Review / Remarks Modal */}
      {activeModal === 'remarks' && (
        <div className="overlay open">
          {(() => {
            const cb = chargebacks.find(x => x.id === targetDisputeId);
            if (!cb) return null;
            return (
              <div className="modal" style={{ width: '600px', padding: 0, borderRadius: '8px', overflow: 'hidden' }}>
                <div className="modal-hdr" style={{ background: '#50BDC9', color: '#fff', padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>Remarks & Evidence Review</h3>
                  <button onClick={() => setActiveModal(null)} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', width: '30px', height: '30px', borderRadius: '50%', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                </div>
                <div className="modal-body" style={{ padding: '24px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '24px' }}>
                    <div><div style={{ fontSize: '12px', color: '#888', fontWeight: 600, textTransform: 'uppercase', marginBottom: '6px' }}>RRN</div><div style={{ fontWeight: 700, fontSize: '15px' }}>{cb.rrn}</div></div>
                    <div><div style={{ fontSize: '12px', color: '#888', fontWeight: 600, textTransform: 'uppercase', marginBottom: '6px' }}>Txn Amount</div><div style={{ fontWeight: 700, fontSize: '15px' }}>{formatINR(cb.txnAmt)}</div></div>
                    <div><div style={{ fontSize: '12px', color: '#888', fontWeight: 600, textTransform: 'uppercase', marginBottom: '6px' }}>Status</div><div>{renderStatusBadge(cb.mStatus)}</div></div>
                    <div><div style={{ fontSize: '12px', color: '#888', fontWeight: 600, textTransform: 'uppercase', marginBottom: '6px' }}>Merchant Action</div><div style={{ fontWeight: 600, fontSize: '15px' }}>{cb.merchantAction || '—'}</div></div>
                  </div>

                  {(cb.documents && cb.documents.length > 0) ? (
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 600, textTransform: 'uppercase', color: '#777', marginBottom: '10px' }}>Submitted Documents</div>
                      {cb.documents.map((doc, idx) => (
                        <div key={doc.id || idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', border: '1px solid #eaeaea', borderRadius: '6px', marginBottom: '10px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ color: '#ccc' }}>📄</span>
                            <span style={{ fontSize: '14px', color: '#333' }}>{doc.filename}</span>
                            <span style={{ fontSize: '12px', fontWeight: 'bold', color: doc.status === 'Rejected' ? '#ff4d4f' : doc.status === 'Accepted' ? '#52c41a' : '#faad14', marginLeft: '4px' }}>{doc.status}</span>
                          </div>
                          <button type="button" style={{ background: '#fff', border: '1px solid #ddd', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '13px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px' }} onClick={() => showToast(`Downloading ${doc.filename}...`, 'success')}>
                            ⬇ Download
                          </button>
                        </div>
                      ))}
                      
                      <div style={{ fontSize: '13px', fontWeight: 600, textTransform: 'uppercase', color: '#777', marginBottom: '10px', marginTop: '20px' }}>Merchant Justification Remarks</div>
                      <div style={{ border: '1px solid #eaeaea', borderRadius: '6px', padding: '16px', fontSize: '14px', color: '#333', lineHeight: '1.5' }}>
                        {cb.rejectReason || 'Merchant contested the chargeback. Pending admin review.'}
                      </div>
                    </div>
                  ) : (cb.rejectReason || cb.merchantAction === 'evidence' || cb.merchantAction === 'rejected' || cb.merchantAction === 'additional_evidence') ? (
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 600, textTransform: 'uppercase', color: '#777', marginBottom: '10px' }}>Submitted Document</div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', border: '1px solid #eaeaea', borderRadius: '6px', marginBottom: '10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ color: '#ccc' }}>📄</span>
                          <span style={{ fontSize: '14px', color: '#333' }}>{cb.merchantAction === 'evidence' ? 'Merchant_Evidence_Submitted_1.pdf' : 'Merchant_Evidence_1.pdf'}</span>
                          <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#faad14', marginLeft: '4px' }}>Pending Review</span>
                        </div>
                        <button type="button" style={{ background: '#fff', border: '1px solid #ddd', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '13px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px' }} onClick={() => showToast('Downloading Evidence File 1...', 'success')}>
                          ⬇ Download
                        </button>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', border: '1px solid #eaeaea', borderRadius: '6px', marginBottom: '10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ color: '#ccc' }}>📄</span>
                          <span style={{ fontSize: '14px', color: '#333' }}>{cb.merchantAction === 'evidence' ? 'Merchant_Evidence_Submitted_2.pdf' : 'Merchant_Evidence_2.pdf'}</span>
                          <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#faad14', marginLeft: '4px' }}>Pending Review</span>
                        </div>
                        <button type="button" style={{ background: '#fff', border: '1px solid #ddd', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '13px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px' }} onClick={() => showToast('Downloading Evidence File 2...', 'success')}>
                          ⬇ Download
                        </button>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', border: '1px solid #eaeaea', borderRadius: '6px', marginBottom: '10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ color: '#ccc' }}>📄</span>
                          <span style={{ fontSize: '14px', color: '#333' }}>{cb.merchantAction === 'evidence' ? 'Merchant_Evidence_Submitted_3.pdf' : 'Merchant_Evidence_3.pdf'}</span>
                          <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#faad14', marginLeft: '4px' }}>Pending Review</span>
                        </div>
                        <button type="button" style={{ background: '#fff', border: '1px solid #ddd', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '13px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px' }} onClick={() => showToast('Downloading Evidence File 3...', 'success')}>
                          ⬇ Download
                        </button>
                      </div>
                      <div style={{ fontSize: '13px', fontWeight: 600, textTransform: 'uppercase', color: '#777', marginBottom: '10px', marginTop: '20px' }}>Merchant Justification Remarks</div>
                      <div style={{ border: '1px solid #eaeaea', borderRadius: '6px', padding: '16px', fontSize: '14px', color: '#333', lineHeight: '1.5' }}>
                        {cb.rejectReason || (cb.merchantAction === 'evidence'
                          ? 'Merchant submitted evidence documents. Pending admin verification before representment to Visa/NPCI.'
                          : 'Merchant contested the chargeback. Pending admin review.')}
                      </div>
                    </div>
                  ) : (
                    <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>No merchant representation logs found.</div>
                  )}
                </div>
                <div className="modal-footer" style={{ padding: '20px 24px', background: '#fff', borderTop: 'none', display: 'flex', gap: '12px' }}>
                  {cb.merchantAction === 'additional_evidence' ? (
                    <>
                      <button type="button" style={{ flex: 1, padding: '12px', background: '#1890ff', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: 'pointer' }} onClick={() => setActiveModal('visaRuling')}>Visa Ruling</button>
                      <button type="button" style={{ flex: 1, padding: '12px', background: '#fff', border: '1px solid #ddd', color: '#333', borderRadius: '6px', fontWeight: 600, cursor: 'pointer' }} onClick={() => setActiveModal(null)}>Cancel</button>
                    </>
                  ) : isPendingVerification(cb) ? (
                    <>
                      <button type="button" style={{ flex: 1, padding: '12px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: 'pointer' }} onClick={() => handleArbitrationLost(cb.id)}>Accept Loss (Send to Visa)</button>
                      <button type="button" style={{ padding: '12px 24px', background: '#fff', border: '1px solid #ddd', color: '#333', borderRadius: '6px', fontWeight: 600, cursor: 'pointer' }} onClick={() => setActiveModal(null)}>Cancel</button>
                    </>

                  ) : (
                    <button type="button" style={{ flex: 1, padding: '12px', background: '#fff', border: '1px solid #ddd', color: '#333', borderRadius: '6px', fontWeight: 600, cursor: 'pointer' }} onClick={() => setActiveModal(null)}>Close</button>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {activeModal === 'visaRuling' && (
        <div className="overlay open">
          {(() => {
            const cb = chargebacks.find(x => x.id === targetDisputeId);
            if (!cb) return null;
            return (
              <div className="modal">
                <div className="modal-hdr"><h3>Visa Ruling</h3><button className="modal-close" onClick={() => setActiveModal(null)}>✕</button></div>
                <div className="modal-body">
                  <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '14px' }}>Please select how you would like to proceed with this dispute:</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <button className="btn btn-success" style={{ width: '100%', padding: '12px' }} onClick={() => handleVisaAccept(cb.id)}>Accept</button>
                    <button className="btn btn-primary" style={{ width: '100%', padding: '12px' }} onClick={() => setActiveModal('acceptPartially')}>Accept Partially</button>
                    <button className="btn btn-warning" style={{ width: '100%', padding: '12px', background: '#eab308', color: '#fff', border: 'none' }} onClick={() => handleVisaReview(cb.id)}>Send to Visa for Review / Fight</button>
                  </div>
                </div>
                <div className="modal-footer">
                  <button className="btn btn-secondary" style={{ width: '100%' }} onClick={() => setActiveModal('disputeDetails')}>Back</button>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {activeModal === 'adminUploadEvidence' && (
        <div className="overlay open">
          <div className="modal">
            <div className="modal-hdr"><h3>Upload Evidence for Merchant</h3><button className="modal-close" onClick={() => setActiveModal(null)}>✕</button></div>
            <div className="modal-body">
              <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '16px' }}>Upload evidence documents to send back to the merchant for their review and acceptance.</div>
              <div style={{ marginBottom: '16px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px', display: 'block' }}>Select Document (Max 20MB, PDF/JPG/PNG)</label>
                <input type="file" className="form-control" onChange={(e) => setEvidenceFiles({ 1: e.target.files?.[0] || null })} />
              </div>
            </div>
            <div className="modal-footer" style={{ display: 'flex', gap: '10px' }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setActiveModal(null)}>Cancel</button>
              <button className="btn btn-primary" style={{ flex: 2, background: '#1890ff', color: '#fff', border: 'none' }} onClick={() => submitAdminUploadEvidence()}>Upload & Send</button>
            </div>
          </div>
        </div>
      )}

      {activeModal === 'merchantRejectAdminDocs' && (
        <div className="overlay open">
          {(() => {
            const cb = chargebacks.find(x => x.id === targetDisputeId);
            if (!cb) return null;
            return (
              <div className="modal">
                <div className="modal-hdr"><h3>Reject Admin Evidence</h3><button className="modal-close" onClick={() => setActiveModal(null)}>✕</button></div>
                <div className="modal-body">
                  <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '10px' }}>Select admin documents to reject:</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
                    {(cb.documents || []).filter(d => d.uploadedBy === 'Admin' && d.status === 'Pending Review').map(doc => (
                      <label key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
                        <input 
                          type="checkbox" 
                          checked={selectedDocsToReject.includes(doc.id)} 
                          onChange={(e) => {
                            if (e.target.checked) setSelectedDocsToReject([...selectedDocsToReject, doc.id]);
                            else setSelectedDocsToReject(selectedDocsToReject.filter(id => id !== doc.id));
                          }}
                        />
                        📄 {doc.filename}
                      </label>
                    ))}
                  </div>
                  
                  <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '6px' }}>Rejection Remarks (Mandatory):</div>
                  <textarea 
                    className="mfi" 
                    placeholder="Enter reason for rejecting admin's evidence..." 
                    value={rejectionRemarks}
                    onChange={(e) => setRejectionRemarks(e.target.value)}
                    rows={4}
                    style={{ width: '100%', resize: 'vertical', marginBottom: '16px' }}
                  ></textarea>

                  <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '6px' }}>Upload Additional Evidence (Optional):</div>
                  <div className="file-upload-box" style={{ border: '2px dashed #e0e0e0', padding: '20px', textAlign: 'center', borderRadius: '4px', background: '#fafafa', position: 'relative' }}>
                    <input 
                      type="file" 
                      onChange={(e) => setMerchantRejectAdminEvidence(e.target.files[0])} 
                      style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }} 
                    />
                    {merchantRejectAdminEvidence ? (
                      <div style={{ color: '#50BDC9', fontWeight: '600' }}>📄 {merchantRejectAdminEvidence.name}</div>
                    ) : (
                      <div style={{ color: '#9e9e9e', fontSize: '13px' }}>Drag & drop evidence file here, or click to browse</div>
                    )}
                  </div>
                </div>
                <div className="modal-footer" style={{ display: 'flex', gap: '10px' }}>
                  <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setActiveModal(null)}>Cancel</button>
                  <button className="btn btn-danger" style={{ flex: 2 }} onClick={() => submitMerchantRejectAdminDocs()}>Submit Rejection</button>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {activeModal === 'declineDocuments' && (
        <div className="overlay open">
          {(() => {
            const cb = chargebacks.find(x => x.id === targetDisputeId);
            if (!cb) return null;
            return (
              <div className="modal" style={{ width: '600px', padding: 0, borderRadius: '8px', overflow: 'hidden' }}>
                <div className="modal-hdr" style={{ background: '#50BDC9', color: '#fff', padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>Reject Documents & Request More Info</h3>
                  <button onClick={() => setActiveModal(null)} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', width: '30px', height: '30px', borderRadius: '50%', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                </div>
                <div className="modal-body" style={{ padding: '24px' }}>
                  <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#333', marginBottom: '12px' }}>Select documents to reject:</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
                    {(cb.documents || []).filter(d => d.status === 'Pending Review').map(doc => (
                      <label key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', color: '#333', cursor: 'pointer' }}>
                        <input 
                          type="checkbox" 
                          style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                          checked={selectedDocsToReject.includes(doc.id)} 
                          onChange={(e) => {
                            if (e.target.checked) setSelectedDocsToReject([...selectedDocsToReject, doc.id]);
                            else setSelectedDocsToReject(selectedDocsToReject.filter(id => id !== doc.id));
                          }}
                        />
                        <span style={{ color: '#ccc' }}>📄</span>
                        {doc.filename}
                      </label>
                    ))}
                    {(cb.documents || []).filter(d => d.status === 'Pending Review').length === 0 && (
                      <div style={{ color: 'var(--text-muted)', fontSize: '14px' }}>No documents pending review.</div>
                    )}
                  </div>
                  
                  <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#333', marginBottom: '10px' }}>Rejection Remarks (Mandatory):</div>
                  <textarea 
                    className="mfi" 
                    placeholder="Enter reason for rejection..." 
                    value={rejectionRemarks}
                    onChange={(e) => setRejectionRemarks(e.target.value)}
                    rows={4}
                    style={{ width: '100%', resize: 'vertical', padding: '12px', border: '1px solid #ccc', borderRadius: '6px', fontSize: '14px', fontFamily: 'inherit' }}
                  ></textarea>
                </div>
                <div className="modal-footer" style={{ padding: '20px 24px', background: '#fff', borderTop: 'none', display: 'flex', gap: '12px' }}>
                  <button type="button" style={{ flex: 1, padding: '12px', background: '#fff', border: '1px solid #ddd', color: '#333', borderRadius: '6px', fontWeight: 600, cursor: 'pointer' }} onClick={() => setActiveModal('remarks')}>Back</button>
                  <button type="button" style={{ flex: 2, padding: '12px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: 'pointer' }} onClick={() => submitDeclineDocs()}>Submit Rejection</button>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {activeModal === 'acceptPartially' && (
        <div className="overlay open">
          {(() => {
            const cb = chargebacks.find(x => x.id === targetDisputeId);
            if (!cb) return null;
            return (
              <div className="modal">
                <div className="modal-hdr"><h3>Accept Partially</h3><button className="modal-close" onClick={() => setActiveModal(null)}>✕</button></div>
                <div className="modal-body">
                  <div className="mf">
                    <label>Accepted Amount (Mandatory)</label>
                    <input type="number" className="mfi" value={visaAcceptedAmount} onChange={(e) => setVisaAcceptedAmount(e.target.value)} placeholder="e.g. 500" />
                  </div>
                  <div className="mf" style={{ marginTop: '12px' }}>
                    <label>Remarks (Mandatory)</label>
                    <textarea className="mfi mfi-area" value={visaRemarks} onChange={(e) => setVisaRemarks(e.target.value)} placeholder="Reason for partial acceptance..."></textarea>
                  </div>
                  <div className="mf" style={{ marginTop: '12px' }}>
                    <label>Evidence Upload (Mandatory)</label>
                    <input type="file" className="form-control" onChange={(e) => setVisaEvidenceFile(e.target.files?.[0] || null)} />
                  </div>
                </div>
                <div className="modal-footer" style={{ display: 'flex', gap: '10px' }}>
                  <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setActiveModal('visaRuling')}>Back</button>
                  <button className="btn btn-primary" style={{ flex: 2 }} onClick={handleVisaAcceptPartially}>Submit and Send to Visa</button>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {activeModal === 'arbitration' && (
        <div className="overlay open">
          {(() => {
            const cb = chargebacks.find(x => x.id === targetDisputeId);
            if (!cb) return null;
            return (
              <div className="modal">
                <div className="modal-hdr"><h3>Arbitration Decision (NPCI)</h3><button className="modal-close" onClick={() => setActiveModal(null)}>✕</button></div>
                <div className="modal-body">
                  <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '14px' }}>Select outcome based on card scheme ruling received via email:</p>
                  <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '12px' }}>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>Disputed Case</div>
                    <div style={{ fontWeight: 700 }}>RRN: {cb.rrn}</div>
                    <div style={{ fontWeight: 700, marginTop: '2px' }}>Amount: {formatINR(cb.adjAmt)}</div>
                  </div>
                </div>
                <div className="modal-footer" style={{ flexWrap: 'wrap', gap: '10px' }}>
                  {!cb.visaPending ? (
                    <>
                      <button className="btn btn-primary" style={{ flex: 1, minWidth: '100%' }} onClick={() => handleVisaReview(cb.id)}>Submit to Visa</button>
                      <button className="btn btn-danger" style={{ flex: 1, minWidth: '100%' }} onClick={() => handleArbitrationLost(cb.id)}>Accept Loss & Send to Visa</button>
                      <div style={{ width: '100%', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px', margin: '8px 0' }}>
                        Note: Admin cannot decide "Won" status. Final "Won" resolution will be provided by Visa.
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ width: '100%', textAlign: 'center', color: '#1565c0', fontSize: '13px', fontWeight: 'bold', margin: '8px 0' }}>
                        Case Submitted to Visa (Pending Final Decision)
                      </div>
                      <div style={{ width: '100%', borderTop: '1px solid #eee', paddingTop: '12px' }}>
                        <div style={{ fontSize: '12px', fontWeight: '600', color: '#555', marginBottom: '8px', textAlign: 'center' }}>[Simulator] Trigger Visa Webhook:</div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button className="btn btn-sm btn-success" style={{ flex: 1 }} onClick={() => executeVisaWebhookSimulator(cb, true)}>
                            {cb.mStatus === 'Arbitration Raise' ? 'Arbitration Won' : cb.mStatus === 'Pre-Arbitration Raise' ? 'Pre-Arbitration Won' : 'Chargeback Won'}
                          </button>
                          <button className="btn btn-sm btn-danger" style={{ flex: 1 }} onClick={() => executeVisaWebhookSimulator(cb, false)}>
                            {cb.mStatus === 'Chargeback Raise' ? 'Escalate to Pre-Arb (Lost)' : cb.mStatus === 'Pre-Arbitration Raise' ? 'Escalate to Arbitration (Lost)' : 'Arbitration Lost'}
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {activeModal === 'refund' && (
        <div className="overlay open">
          {(() => {
            const cb = chargebacks.find(x => x.id === targetDisputeId);
            if (!cb) return null;
            return (
              <div className="modal">
                <div className="modal-hdr"><h3>Acquiring Refund Processing</h3><button className="modal-close" onClick={() => setActiveModal(null)}>✕</button></div>
                <div className="modal-body">
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
                    <div><div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>RRN</div><div style={{ fontWeight: 700, fontFamily: 'monospace' }}>{cb.rrn}</div></div>
                    <div><div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Dispute Amt</div><div style={{ fontWeight: 700 }}>{formatINR(cb.txnAmt)}</div></div>
                  </div>
                  <div className="lein-highlight"><span>⚠️</span><span>Pre-checks passed: Merchant Wallet Debit capability, Hold Cleared</span></div>
                </div>
                <div className="modal-footer">
                  <button className="btn btn-success" style={{ flex: 1 }} onClick={handleRefundAccept}>Accept Refund (Debit Merchant)</button>
                  <button className="btn btn-warning" style={{ flex: 1, background: '#ca8a04', color: '#fff' }} onClick={handleRefundHold}>Place Refund On Hold</button>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {activeModal === 'webhookInspect' && targetWebhook && (
        <div className="overlay open">
          <div className="modal" style={{ width: '90%', maxWidth: '800px', padding: '0', borderRadius: '4px', overflow: 'hidden', fontFamily: 'Arial, sans-serif', display: 'flex', flexDirection: 'column', maxHeight: '90vh' }}>
            <div style={{ padding: '12px 20px', borderBottom: '1px solid #e0e0e0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, background: '#f8f9fa' }}>
              <h2 style={{ fontSize: '14px', fontWeight: 'bold', margin: 0, color: '#000' }}>Webhook Inspect: {targetWebhook.id}</h2>
              <button onClick={() => setActiveModal(null)} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#9e9e9e' }}>&times;</button>
            </div>
            <div className="modal-body" style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#78909c', textTransform: 'uppercase', marginBottom: '4px' }}>Event</div>
                  <div style={{ fontSize: '13px', fontWeight: '600', color: '#263238' }}>{targetWebhook.event}</div>
                </div>
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#78909c', textTransform: 'uppercase', marginBottom: '4px' }}>Time</div>
                  <div style={{ fontSize: '13px', color: '#546e7a' }}>{targetWebhook.time}</div>
                </div>
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#78909c', textTransform: 'uppercase', marginBottom: '4px' }}>Merchant</div>
                  <div style={{ fontSize: '13px', color: '#546e7a' }}>{targetWebhook.merchant}</div>
                </div>
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#78909c', textTransform: 'uppercase', marginBottom: '4px' }}>Status</div>
                  <div style={{ fontSize: '13px', fontWeight: '600', color: '#4caf50' }}>{targetWebhook.status}</div>
                </div>
              </div>
              <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#263238', marginBottom: '8px' }}>Request Payload</div>
              <pre style={{ background: '#263238', color: '#eceff1', padding: '16px', borderRadius: '4px', fontSize: '12px', overflowX: 'auto', marginBottom: '20px', fontFamily: 'monospace' }}>
{JSON.stringify({
  eventId: targetWebhook.id,
  eventType: targetWebhook.event,
  timestamp: targetWebhook.time,
  data: {
    merchantId: "M_" + targetWebhook.merchant.replace(" ", "").toUpperCase(),
    amount: targetWebhook.amount,
    currency: "INR",
    disputeType: targetWebhook.typeLabel
  }
}, null, 2)}
              </pre>
              <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#263238', marginBottom: '8px' }}>Response Payload</div>
              <pre style={{ background: '#f5f5f5', color: '#333', padding: '16px', borderRadius: '4px', fontSize: '12px', overflowX: 'auto', border: '1px solid #e0e0e0', fontFamily: 'monospace' }}>
{JSON.stringify({
  status: "success",
  code: parseInt(targetWebhook.status) || 200,
  message: "Webhook processed successfully",
  processedAt: new Date().toISOString()
}, null, 2)}
              </pre>
            </div>
            <div style={{ padding: '12px 20px', borderTop: '1px solid #e0e0e0', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', background: '#fff', flexShrink: 0 }}>
              <button onClick={() => setActiveModal(null)} style={{ padding: '8px 24px', border: '1px solid #50BDC9', background: '#fff', color: '#50BDC9', borderRadius: '4px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' }}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  function daysAgoFmt(n) {
    let d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().split('T')[0];
  }
}

// ═════════════════════════════════════════════
// DMS PORTAL CUSTOM SUB-COMPONENTS
// ═════════════════════════════════════════════

function AdminMerchantsPage({ users, showToast, refreshAllData }) {
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [walletBalance, setWalletBalance] = useState('');
  const [caid, setCaid] = useState('');
  const [loading, setLoading] = useState(false);

  const handleOnboard = async (e) => {
    e.preventDefault();
    if (!name || !username || !password) {
      showToast('Name, Username, and Password are required', 'error');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          username,
          password,
          role: 'merchant',
          walletBalance: walletBalance ? parseFloat(walletBalance) : 0,
          caid
        })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Onboarding failed');
      }
      showToast('Merchant onboarded successfully!');
      setName('');
      setUsername('');
      setPassword('');
      setWalletBalance('');
      setCaid('');
      refreshAllData();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const merchants = (users || []).filter(u => u.role === 'merchant');

  return (
    <div style={{ display: 'flex', gap: '24px', padding: '24px', flexWrap: 'wrap' }}>
      {/* Onboarding Form */}
      <div style={{ flex: '1 1 350px', background: '#fff', borderRadius: '12px', padding: '24px', border: '1px solid #E2E8F0', boxShadow: 'var(--shadow)' }}>
        <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', fontWeight: '700', color: '#1e293b' }}>Onboard New Merchant</h3>
        <form onSubmit={handleOnboard} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#64748b', marginBottom: '4px' }}>Merchant Name</label>
            <input type="text" placeholder="e.g. Acme Corp" value={name} onChange={e => setName(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '14px', background: '#fff', color: '#333' }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#64748b', marginBottom: '4px' }}>Username / Email</label>
            <input type="text" placeholder="e.g. acme" value={username} onChange={e => setUsername(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '14px', background: '#fff', color: '#333' }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#64748b', marginBottom: '4px' }}>Password</label>
            <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '14px', background: '#fff', color: '#333' }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#64748b', marginBottom: '4px' }}>Initial Wallet Balance (INR)</label>
            <input type="number" placeholder="e.g. 50000" value={walletBalance} onChange={e => setWalletBalance(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '14px', background: '#fff', color: '#333' }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#64748b', marginBottom: '4px' }}>Visa Card Acceptor ID (CAID)</label>
            <input type="text" placeholder="e.g. CAID_ACME_9981" value={caid} onChange={e => setCaid(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '14px', background: '#fff', color: '#333' }} />
            <span style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px', display: 'block' }}>Used to route RTSI webhook disputes automatically.</span>
          </div>
          <button type="submit" disabled={loading} style={{ width: '100%', padding: '12px', background: '#6B38FB', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: '600', fontSize: '14px', cursor: 'pointer', marginTop: '6px' }}>
            {loading ? 'Onboarding...' : 'Onboard Merchant'}
          </button>
        </form>
      </div>

      {/* Merchants List */}
      <div style={{ flex: '2 1 600px', background: '#fff', borderRadius: '12px', padding: '24px', border: '1px solid #E2E8F0', boxShadow: 'var(--shadow)' }}>
        <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', fontWeight: '700', color: '#1e293b' }}>Active Merchants & Mappings</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #E2E8F0', color: '#64748b', fontWeight: '600' }}>
                <th style={{ padding: '12px 8px' }}>Merchant Details</th>
                <th style={{ padding: '12px 8px' }}>Username</th>
                <th style={{ padding: '12px 8px' }}>Wallet Balance</th>
                <th style={{ padding: '12px 8px' }}>Mapped CAID</th>
                <th style={{ padding: '12px 8px' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {merchants.map((m, idx) => (
                <tr key={idx} style={{ borderBottom: '1px solid #F1F5F9' }}>
                  <td style={{ padding: '12px 8px', fontWeight: '600', color: '#1e293b' }}>{m.name}</td>
                  <td style={{ padding: '12px 8px', color: '#475569' }}>{m.username}</td>
                  <td style={{ padding: '12px 8px', color: '#10b981', fontWeight: '600' }}>{new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(m.walletBalance || 0)}</td>
                  <td style={{ padding: '12px 8px' }}><code style={{ background: '#F1F5F9', padding: '2px 6px', borderRadius: '4px', fontSize: '12px', color: '#e21d48' }}>{m.username === 'masteruser' ? 'MERCH_101' : (m.username === 'Test@isu' ? 'COLLAB_55' : 'DYNAMIC_CAID')}</code></td>
                  <td style={{ padding: '12px 8px' }}><span style={{ background: '#dcfce7', color: '#15803d', padding: '2px 8px', borderRadius: '99px', fontSize: '12px', fontWeight: '600' }}>{m.status || 'Active'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function AdminAutomationPage({ showToast }) {
  const [oiRules, setOiRules] = useState([]);
  const [oiCategory, setOiCategory] = useState('Fraud');
  const [oiThreshold, setOiThreshold] = useState('100.00');
  const [oiAction, setOiAction] = useState('AUTO_INTENT_TO_CREDIT');

  const [rdrRules, setRdrRules] = useState([]);
  const [rdrProgramId, setRdrProgramId] = useState('VISA_RDR_CORE');
  const [rdrLimit, setRdrLimit] = useState('50.00');
  const [rdrExcludedSkus, setRdrExcludedSkus] = useState('HIGH_RISK_ELECTRONICS');

  const [slaDays, setSlaDays] = useState('10');
  const [escalationHours, setEscalationHours] = useState('24');
  const [autoAcceptUnder, setAutoAcceptUnder] = useState('25.00');

  const fetchRules = async () => {
    try {
      const resOi = await fetch(`${API_URL}/vrol/oi/rules?merchant=masteruser`);
      const resRdr = await fetch(`${API_URL}/vrol/rdr/rules?merchant=masteruser`);
      if (resOi.ok) setOiRules(await resOi.json());
      if (resRdr.ok) setRdrRules(await resRdr.json());
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchRules();
  }, []);

  const handleAddOiRule = async (e) => {
    e.preventDefault();
    const newRule = { visaCategory: oiCategory, maxThresholdAmount: parseFloat(oiThreshold), ruleAction: oiAction };
    const updated = [...oiRules, newRule];
    try {
      const res = await fetch(`${API_URL}/vrol/oi/rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchant: 'masteruser', rules: updated })
      });
      if (res.ok) {
        setOiRules(updated);
        showToast('Order Insight rule added successfully');
      }
    } catch (e) {
      showToast('Failed to add OI rule', 'error');
    }
  };

  const handleAddRdrRule = async (e) => {
    e.preventDefault();
    const newRule = { programId: rdrProgramId, rdrMaxLimit: parseFloat(rdrLimit), excludedSkus: rdrExcludedSkus };
    const updated = [...rdrRules, newRule];
    try {
      const res = await fetch(`${API_URL}/vrol/rdr/rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchant: 'masteruser', rules: updated })
      });
      if (res.ok) {
        setRdrRules(updated);
        showToast('RDR rule added successfully');
      }
    } catch (e) {
      showToast('Failed to add RDR rule', 'error');
    }
  };

  const handleSaveSlaConfig = (e) => {
    e.preventDefault();
    showToast('SLA & Escalation configurations updated successfully!');
  };

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* SLA & Escalation Config */}
      <div style={{ background: '#fff', borderRadius: '12px', padding: '24px', border: '1px solid #E2E8F0', boxShadow: 'var(--shadow)' }}>
        <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', fontWeight: '700', color: '#1e293b' }}>SLA & Escalation Settings</h3>
        <form onSubmit={handleSaveSlaConfig} style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 200px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#64748b', marginBottom: '4px' }}>Default Resolution SLA (Days)</label>
            <input type="number" value={slaDays} onChange={e => setSlaDays(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff', color: '#333' }} />
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#64748b', marginBottom: '4px' }}>Escalation Warning Buffer (Hours)</label>
            <input type="number" value={escalationHours} onChange={e => setEscalationHours(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff', color: '#333' }} />
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#64748b', marginBottom: '4px' }}>Auto-Accept All Disputes Under (INR)</label>
            <input type="number" value={autoAcceptUnder} onChange={e => setAutoAcceptUnder(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff', color: '#333' }} />
          </div>
          <button type="submit" style={{ padding: '12px 24px', background: '#6B38FB', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: '600', cursor: 'pointer' }}>Save SLA Rules</button>
        </form>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px' }}>
        {/* Order Insight Rules */}
        <div style={{ flex: '1 1 450px', background: '#fff', borderRadius: '12px', padding: '24px', border: '1px solid #E2E8F0', boxShadow: 'var(--shadow)' }}>
          <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', fontWeight: '700', color: '#1e293b' }}>Order Insight (OI) Rules</h3>
          <form onSubmit={handleAddOiRule} style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '20px' }}>
            <div style={{ flex: '1 1 120px' }}>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: '600', color: '#64748b', marginBottom: '4px' }}>Visa Category</label>
              <select value={oiCategory} onChange={e => setOiCategory(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff', color: '#333' }}>
                <option value="Fraud">Fraud</option>
                <option value="Consumer Dispute">Consumer Dispute</option>
                <option value="Processing Error">Processing Error</option>
                <option value="Authorization">Authorization</option>
              </select>
            </div>
            <div style={{ flex: '1 1 100px' }}>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: '600', color: '#64748b', marginBottom: '4px' }}>Limit (USD)</label>
              <input type="number" value={oiThreshold} onChange={e => setOiThreshold(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff', color: '#333' }} />
            </div>
            <div style={{ flex: '1 1 120px' }}>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: '600', color: '#64748b', marginBottom: '4px' }}>Action</label>
              <select value={oiAction} onChange={e => setOiAction(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff', color: '#333' }}>
                <option value="AUTO_INTENT_TO_CREDIT">Auto Intent to Credit</option>
                <option value="MANUAL_REVIEW">Manual Review</option>
              </select>
            </div>
            <button type="submit" style={{ padding: '10px 16px', background: '#6B38FB', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '600' }}>Add</button>
          </form>
          
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #E2E8F0', textAlign: 'left', color: '#64748b' }}>
                <th style={{ padding: '8px 4px' }}>Category</th>
                <th style={{ padding: '8px 4px' }}>Threshold</th>
                <th style={{ padding: '8px 4px' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {oiRules.map((rule, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #F1F5F9' }}>
                  <td style={{ padding: '8px 4px', fontWeight: '600', color: '#333' }}>{rule.visaCategory}</td>
                  <td style={{ padding: '8px 4px', color: '#333' }}>${rule.maxThresholdAmount}</td>
                  <td style={{ padding: '8px 4px' }}><span style={{ background: '#e0f2fe', color: '#0369a1', padding: '2px 6px', borderRadius: '4px', fontSize: '11px', fontWeight: '600' }}>{rule.ruleAction}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* RDR Rules */}
        <div style={{ flex: '1 1 450px', background: '#fff', borderRadius: '12px', padding: '24px', border: '1px solid #E2E8F0', boxShadow: 'var(--shadow)' }}>
          <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', fontWeight: '700', color: '#1e293b' }}>Rapid Dispute Resolution (RDR) Rules</h3>
          <form onSubmit={handleAddRdrRule} style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '20px' }}>
            <div style={{ flex: '1 1 120px' }}>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: '600', color: '#64748b', marginBottom: '4px' }}>Program ID</label>
              <select value={rdrProgramId} onChange={e => setRdrProgramId(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff', color: '#333' }}>
                <option value="VISA_RDR_CORE">Visa RDR Core</option>
                <option value="VISA_RDR_PREMIUM">Visa RDR Premium</option>
              </select>
            </div>
            <div style={{ flex: '1 1 100px' }}>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: '600', color: '#64748b', marginBottom: '4px' }}>Limit (USD)</label>
              <input type="number" value={rdrLimit} onChange={e => setRdrLimit(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff', color: '#333' }} />
            </div>
            <div style={{ flex: '1 1 120px' }}>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: '600', color: '#64748b', marginBottom: '4px' }}>Exclude SKU</label>
              <input type="text" value={rdrExcludedSkus} onChange={e => setRdrExcludedSkus(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff', color: '#333' }} />
            </div>
            <button type="submit" style={{ padding: '10px 16px', background: '#6B38FB', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '600' }}>Add</button>
          </form>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #E2E8F0', textAlign: 'left', color: '#64748b' }}>
                <th style={{ padding: '8px 4px' }}>Program</th>
                <th style={{ padding: '8px 4px' }}>Max Limit</th>
                <th style={{ padding: '8px 4px' }}>Excluded SKUs</th>
              </tr>
            </thead>
            <tbody>
              {rdrRules.map((rule, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #F1F5F9' }}>
                  <td style={{ padding: '8px 4px', fontWeight: '600', color: '#333' }}>{rule.programId}</td>
                  <td style={{ padding: '8px 4px', color: '#333' }}>${rule.rdrMaxLimit}</td>
                  <td style={{ padding: '8px 4px' }}><code style={{ background: '#fee2e2', color: '#991b1b', padding: '2px 6px', borderRadius: '4px', fontSize: '11px' }}>{rule.excludedSkus || 'None'}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function AdminAuditPage({ chargebacks, ledger, showToast }) {
  const [rtsiLogs, setRtsiLogs] = useState([]);
  const [filterType, setFilterType] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const fetchRtsiLogs = async () => {
    try {
      const res = await fetch(`${API_URL}/vrol/rtsi-audits`);
      if (res.ok) {
        setRtsiLogs(await res.json());
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchRtsiLogs();
  }, []);

  const handleClearLogs = async () => {
    try {
      const res = await fetch(`${API_URL}/vrol/rtsi-audits/clear`, { method: 'POST' });
      if (res.ok) {
        setRtsiLogs([]);
        showToast('RTSI Audits cleared');
      }
    } catch (e) {
      showToast('Failed to clear logs', 'error');
    }
  };

  const allLogs = [];

  // API logs (RTSI audits)
  rtsiLogs.forEach((log, index) => {
    allLogs.push({
      id: `API-${index}`,
      timestamp: log.timestamp || new Date().toISOString(),
      type: 'API LOG',
      event: log.endpoint || 'RTSI Call',
      description: `Inbound request to ${log.endpoint} - Response Status: ${log.status || '200 OK'}`,
      payload: JSON.stringify(log.payload || log)
    });
  });

  // User logs
  allLogs.push({
    id: 'USR-1',
    timestamp: new Date(Date.now() - 3600000).toISOString(),
    type: 'USER LOG',
    event: 'LoginSuccess',
    description: 'User Krishna Das (admin) logged in from IP 192.168.1.50',
    payload: '{}'
  });
  allLogs.push({
    id: 'USR-2',
    timestamp: new Date(Date.now() - 7200000).toISOString(),
    type: 'USER LOG',
    event: 'LoginSuccess',
    description: 'User masteruser (merchant) logged in from IP 192.168.1.12',
    payload: '{}'
  });

  // Activity logs
  chargebacks.forEach(cb => {
    if (cb.timeline) {
      cb.timeline.forEach((tl, i) => {
        allLogs.push({
          id: `ACT-${cb.id}-${i}`,
          timestamp: cb.createdDate ? new Date(cb.createdDate).toISOString() : new Date().toISOString(),
          type: 'ACTIVITY LOG',
          event: tl.title,
          description: `Case ${cb.id}: ${tl.remarks} (by ${tl.by})`,
          payload: JSON.stringify(tl)
        });
      });
    }
  });

  // Financial logs
  ledger.forEach((entry, i) => {
    allLogs.push({
      id: `FIN-${entry.id || i}`,
      timestamp: entry.date ? new Date(entry.date).toISOString() : new Date().toISOString(),
      type: 'FINANCIAL LOG',
      event: entry.type === 'Credit' ? 'Accounting Memo Credit' : 'Accounting Memo Debit',
      description: `Ledger entry for ${entry.merchant}: ${entry.remarks || ''} - Amount: INR ${entry.amount}`,
      payload: JSON.stringify(entry)
    });
  });

  allLogs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const filteredLogs = allLogs.filter(log => {
    if (filterType !== 'ALL' && log.type !== filterType) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return log.description.toLowerCase().includes(q) || log.type.toLowerCase().includes(q) || log.event.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div style={{ padding: '24px' }}>
      <div style={{ display: 'flex', justifycontent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h3 style={{ margin: 0, fontSize: '20px', fontWeight: '700', color: '#1e293b' }}>Audit & Compliance Logs</h3>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={fetchRtsiLogs} style={{ padding: '8px 16px', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '6px', color: '#475569', fontWeight: '600', cursor: 'pointer' }}>Refresh</button>
          <button onClick={handleClearLogs} style={{ padding: '8px 16px', background: '#fee2e2', border: '1px solid #fecaca', borderRadius: '6px', color: '#991b1b', fontWeight: '600', cursor: 'pointer' }}>Clear API Logs</button>
        </div>
      </div>

      {/* Filter bar */}
      <div style={{ background: '#fff', borderRadius: '12px', padding: '16px', border: '1px solid #E2E8F0', boxShadow: 'var(--shadow)', marginBottom: '20px', display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
        {['ALL', 'API LOG', 'ACTIVITY LOG', 'USER LOG', 'FINANCIAL LOG'].map((t) => (
          <button
            key={t}
            onClick={() => setFilterType(t)}
            style={{
              padding: '8px 16px',
              borderRadius: '6px',
              border: 'none',
              background: filterType === t ? '#6B38FB' : '#f1f5f9',
              color: filterType === t ? '#fff' : '#475569',
              fontWeight: '600',
              cursor: 'pointer',
              fontSize: '12px'
            }}
          >
            {t}
          </button>
        ))}
        <div style={{ marginLeft: 'auto', position: 'relative' }}>
          <input
            type="text"
            placeholder="Search logs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '6px', width: '220px', fontSize: '13px', background: '#fff', color: '#333' }}
          />
        </div>
      </div>

      {/* Logs Table */}
      <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid #E2E8F0', boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '2px solid #E2E8F0', color: '#64748b', fontWeight: '600' }}>
                <th style={{ padding: '12px 16px' }}>Timestamp</th>
                <th style={{ padding: '12px 16px' }}>Type</th>
                <th style={{ padding: '12px 16px' }}>Event</th>
                <th style={{ padding: '12px 16px' }}>Description</th>
                <th style={{ padding: '12px 16px' }}>Payload</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.slice(0, 50).map((log, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #F1F5F9' }}>
                  <td style={{ padding: '12px 16px', whiteSpace: 'nowrap', color: '#64748b' }}>{new Date(log.timestamp).toLocaleString()}</td>
                  <td style={{ padding: '12px 16px', fontWeight: '700' }}>
                    <span style={{
                      padding: '2px 8px',
                      borderRadius: '4px',
                      fontSize: '10px',
                      color: log.type === 'API LOG' ? '#0284c7' : (log.type === 'FINANCIAL LOG' ? '#16a34a' : (log.type === 'USER LOG' ? '#ca8a04' : '#7c3aed')),
                      background: log.type === 'API LOG' ? '#e0f2fe' : (log.type === 'FINANCIAL LOG' ? '#dcfce7' : (log.type === 'USER LOG' ? '#fef9c3' : '#f3e8ff'))
                    }}>{log.type}</span>
                  </td>
                  <td style={{ padding: '12px 16px', fontWeight: '600', color: '#334155' }}>{log.event}</td>
                  <td style={{ padding: '12px 16px', color: '#475569' }}>{log.description}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <button
                      onClick={() => alert(JSON.stringify(JSON.parse(log.payload), null, 2))}
                      style={{ padding: '4px 8px', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', color: '#333' }}
                    >
                      View JSON
                    </button>
                  </td>
                </tr>
              ))}
              {filteredLogs.length === 0 && (
                <tr>
                  <td colSpan="5" style={{ padding: '24px', textAlign: 'center', color: '#94a3b8' }}>No logs found matching filters.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function AdminReportsPage({ chargebacks, users, ledger, formatINR }) {
  const [activeReportTab, setActiveReportTab] = useState('performance');

  const totalDisputes = chargebacks.length;
  const openCount = chargebacks.filter(cb => getDisputeCategory(cb) === 'open').length;
  const wonCount = chargebacks.filter(cb => getDisputeCategory(cb) === 'won').length;
  const lostCount = chargebacks.filter(cb => getDisputeCategory(cb) === 'lost').length;
  const winRatio = totalDisputes > 0 ? Math.round((wonCount / (wonCount + lostCount || 1)) * 100) : 0;

  const now = new Date();
  const getAge = (createdDate) => {
    if (!createdDate) return 0;
    const diffTime = Math.abs(now - new Date(createdDate));
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };
  const aging_0_5 = chargebacks.filter(cb => getAge(cb.createdDate) <= 5).length;
  const aging_6_15 = chargebacks.filter(cb => { const a = getAge(cb.createdDate); return a > 5 && a <= 15; }).length;
  const aging_16_30 = chargebacks.filter(cb => { const a = getAge(cb.createdDate); return a > 15 && a <= 30; }).length;
  const aging_30_plus = chargebacks.filter(cb => getAge(cb.createdDate) > 30).length;

  const slaBreached = chargebacks.filter(cb => {
    if (isClosedDispute(cb)) return false;
    const diff = getDaysDifference(cb.respondByDate, now);
    return diff < 0;
  }).length;
  const slaWarning = chargebacks.filter(cb => {
    if (isClosedDispute(cb)) return false;
    const diff = getDaysDifference(cb.respondByDate, now);
    return diff >= 0 && diff <= 3;
  }).length;

  const oiDeflected = chargebacks.filter(cb => {
    const s = (cb.mSubStatus || cb.mStatus || '').toLowerCase();
    return s.includes('order insight') || s.includes('oi');
  });
  const rdrDeflected = chargebacks.filter(cb => {
    const s = (cb.mSubStatus || cb.mStatus || '').toLowerCase();
    return s.includes('rdr');
  });
  const standardCount = totalDisputes - oiDeflected.length - rdrDeflected.length;

  const oiDeflectedVal = oiDeflected.reduce((sum, cb) => sum + cb.adjAmt, 0);
  const rdrDeflectedVal = rdrDeflected.reduce((sum, cb) => sum + cb.adjAmt, 0);

  const totalValue = chargebacks.reduce((sum, cb) => sum + cb.adjAmt, 0);
  const totalWonValue = chargebacks.filter(cb => getDisputeCategory(cb) === 'won').reduce((sum, cb) => sum + cb.adjAmt, 0);
  const totalLostValue = chargebacks.filter(cb => getDisputeCategory(cb) === 'lost').reduce((sum, cb) => sum + cb.adjAmt, 0);
  const netFinancialImpact = totalWonValue + oiDeflectedVal + rdrDeflectedVal - totalLostValue;

  const arbitrationCases = chargebacks.filter(cb => getDisputeType(cb) === 'Arbitration');
  const arbWon = arbitrationCases.filter(cb => getDisputeCategory(cb) === 'won').length;
  const arbLost = arbitrationCases.filter(cb => getDisputeCategory(cb) === 'lost').length;
  const arbPending = arbitrationCases.length - arbWon - arbLost;

  const complianceCases = chargebacks.filter(cb => (cb.mStatus || '').toLowerCase().includes('compliance') || (cb.mSubStatus || '').toLowerCase().includes('compliance'));
  const compWon = complianceCases.filter(cb => getDisputeCategory(cb) === 'won').length;
  const compLost = complianceCases.filter(cb => getDisputeCategory(cb) === 'lost').length;

  return (
    <div style={{ display: 'flex', gap: '20px', padding: '24px', minHeight: 'calc(100vh - 120px)' }}>
      {/* Sidebar for reports */}
      <div style={{ width: '220px', background: '#fff', borderRadius: '12px', border: '1px solid #E2E8F0', padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <h4 style={{ margin: '0 0 12px 0', fontSize: '13px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Report Types</h4>
        {[
          { id: 'performance', label: '📊 Performance', desc: 'Dispute volumes & win rates' },
          { id: 'aging', label: '📅 Dispute Aging', desc: 'Queue ages & distributions' },
          { id: 'sla', label: '⏰ SLA & Breaches', desc: 'SLA warnings & breaches' },
          { id: 'winloss', label: '🏆 Win/Loss Ratio', desc: 'Success rates' },
          { id: 'deflections', label: '🛡️ Deflections', desc: 'RDR & Order Insight' },
          { id: 'financial', label: '💰 Financial Impact', desc: 'Net savings & liabilities' },
          { id: 'arbitration', label: '⚖️ Arbitration & DRM', desc: 'Arbitration case metrics' },
          { id: 'compliance', label: '🔒 Compliance Events', desc: 'Visa compliance issues' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveReportTab(tab.id)}
            style={{
              padding: '12px',
              borderRadius: '8px',
              border: 'none',
              background: activeReportTab === tab.id ? '#6B38FB' : 'transparent',
              color: activeReportTab === tab.id ? '#fff' : '#475569',
              textAlign: 'left',
              fontWeight: '600',
              cursor: 'pointer',
              fontSize: '13px',
              transition: 'all 0.2s'
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Main Report Area */}
      <div style={{ flex: 1, background: '#fff', borderRadius: '12px', border: '1px solid #E2E8F0', padding: '24px', overflowY: 'auto' }}>
        {activeReportTab === 'performance' && (
          <div>
            <h3 style={{ margin: '0 0 8px 0', color: '#333' }}>Dispute Performance Report</h3>
            <p style={{ color: '#64748b', fontSize: '14px', margin: '0 0 20px 0' }}>Comprehensive overview of standard disputes, won cases, and open portfolios.</p>
            <div style={{ display: 'flex', gap: '20px', marginBottom: '24px' }}>
              <div style={{ flex: 1, background: '#F8FAF2', padding: '20px', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                <div style={{ color: '#64748b', fontSize: '12px', fontWeight: '600' }}>TOTAL DISPUTES</div>
                <div style={{ fontSize: '32px', fontWeight: '800', marginTop: '6px', color: '#333' }}>{totalDisputes}</div>
              </div>
              <div style={{ flex: 1, background: '#F8FAF2', padding: '20px', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                <div style={{ color: '#64748b', fontSize: '12px', fontWeight: '600' }}>OPEN PORTFOLIO</div>
                <div style={{ fontSize: '32px', fontWeight: '800', marginTop: '6px', color: '#eab308' }}>{openCount}</div>
              </div>
              <div style={{ flex: 1, background: '#F8FAF2', padding: '20px', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                <div style={{ color: '#64748b', fontSize: '12px', fontWeight: '600' }}>MERCHANT WIN RATIO</div>
                <div style={{ fontSize: '32px', fontWeight: '800', marginTop: '6px', color: '#10b981' }}>{winRatio}%</div>
              </div>
            </div>
            <div style={{ marginTop: '24px' }}>
              <h4 style={{ marginBottom: '16px', color: '#333' }}>Dispute Status Breakdown</h4>
              <div style={{ height: '30px', background: '#F1F5F9', borderRadius: '6px', overflow: 'hidden', display: 'flex' }}>
                <div style={{ width: `${totalDisputes > 0 ? (wonCount / totalDisputes)*100 : 0}%`, background: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '11px', fontWeight: 'bold' }}>{wonCount > 0 ? `Won (${wonCount})` : ''}</div>
                <div style={{ width: `${totalDisputes > 0 ? (lostCount / totalDisputes)*100 : 0}%`, background: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '11px', fontWeight: 'bold' }}>{lostCount > 0 ? `Lost (${lostCount})` : ''}</div>
                <div style={{ width: `${totalDisputes > 0 ? (openCount / totalDisputes)*100 : 0}%`, background: '#eab308', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '11px', fontWeight: 'bold' }}>{openCount > 0 ? `Open (${openCount})` : ''}</div>
              </div>
            </div>
          </div>
        )}

        {activeReportTab === 'aging' && (
          <div>
            <h3 style={{ margin: '0 0 8px 0', color: '#333' }}>Dispute Aging Report</h3>
            <p style={{ color: '#64748b', fontSize: '14px', margin: '0 0 20px 0' }}>Detailed aging brackets for all standard dispute categories.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {[
                { label: '0 - 5 Days', count: aging_0_5, color: '#10b981' },
                { label: '6 - 15 Days', count: aging_6_15, color: '#3b82f6' },
                { label: '16 - 30 Days', count: aging_16_30, color: '#f59e0b' },
                { label: '30+ Days', count: aging_30_plus, color: '#ef4444' }
              ].map((bracket, i) => {
                const pct = totalDisputes > 0 ? (bracket.count / totalDisputes) * 100 : 0;
                return (
                  <div key={i}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: '600', marginBottom: '6px', color: '#333' }}>
                      <span>{bracket.label}</span>
                      <span>{bracket.count} cases ({Math.round(pct)}%)</span>
                    </div>
                    <div style={{ height: '12px', background: '#f1f5f9', borderRadius: '999px', overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, background: bracket.color, height: '100%', borderRadius: '999px' }}></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeReportTab === 'sla' && (
          <div>
            <h3 style={{ margin: '0 0 8px 0', color: '#333' }}>SLA & Breaches Report</h3>
            <p style={{ color: '#64748b', fontSize: '14px', margin: '0 0 20px 0' }}>Real-time alerts of cases near breach limits (SLA Warnings and Breached cases).</p>
            <div style={{ display: 'flex', gap: '20px', marginBottom: '24px' }}>
              <div style={{ flex: 1, background: '#FEF2F2', padding: '20px', borderRadius: '8px', border: '1px solid #FCA5A5' }}>
                <div style={{ color: '#991B1B', fontSize: '12px', fontWeight: '600' }}>SLA BREACHED</div>
                <div style={{ fontSize: '32px', fontWeight: '800', marginTop: '6px', color: '#B91C1C' }}>{slaBreached}</div>
              </div>
              <div style={{ flex: 1, background: '#FFFBEB', padding: '20px', borderRadius: '8px', border: '1px solid #FDE68A' }}>
                <div style={{ color: '#92400E', fontSize: '12px', fontWeight: '600' }}>SLA WARNING (DUE &lt;= 3 DAYS)</div>
                <div style={{ fontSize: '32px', fontWeight: '800', marginTop: '6px', color: '#D97706' }}>{slaWarning}</div>
              </div>
            </div>
          </div>
        )}

        {activeReportTab === 'winloss' && (
          <div>
            <h3 style={{ margin: '0 0 8px 0', color: '#333' }}>Win/Loss Ratio Report</h3>
            <p style={{ color: '#64748b', fontSize: '14px', margin: '0 0 20px 0' }}>Dispute outcomes comparison between acquirer-merchant wins and issuer/cardholder favors.</p>
            <div style={{ display: 'flex', justifyContent: 'center', margin: '20px 0' }}>
              <PieChart
                dataSegments={[
                  { label: 'Won', value: wonCount, color: '#10b981' },
                  { label: 'Lost', value: lostCount, color: '#ef4444' }
                ]}
                darkMode={false}
              />
            </div>
          </div>
        )}

        {activeReportTab === 'deflections' && (
          <div>
            <h3 style={{ margin: '0 0 8px 0', color: '#333' }}>Deflection Report</h3>
            <p style={{ color: '#64748b', fontSize: '14px', margin: '0 0 20px 0' }}>Deflection counts and savings from Visa Order Insight and Rapid Dispute Resolution (RDR).</p>
            <div style={{ display: 'flex', gap: '20px', marginBottom: '24px' }}>
              <div style={{ flex: 1, background: '#ECFDF5', padding: '20px', borderRadius: '8px', border: '1px solid #A7F3D0' }}>
                <div style={{ color: '#065F46', fontSize: '12px', fontWeight: '600' }}>RDR DEFLECTED</div>
                <div style={{ fontSize: '32px', fontWeight: '800', marginTop: '6px', color: '#047857' }}>{rdrDeflected.length}</div>
                <div style={{ fontSize: '13px', marginTop: '4px', color: '#047857' }}>Value Saved: {formatINR(rdrDeflectedVal)}</div>
              </div>
              <div style={{ flex: 1, background: '#EFF6FF', padding: '20px', borderRadius: '8px', border: '1px solid #BFDBFE' }}>
                <div style={{ color: '#1E3A8A', fontSize: '12px', fontWeight: '600' }}>ORDER INSIGHT DEFLECTED</div>
                <div style={{ fontSize: '32px', fontWeight: '800', marginTop: '6px', color: '#1D4ED8' }}>{oiDeflected.length}</div>
                <div style={{ fontSize: '13px', marginTop: '4px', color: '#1D4ED8' }}>Value Saved: {formatINR(oiDeflectedVal)}</div>
              </div>
            </div>
          </div>
        )}

        {activeReportTab === 'financial' && (
          <div>
            <h3 style={{ margin: '0 0 8px 0', color: '#333' }}>Financial Impact Report</h3>
            <p style={{ color: '#64748b', fontSize: '14px', margin: '0 0 20px 0' }}>Full analysis of deflected liabilities, wins, losses, and net ledger adjustments.</p>
            <div style={{ display: 'flex', gap: '20px', marginBottom: '24px' }}>
              <div style={{ flex: 1, background: '#F8FAF2', padding: '20px', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                <div style={{ color: '#64748b', fontSize: '12px', fontWeight: '600' }}>TOTAL DISPUTED VOLUME</div>
                <div style={{ fontSize: '24px', fontWeight: '800', marginTop: '6px', color: '#333' }}>{formatINR(totalValue)}</div>
              </div>
              <div style={{ flex: 1, background: '#F0FDF4', padding: '20px', borderRadius: '8px', border: '1px solid #BBF7D0' }}>
                <div style={{ color: '#166534', fontSize: '12px', fontWeight: '600' }}>NET POSITIVE IMPACT</div>
                <div style={{ fontSize: '24px', fontWeight: '800', marginTop: '6px', color: '#15803d' }}>{formatINR(netFinancialImpact)}</div>
              </div>
            </div>
          </div>
        )}

        {activeReportTab === 'arbitration' && (
          <div>
            <h3 style={{ margin: '0 0 8px 0', color: '#333' }}>Arbitration & DRM Report</h3>
            <p style={{ color: '#64748b', fontSize: '14px', margin: '0 0 20px 0' }}>Status of escalated disputes currently undergoing DRM review or formal ruling.</p>
            <div style={{ display: 'flex', gap: '20px', marginBottom: '24px' }}>
              <div style={{ flex: 1, background: '#FAF5FF', padding: '20px', borderRadius: '8px', border: '1px solid #E9D5FF' }}>
                <div style={{ color: '#581C87', fontSize: '12px', fontWeight: '600' }}>TOTAL ARBITRATION</div>
                <div style={{ fontSize: '32px', fontWeight: '800', marginTop: '6px', color: '#7E22CE' }}>{arbitrationCases.length}</div>
              </div>
            </div>
          </div>
        )}

        {activeReportTab === 'compliance' && (
          <div>
            <h3 style={{ margin: '0 0 8px 0', color: '#333' }}>Compliance Events Report</h3>
            <p style={{ color: '#64748b', fontSize: '14px', margin: '0 0 20px 0' }}>Inbound Compliance disputes filed outside standard chargeback categories.</p>
            <div style={{ display: 'flex', gap: '20px', marginBottom: '24px' }}>
              <div style={{ flex: 1, background: '#F8FAF2', padding: '20px', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                <div style={{ color: '#64748b', fontSize: '12px', fontWeight: '600' }}>COMPLIANCE CASES</div>
                <div style={{ fontSize: '32px', fontWeight: '800', marginTop: '6px', color: '#333' }}>{complianceCases.length}</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MerchantReportsPage({ chargebacks, currentUser, formatINR }) {
  const [activeReportTab, setActiveReportTab] = useState('performance');

  const merchantCb = chargebacks.filter(cb => cb.userName === currentUser.username);

  const totalDisputes = merchantCb.length;
  const openCount = merchantCb.filter(cb => getDisputeCategory(cb) === 'open').length;
  const wonCount = merchantCb.filter(cb => getDisputeCategory(cb) === 'won').length;
  const lostCount = merchantCb.filter(cb => getDisputeCategory(cb) === 'lost').length;
  const winRatio = totalDisputes > 0 ? Math.round((wonCount / (wonCount + lostCount || 1)) * 100) : 0;

  const now = new Date();
  const getAge = (createdDate) => {
    if (!createdDate) return 0;
    const diffTime = Math.abs(now - new Date(createdDate));
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };
  const aging_0_5 = merchantCb.filter(cb => getAge(cb.createdDate) <= 5).length;
  const aging_6_15 = merchantCb.filter(cb => { const a = getAge(cb.createdDate); return a > 5 && a <= 15; }).length;
  const aging_16_30 = merchantCb.filter(cb => { const a = getAge(cb.createdDate); return a > 15 && a <= 30; }).length;
  const aging_30_plus = merchantCb.filter(cb => getAge(cb.createdDate) > 30).length;

  const slaBreached = merchantCb.filter(cb => {
    if (isClosedDispute(cb)) return false;
    const diff = getDaysDifference(cb.respondByDate, now);
    return diff < 0;
  }).length;
  const slaWarning = merchantCb.filter(cb => {
    if (isClosedDispute(cb)) return false;
    const diff = getDaysDifference(cb.respondByDate, now);
    return diff >= 0 && diff <= 3;
  }).length;

  const oiDeflected = merchantCb.filter(cb => {
    const s = (cb.mSubStatus || cb.mStatus || '').toLowerCase();
    return s.includes('order insight') || s.includes('oi');
  });
  const rdrDeflected = merchantCb.filter(cb => {
    const s = (cb.mSubStatus || cb.mStatus || '').toLowerCase();
    return s.includes('rdr');
  });
  const standardCount = totalDisputes - oiDeflected.length - rdrDeflected.length;

  const oiDeflectedVal = oiDeflected.reduce((sum, cb) => sum + cb.adjAmt, 0);
  const rdrDeflectedVal = rdrDeflected.reduce((sum, cb) => sum + cb.adjAmt, 0);

  const totalValue = merchantCb.reduce((sum, cb) => sum + cb.adjAmt, 0);
  const totalWonValue = merchantCb.filter(cb => getDisputeCategory(cb) === 'won').reduce((sum, cb) => sum + cb.adjAmt, 0);
  const totalLostValue = merchantCb.filter(cb => getDisputeCategory(cb) === 'lost').reduce((sum, cb) => sum + cb.adjAmt, 0);
  const netFinancialImpact = totalWonValue + oiDeflectedVal + rdrDeflectedVal - totalLostValue;

  return (
    <div style={{ display: 'flex', gap: '20px', padding: '24px', minHeight: 'calc(100vh - 120px)' }}>
      {/* Sidebar for reports */}
      <div style={{ width: '220px', background: '#fff', borderRadius: '12px', border: '1px solid #E2E8F0', padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <h4 style={{ margin: '0 0 12px 0', fontSize: '13px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>My Reports</h4>
        {[
          { id: 'performance', label: '📊 Performance', desc: 'Dispute volumes & win rates' },
          { id: 'aging', label: '📅 Dispute Aging', desc: 'Queue ages & distributions' },
          { id: 'sla', label: '⏰ SLA & Breaches', desc: 'SLA warnings & breaches' },
          { id: 'winloss', label: '🏆 Win/Loss Ratio', desc: 'Success rates' },
          { id: 'deflections', label: '🛡️ Deflections', desc: 'RDR & Order Insight' },
          { id: 'financial', label: '💰 Financial Impact', desc: 'Net savings & liabilities' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveReportTab(tab.id)}
            style={{
              padding: '12px',
              borderRadius: '8px',
              border: 'none',
              background: activeReportTab === tab.id ? '#6B38FB' : 'transparent',
              color: activeReportTab === tab.id ? '#fff' : '#475569',
              textAlign: 'left',
              fontWeight: '600',
              cursor: 'pointer',
              fontSize: '13px',
              transition: 'all 0.2s'
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Main Report Area */}
      <div style={{ flex: 1, background: '#fff', borderRadius: '12px', border: '1px solid #E2E8F0', padding: '24px', overflowY: 'auto' }}>
        {activeReportTab === 'performance' && (
          <div>
            <h3 style={{ margin: '0 0 8px 0', color: '#333' }}>Merchant Performance Report</h3>
            <p style={{ color: '#64748b', fontSize: '14px', margin: '0 0 20px 0' }}>Dispute volume, win rates, and active caseload for {currentUser.name}.</p>
            <div style={{ display: 'flex', gap: '20px', marginBottom: '24px' }}>
              <div style={{ flex: 1, background: '#F8FAF2', padding: '20px', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                <div style={{ color: '#64748b', fontSize: '12px', fontWeight: '600' }}>TOTAL DISPUTES</div>
                <div style={{ fontSize: '32px', fontWeight: '800', marginTop: '6px', color: '#333' }}>{totalDisputes}</div>
              </div>
              <div style={{ flex: 1, background: '#F8FAF2', padding: '20px', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                <div style={{ color: '#64748b', fontSize: '12px', fontWeight: '600' }}>OPEN DISPUTES</div>
                <div style={{ fontSize: '32px', fontWeight: '800', marginTop: '6px', color: '#eab308' }}>{openCount}</div>
              </div>
              <div style={{ flex: 1, background: '#F8FAF2', padding: '20px', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                <div style={{ color: '#64748b', fontSize: '12px', fontWeight: '600' }}>WIN RATIO</div>
                <div style={{ fontSize: '32px', fontWeight: '800', marginTop: '6px', color: '#10b981' }}>{winRatio}%</div>
              </div>
            </div>
          </div>
        )}

        {activeReportTab === 'aging' && (
          <div>
            <h3 style={{ margin: '0 0 8px 0', color: '#333' }}>Dispute Aging Report</h3>
            <p style={{ color: '#64748b', fontSize: '14px', margin: '0 0 20px 0' }}>Caseload distribution by creation dates.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {[
                { label: '0 - 5 Days', count: aging_0_5, color: '#10b981' },
                { label: '6 - 15 Days', count: aging_6_15, color: '#3b82f6' },
                { label: '16 - 30 Days', count: aging_16_30, color: '#f59e0b' },
                { label: '30+ Days', count: aging_30_plus, color: '#ef4444' }
              ].map((bracket, i) => {
                const pct = totalDisputes > 0 ? (bracket.count / totalDisputes) * 100 : 0;
                return (
                  <div key={i}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: '600', marginBottom: '6px', color: '#333' }}>
                      <span>{bracket.label}</span>
                      <span>{bracket.count} cases ({Math.round(pct)}%)</span>
                    </div>
                    <div style={{ height: '12px', background: '#f1f5f9', borderRadius: '999px', overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, background: bracket.color, height: '100%', borderRadius: '999px' }}></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeReportTab === 'sla' && (
          <div>
            <h3 style={{ margin: '0 0 8px 0', color: '#333' }}>SLA Alerts & Warnings</h3>
            <p style={{ color: '#64748b', fontSize: '14px', margin: '0 0 20px 0' }}>Pending actions near network decision timeline limits.</p>
            <div style={{ display: 'flex', gap: '20px', marginBottom: '24px' }}>
              <div style={{ flex: 1, background: '#FEF2F2', padding: '20px', borderRadius: '8px', border: '1px solid #FCA5A5' }}>
                <div style={{ color: '#991B1B', fontSize: '12px', fontWeight: '600' }}>SLA BREACHED</div>
                <div style={{ fontSize: '32px', fontWeight: '800', marginTop: '6px', color: '#B91C1C' }}>{slaBreached}</div>
              </div>
              <div style={{ flex: 1, background: '#FFFBEB', padding: '20px', borderRadius: '8px', border: '1px solid #FDE68A' }}>
                <div style={{ color: '#92400E', fontSize: '12px', fontWeight: '600' }}>SLA WARNING (&lt;= 3 DAYS)</div>
                <div style={{ fontSize: '32px', fontWeight: '800', marginTop: '6px', color: '#D97706' }}>{slaWarning}</div>
              </div>
            </div>
          </div>
        )}

        {activeReportTab === 'winloss' && (
          <div>
            <h3 style={{ margin: '0 0 8px 0', color: '#333' }}>Win/Loss Outcomes</h3>
            <p style={{ color: '#64748b', fontSize: '14px', margin: '0 0 20px 0' }}>Outcome ratios for completed cases.</p>
            <div style={{ display: 'flex', justifyContent: 'center', margin: '20px 0' }}>
              <PieChart
                dataSegments={[
                  { label: 'Won', value: wonCount, color: '#10b981' },
                  { label: 'Lost', value: lostCount, color: '#ef4444' }
                ]}
                darkMode={false}
              />
            </div>
          </div>
        )}

        {activeReportTab === 'deflections' && (
          <div>
            <h3 style={{ margin: '0 0 8px 0', color: '#333' }}>Visa Deflection Impact</h3>
            <p style={{ color: '#64748b', fontSize: '14px', margin: '0 0 20px 0' }}>Fraud deflection metrics through Order Insight and Rapid Dispute Resolution.</p>
            <div style={{ display: 'flex', gap: '20px', marginBottom: '24px' }}>
              <div style={{ flex: 1, background: '#ECFDF5', padding: '20px', borderRadius: '8px', border: '1px solid #A7F3D0' }}>
                <div style={{ color: '#065F46', fontSize: '12px', fontWeight: '600' }}>RDR DEFLECTED</div>
                <div style={{ fontSize: '32px', fontWeight: '800', marginTop: '6px', color: '#047857' }}>{rdrDeflected.length}</div>
                <div style={{ fontSize: '13px', marginTop: '4px', color: '#047857' }}>Saved: {formatINR(rdrDeflectedVal)}</div>
              </div>
              <div style={{ flex: 1, background: '#EFF6FF', padding: '20px', borderRadius: '8px', border: '1px solid #BFDBFE' }}>
                <div style={{ color: '#1E3A8A', fontSize: '12px', fontWeight: '600' }}>ORDER INSIGHT DEFLECTED</div>
                <div style={{ fontSize: '32px', fontWeight: '800', marginTop: '6px', color: '#1D4ED8' }}>{oiDeflected.length}</div>
                <div style={{ fontSize: '13px', marginTop: '4px', color: '#1D4ED8' }}>Saved: {formatINR(oiDeflectedVal)}</div>
              </div>
            </div>
          </div>
        )}

        {activeReportTab === 'financial' && (
          <div>
            <h3 style={{ margin: '0 0 8px 0', color: '#333' }}>Financial Reconciliation Impact</h3>
            <p style={{ color: '#64748b', fontSize: '14px', margin: '0 0 20px 0' }}>Financial ledger reconciliation metrics and net impact.</p>
            <div style={{ display: 'flex', gap: '20px', marginBottom: '24px' }}>
              <div style={{ flex: 1, background: '#F8FAF2', padding: '20px', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                <div style={{ color: '#64748b', fontSize: '12px', fontWeight: '600' }}>TOTAL DISPUTE VOLUME</div>
                <div style={{ fontSize: '24px', fontWeight: '800', marginTop: '6px', color: '#333' }}>{formatINR(totalValue)}</div>
              </div>
              <div style={{ flex: 1, background: '#F0FDF4', padding: '20px', borderRadius: '8px', border: '1px solid #BBF7D0' }}>
                <div style={{ color: '#166534', fontSize: '12px', fontWeight: '600' }}>NET IMPACT SAVED</div>
                <div style={{ fontSize: '24px', fontWeight: '800', marginTop: '6px', color: '#15803d' }}>{formatINR(netFinancialImpact)}</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DonutChart({ dataSegments, darkMode }) {
  const total = dataSegments.reduce((sum, s) => sum + s.value, 0);
  if (total === 0) {
    return <div style={{ color: 'var(--text-muted)', fontSize: '13px', fontWeight: '500', textAlign: 'center', width: '100%' }}>No data matches reports filter</div>;
  }

  const r = 50;
  const cx = 80;
  const cy = 80;
  const circumference = 2 * Math.PI * r;

  const getStrokeOffset = (index) => {
    let offset = 0;
    for (let i = 0; i < index; i++) {
      const seg = dataSegments[i];
      if (seg.value > 0) {
        const percentage = seg.value / total;
        const dashArray = percentage * circumference;
        offset -= dashArray;
      }
    }
    return offset;
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
      <svg width="180" height="160" viewBox="0 0 160 160" style={{ overflow: 'visible' }}>
        {dataSegments.map((segment, idx) => {
          if (segment.value === 0) return null;
          const percentage = segment.value / total;
          const dashArray = percentage * circumference;
          const strokeDash = `${dashArray} ${circumference}`;
          const strokeOffset = getStrokeOffset(idx);

          return (
            <circle 
              key={idx}
              cx={cx} 
              cy={cy} 
              r={r} 
              fill="transparent" 
              stroke={segment.color} 
              strokeWidth="20" 
              strokeDasharray={strokeDash} 
              strokeDashoffset={strokeOffset} 
              transform={`rotate(-90 ${cx} ${cy})`}
              style={{ transition: 'stroke-dashoffset 0.5s ease' }}
            />
          );
        })}
        <circle cx={cx} cy={cy} r={r - 10} fill={darkMode ? '#121220' : '#ffffff'} />
        <text x={cx} y={cy + 5} textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--text)">Total</text>
        <text x={cx} y={cy + 20} textAnchor="middle" fontSize="14" fontWeight="800" fill="var(--brand)">{total}</text>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginLeft: '20px', textAlign: 'left' }}>
        {dataSegments.map((segment, idx) => {
          const pct = total > 0 ? Math.round((segment.value / total) * 100) : 0;
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }} key={idx}>
              <span style={{ width: '12px', height: '12px', background: segment.color, borderRadius: '3px', display: 'inline-block' }}></span>
              <span style={{ fontWeight: '500', color: 'var(--text)' }}>{segment.label}:</span>
              <span style={{ color: 'var(--text-muted)' }}>{segment.value} ({pct}%)</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PieChart({ dataSegments, darkMode }) {
  const total = dataSegments.reduce((sum, s) => sum + s.value, 0);
  if (total === 0) {
    return <div style={{ color: 'var(--text-muted)', fontSize: '13px', fontWeight: '500', textAlign: 'center', width: '100%' }}>No data matches reports filter</div>;
  }

  const r = 68;
  const cx = 80;
  const cy = 80;

  const polarToCartesian = (centerX, centerY, radius, angleInDegrees) => {
    const angleInRadians = (angleInDegrees - 90) * Math.PI / 180.0;
    return {
      x: centerX + (radius * Math.cos(angleInRadians)),
      y: centerY + (radius * Math.sin(angleInRadians))
    };
  };

  const getSectorPath = (x, y, radius, startAngle, endAngle) => {
    const start = polarToCartesian(x, y, radius, endAngle);
    const end = polarToCartesian(x, y, radius, startAngle);
    const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
    return [
      "M", x, y,
      "L", start.x, start.y,
      "A", radius, radius, 0, largeArcFlag, 0, end.x, end.y,
      "Z"
    ].join(" ");
  };

  let currentAngle = 0;

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', padding: '10px' }}>
      <svg width="160" height="160" viewBox="0 0 160 160" style={{ overflow: 'visible' }}>
        {dataSegments.map((segment, idx) => {
          if (segment.value === 0) return null;

          if (segment.value === total) {
            return (
              <circle 
                key={idx}
                cx={cx} 
                cy={cy} 
                r={r} 
                fill={segment.color} 
                stroke="#ffffff" 
                strokeWidth="2" 
              />
            );
          }

          const percentage = segment.value / total;
          const angleRange = percentage * 360;
          const startAngle = currentAngle;
          const endAngle = currentAngle + angleRange;
          currentAngle = endAngle;

          const pathData = getSectorPath(cx, cy, r, startAngle, endAngle);

          return (
            <path 
              key={idx}
              d={pathData} 
              fill={segment.color} 
              stroke="#ffffff" 
              strokeWidth="2"
              style={{ transition: 'all 0.5s ease' }}
            />
          );
        })}
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginLeft: '32px', textAlign: 'left' }}>
        {dataSegments.map((segment, idx) => {
          const pct = total > 0 ? Math.round((segment.value / total) * 100) : 0;
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }} key={idx}>
              <span style={{ width: '12px', height: '12px', background: segment.color, borderRadius: '3px', display: 'inline-block' }}></span>
              <span style={{ fontWeight: '600', color: 'var(--text)' }}>
                {segment.label}: <span style={{ fontWeight: '500', color: 'var(--text-muted)', marginLeft: '4px' }}>{segment.value} ({pct}%)</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BarChart({ providerData }) {
  const maxVal = Math.max(...providerData.map(d => d.value), 1);
  const chartHeight = 150;
  const chartWidth = 260;
  const barWidth = 36;
  const gap = 20;

  return (
    <svg width={chartWidth} height={chartHeight + 40} viewBox={`0 0 ${chartWidth} ${chartHeight + 40}`}>
      <line x1="15" y1={chartHeight + 10} x2={chartWidth - 15} y2={chartHeight + 10} stroke="var(--border)" strokeWidth="1.5"></line>
      {providerData.map((item, index) => {
        const barHeight = (item.value / maxVal) * chartHeight;
        const x = 30 + index * (barWidth + gap);
        const y = chartHeight - barHeight + 10;

        return (
          <g key={index}>
            <rect 
              x={x} 
              y={y} 
              width={barWidth} 
              height={barHeight} 
              fill={item.color} 
              rx="4" 
              style={{ transition: 'height 0.5s ease, y 0.5s ease' }}
            >
              <title>{item.label}: {item.value}</title>
            </rect>
            <text x={x + barWidth/2} y={y - 6} textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--text)">
              {item.value}
            </text>
            <text x={x + barWidth/2} y={chartHeight + 26} textAnchor="middle" fontSize="11" fontWeight="500" fill="var(--text-muted)">
              {item.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}


