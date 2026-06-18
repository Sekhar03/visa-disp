Feature: Acquiring-Side Transaction Dispute Management System for Payment Aggregators and Merchants
  As an intermediate middleware and portal integrated with Visa Resolve Online (VROL) via Real-Time Systems Interface (RTSI),
  The system must ingest, route, automate, and manage the full lifecycle of transaction inquiries, pre-disputes, 
  and formal disputes, mirroring premium orchestration, rules engines, and automated evidence compilation capabilities.

  Background: Core Middleware Connectivity and Tenant Authentication
    Given the Payment Aggregator middleware has an active, secure connection to the VROL network via RTSI APIs
    And the system's centralized database has pre-configured merchant sub-accounts mapped via unique Card Acceptor IDs (CAID)
    And the Pega-style automated rule orchestration engine and Vuram-style evidence compiler are initialized
    And the following system roles are authenticated and active:
      | User Role                       | Interface Access               | Permission Set                                  |
      | Payment Aggregator Central Admin | Central Administrator Console  | Cross-tenant rules, global SLAs, VROL API audits|
      | Merchant Dashboard Operations   | Sub-Merchant Dedicated Portal   | Case queue review, evidence upload, manual refund|

  @OrderInsight @PreDispute @Deflection @RealTime
  Scenario Outline: Automated API lookup matching a VROL Order Insight request against the Aggregator data store returning a full digital receipt
    Given an inbound VROL Order Insight (OI) Purchase Inquiry is received via the RTSI webhook endpoint
    And the inbound payload contains the following Visa transaction identifiers:
      | Field Name                  | Field Value             |
      | Visa Transaction Identifier | <VisaTxID>              |
      | Card Acceptor ID (CAID)     | <MerchantCAID>          |
      | Acquirer Reference Number   | <ARN>                   |
      | Transaction Date Timestamp  | <TxTimestamp>           |
      | Auth Amount                 | <Amount>                |
      | Currency Code               | <CurrencyISO>           |
    When the Aggregator middleware extracts the CAID "<MerchantCAID>" and routes a real-time query to the sub-merchant's internal CRM and Order Management System (OMS)
    And the sub-merchant's OMS returns a matching order record containing localized digital transaction elements matching the item category "<ProductCategory>"
    Then the automated evidence compilation engine constructs a VROL-compliant Order Insight response payload containing:
      | Payload Field Element      | Extracted Merchant Value   |
      | Customer Account Name      | <CustomerName>             |
      | Product Digital Description| <ProductDescription>       |
      | Customer Device IP Address | <DeviceIP>                 |
      | Device Fingerprint Hash     | <DeviceFingerprint>        |
      | Shipping Carrier Status    | <FulfillmentStatus>        |
    And the system transmits this compiled digital receipt payload back to VROL via the RTSI Order Insight Reply API
    But the system does not exceed the Visa network timeout limit of 2000 milliseconds for synchronous pre-dispute responses
    And the transaction status is updated in the Merchant Dashboard to "Pre-Dispute - Deflected via Order Insight"

    Examples:
      | VisaTxID       | MerchantCAID   | ARN                     | TxTimestamp          | Amount  | CurrencyISO | ProductCategory | CustomerName | ProductDescription                | DeviceIP       | DeviceFingerprint                | FulfillmentStatus          |
      | 987654321012345 | MERCH_ACQ_9981 | 74123456789012345678901 | 2026-06-15T14:32:00Z | 149.99  | 840         | Digital SaaS     | Jane Doe     | Premium SaaS Subscription - Annual| 192.168.1.45   | a7b8c9d0e1f2g3h4i5j6k7l8m9n0o1p2 | FULFILLED_DIGITAL_DELIVERY |
      | 987654321012346 | MERCH_ACQ_4452 | 74123456789012345678902 | 2026-06-16T10:15:00Z | 85.00   | 978         | Physical Retail  | John Smith   | Leather Messenger Work Bag        | 172.56.21.9    | z1x2c3v4b5n6m7asdfghjklqwertyui1 | DELIVERED_SIGNED_BY_RECIP   |
      | 987654321012347 | MERCH_ACQ_1109 | 74123456789012345678903 | 2026-06-16T18:45:00Z | 420.50  | 826         | Travel & T&E     | Alice Green  | Boutique Hotel Stay - 2 Nights    | 204.14.52.88   | q1w2e3r4t5y6u7i8o9p0asdfghjklzxc | CHECKED_OUT_VALID_ID       |
      | 987654321012348 | MERCH_ACQ_7761 | 74123456789012345678904 | 2026-06-17T02:11:00Z | 35.10   | 036         | Digital Goods    | Bob Taylor   | In-Game Virtual Currency Pack     | 101.23.4.112   | m9n8b7v6c5x4z3asdfghjklpoiuytrew | CREDITED_TO_USER_WALLET    |

  @OrderInsight @IntentToCredit @Automation @AEM
  Scenario Outline: Merchant-configured threshold triggers an automated Intent to Credit response to an Order Insight inquiry
    Given a sub-merchant has defined an automated deflection threshold rule within the Aggregator portal:
      | Rule Parameter           | Rule Threshold Value  | Rule Action               |
      | Max Deflection Amount    | <MaxThresholdAmount>  | AUTO_INTENT_TO_CREDIT     |
      | Visa Dispute Category    | <VisaCategory>        | ALL_MATCHES               |
    And an inbound VROL Order Insight Inquiry arrives via RTSI for a transaction matching the criteria:
      | Parameter                | Value                 |
      | Card Acceptor ID (CAID)  | <MerchantCAID>        |
      | Dispute Category Code    | <VisaCategory>        |
      | Authorization Amount     | <TransactionAmount>   |
      | Currency ISO Code        | <CurrencyCode>        |
    When the system evaluates the inbound transaction amount "<TransactionAmount>" against the configured maximum deflection amount "<MaxThresholdAmount>"
    Then the system executes the "AUTO_INTENT_TO_CREDIT" automated rule logic
    And the system sends a VROL Order Insight response containing an "Intent to Credit" indicator code to the issuer via RTSI
    And the system posts a local Accounting Entry Memo (AEM) to the general ledger to flag the pending financial settlement:
      | Ledger Field             | Value                                             |
      | Account Entry Memo Type  | PRE_DISPUTE_DEFLECTION_REVERSAL                  |
      | Debit Entity             | Merchant Escrow Settlement Account                |
      | Credit Entity            | Issuer Cardholder Network Settlement Pool        |
      | Allocation Amount        | <TransactionAmount>                               |
      | Local Currency           | <CurrencyCode>                                    |
    And the case status in the Merchant Dashboard updates to "Resolved - Deflected via OI Credit"

    Examples:
      | MaxThresholdAmount | VisaCategory     | MerchantCAID    | TransactionAmount | CurrencyCode |
      | 25.00              | Fraud            | CAID_SUB_8812   | 14.50             | USD          |
      | 50.00              | Consumer Dispute | CAID_SUB_4432   | 45.00             | USD          |
      | 35.00              | Processing Error | CAID_SUB_1109   | 34.99             | EUR          |
      | 15.00              | Authorization    | CAID_SUB_7761   | 9.99              | GBP          |
      | 100.00             | Fraud            | CAID_SUB_9941   | 89.15             | CAD          |

  @RapidDisputeResolution @RDR @RuleEngine @AutoResolution
  Scenario Outline: Inbound VROL RDR alert matches a pre-defined Merchant Rule executing an automated credit and updating the local ledger
    Given the Payment Aggregator has enrolled the sub-merchant in the Visa Rapid Dispute Resolution (RDR) program via VROL
    And the merchant has activated an RDR Automation Rule within the ServiceNow-style workflow engine:
      | Rule Attribute           | Rule Constraint Value |
      | Program Identifier       | VISA_RDR_CORE         |
      | Maximum Auto-Accept Limit| <RDRMaxLimit>         |
      | Excluded SKUs            | HIGH_RISK_ELECTRONICS |
    When a real-time VROL RDR Dispute Alert notification is pushed via RTSI to the middleware with the following details:
      | Network Detail Field     | Network Payload Value |
      | VROL RDR Global Case ID  | <VROLCaseID>          |
      | Visa Dispute Condition   | <DisputeCondition>    |
      | Financial Clear Amount   | <DisputeAmount>       |
      | Clearing Currency Code   | <Currency>            |
      | Stock Keeping Unit (SKU) | <ProductSKU>          |
    Then the rules engine verifies that "<DisputeAmount>" is less than or equal to "<RDRMaxLimit>"
    And the system verifies that "<ProductSKU>" is not in the "HIGH_RISK_ELECTRONICS" exclusion list
    And the system issues an automated accept response to VROL via the RTSI RDR Accept API to confirm the automated debit from the acquirer bin
    And the system automatically writes an internal Accounting Entry Memo (AEM) to execute the matching internal balance movement:
      | General Ledger Field     | Settlement Value                                  |
      | Memo Transaction Type    | Automated RDR Credit Adjustment                   |
      | Source Merchant Account  | <MerchantCAID>                                    |
      | Financial Debit Amount   | <DisputeAmount>                                   |
      | Financial Credit Account | Acquirer Network Liability Clear Account          |
    And the case record is systematically closed and moved to status "Resolved - Deflected via RDR"
    And an automated webhook notification is triggered to sync this resolution with the merchant's external backend ERP system

    Examples:
      | RDRMaxLimit | VROLCaseID  | DisputeCondition               | DisputeAmount | Currency | ProductSKU      | MerchantCAID   |
      | 50.00       | RDR-771120A | 10.1: EMV Fraud Counterfeit    | 22.50         | USD      | DIGITAL_COIN_X1 | CAID_MERCH_001 |
      | 50.00       | RDR-771121B | 13.1: Merchandise Not Received | 49.99         | USD      | APPAREL_SHIRT_0 | CAID_MERCH_001 |
      | 75.00       | RDR-992314C | 10.4: Other Fraud (CNP)        | 65.00         | EUR      | EBOOK_DOWNLOAD_ | CAID_MERCH_002 |
      | 30.00       | RDR-104958D | 12.5: Incorrect Amount         | 12.00         | GBP      | FOOD_DELIVERY_0 | CAID_MERCH_003 |
      | 120.00      | RDR-883411E | 10.4: Other Fraud (CNP)        | 115.00        | CAD      | TICKET_CONCERT_ | CAID_MERCH_004 |

  @DisputeIntake @RTSI @PegaRouting @SLAAlerts
  Scenario Outline: Real-time ingestion of a formal VROL Dispute notification via RTSI mapping tenants, categories, and strict SLA expiration timers
    Given an automated system schedule or real-time RTSI push event triggers the VROL Dispute Ingestion Worker
    When a formal Visa Dispute Notification message is received by the middleware containing network payload parameters:
      | Visa Network Attribute     | Payload JSON Value       |
      | VROL Case ID               | <VROLCaseID>             |
      | Card Acceptor ID (CAID)    | <MerchantCAID>           |
      | Card Acceptor Name         | <MerchantName>           |
      | Visa Dispute Category Code | <DisputeCategory>        |
      | Visa Dispute Condition     | <DisputeCondition>       |
      | Dispute Financial Amount   | <DisputeAmount>          |
      | Dispute Currency           | <CurrencyCode>           |
      | Visa Network Day Limit     | <NetworkDayLimit>        |
      | Network Submission Date    | 2026-06-18               |
    Then the Pega-style orchestration engine maps the CAID "<MerchantCAID>" directly to the sub-merchant database record for "<MerchantName>"
    And the system parses the "Visa Network Day Limit" of "<NetworkDayLimit>" and computes a precise local system SLA expiration timestamp set exactly at "<ComputedSLATimestamp>"
    And the system initializes a T-minus countdown indicator on the user interface display tracking remaining response days
    And the routing engine classifies this case under the designated "<QueuePriority>" due to the defined triage thresholds
    And the case status changes to "Action Required - Awaiting Merchant Input"
    And the system dispatches an automated, priority SLA alert email notification to the merchant's assigned dispute operator group

    Examples:
      | VROLCaseID           | MerchantCAID        | MerchantName               | DisputeCategory   | DisputeCondition                    | DisputeAmount | CurrencyCode | NetworkDayLimit | ComputedSLATimestamp | QueuePriority            |
      | VROL-DISP-2026-99481 | CAID_SUB_VURAM_4412 | ACME Digital Services Corp | Consumer Dispute   | 13.3: Not as Described or Defective | 350.00        | 840          | 30 Days         | 2026-07-18T23:59:59Z | High-Priority Review     |
      | VROL-DISP-2026-99482 | CAID_SUB_VURAM_1002 | Global Electro Market      | Fraud              | 10.4: Other Fraud (CNP)             | 1450.00       | 840          | 20 Days         | 2026-07-08T23:59:59Z | Critical-Escalation Corp |
      | VROL-DISP-2026-99483 | CAID_SUB_VURAM_7751 | Euro Fashion Attire Ltd    | Processing Error   | 12.3: Duplicate Processing          | 45.00         | 978          | 30 Days         | 2026-07-18T23:59:59Z | Low-Priority Batch       |
      | VROL-DISP-2026-99484 | CAID_SUB_VURAM_8890 | UK Transatlantic Flights   | Authorization      | 11.1: No Authorization              | 890.00        | 826          | 30 Days         | 2026-07-18T23:59:59Z | High-Priority Review     |
      | VROL-DISP-2026-99485 | CAID_SUB_VURAM_2211 | Micro-SaaS Analytics Tools | Consumer Dispute   | 13.2: Cancelled Recurring           | 19.99         | 840          | 30 Days         | 2026-07-18T23:59:59Z | Standard-Priority Queue  |

  @AllocationWorkflow @Representment @Fraud @Authorization @ChargebackHelp
  Scenario Outline: Responding to an Allocation dispute by uploading compelling evidence and submitting a representment back to VROL
    Given an active case exists in the Merchant Dashboard under the Allocation Workflow track:
      | Case Identifier       | Merchant CAID  | Dispute Category   | Dispute Condition      | Dispute Amount   |
      | <LocalCaseIdentifier> | <MerchantCAID> | <DisputeCategory>  | <ConditionCode>        | <DisputeAmount>  |
    And the Pega-style orchestration UI alerts the user that the case requires response actions within the absolute Visa network limitation window
    When the Merchant Dashboard User logs in and accesses the "Compile Evidence" workspace for the case
    And the user uploads digital files containing documented proof to fulfill Visa's compelling data specifications:
      | Document Type               | File Name              | Document Description Data Element               |
      | Core Verification File      | <EvidenceFile1>        | <EvidenceDescription1>                          |
      | Supplementary Proof Log     | <EvidenceFile2>        | <EvidenceDescription2>                          |
      | Historical Validation Data  | <EvidenceFile3>        | <EvidenceDescription3>                          |
    And the user triggers the ChargebackHelp-style automated validation script to verify document formatting and size limits
    Then the system compiles the formal "VROL Dispute Response Questionnaire" object matching the requirements for "<ConditionCode>"
    And the system attaches the electronic document binary links to the questionnaire schema payload
    And the Aggregator middleware transmits the complete dispute response and representment files to VROL using the RTSI "Submit Dispute Response Questionnaire" API
    And the system records a successful API transmission log with status "VROL_ACKNOWLEDGED_SUCCESS"
    And the local case status updates to "Representment Submitted - Awaiting Network Ruling"

    Examples:
      | LocalCaseIdentifier | MerchantCAID   | DisputeCategory | ConditionCode               | DisputeAmount | EvidenceFile1        | EvidenceDescription1             | EvidenceFile2           | EvidenceDescription2             | EvidenceFile3           | EvidenceDescription3             |
      | CASE-2026-F01       | CAID_MERCH_101 | Fraud           | 10.1: EMV Fraud Counterfeit | 120.00        | pin_log_terminal.pdf | POS terminal chip read signature | device_id_finger.json   | Device metadata and hardware profile| past_clearing.csv       | Previous undisputed history     |
      | CASE-2026-F04       | CAID_MERCH_102 | Fraud           | 10.4: Other Fraud (CNP)     | 85.50         | ip_match_proof.pdf   | Matching IP and geofence logs    | shipping_carrier_rec.pdf| Signed delivery proof at billing | customer_profile.pdf    | Verified account history logs   |
      | CASE-2026-A11       | CAID_MERCH_103 | Authorization   | 11.1: No Authorization      | 210.00        | auth_token_valid.pdf | Real-time auth code logs via VIP | settle_reconcile.json   | Settled ledger match record     | terminal_receipt.pdf    | Physical swipe customer voucher  |
      | CASE-2026-A13       | CAID_MERCH_104 | Authorization   | 11.3: Expired Authorization | 45.00         | ext_auth_window.pdf  | Delayed execution compliance log | booking_contract.pdf    | Pre-authorization agreement terms| merchant_memo.txt       | Partial completion data log     |

  @CollaborationWorkflow @PreArbitration @Arbitration @VisaDRM @ServiceNowLifecycle
  Scenario Outline: Managing a Collaboration case lifecycle from initial intake up to Pre-Arbitration and formal Arbitration/Compliance Case Filing
    Given an inbound VROL Collaboration Workflow notification is ingested via RTSI for a case under the "<DisputeCategory>" category
    And the dispute parameters reflect a multi-stage dispute lifecycle:
      | Lifecycle Parameter        | Parameter Value Elements                                |
      | VROL Case ID               | <VROLCaseID>                                            |
      | Sub-Merchant Account ID    | <MerchantCAID>                                          |
      | Dispute Condition Code     | <ConditionCode>                                         |
      | Current Case Phase         | Collaboration Initial Ingestion                         |
      | Financial Dispute Value    | <DisputeAmount>                                         |
    When the merchant uploads an initial response questionnaire rejecting the claim with basic transaction files "<InitialEvidence>"
    And the system submits this response to VROL to complete the initial Collaboration phase
    And the Issuer rejects the merchant's evidence and advances the case state to the "Pre-Arbitration" phase via VROL
    And the system receives the updated VROL Pre-Arbitration documentation payload containing a formal cardholder counter-reason statement "<PreArbCounterReason>"
    Then the ServiceNow-style case lifecycle manager moves the local case entity state to "Pre-Arbitration - Review Required"
    And the system displays an urgent dashboard warning modal showing:
      | UI Alert Attribute         | Interface Display Metric                                |
      | Phase Expiration Countdown | T-Minus 5 Days remaining before default liability loss  |
      | Recommended Action         | Review cardholder letter or Accept Financial Liability  |
    When the Merchant Dashboard User reviews the cardholder counter-declaration and selects the action "<FinalAction>"
    And the system executes the corresponding dynamic network routing step:
      | Final Action Taken  | Network API Target Route                                        |
      | ACCEPT_LIABILITY    | Submit Liability Acceptance Questionnaire to VROL              |
      | ESCALATE_TO_DRM     | Compile Case Filing Dossier & Trigger Visa DRM Case Review API |
    Then the local middleware case track state shifts to the definitive ending state "<ExpectedFinalState>"
    And the system flags the transaction file to block any duplicate chargebacks or manual refunds while in this state

    Examples:
      | VROLCaseID        | MerchantCAID       | DisputeCategory  | ConditionCode                        | DisputeAmount | InitialEvidence       | PreArbCounterReason                  | FinalAction       | ExpectedFinalState                                              |
      | VROL-COLLAB-88431 | CAID_SUB_COLLAB_55 | Consumer Dispute | 13.1: Merchandise Not Received       | 500.00        | basic_tracking_id.pdf | Cardholder claims package stolen     | ESCALATE_TO_DRM   | Pending Formal Arbitration - Assigned to Visa DRM Queue        |
      | VROL-COLLAB-88432 | CAID_SUB_COLLAB_12 | Consumer Dispute | 13.3: Not as Described or Defective  | 175.00        | item_spec_sheet.pdf   | Cardholder provides expert appraisal | ACCEPT_LIABILITY  | Resolved Closed - Liability Accepted to Issuer                  |
      | VROL-COLLAB-88433 | CAID_SUB_COLLAB_99 | Processing Error | 12.1: Late Presentment               | 62.00         | batch_settle_log.json | Issuer proves 180+ day system delay  | ACCEPT_LIABILITY  | Resolved Closed - Liability Accepted to Issuer                  |
      | VROL-COLLAB-88434 | CAID_SUB_COLLAB_04 | Processing Error | 12.3: Duplicate Processing           | 88.00         | double_invoice_id.pdf | Issuer provides distinct trace IDs   | ESCALATE_TO_DRM   | Pending Formal Compliance Case Filing - Assigned to Visa DRM    |
