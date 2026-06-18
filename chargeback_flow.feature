Feature: Visa Chargeback Dispute Management Workflow for Merchant and Admin Portals
  As a portal user (Merchant or Admin)
  I want to access my respective portal features, view dashboards, filter datasets, manage dispute lifecycles, and perform actions
  So that chargebacks are systematically handled and audited between all portals.

  Background:
    Given the Chargeback system is running
    And the following portals are available: Merchant Portal and Admin Portal

  # ═════════════════════════════════════════════════════════════════════════
  # LOGIN & AUTHENTICATION
  # ═════════════════════════════════════════════════════════════════════════

  Scenario Outline: Portal login flow with credentials
    Given the Chargeback system is running
    When I enter my username "<Username>" and password "<Password>"
    And I click the login button
    Then I should be successfully logged in with role "<Role>"
    And I should be redirected to the "<Portal>" dashboard

    Examples:
      | Username    | Password  | Role     | Portal          |
      | masteruser  | Test@2026 | merchant | Merchant Portal |
      | Test@isu    | Test@2026 | merchant | Merchant Portal |
      | Test@Ad     | Test@2027 | admin    | Admin Portal    |

  Scenario Outline: Invalid login attempts
    Given the Chargeback system is running
    When I enter my username "<Username>" and password "<Password>"
    And I click the login button
    Then I should see the error message "Invalid username or password"

    Examples:
      | Username    | Password   |
      | masteruser  | wrongpw    |
      | Test@Ad     | badpassword|
      | unknownuser | Test@2028  |

  # ═════════════════════════════════════════════════════════════════════════
  # MERCHANT PORTAL
  # ═════════════════════════════════════════════════════════════════════════

  # --- Dashboard Features ---
  Scenario: Merchant views dashboard analytics
    Given I am logged into the Merchant Portal
    Then I should see the welcome message "Welcome, Merchant Dispute Dashboard 👋"
    And I should see five live statistics cards:
      | Card | Disputes Received |
      | Card | Open Disputes |
      | Card | Disputes Lost |
      | Card | Disputes Won |
      | Card | SLA Expiring Today |

  Scenario Outline: Merchant filters dashboard stats by preset date range
    Given I am logged into the Merchant Portal
    When I select the date preset "<Preset>"
    Then the dashboard statistics should filter to show data matching "<Range>"

    Examples:
      | Preset  | Range             |
      | 7days   | last 7 days       |
      | 30days  | last 30 days      |
      | custom  | custom date range |

  # --- Navigation & Sidebar Layout ---
  Scenario: Sidebar collapses and hides menu links on case detail preview
    Given I am logged into the Merchant Portal
    And I am on the Dispute Management page
    When I select a dispute case to view its details
    Then the sidebar should transition to the collapsed state
    And the menu options "Dashboard", "Dispute Management", and "FAQ & Help" should be hidden
    When I click the close button on the preview pane or click the active SLA card to reset
    Then the sidebar should expand to its normal width
    And the menu options should be visible again

  # --- Dispute Management Tabs & Statistics ---
  Scenario: Merchant navigates tabs and views count badges
    Given I am logged into the Merchant Portal
    When I go to the Dispute Management page
    Then I should see four tabs: "Action Required", "Under Review", "Closed", and "All Disputes"
    And the "Action Required" tab should display its dispute count in a badge
    And the "Under Review" tab should display its dispute count in a badge

  Scenario Outline: Merchant filters disputes via SLA summary cards
    Given I am logged into the Merchant Portal
    And I am on the "Action Required" tab showing SLA summary cards
    When I click on the "<Card>" SLA summary card
    Then the disputes table should filter to show only cases matching "<Criteria>"

    Examples:
      | Card                   | Criteria               |
      | Due Today              | due today              |
      | Due Tomorrow           | due tomorrow           |
      | Due 2 to 7 Days        | due between 2 to 7 days|
      | Due after 7 Days       | due after 7 days       |
      | Insufficient Evidence  | evidence rejected      |

  Scenario: Merchant views Closed tab analytics
    Given I am logged into the Merchant Portal
    When I click on the "Closed" tab
    Then the summary cards section should show four closed statistics cards:
      | Card | Total Disputes |
      | Card | Won Disputes |
      | Card | Lost Disputes |
      | Card | Representment Win Ratio |

  # --- Filters & Search ---
  Scenario Outline: Merchant filters and searches the disputes list
    Given I am logged into the Merchant Portal
    When I open the advanced search and filter panel
    And I select dispute type filter "<Type>"
    And I select scheme filter "<Scheme>"
    And I enter search text "<Query>" in the elastic search bar
    Then the table should only show "<Scheme>" "<Type>" disputes containing search match "<Query>"

    Examples:
      | Type            | Scheme     | Query  |
      | Pre-Arbitration | VISA       | 609315 |
      | Chargeback      | Mastercard | 876898 |
      | Arbitration     | Rupay      | 223344 |

  Scenario: Merchant exports filtered disputes to CSV
    Given I am logged into the Merchant Portal
    And I have filtered disputes by provider "Visa" and date range
    When I click the "Export" button in the toolbar
    Then a CSV file containing only the filtered Visa disputes should be downloaded

  # --- Dispute Case Preview & Actions ---
  Scenario: Merchant reviews selected case details split layout
    Given I am logged into the Merchant Portal
    When I click on a dispute case to view details
    Then a split vertical preview pane should slide in from the right
    And the header should show the transaction amount as "Dispute Amount: <amount>"
    And the red SLA pending days label (e.g. "SLA: <days> days pending") should display directly below the amount
    And the SLA text size should be 17px and weight 800, which is larger than the dispute amount text size
    And the body of the pane should show a split layout:
      | Left Column | Action buttons (Accept/Contest), Uploaded documents list, and Case Timeline |
      | Right Column | Transaction details and Dispute info |

  Scenario Outline: Merchant accepts liability for a dispute
    Given I am logged into the Merchant Portal
    And I have selected an active dispute case in the preview pane
    When I click the "Accept Dispute" button
    Then I can choose between "Full Liability" and "Partial Liability"
    When I select "<Type>" and enter acceptance remarks "<Remarks>"
    And I click "Accept Liability"
    Then the dispute is closed as "<Outcome>" and moves to the Closed tab

    Examples:
      | Type              | Remarks                  | Outcome            |
      | Full Liability    | Accepting full liability | lost               |
      | Partial Liability | Only partially responsible| partially accepted |

  Scenario: Merchant contests a dispute and uploads evidence
    Given I am logged into the Merchant Portal
    And I have selected an active dispute case in the preview pane that has no documents uploaded
    When I click the "Contest & Submit Proof" button
    And I upload files to slots:
      | Slot 1 | Delivery/Service Proof |
      | Slot 2 | Statement of Service |
      | Slot 3 | Refund Invoice (Optional) |
    And I enter justification remarks up to 500 characters
    And I click "Submit Evidence"
    Then the dispute status should show "Chargeback In Progress"
    And the dispute should move to the "Under Review" tab
    And the uploaded documents should list in the left column evidence list

  Scenario: Merchant uploads more evidence for a dispute
    Given I am logged into the Merchant Portal
    When I have selected a dispute case under "Action Required" that already has uploaded documents
    Then the Accept and Contest actions should be replaced by a single "Upload More Evidence" button
    When I click "Upload More Evidence"
    And I attach additional files in the Contest modal and click "Submit Evidence"
    Then the new files should be appended to the evidence documents list

  Scenario: Merchant adds comments to case timeline
    Given I am logged into the Merchant Portal
    And I have selected a dispute case in the preview pane under the "Under Review" tab
    When I click the inline Comment icon button "💬"
    And I enter comment text in the dialog and click submit
    Then a comment entry with my username and timestamp should append to the case timeline

  # --- Under Review Inline Actions & Tooltips ---
  Scenario: Merchant triggers inline row actions under the Under Review tab
    Given I am logged into the Merchant Portal
    When I switch to the "Under Review" tab
    Then each dispute row in the table should render inline action buttons: Upload ("📤") and Comment ("💬")
    When I hover over the Upload icon
    Then a custom centered dark tooltip "Upload More Evidence" should appear above the icon
    When I hover over the Comment icon
    Then a custom centered dark tooltip "Comment" should appear above the icon
    When I click the inline Comment icon
    Then the case row should automatically get selected and the Comment modal should open

  # --- Guided Website Tour ---
  Scenario: Merchant starts interactive guided portal tour
    Given I am logged into the Merchant Portal
    When I click my profile dropdown in the header
    And I click "Start Guided Tour 🚀"
    Then a step-by-step floating presentation tour with dark backdrop masks should open
    And I can navigate through steps highlighting different parts of the portal
    And the system automatically transitions between pages as I step through

  # --- FAQ Floating Help ---
  Scenario: Merchant opens FAQ floating widget
    Given I am logged into the Merchant Portal
    When I click the "FAQ & Help" sidebar item or the "?" floating button in the bottom-right corner
    Then a fixed floating FAQ card should open in the bottom-right corner of the page
    And the background content should remain visible and fully interactive
    When I navigate to the "Dashboard"
    Then the floating FAQ widget should automatically close

  # ═════════════════════════════════════════════════════════════════════════
  # ADMIN PORTAL
  # ═════════════════════════════════════════════════════════════════════════

  # --- Dashboard & Sidebar navigation ---
  Scenario: Admin views portfolio metrics and navigates sections
    Given I am logged into the Admin Portal
    Then I should see aggregate portfolio stats:
      | Card | Total Transactions |
      | Card | Dispute Received |
      | Card | Dispute Open |
      | Card | Dispute Lost |
      | Card | Dispute Won |
      | Card | SLA Expiring Today |
    And I should see a Pie Chart showing Dispute Distribution (Open, Lost, Won segments)
    And I can navigate between sidebar links: "Dashboard", "Dispute Management", and "VROL Import Center"

  # --- Dispute Queue Tabs & Details ---
  Scenario: Admin reviews dispute queue tabs and count brackets
    Given I am logged into the Admin Portal
    When I open the "Dispute Management" page
    Then I should see four queue tabs: "Action Required", "Under Review", "Closed", and "All Disputes"
    And each tab label should display its count in brackets, e.g. "Action Required (count)"
    When I click a dispute case from the dispute list
    Then the split vertical details preview panel should slide in from the right

  # --- Dispute Actions ---
  Scenario: Admin approves merchant representment evidence
    Given I am logged into the Admin Portal
    And I am viewing a dispute under "Action Required" that has merchant evidence
    When I click the "✓ Accept & Submit to Visa" button
    Then the dispute should transition to Visa pending review state
    And the status should display "Chargeback In Progress"

  Scenario Outline: Admin simulates Visa Webhook outcomes
    Given I am logged into the Admin Portal
    And I am viewing a dispute case where the case is submitted to Visa (visaPending is true)
    Then I should see the Visa Simulator options
    When I click the simulator button "<Action>"
    Then the dispute status transitions to the "<Outcome>" state

    Examples:
      | Action           | Outcome |
      | Pre-Arb Won      | won     |
      | Arbitration Won  | won     |
      | Pre-Arb Lost     | lost    |
      | Arbitration Lost | lost    |

  # --- VROL Import center ---
  Scenario: Admin imports VROL dispute batch files
    Given I am logged into the Admin Portal
    When I navigate to the "VROL Import Center" page
    And I select a Visa VROL CSV/XLSX batch data file and click "Upload File"
    Then the new VROL disputes should be parsed, created, and populated in the system database

  # --- FAQ Floating Help ---
  Scenario: Admin opens FAQ help widget
    Given I am logged into the Admin Portal
    When I click the circular "?" floating button in the bottom-right corner
    Then the fixed floating FAQ card should open in the bottom-right corner

  # ═════════════════════════════════════════════════════════════════════════
  # END-TO-END DISPUTE ACTION LIFE CYCLE FLOW
  # ═════════════════════════════════════════════════════════════════════════

  Scenario Outline: End-to-End dispute lifecycle flow across all portals
    Given a new dispute case "<CaseID>" is raised in the system database
    
    # 1. Merchant Action Flow: Contest the dispute
    When I log into the Merchant Portal as "<MerchantUser>" with password "<MerchantPass>"
    And I go to the Dispute Management page
    And I contest the dispute "<CaseID>" by uploading evidence documents
    Then the dispute status transitions to "Chargeback In Progress" under the Merchant "Under Review" tab
    And a timeline entry "Remarks Updated by <MerchantUser>" is appended to the audit log

    # 2. Admin Action Flow: Accept representment and submit to Visa
    When I log into the Admin Portal as "<AdminUser>" with password "<AdminPass>"
    And I select the dispute "<CaseID>" under the Admin "Action Required" queue
    And I verify the merchant uploaded documents
    And I click the "✓ Accept & Submit to Visa" button
    Then the dispute status remains "Chargeback In Progress" with visa pending review (visaPending is true)
    And a timeline entry "Submitted to Visa" is appended to the audit log

    # 3. Visa Simulator Webhook Flow: Resolve dispute
    When I trigger the Visa Simulator webhook outcome "<VisaResult>" for case "<CaseID>"
    Then the dispute status transitions to "<FinalStatus>" under the Admin "Closed" queue
    And a timeline entry "<FinalStatus>" is appended to the audit log

    Examples:
      | CaseID | MerchantUser | MerchantPass | AdminUser | AdminPass | VisaResult      | FinalStatus     |
      | CB001  | masteruser   | Test@2026    | Test@Ad   | Test@2027 | Pre-Arb Won     | Chargeback Won  |
      | CB002  | Test@isu     | Test@2026    | Test@Ad   | Test@2027 | Pre-Arb Lost    | Chargeback Lost |
      | CB005  | masteruser   | Test@2026    | Test@Ad   | Test@2027 | Arbitration Won | Chargeback Won  |
      | CB024  | Test@isu     | Test@2026    | Test@Ad   | Test@2027 | Arbitration Lost| Chargeback Lost |
