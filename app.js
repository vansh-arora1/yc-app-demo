const state = {
  screen: "intake",
  workflow: null,
  baseChecklist: null,
  edgeCases: [],
  selectedCase: "",
  packetIndexed: false,
  indexingRunning: false,
  indexingLineIndex: -1,
  checklistGenerated: false,
  checklistRunning: false,
  checklistLineIndex: -1,
  overlaysConfirmed: false,
  overlayPreset: "standard",
  overlayConfig: {
    reserveMonths: "2",
    maxDuDti: "50",
    largeDepositThreshold: "50",
    incomeVarianceTolerance: "3",
    requireWrittenVoe: true,
    requireTitleClearance: true,
    appraisalShortfallAction: "contract_amendment_or_restructure",
  },
  activeBucket: "borrower_risk",
  bucketRunning: null,
  bucketLineIndex: -1,
  completedBuckets: new Set(),
  blockedBuckets: new Set(),
  externalFetched: new Set(),
  corrections: {},
  bucketOutputs: {},
  correctionDrafts: {},
  previewDoc: null,
  timers: [],
};

const app = document.querySelector("#app");
const gateLabel = document.querySelector("#gateLabel");
const screenTabs = document.querySelector("#screenTabs");
const summaryBorrower = document.querySelector("#summaryBorrower");
const summaryProperty = document.querySelector("#summaryProperty");
const summaryLoanAmount = document.querySelector("#summaryLoanAmount");
const summaryPrice = document.querySelector("#summaryPrice");
const summaryCrumb = document.querySelector("#summaryCrumb");

const visibleCaseIds = ["clean", "EC03", "EC02", "EC05"];

const caseProfiles = {
  clean: {
    title: "Clean purchase packet",
    borrower: "Maya Raman",
    property: "725 Sample Street, Los Angeles, CA",
    purpose: "Purchase",
    product: "Conventional / Fannie DU / 30-year fixed",
    state: "CA",
    county: "Los Angeles County",
    occupancy: "Primary residence",
    incomeType: "W-2 fixed base",
    monthlyIncome: "$15,000",
    loanAmount: "$640,000",
    price: "$800,000",
    triggers: [],
    collateralPath: "Full appraisal branch",
  },
  EC02: {
    title: "Large deposit source review",
    borrower: "Maya Raman",
    property: "725 Sample Street, Los Angeles, CA",
    purpose: "Purchase",
    product: "Conventional / Fannie DU / 30-year fixed",
    state: "CA",
    county: "Los Angeles County",
    occupancy: "Primary residence",
    incomeType: "W-2 fixed base",
    monthlyIncome: "$15,000",
    loanAmount: "$640,000",
    price: "$800,000",
    triggers: ["large_deposit", "source_account_required"],
    collateralPath: "Full appraisal branch",
  },
  EC03: {
    title: "Income variance requiring VOE",
    borrower: "Maya Raman",
    property: "725 Sample Street, Los Angeles, CA",
    purpose: "Purchase",
    product: "Conventional / Fannie DU / 30-year fixed",
    state: "CA",
    county: "Los Angeles County",
    occupancy: "Primary residence",
    incomeType: "W-2 fixed base with written VOE",
    monthlyIncome: "$15,000 stated / $14,500 supported",
    loanAmount: "$640,000",
    price: "$800,000",
    triggers: ["income_variance", "written_voe_required"],
    collateralPath: "Full appraisal branch",
  },
  EC05: {
    title: "Appraisal shortfall restructure",
    borrower: "Maya Raman",
    property: "725 Sample Street, Los Angeles, CA",
    purpose: "Purchase",
    product: "Conventional / Fannie DU / 30-year fixed",
    state: "CA",
    county: "Los Angeles County",
    occupancy: "Primary residence",
    incomeType: "W-2 fixed base",
    monthlyIncome: "$15,000",
    loanAmount: "$640,000 proposed / $608,000 restructured",
    price: "$800,000 contract / $760,000 appraisal",
    triggers: ["value_shortfall", "du_rerun_required", "contract_amendment_required"],
    collateralPath: "Full appraisal with value shortfall",
  },
};

const intakeDocuments = [
  { name: "URLA - Fannie Form 1003 / Freddie Form 65", source: "Borrower + loan officer", category: "Application", applies: () => true },
  { name: "SCIF - Form 1103", source: "Borrower", category: "Application", applies: () => true },
  { name: "Credit authorization / blanket authorization", source: "Borrower", category: "Application", applies: () => true },
  { name: "IRS Form 4506-C", source: "Borrower + lender", category: "Income/QC", applies: () => true },
  { name: "Executed residential purchase agreement", source: "Buyer / seller / agents", category: "Property", applies: () => true },
  { name: "Most recent paystub with YTD earnings", source: "Employer/payroll", category: "Income", applies: () => true },
  { name: "Most recent W-2", source: "Employer / borrower", category: "Income", applies: () => true },
  { name: "Two consecutive monthly bank statements", source: "Bank / borrower", category: "Assets", applies: () => true },
  { name: "Source account statement and transfer trace", source: "Borrower / depository institution", category: "Assets", applies: (profile) => profile.triggers.includes("source_account_required") },
  { name: "Form 1005 written VOE", source: "Employer", category: "Income", applies: (profile) => profile.triggers.includes("written_voe_required") },
  { name: "Current liability statement", source: "Creditor / borrower", category: "Credit/liabilities", applies: (profile) => profile.triggers.includes("new_liability") },
  { name: "Executed contract amendment", source: "Buyer / seller / agents", category: "Collateral", applies: (profile) => profile.triggers.includes("contract_amendment_required") },
  { name: "Corrected title commitment", source: "Title company", category: "Title", applies: (profile) => profile.triggers.includes("corrected_title_required") },
  { name: "Corrected application pages", source: "Loan officer / borrower", category: "Application", applies: (profile) => profile.triggers.includes("corrected_application_required") },
];

const scenarioSpecs = {
  clean: {
    story: "Happy path from borrower/LO application package through third-party evidence and underwriter-ready packet.",
    intakeFinding: "All borrower-provided documents are indexed and matched to the canonical application.",
  },
  EC03: {
    story: "Income evidence conflicts with the application; the agent compresses the VOE outreach loop.",
    ruleIds: ["P2-INCOME", "P2-DU-DATA"],
    triggeredBy: "Paystub annualizes to $174,000 while URLA/Form 1003 states $180,000.",
    invalidates: ["INCOME", "DTI", "DU_CASEFILE", "UNDERWRITING_READY"],
    neededEvidence: ["Form 1005 written VOE", "corrected income snapshot", "DTI recalculation"],
    contactRoute: "Borrower plus employer / VOE provider; direct contact when permitted, otherwise loan-officer mediated.",
    manualPath: "BPO asks the loan officer to chase borrower and employer; typical clarification loop adds about 5 days.",
    outreachActions: ["Send VOE request", "Draft LO message", "Place borrower call", "Send secure upload link"],
    outreachLog: [
      "Drafted borrower/LO explanation citing P2-INCOME and lender income-variance overlay.",
      "Placed borrower call to confirm salary reduction and employer verification path.",
      "Sent Form 1005 request to Pacific Analytics, Inc. through the VOE route.",
    ],
    receivedEvidence: "Form 1005 written VOE, corrected income snapshot and DTI recalculation",
    resolvedSummary: "Qualified income reduced to $14,500/month; DTI recalculated to 32.48%; DU inputs marked current for rerun.",
    supplementName: "supplement_written_voe.json",
  },
  EC02: {
    story: "Large deposit affects funds-to-close; the agent requests source evidence directly instead of waiting on a manual LO handoff.",
    ruleIds: ["P2-ASSETS", "P2-DU-DATA"],
    triggeredBy: "$25,000 deposit appears in the reviewed checking account period without source trail.",
    invalidates: ["FUNDS_TO_CLOSE", "RISK_VERIFIED", "DU_CASEFILE"],
    neededEvidence: ["source account statement", "transfer trace", "funds-to-close recalculation"],
    contactRoute: "Borrower direct or loan-officer mediated; bank/asset verification provider if digital verification is selected.",
    manualPath: "BPO cannot contact the borrower directly, so the request waits for LO follow-up and document return.",
    outreachActions: ["Send source-document request", "Place borrower call", "Send secure upload link", "Request asset verification report"],
    outreachLog: [
      "Sent secure upload request for source account statement and transfer trace.",
      "Called borrower to classify the $25,000 deposit as owned savings, gift, payroll, sale proceeds or new debt.",
      "Received transfer trace from owned savings account with no new debt indicated.",
    ],
    receivedEvidence: "Savings account statement and matched $25,000 transfer trace dated 2026-07-18",
    resolvedSummary: "Deposit traced from borrower-owned savings; no new debt indicated; usable funds and reserves restored.",
    supplementName: "supplement_source_account.json + supplement_transfer_trace.json",
  },
  EC05: {
    story: "Collateral value shortfall forces restructured terms; the agent coordinates the LO/agents/AMC loop and refreshes DU inputs.",
    ruleIds: ["P3-APPRAISAL", "P3-VALUATION-PATH", "P4-DU"],
    triggeredBy: "Appraisal supports $760,000 against the original $800,000 contract price.",
    invalidates: ["LTV", "CASH_TO_CLOSE", "MI", "DU_CASEFILE", "UNDERWRITING_READY", "DISCLOSURES"],
    neededEvidence: ["executed contract amendment", "restructured terms snapshot", "refreshed DU Findings"],
    contactRoute: "Loan officer with buyer/seller agents; AMC/appraiser only if ROV is selected.",
    manualPath: "Processor waits for LO to coordinate buyer, seller, agents and appraisal response before DU can be refreshed.",
    outreachActions: ["Draft LO message", "Request contract amendment", "Record restructured terms", "Rerun DU with updated terms"],
    outreachLog: [
      "Drafted LO task explaining appraised value below contract price and affected LTV/cash-to-close.",
      "Requested executed contract amendment or restructured terms from transaction parties.",
      "Prepared DU rerun using updated value, price, loan amount and cash-to-close.",
    ],
    receivedEvidence: "Executed contract amendment, restructured terms and refreshed DU run",
    resolvedSummary: "Purchase price lowered to $760,000; loan amount lowered to $608,000; LTV restored to 80%; DU rerun supersedes prior run.",
    supplementName: "supplement_contract_amendment.json + supplement_restructured_terms.json + supplement_du_rerun.json",
  },
};

const indexingLogs = [
  ["Read document packet", "Open the selected packet and register Form 1003/Form 65, Form 1103, blanket authorization, Form 4506-C, purchase agreement, income and asset documents."],
  ["Extract application data", "Pull borrower, property, purpose, product, state, county, occupancy, price, loan amount, income profile and monthly income from the indexed documents."],
  ["Classify document inventory", "Group application, income, asset and property documents for later rule generation."],
  ["Write extracted fields", "Populate the application form and mark only missing, unreadable or unindexed documents."],
];

const checklistLogs = [
  ["Extract loan factors", "Loan purpose, product, investor path, state, county, occupancy, income type and collateral path are read from the packet."],
  ["Select rule layers", "Federal, Fannie Mae, DU-message, California, county and lender-control layers are applied in order."],
  ["Create requirement groups", "Borrower risk and collateral assessment sections are generated from the extracted factors."],
  ["Prepare assessment sections", "Each requirement is mapped to borrower risk or collateral assessment."],
];

const requirements = [
  {
    id: "BR-CREDIT",
    bucket: "borrower_risk",
    group: "Credit and liabilities",
    title: "Credit report and URLA liabilities reconcile",
    basis: "Tri-merge mortgage credit report, URLA/Form 1003 liabilities, inquiries, derogatory events and liability disposition.",
    applies: () => true,
  },
  {
    id: "BR-CREDIT-SCORE",
    bucket: "borrower_risk",
    group: "Credit and liabilities",
    title: "Mortgage credit report is pulled and scored",
    basis: "Tri-merge mortgage credit report supplies repository coverage, representative credit score, tradelines, inquiries and derogatory-event review.",
    applies: () => true,
  },
  {
    id: "BR-INCOME",
    bucket: "borrower_risk",
    group: "Income and employment",
    title: "W-2 fixed base income is supported",
    basis: "Most recent paystub with YTD earnings, W-2, Form 1005 written VOE or approved third-party VOE report when required.",
    applies: () => true,
  },
  {
    id: "BR-ASSETS",
    bucket: "borrower_risk",
    group: "Assets and funds to close",
    title: "Funds to close and reserves are supported",
    basis: "Two consecutive monthly bank statements, Verification of Deposit - Form 1006, gift/source evidence when triggered.",
    applies: () => true,
  },
  {
    id: "BR-ASSET-COMPLETE",
    bucket: "borrower_risk",
    group: "Assets and funds to close",
    title: "Asset statements are complete by account and period",
    basis: "Two consecutive monthly statements must include all pages and ending balances for the reviewed account periods.",
    applies: (profile) => profile.triggers.includes("missing_asset_page"),
  },
  {
    id: "BR-LARGE-DEPOSIT",
    bucket: "borrower_risk",
    group: "Assets and funds to close",
    title: "Large deposit source trail is documented",
    basis: "Deposits greater than 50 percent of monthly qualifying income require source account statement, transfer trace or deduction.",
    applies: (profile) => profile.triggers.includes("large_deposit"),
  },
  {
    id: "BR-RESERVE-OVERLAY",
    bucket: "borrower_risk",
    group: "Assets and funds to close",
    title: "Lender reserve overlay is met",
    basis: "Provider reserve overlay must be included in funds-to-close and reserve testing.",
    applies: () => true,
  },
  {
    id: "BR-DU-DATA",
    bucket: "borrower_risk",
    group: "DU data integrity",
    title: "Borrower data is current before DU submission",
    basis: "Income, liabilities, assets and declarations must match the current application snapshot.",
    applies: () => true,
  },
  {
    id: "BR-DU-SUBMISSION",
    bucket: "borrower_risk",
    group: "DU data integrity",
    title: "Desktop Underwriter casefile uses current borrower data",
    basis: "DU MISMO 3.4 request must use current income, liability, asset and declaration data before DU Findings are relied on.",
    applies: (profile) => profile.triggers.includes("du_rerun_required") || profile.triggers.includes("income_variance"),
  },
  {
    id: "BR-DU-FINDINGS",
    bucket: "borrower_risk",
    group: "DU data integrity",
    title: "DU Findings are mapped to evidence and conditions",
    basis: "Every DU message is mapped to evidence, documented relief, a condition, or not-applicable rationale.",
    applies: (profile) => profile.triggers.includes("stale_du") || profile.triggers.includes("du_rerun_required"),
  },
  {
    id: "BR-IDENTITY",
    bucket: "borrower_risk",
    group: "Application identity",
    title: "Borrower identity is consistent across application and credit evidence",
    basis: "Corrected application pages or identity-resolution clarification is required when Form 1003 and credit evidence conflict.",
    applies: (profile) => profile.triggers.includes("identity_conflict"),
  },
  {
    id: "COLL-VALUATION",
    bucket: "collateral",
    group: "Valuation path",
    title: "Appraisal or value-acceptance path is supported",
    basis: "Collateral Underwriter route, appraisal report + UAD artifact, UCDP Submission Summary Report or value-acceptance eligibility.",
    applies: () => true,
  },
  {
    id: "COLL-SHORTFALL",
    bucket: "collateral",
    group: "Valuation path",
    title: "Value shortfall response is documented",
    basis: "Contract amendment, restructured terms, revised LTV/cash-to-close and refreshed DU submission when appraised value is below price.",
    applies: (profile) => profile.triggers.includes("value_shortfall"),
  },
  {
    id: "COLL-TITLE-FLOOD",
    bucket: "collateral",
    group: "Title, flood and property identity",
    title: "Property identity reconciles across title, flood, contract and appraisal",
    basis: "Preliminary title report/title commitment, legal description, APN, vesting, flood determination certificate and subject address.",
    applies: () => true,
  },
  {
    id: "COLL-TITLE-CORRECTION",
    bucket: "collateral",
    group: "Title, flood and property identity",
    title: "Corrected title commitment resolves parcel mismatch",
    basis: "Corrected title commitment must match subject APN, legal description, address and intended vesting.",
    applies: (profile) => profile.triggers.includes("corrected_title_required"),
  },
  {
    id: "COLL-INSURANCE",
    bucket: "collateral",
    group: "Insurance and property costs",
    title: "Insurance and property-cost inputs are available",
    basis: "Homeowners insurance quote/binder/evidence of insurance plus property tax and assessment data.",
    applies: () => true,
  },
  {
    id: "COLL-PROVIDER-OVERLAY",
    bucket: "collateral",
    group: "Collateral provider overlay",
    title: "Provider collateral overlay is satisfied",
    basis: "Value shortfall, title-clearance and collateral-document requirements must follow the selected lender/provider overlay.",
    applies: () => true,
  },
  {
    id: "COLL-UAD-UCDP",
    bucket: "collateral",
    group: "Valuation path",
    title: "Appraisal dataset and UCDP submission are retained",
    basis: "Appraisal/UAD adapter version and UCDP Submission Summary Report are retained with the collateral record.",
    applies: (profile) => profile.collateralPath.includes("appraisal"),
  },
];

const ruleLayers = [
  ["Application package", "URLA/Form 1003/Form 65, SCIF/Form 1103, blanket authorization, Form 4506-C and purchase agreement"],
  ["Fannie Mae Selling Guide", "Borrower eligibility, credit, liabilities, income, assets and collateral documentation"],
  ["Desktop Underwriter", "DU MISMO 3.4 request, DU Findings messages, evidence mapping and resubmission triggers"],
  ["California purchase overlay", "California property identity, title, escrow, insurance and state-specific purchase-file controls"],
  ["Lender controls", "Processor review, evidence dedupe, prefunding QC and condition closeout"],
  ["Freddie Mac sibling path", "Form 65/LPA adapter retained for the same canonical loan core when investor path changes"],
];

const overlayPresets = {
  standard: {
    label: "Standard lender overlay",
    config: {
      reserveMonths: "2",
      maxDuDti: "50",
      largeDepositThreshold: "50",
      incomeVarianceTolerance: "3",
      requireWrittenVoe: true,
      requireTitleClearance: true,
      appraisalShortfallAction: "contract_amendment_or_restructure",
    },
  },
  conservative: {
    label: "Conservative provider overlay",
    config: {
      reserveMonths: "4",
      maxDuDti: "45",
      largeDepositThreshold: "25",
      incomeVarianceTolerance: "1",
      requireWrittenVoe: true,
      requireTitleClearance: true,
      appraisalShortfallAction: "contract_amendment_required",
    },
  },
  fast_close: {
    label: "Fast-close digital verification",
    config: {
      reserveMonths: "1",
      maxDuDti: "50",
      largeDepositThreshold: "50",
      incomeVarianceTolerance: "5",
      requireWrittenVoe: false,
      requireTitleClearance: true,
      appraisalShortfallAction: "du_rerun_with_restructured_terms",
    },
  },
  appraisal_sensitive: {
    label: "Appraisal-sensitive purchase",
    config: {
      reserveMonths: "2",
      maxDuDti: "48",
      largeDepositThreshold: "50",
      incomeVarianceTolerance: "3",
      requireWrittenVoe: true,
      requireTitleClearance: true,
      appraisalShortfallAction: "contract_amendment_required",
    },
  },
};

const bucketDefinitions = {
  borrower_risk: {
    label: "Borrower risk assessment",
    cta: "Run borrower risk",
    evidenceCta: "Fetch credit, DU and verifications",
    evidenceDone: "Credit, DU and verifications obtained",
    railDone: "credit/DU obtained",
    dataPulls: [
      ["Tri-merge mortgage credit report", "Repository coverage, representative score, tradelines, inquiries and derogatory events"],
      ["Desktop Underwriter Findings", "DU MISMO 3.4 submission response, recommendation, messages and documentation relief"],
      ["Employment verification", "Form 1005 written VOE or approved third-party VOE report when triggered"],
      ["Asset verification", "Verification of Deposit - Form 1006 or approved asset report when bank statements are not enough"],
    ],
    logs: [
      ["Credit pull", "Request tri-merge mortgage credit report, receive repository coverage, representative score, tradelines and inquiry data."],
      ["Income review", "Compare paystub, W-2 and Form 1005/VOE path against qualifying income used for DU."],
      ["Asset review", "Check two months statements, page completeness, usable balances and large-deposit triggers."],
      ["Desktop Underwriter", "Build DU MISMO 3.4 request from current borrower data and compare DU Findings to the current application snapshot."],
    ],
    issueTriggers: ["missing_asset_page", "large_deposit", "income_variance", "new_liability", "identity_conflict"],
  },
  collateral: {
    label: "Collateral assessment",
    cta: "Run collateral",
    evidenceCta: "Fetch CU, appraisal, title and flood",
    evidenceDone: "CU, appraisal, title and flood obtained",
    railDone: "CU/title obtained",
    dataPulls: [
      ["Collateral Underwriter response", "Value acceptance route, CU risk score and appraisal messages"],
      ["Appraisal package", "Appraisal report, UAD data file and UCDP Submission Summary Report"],
      ["Title commitment", "Vesting, APN, legal description, exceptions and title-company corrections"],
      ["Flood and insurance evidence", "Flood determination certificate and homeowners insurance quote/binder/evidence of insurance"],
    ],
    logs: [
      ["Valuation route", "Check value acceptance, property data collection, appraisal report + UAD and UCDP status."],
      ["Price/value test", "Compare contract price, appraised value, loan amount, LTV and cash to close."],
      ["Title and flood", "Reconcile title commitment, legal description, APN, flood determination and subject property address."],
      ["Property conditions", "Check insurance evidence, property tax inputs and collateral blockers."],
    ],
    issueTriggers: ["value_shortfall", "title_mismatch"],
  },
};

function profile() {
  return caseProfiles[state.selectedCase] || null;
}

function activeProfile() {
  return profile() || caseProfiles.clean;
}

function extractedProfile() {
  return state.packetIndexed ? profile() : null;
}

function clearTimers() {
  state.timers.forEach((timer) => clearTimeout(timer));
  state.timers = [];
}

function switchScreen(screen) {
  if (screen === "overlays" && !state.packetIndexed) return;
  if (screen === "checklist" && !state.packetIndexed) return;
  if (screen === "checklist" && !state.overlaysConfirmed) return;
  if (screen === "workbench" && !state.checklistGenerated) return;
  state.screen = screen;
  render();
}

function resetDerivedState() {
  clearTimers();
  state.packetIndexed = false;
  state.indexingRunning = false;
  state.indexingLineIndex = -1;
  state.checklistGenerated = false;
  state.checklistRunning = false;
  state.checklistLineIndex = -1;
  state.overlaysConfirmed = false;
  state.overlayPreset = "standard";
  state.overlayConfig = { ...overlayPresets.standard.config };
  state.activeBucket = "borrower_risk";
  state.bucketRunning = null;
  state.bucketLineIndex = -1;
  state.completedBuckets = new Set();
  state.blockedBuckets = new Set();
  state.externalFetched = new Set();
  state.corrections = {};
  state.correctionDrafts = {};
  state.bucketOutputs = {};
  state.previewDoc = null;
  state.screen = "intake";
}

function runIndexedSequence(kind, logs, onFinish) {
  clearTimers();
  logs.forEach((_, index) => {
    const timer = setTimeout(() => {
      if (kind === "indexing") state.indexingLineIndex = index;
      if (kind === "checklist") state.checklistLineIndex = index;
      if (kind === "bucket") state.bucketLineIndex = index;
      render();
      if (index === logs.length - 1) onFinish();
    }, 1050 * (index + 1));
    state.timers.push(timer);
  });
}

function runIndexing() {
  if (!profile() || state.indexingRunning) return;
  state.indexingRunning = true;
  state.indexingLineIndex = -1;
  state.packetIndexed = false;
  state.checklistGenerated = false;
  state.overlaysConfirmed = false;
  state.completedBuckets = new Set();
  state.blockedBuckets = new Set();
  state.externalFetched = new Set();
  state.corrections = {};
  state.bucketOutputs = {};
  render();
  runIndexedSequence("indexing", indexingLogs, () => {
    state.indexingRunning = false;
    state.indexingLineIndex = -1;
    state.packetIndexed = true;
    render();
  });
}

function runChecklistGeneration() {
  if (!state.packetIndexed || !state.overlaysConfirmed || state.checklistRunning) return;
  state.checklistRunning = true;
  state.checklistLineIndex = -1;
  state.checklistGenerated = false;
  render();
  runIndexedSequence("checklist", checklistLogs, () => {
    state.checklistRunning = false;
    state.checklistLineIndex = -1;
    state.checklistGenerated = true;
    render();
  });
}

function runBucket(bucketId) {
  if (!canRunBucket(bucketId)) return;
  const bucket = bucketDefinitions[bucketId];
  state.activeBucket = bucketId;
  state.bucketRunning = bucketId;
  state.bucketLineIndex = -1;
  state.bucketOutputs[bucketId] = null;
  render();
  runIndexedSequence("bucket", bucket.logs, () => finishBucket(bucketId));
}

function canFetchExternalEvidence(bucketId) {
  if (!state.checklistGenerated || state.bucketRunning || state.externalFetched.has(bucketId)) return false;
  if (bucketId === "collateral" && !state.completedBuckets.has("borrower_risk")) return false;
  return true;
}

function fetchExternalEvidence(bucketId) {
  if (!canFetchExternalEvidence(bucketId)) return;
  state.externalFetched.add(bucketId);
  state.activeBucket = bucketId;
  render();
}

function recordOutreachAction(label) {
  const output = state.bucketOutputs[state.activeBucket];
  if (!output || output.status !== "Review needed") return;
  const draft = state.correctionDrafts[state.activeBucket] || {};
  draft.outreach = draft.outreach || [];
  const scripted = output.outreachLog?.[draft.outreach.length];
  draft.outreach.push(scripted || `${label} initiated for ${output.neededEvidence?.[0] || "required evidence"}.`);
  state.correctionDrafts[state.activeBucket] = draft;
  render();
}

function receiveExpectedEvidence(bucketId) {
  const output = state.bucketOutputs[bucketId];
  if (!output || output.status !== "Review needed") return;
  const draft = state.correctionDrafts[bucketId] || {};
  draft.evidenceReceived = output.receivedEvidence || output.supplementName || "Expected supplement received";
  draft.document = draft.evidenceReceived;
  draft.note = output.resolvedSummary || draft.note;
  state.correctionDrafts[bucketId] = draft;
  render();
}

function invalidateFromOverlayEdit() {
  state.overlaysConfirmed = false;
  state.checklistGenerated = false;
  state.checklistRunning = false;
  state.checklistLineIndex = -1;
  state.bucketRunning = null;
  state.bucketLineIndex = -1;
  state.completedBuckets = new Set();
  state.blockedBuckets = new Set();
  state.externalFetched = new Set();
  state.corrections = {};
  state.correctionDrafts = {};
  state.bucketOutputs = {};
}

function applyOverlayPreset(presetId) {
  const preset = overlayPresets[presetId];
  if (!preset) return;
  state.overlayPreset = presetId;
  state.overlayConfig = { ...preset.config };
  invalidateFromOverlayEdit();
  render();
}

function updateOverlayField(field, value) {
  if (!(field in state.overlayConfig)) return;
  state.overlayConfig = { ...state.overlayConfig, [field]: value };
  state.overlayPreset = "custom";
  invalidateFromOverlayEdit();
  render();
}

function confirmOverlays() {
  if (!state.packetIndexed) return;
  state.overlaysConfirmed = true;
  state.screen = "checklist";
  render();
}

function canRunBucket(bucketId) {
  if (!state.checklistGenerated || state.bucketRunning || state.blockedBuckets.has(bucketId)) return false;
  if (!state.externalFetched.has(bucketId)) return false;
  if (bucketId === "collateral" && !state.completedBuckets.has("borrower_risk")) return false;
  return true;
}

function bucketLockReason(bucketId) {
  if (bucketId === "collateral" && !state.completedBuckets.has("borrower_risk")) return "Borrower risk must clear first";
  if (!state.externalFetched.has(bucketId)) return bucketDefinitions[bucketId].evidenceCta;
  if (state.blockedBuckets.has(bucketId)) return "Correction needed";
  return "";
}

function finishBucket(bucketId) {
  const issue = bucketIssue(bucketId);
  state.bucketRunning = null;
  state.bucketLineIndex = -1;
  if (issue && !state.corrections[bucketId]?.cleared) {
    state.blockedBuckets.add(bucketId);
    state.completedBuckets.delete(bucketId);
    state.bucketOutputs[bucketId] = { status: "Review needed", ...issue };
  } else {
    state.blockedBuckets.delete(bucketId);
    state.completedBuckets.add(bucketId);
    state.bucketOutputs[bucketId] = {
      status: "Cleared",
      title: `${bucketDefinitions[bucketId].label} cleared`,
      summary: state.corrections[bucketId]?.resolvedSummary || "Requirements tied to this assessment are satisfied for the current packet.",
      evidence: requirementsForBucket(bucketId).map((item) => item.title),
    };
  }
  render();
}

function bucketIssue(bucketId) {
  const triggers = activeProfile().triggers;
  const config = state.overlayConfig;
  const spec = scenarioSpecs[state.selectedCase] || {};
  if (bucketId === "borrower_risk") {
    if (triggers.includes("missing_asset_page")) {
      return {
        title: "Incomplete asset statement",
        summary: "July bank statement is missing a page, so funds to close cannot clear.",
        correction: "Upload missing page 2 or an accepted replacement account verification covering the same account and period.",
      };
    }
    if (triggers.includes("large_deposit")) {
      return {
        title: "Large deposit source trail missing",
        summary: `Deposit exceeds the selected lender threshold of ${config.largeDepositThreshold} percent of monthly qualifying income and affects usable assets.`,
        correction: `Upload source account statement and transfer trace, or add a processor clarification excluding unsupported funds under the ${config.largeDepositThreshold}% lender overlay.`,
        rule: "P2-ASSETS",
        overlay: `Large deposit threshold = ${config.largeDepositThreshold}% / reserves = ${config.reserveMonths} months`,
        ...spec,
      };
    }
    if (triggers.includes("income_variance")) {
      return {
        title: "Qualifying income variance",
        summary: `Paystub supports lower income than Form 1003 and exceeds the selected ${config.incomeVarianceTolerance}% variance tolerance.`,
        correction: config.requireWrittenVoe
          ? "Upload Form 1005 written VOE or correct qualifying income and recalculate DTI."
          : "Attach accepted digital employment verification or add processor clarification to correct income and recalculate DTI.",
        rule: "P2-INCOME",
        overlay: `Income variance tolerance = ${config.incomeVarianceTolerance}% / written VOE ${config.requireWrittenVoe ? "required" : "not required"}`,
        ...spec,
      };
    }
    if (triggers.includes("new_liability")) {
      return {
        title: "Undisclosed liability",
        summary: "Credit evidence shows a monthly payment not listed on Form 1003.",
        correction: "Upload liability statement or add borrower clarification, then update DTI and DU data.",
      };
    }
    if (triggers.includes("identity_conflict")) {
      return {
        title: "Borrower identity conflict",
        summary: "Application evidence contains conflicting borrower identity.",
        correction: "Upload corrected application pages or add identity-resolution clarification before credit matching.",
      };
    }
  }
  if (bucketId === "collateral") {
    if (triggers.includes("value_shortfall")) {
      return {
        title: "Value below contract price",
        summary: "Appraised value is below purchase price, affecting LTV, cash to close and DU data.",
        correction: collateralCorrectionText(config),
        rule: "P3-APPRAISAL / P4-DU",
        overlay: `Appraisal shortfall response = ${config.appraisalShortfallAction.replaceAll("_", " ")}`,
        ...spec,
      };
    }
    if (triggers.includes("title_mismatch")) {
      return {
        title: "Title parcel mismatch",
        summary: "Title commitment does not reconcile to contract and appraisal property identity.",
        correction: config.requireTitleClearance
          ? "Upload corrected title commitment from the title company before collateral can clear."
          : "Add title-company clarification and retain the mismatch as a processor-reviewed exception.",
      };
    }
  }
  return null;
}

function collateralCorrectionText(config) {
  if (config.appraisalShortfallAction === "contract_amendment_required") {
    return "Upload executed contract amendment and rerun LTV/cash-to-close before collateral can clear.";
  }
  if (config.appraisalShortfallAction === "du_rerun_with_restructured_terms") {
    return "Record restructured terms, rerun DU with updated value and cash-to-close, then attach the refreshed findings.";
  }
  return "Upload contract amendment or record restructured terms, then refresh LTV, cash-to-close and DU data.";
}

function requirementsForBucket(bucketId) {
  return requirements.filter((item) => item.bucket === bucketId && item.applies(activeProfile()));
}

function requirementStatus(item) {
  if (state.checklistRunning) return "Generating";
  if (!state.checklistGenerated) return "Not generated";
  const issue = bucketIssue(item.bucket);
  if (state.blockedBuckets.has(item.bucket) && issue && impactedByIssue(item, issue)) return "Review needed";
  if (state.corrections[item.bucket]?.cleared && impactedByIssue(item, issue)) return "Cleared";
  if (state.completedBuckets.has(item.bucket)) return "Cleared";
  return "Required";
}

function impactedByIssue(item, issue) {
  if (!issue) return false;
  const title = issue.title.toLowerCase();
  if (title.includes("asset") || title.includes("deposit")) return item.id.includes("ASSET") || item.id.includes("LARGE") || item.id.includes("DU-DATA");
  if (title.includes("income")) return item.id.includes("INCOME") || item.id.includes("DU-DATA");
  if (title.includes("liability") || title.includes("identity")) return item.id.includes("CREDIT") || item.id.includes("DU-DATA");
  if (title.includes("value")) return item.id.includes("VALUATION") || item.id.includes("SHORTFALL");
  if (title.includes("title")) return item.id.includes("TITLE");
  return item.bucket === state.activeBucket;
}

function statusClass(status) {
  if (status === "Review needed") return "attention";
  if (status === "Cleared") return "satisfied";
  return "queued";
}

function visibleSequence(kind, logs) {
  if (kind === "indexing") {
    if (state.packetIndexed) return logs;
    return state.indexingRunning ? logs.slice(0, state.indexingLineIndex + 1) : [];
  }
  if (kind === "checklist") {
    if (state.checklistGenerated) return logs;
    return state.checklistRunning ? logs.slice(0, state.checklistLineIndex + 1) : [];
  }
  if (kind === "bucket") {
    if (state.bucketOutputs[state.activeBucket]) return bucketDefinitions[state.activeBucket].logs;
    return state.bucketRunning === state.activeBucket
      ? bucketDefinitions[state.activeBucket].logs.slice(0, state.bucketLineIndex + 1)
      : [];
  }
  return [];
}

function render() {
  renderTabs();
  updateLoanSummary();
  gateLabel.textContent = gateText();
  if (state.screen === "intake") renderIntake();
  if (state.screen === "overlays") renderOverlays();
  if (state.screen === "checklist") renderChecklist();
  if (state.screen === "workbench") renderWorkbench();
}

function updateLoanSummary() {
  const current = extractedProfile();
  if (summaryBorrower) summaryBorrower.textContent = current?.borrower || "Not extracted";
  if (summaryProperty) summaryProperty.textContent = current?.property || "Not extracted";
  if (summaryLoanAmount) summaryLoanAmount.textContent = current?.loanAmount || "Not extracted";
  if (summaryPrice) summaryPrice.textContent = current?.price || "Not extracted";
  if (summaryCrumb) {
    summaryCrumb.textContent = current
      ? `${current.borrower} / Fannie DU conventional purchase / ${current.county}, ${current.state}`
      : "Select a borrower persona, then index documents to extract the application.";
  }
}

function renderTabs() {
  const tabs = [
    ["intake", "Intake", true],
    ["overlays", "Overlays", state.packetIndexed],
    ["checklist", "Checklist", state.packetIndexed && state.overlaysConfirmed],
    ["workbench", "Workbench", state.checklistGenerated],
  ];
  screenTabs.innerHTML = tabs.map(([id, label, enabled]) => `
    <button class="tab ${state.screen === id ? "active" : ""}" type="button" data-screen="${id}" ${enabled ? "" : "disabled"}>${label}</button>
  `).join("");
}

function gateText() {
  if (!profile()) return "Select persona";
  if (!state.packetIndexed) return "Index documents";
  if (!state.overlaysConfirmed) return "Review overlays";
  if (!state.checklistGenerated) return "Compliance rules";
  if (state.blockedBuckets.size) return "Correction needed";
  if (state.completedBuckets.size === 2) return "Packet complete";
  return bucketDefinitions[state.activeBucket].label;
}

function renderIntake() {
  const current = profile();
  const extracted = extractedProfile();
  const documents = current ? intakeDocuments.filter((doc) => doc.applies(current)) : [];
  const previewName = current ? state.previewDoc || documents[0]?.name : null;
  app.innerHTML = `
    <section class="screen-head">
      <div>
        <span class="eyebrow">Step 1</span>
        <h1>Application form</h1>
        <p>Select a borrower persona to load documents. Indexing extracts loan information from those documents and fills the application fields.</p>
      </div>
      <div class="agent-actions">
        <button class="btn secondary" type="button" data-screen="overlays" ${!state.packetIndexed ? "disabled" : ""}>Review overlays</button>
        <button class="btn primary" type="button" data-action="run-indexing" ${!current || state.indexingRunning ? "disabled" : ""}>${state.packetIndexed ? "Re-index / extract" : "Index / extract"}</button>
      </div>
    </section>

    <section class="intake-input-surface">
      <div class="panel packet-panel">
        <div class="packet-drop">
          <div>
            <span class="eyebrow">Borrower persona</span>
            <h2>Application package</h2>
            <p>Choose a prepared loan file. The document inventory loads first; the form stays blank until indexing finishes.</p>
          </div>
          <label class="packet-select">
            <span>Packet</span>
            <select id="caseSelect" aria-label="Loan packet">
              <option value="" ${state.selectedCase === "" ? "selected" : ""}>Select persona</option>
              ${visibleCaseIds.map((id) => [id, caseProfiles[id]])
                .map(([id, item]) => `<option value="${id}" ${id === state.selectedCase ? "selected" : ""}>${id} - ${item.title}</option>`)
                .join("")}
            </select>
          </label>
          ${current ? `
            <div class="case-summary">
              <strong>${current.title}</strong>
              <span>${scenarioSpecs[state.selectedCase]?.story || caseTriggerText(current)}</span>
            </div>
          ` : `<div class="case-summary muted-box">No packet selected.</div>`}
        </div>
      </div>

      <div class="panel application-panel">
        <div class="application-head">
          <div>
            <div class="panel-title">Application fields</div>
            <p>${extracted ? "Fields extracted from the indexed document packet." : "Fields will populate after document indexing and extraction."}</p>
          </div>
          <span class="extract-badge ${extracted ? "complete" : ""}">${extracted ? "Extracted" : "Blank"}</span>
        </div>

        <div class="application-summary">
          <div>
            <span>Borrower</span>
            <strong>${extracted?.borrower || "Not extracted"}</strong>
          </div>
          <div>
            <span>Property</span>
            <strong>${extracted?.property || "Not extracted"}</strong>
          </div>
          <div>
            <span>Loan amount</span>
            <strong>${extracted?.loanAmount || "Not extracted"}</strong>
          </div>
        </div>

        <div class="application-sections">
          <section>
            <h3>Loan terms</h3>
            <div class="form-grid refined">
              <label class="wide"><span>Product</span><input value="${extracted?.product || ""}" placeholder="Extracted during indexing" readonly /></label>
              <label><span>Loan purpose</span><input value="${extracted?.purpose || ""}" placeholder="Extracted during indexing" readonly /></label>
              <label><span>Occupancy</span><input value="${extracted?.occupancy || ""}" placeholder="Extracted during indexing" readonly /></label>
              <label><span>Purchase price</span><input value="${extracted?.price || ""}" placeholder="Extracted during indexing" readonly /></label>
              <label><span>Loan amount</span><input value="${extracted?.loanAmount || ""}" placeholder="Extracted during indexing" readonly /></label>
            </div>
          </section>

          <section>
            <h3>Borrower and property</h3>
            <div class="form-grid refined">
              <label class="wide"><span>Borrower</span><input value="${extracted?.borrower || ""}" placeholder="Extracted during indexing" readonly /></label>
              <label class="wide"><span>Subject property</span><input value="${extracted?.property || ""}" placeholder="Extracted during indexing" readonly /></label>
              <label><span>State / county</span><input value="${extracted ? `${extracted.state} / ${extracted.county}` : ""}" placeholder="Extracted during indexing" readonly /></label>
              <label><span>Monthly income</span><input value="${extracted?.monthlyIncome || ""}" placeholder="Extracted during indexing" readonly /></label>
              <label class="wide"><span>Income profile</span><input value="${extracted?.incomeType || ""}" placeholder="Extracted during indexing" readonly /></label>
            </div>
          </section>
        </div>
      </div>
    </section>

    ${(state.indexingRunning || state.packetIndexed) ? `
      <section class="panel intake-progress-panel">
        <div class="panel-title">Indexing and extraction</div>
        ${renderSequence("indexing", indexingLogs, "Packet has not been indexed.")}
      </section>
    ` : ""}

    <section class="document-browser">
      <div class="panel">
        <div class="panel-title">Document inventory</div>
        <div class="document-table">
          <div class="document-row document-row-head">
            <span>Document</span>
            <span>Source</span>
            <span>Category</span>
            <span>Status</span>
            <span>View</span>
          </div>
          ${documents.length ? documents.map((doc) => renderDocumentRow(doc, previewName)).join("") : `<div class="empty-state">Select a persona to load the document inventory.</div>`}
        </div>
      </div>
      <aside class="panel document-preview">
        <div class="panel-title">Document View</div>
        ${renderDocumentPreview(previewName)}
      </aside>
    </section>
  `;
}

function caseTriggerText(current) {
  return current.triggers.length
    ? current.triggers.map((item) => item.replaceAll("_", " ")).join(" / ")
    : "Complete baseline packet";
}

function renderDocumentRow(doc, previewName) {
  const status = documentInventoryStatus(doc.name);
  const rowTone = state.packetIndexed ? status.tone : "queued";
  return `
    <div class="document-row ${rowTone} ${previewName === doc.name ? "selected" : ""}">
      <strong>${doc.name}</strong>
      <span>${doc.source}</span>
      <span>${doc.category}</span>
      <em>${state.packetIndexed ? status.label : "Pending index"}</em>
      <button class="inline-action" type="button" data-preview-doc="${doc.name}">View</button>
    </div>
  `;
}

function renderDocumentPreview(name) {
  if (!name) return `<div class="empty-state">Select a document.</div>`;
  const current = extractedProfile();
  const status = documentInventoryStatus(name);
  if (!current) {
    return `
      <article class="stub-card">
        <strong>${name}</strong>
        <p>Document is loaded in the packet. Run indexing to extract borrower, property, loan terms and compliance-driving factors from this file.</p>
      </article>
    `;
  }
  return `
    <article class="stub-card ${status.tone}">
      <strong>${name}</strong>
      <dl>
        <div><dt>Borrower</dt><dd>${current.borrower}</dd></div>
        <div><dt>Subject property</dt><dd>${current.property}</dd></div>
        <div><dt>Indexed status</dt><dd>${state.packetIndexed ? status.label : "Pending index"}</dd></div>
        <div><dt>Extracted use</dt><dd>${stubUse(name)}</dd></div>
      </dl>
      <p>${stubFinding(name)}</p>
    </article>
  `;
}

function stubUse(name) {
  if (name.includes("1003") || name.includes("65")) return "Application identity, liabilities, declarations and loan terms.";
  if (name.includes("1103")) return "Supplemental consumer information and language preference capture.";
  if (name.includes("4506")) return "Income validation and prefunding QC evidence.";
  if (name.includes("paystub") || name.includes("W-2") || name.includes("VOE")) return "Qualifying income and employment support.";
  if (name.includes("bank") || name.includes("Source")) return "Funds to close, reserves and large-deposit sourcing.";
  if (name.includes("purchase") || name.includes("contract")) return "Purchase price, parties, property address and transaction terms.";
  if (name.includes("title")) return "APN, legal description, vesting and title exceptions.";
  return "Packet evidence for generated compliance requirements.";
}

function stubFinding(name) {
  if (!state.packetIndexed) return "Document contents are available as a prepared synthetic stub after indexing.";
  return "Indexed for application extraction and document inventory. Rule checks run later in the checklist and workbench.";
}

function renderOverlays() {
  const current = activeProfile();
  const config = state.overlayConfig;
  app.innerHTML = `
    <section class="screen-head">
      <div>
        <span class="eyebrow">Step 3</span>
        <h1>Rule overlays</h1>
        <p>Baseline agency, federal and California rules are locked. The loan officer can edit product and lender/provider overlays before checklist generation.</p>
      </div>
      <div class="agent-actions">
        <button class="btn secondary" type="button" data-screen="intake">Back to application</button>
        <button class="btn primary" type="button" data-action="confirm-overlays">Confirm overlays</button>
      </div>
    </section>

    <section class="overlay-layout">
      <aside class="panel">
        <div class="panel-title">Locked baseline layers</div>
        <div class="layer-list">
          ${[
            ["Federal / TRID", "Application date, disclosure clock, corrected-disclosure trigger controls"],
            ["Fannie Mae Selling Guide", "Borrower evidence, assets, income, collateral and DU documentation requirements"],
            ["Freddie Mac sibling adapter", "LPA path remains versioned but inactive for the selected Fannie DU route"],
            ["California / county", `${current.state} and ${current.county} jurisdiction, title and recording controls`],
          ].map(renderRuleLayer).join("")}
        </div>
      </aside>

      <section class="panel overlay-editor">
        <div class="application-head">
          <div>
            <div class="panel-title">Editable product and provider overlays</div>
            <p>These values change the generated checklist and what a resolution agent asks for when a file is blocked.</p>
          </div>
          <span class="extract-badge ${state.overlaysConfirmed ? "complete" : ""}">${state.overlaysConfirmed ? "Confirmed" : "Draft"}</span>
        </div>

        <div class="preset-row">
          ${Object.entries(overlayPresets).map(([id, preset]) => `
            <button class="preset-button ${state.overlayPreset === id ? "active" : ""}" type="button" data-overlay-preset="${id}">
              <strong>${preset.label}</strong>
            </button>
          `).join("")}
        </div>

        <div class="overlay-sections">
          <section>
            <h3>Loan product overlay</h3>
            <div class="form-grid refined">
              <label><span>Reserve months</span><input data-overlay-field="reserveMonths" value="${config.reserveMonths}" /></label>
              <label><span>DU DTI cap</span><input data-overlay-field="maxDuDti" value="${config.maxDuDti}" /></label>
              <label class="wide"><span>Appraisal shortfall response</span>
                <select data-overlay-field="appraisalShortfallAction">
                  <option value="contract_amendment_or_restructure" ${config.appraisalShortfallAction === "contract_amendment_or_restructure" ? "selected" : ""}>Contract amendment or restructured terms</option>
                  <option value="contract_amendment_required" ${config.appraisalShortfallAction === "contract_amendment_required" ? "selected" : ""}>Contract amendment required</option>
                  <option value="du_rerun_with_restructured_terms" ${config.appraisalShortfallAction === "du_rerun_with_restructured_terms" ? "selected" : ""}>DU rerun with restructured terms</option>
                </select>
              </label>
            </div>
          </section>

          <section>
            <h3>Lender / verification provider overlay</h3>
            <div class="form-grid refined">
              <label><span>Large deposit threshold</span><input data-overlay-field="largeDepositThreshold" value="${config.largeDepositThreshold}" /></label>
              <label><span>Income variance tolerance</span><input data-overlay-field="incomeVarianceTolerance" value="${config.incomeVarianceTolerance}" /></label>
              <label class="checkbox-field wide">
                <input type="checkbox" data-overlay-field="requireWrittenVoe" ${config.requireWrittenVoe ? "checked" : ""} />
                <span>Require Form 1005 written VOE when income variance exceeds tolerance</span>
              </label>
              <label class="checkbox-field wide">
                <input type="checkbox" data-overlay-field="requireTitleClearance" ${config.requireTitleClearance ? "checked" : ""} />
                <span>Require title-company clearance before collateral can clear</span>
              </label>
            </div>
          </section>
        </div>
      </section>

      <aside class="panel">
        <div class="panel-title">Generated-rule impact</div>
        <div class="impact-list">
          ${overlayImpacts().map(([title, detail]) => `
            <article>
              <strong>${title}</strong>
              <span>${detail}</span>
            </article>
          `).join("")}
        </div>
      </aside>
    </section>
  `;
}

function overlayImpacts() {
  const config = state.overlayConfig;
  return [
    ["Assets", `Large deposits above ${config.largeDepositThreshold}% of monthly qualifying income require source account evidence or exclusion from usable funds.`],
    ["Income", config.requireWrittenVoe
      ? `Income variance above ${config.incomeVarianceTolerance}% asks for Form 1005 written VOE or corrected qualifying income.`
      : `Income variance above ${config.incomeVarianceTolerance}% can be cleared with accepted digital verification or processor clarification.`],
    ["DU submission", `DU request is blocked when DTI exceeds ${config.maxDuDti}% or when edited overlay inputs change the current application hash.`],
    ["Collateral", collateralOverlayText(config)],
    ["Reserves", `${config.reserveMonths} months reserves are included in the rule checklist and funds-to-close test.`],
  ];
}

function collateralOverlayText(config) {
  if (config.appraisalShortfallAction === "contract_amendment_required") {
    return "Value shortfall resolution requires an executed contract amendment before collateral can clear.";
  }
  if (config.appraisalShortfallAction === "du_rerun_with_restructured_terms") {
    return "Value shortfall resolution can clear with restructured terms and a refreshed DU run.";
  }
  return "Value shortfall resolution accepts a contract amendment or restructured terms with refreshed LTV/cash-to-close.";
}

function documentInventoryStatus(name) {
  return { label: "Indexed", tone: "satisfied" };
}

function ruleMeta(item) {
  if (item.id.includes("OVERLAY")) return ["Editable lender/provider overlay", "Loan officer confirmed overlay version"];
  if (item.id.startsWith("BR-DU")) return ["Desktop Underwriter", "DU MISMO 3.4 / DU Findings"];
  if (item.id.includes("CREDIT")) return ["Fannie Mae", "Selling Guide credit and liabilities documentation"];
  if (item.id.includes("INCOME")) return ["Fannie Mae", "Selling Guide income and employment documentation"];
  if (item.id.includes("ASSET") || item.id.includes("LARGE")) return ["Fannie Mae", "Selling Guide asset documentation / Form 1006 path"];
  if (item.id.includes("IDENTITY")) return ["Application package", "URLA/Form 1003 identity and borrower evidence"];
  if (item.id.includes("VALUATION") || item.id.includes("SHORTFALL") || item.id.includes("UAD")) return ["Fannie Mae collateral", "Collateral Underwriter / UAD / UCDP"];
  if (item.id.includes("TITLE")) return ["California purchase overlay", "Title commitment, APN, legal description and flood evidence"];
  if (item.id.includes("INSURANCE")) return ["Lender controls", "Insurance, property tax and escrow inputs"];
  return ["Lender controls", "Processor checklist control"];
}

function sourceRuleId(item) {
  if (item.id.includes("CREDIT")) return "P2-CREDIT";
  if (item.id.includes("INCOME")) return "P2-INCOME";
  if (item.id.includes("ASSET") || item.id.includes("LARGE") || item.id.includes("RESERVE")) return "P2-ASSETS";
  if (item.id.includes("DU")) return "P2-DU-DATA / P4-DU";
  if (item.id.includes("VALUATION")) return "P3-VALUATION-PATH";
  if (item.id.includes("SHORTFALL") || item.id.includes("UAD") || item.id.includes("APPRAISAL")) return "P3-APPRAISAL";
  if (item.id.includes("TITLE") || item.id.includes("INSURANCE")) return "P3-TITLE-FLOOD";
  if (item.id.includes("IDENTITY")) return "P1-URLA";
  return "Overlay rule";
}

function overlayAwareBasis(item) {
  const config = state.overlayConfig;
  if (item.id === "BR-LARGE-DEPOSIT") {
    return `Deposits greater than ${config.largeDepositThreshold} percent of monthly qualifying income require source account statement, transfer trace or deduction.`;
  }
  if (item.id === "BR-INCOME") {
    return config.requireWrittenVoe
      ? `Paystub/W-2 income must reconcile within ${config.incomeVarianceTolerance} percent or be supported by Form 1005 written VOE.`
      : `Paystub/W-2 income must reconcile within ${config.incomeVarianceTolerance} percent or be supported by accepted digital employment verification.`;
  }
  if (item.id === "BR-DU-DATA" || item.id === "BR-DU-SUBMISSION") {
    return `DU MISMO 3.4 request must use current borrower data; lender DU DTI cap is ${config.maxDuDti} percent.`;
  }
  if (item.id === "BR-RESERVE-OVERLAY") {
    return `Provider overlay requires ${config.reserveMonths} months reserves to be included in funds-to-close and reserves testing.`;
  }
  if (item.id === "COLL-SHORTFALL" || item.id === "COLL-PROVIDER-OVERLAY") {
    return collateralOverlayText(config);
  }
  if (item.id === "COLL-TITLE-CORRECTION") {
    return config.requireTitleClearance
      ? "Corrected title commitment must be obtained from the title company before collateral can clear."
      : "Title-company clarification may be retained as an exception when provider overlay permits processor review.";
  }
  return item.basis;
}

function renderRuleLayer([title, detail]) {
  return `
    <article class="layer-card">
      <strong>${title}</strong>
      <span>${detail}</span>
    </article>
  `;
}

function checklistSubtitle() {
  if (state.checklistGenerated) return "Compliance rules are generated for this application packet and mapped into the workbench sections.";
  if (state.checklistRunning) return "Rule layers are being evaluated against the indexed application packet.";
  return "Generate the deterministic compliance rules after document indexing.";
}

function generatedRequirementCount(activeRequirements) {
  return visibleRequirements(activeRequirements).length;
}

function visibleRuleLayers() {
  const layers = [...ruleLayers, ...confirmedOverlayLayers()];
  if (state.checklistGenerated) return layers;
  if (!state.checklistRunning) return [];
  if (state.checklistLineIndex < 1) return [];
  if (state.checklistLineIndex === 1) return layers.slice(0, 3);
  return layers;
}

function confirmedOverlayLayers() {
  const config = state.overlayConfig;
  return [
    ["Editable product overlay", `Reserves ${config.reserveMonths} months; DU DTI cap ${config.maxDuDti}%; appraisal shortfall: ${config.appraisalShortfallAction.replaceAll("_", " ")}`],
    ["Editable lender/provider overlay", `Large deposit threshold ${config.largeDepositThreshold}%; income variance tolerance ${config.incomeVarianceTolerance}%; written VOE ${config.requireWrittenVoe ? "required" : "not required"}`],
  ];
}

function visibleRequirements(activeRequirements) {
  if (state.checklistGenerated) return activeRequirements;
  if (!state.checklistRunning || state.checklistLineIndex < 2) return [];
  if (state.checklistLineIndex === 2) {
    return activeRequirements.filter((item) => item.bucket === "borrower_risk");
  }
  return activeRequirements;
}

function renderedRuleRequirements(grouped) {
  return ["borrower_risk", "collateral"].map((bucketId) => {
    const bucketRules = grouped[bucketId] || [];
    if (!bucketRules.length && !state.checklistGenerated) return "";
    return `
    <section class="requirement-phase">
      <div class="phase-heading">
        <strong>${bucketDefinitions[bucketId].label}</strong>
        <span>${bucketRules.length} ${bucketRules.length === 1 ? "rule" : "rules"}</span>
      </div>
      ${bucketRules.length ? bucketRules.map(renderRequirement).join("") : `<div class="empty-state">Rules not assembled yet.</div>`}
    </section>
  `;
  }).join("");
}

function renderChecklist() {
  const current = activeProfile();
  const activeRequirements = requirements.filter((item) => item.applies(current));
  const visibleRules = visibleRequirements(activeRequirements);
  const grouped = groupBy(visibleRules, "bucket");
  const visibleLayers = visibleRuleLayers();
  app.innerHTML = `
    <section class="screen-head">
      <div>
        <span class="eyebrow">Step 2</span>
        <h1>Compliance rules</h1>
        <p>${checklistSubtitle()}</p>
      </div>
      <div class="agent-actions">
        <button class="btn secondary" type="button" data-action="run-checklist" ${!state.packetIndexed || !state.overlaysConfirmed || state.checklistRunning ? "disabled" : ""}>
          ${state.checklistGenerated ? "Regenerate rules" : "Generate rules"}
        </button>
        <button class="btn primary" type="button" data-screen="workbench" ${!state.checklistGenerated ? "disabled" : ""}>Open workbench</button>
      </div>
    </section>

    <section class="checklist-layout checklist-rebuilt">
      <aside class="panel">
        <div class="score-card">
          <span>Applicable rules</span>
          <strong>${generatedRequirementCount(activeRequirements)}</strong>
        </div>
        <div class="panel-title">Rule overlays</div>
        <div class="layer-list">
          ${visibleLayers.length ? visibleLayers.map(renderRuleLayer).join("") : `<div class="empty-state">Rule overlays will appear as the assembly agent selects them.</div>`}
        </div>

        <div class="panel-title spaced">Rule assembly log</div>
        ${renderSequence("checklist", checklistLogs, "Generate compliance rules after packet indexing.")}
      </aside>

      <section class="panel">
        <div class="panel-title">Generated rule checklist</div>
        <div class="requirements">
          ${visibleRules.length ? renderedRuleRequirements(grouped) : `<div class="empty-state">${state.checklistRunning ? "Waiting for rule assembly output." : "No rules generated yet."}</div>`}
        </div>
      </section>
    </section>
  `;
}

function renderWorkbench() {
  const bucket = bucketDefinitions[state.activeBucket];
  const fetched = state.externalFetched.has(state.activeBucket);
  const lockReason = bucketLockReason(state.activeBucket);
  app.innerHTML = `
    <section class="screen-head">
      <div>
        <span class="eyebrow">Step 4</span>
        <h1>Agent workbench</h1>
        <p>Run assessment buckets; findings update the checklist.</p>
      </div>
      <button class="btn secondary" type="button" data-screen="checklist">View checklist</button>
    </section>

    <section class="agent-grid workbench-rebuilt">
      <aside class="panel">
        <div class="panel-title">Assessment buckets</div>
        ${Object.entries(bucketDefinitions).map(([bucketId, item]) => renderBucketButton(bucketId, item)).join("")}
      </aside>

      <section class="panel run-panel">
        <div class="run-head">
          <div>
            <span class="eyebrow">${bucket.label}</span>
            <h2>${bucket.label}</h2>
            <p>${requirementsForBucket(state.activeBucket).length} generated requirements${lockReason ? ` · ${lockReason}` : ""}</p>
          </div>
          <div class="run-actions">
            <button class="btn secondary" type="button" data-fetch-evidence="${state.activeBucket}" ${canFetchExternalEvidence(state.activeBucket) ? "" : "disabled"}>
              ${fetched ? bucket.evidenceDone : bucket.evidenceCta}
            </button>
            <button class="btn primary" type="button" data-run-bucket="${state.activeBucket}" ${canRunBucket(state.activeBucket) ? "" : "disabled"}>
              ${state.bucketRunning === state.activeBucket ? "Running..." : bucket.cta}
            </button>
          </div>
        </div>

        <div class="data-pull-strip">
          ${bucket.dataPulls.map(([label, detail]) => `
            <article class="${fetched ? "obtained" : ""}">
              <strong>${label}</strong>
              <span>${detail}</span>
              <em>${fetched ? "Obtained" : "Required"}</em>
            </article>
          `).join("")}
        </div>

        <div class="bucket-layout">
          <div>
            <div class="panel-title">Checklist subsection</div>
            <div class="requirements compact-requirements">
              ${requirementsForBucket(state.activeBucket).map(renderRequirement).join("")}
            </div>
          </div>
          <div class="assessment-run">
            <div>
              <div class="panel-title">Agent log</div>
              ${renderSequence("bucket", bucket.logs, `Run ${bucket.label} to start assessment.`)}
            </div>
            <div>
              <div class="panel-title spaced">Output</div>
              ${renderBucketOutput()}
            </div>
          </div>
        </div>
      </section>

      <aside class="panel">
        ${renderCorrectionPanel()}
      </aside>
    </section>
  `;
}

function renderRequirement(item) {
  const status = requirementStatus(item);
  const [authority, source] = ruleMeta(item);
  return `
    <article class="requirement ${statusClass(status)}">
      <div>
        <strong>${item.title}</strong>
        <p>${overlayAwareBasis(item)}</p>
        <div class="chips">
          <span>${sourceRuleId(item)}</span>
          <span>${item.group}</span>
          <span>${authority}</span>
          <span>${source}</span>
        </div>
      </div>
      <em>${status}</em>
    </article>
  `;
}

function renderBucketButton(bucketId, bucket) {
  const active = state.activeBucket === bucketId;
  const blocked = state.blockedBuckets.has(bucketId);
  const complete = state.completedBuckets.has(bucketId);
  const locked = bucketId === "collateral" && !state.completedBuckets.has("borrower_risk");
  const fetched = state.externalFetched.has(bucketId);
  return `
    <button class="stage-button ${active ? "active" : ""} ${blocked ? "blocked" : ""} ${complete ? "complete" : ""} ${locked ? "locked" : ""}" type="button" data-bucket="${bucketId}">
      <i aria-hidden="true"></i>
      <span>${bucket.label}</span>
      <strong>${blocked ? "review needed" : complete ? "cleared" : locked ? "locked" : fetched ? bucket.railDone : "not run"}</strong>
    </button>
  `;
}

function renderSequence(kind, logs, emptyText) {
  const visible = visibleSequence(kind, logs);
  if (!visible.length) return `<div class="empty-state">${emptyText}</div>`;
  const running = (kind === "indexing" && state.indexingRunning)
    || (kind === "checklist" && state.checklistRunning)
    || (kind === "bucket" && state.bucketRunning === state.activeBucket);
  return `
    <div class="log-list compact">
      ${visible.map(([title, detail], index) => {
        const active = running && index === visible.length - 1;
        return `
          <div class="log-entry ${active ? "active" : ""}">
            <div class="log-topline">
              <span class="${active ? "spinner" : "dot"}"></span>
              <strong>${title}</strong>
              <em>${active ? "running" : "done"}</em>
            </div>
            <p>${detail}</p>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderBucketOutput() {
  const output = state.bucketOutputs[state.activeBucket];
  if (!output) {
    return `
      <div class="output-card pending">
        <strong>Not run</strong>
        <p>${bucketDefinitions[state.activeBucket].label} has not run for this packet.</p>
      </div>
    `;
  }
  return `
    <div class="output-card ${output.status === "Cleared" ? "greenlit" : "flagged"}">
      <div class="output-status">${output.status}</div>
      <h3>${output.title}</h3>
      <p>${output.summary}</p>
      ${output.rule ? `
        <dl>
          <div><dt>Rule</dt><dd>${output.rule}</dd></div>
          <div><dt>Triggered by</dt><dd>${output.triggeredBy || "Assessment evidence conflict"}</dd></div>
          <div><dt>Invalidates</dt><dd>${(output.invalidates || []).join(", ")}</dd></div>
        </dl>
      ` : ""}
    </div>
  `;
}

function renderCorrectionPanel() {
  const output = state.bucketOutputs[state.activeBucket];
  if (!output || output.status !== "Review needed") {
    return `
      <div class="panel-title">Correction</div>
      <p class="muted">No correction open.</p>
    `;
  }
  const correction = state.corrections[state.activeBucket] || {};
  const draft = state.correctionDrafts[state.activeBucket] || {};
  const outreach = draft.outreach || [];
  const canReceive = outreach.length > 0 && !draft.evidenceReceived;
  const canClear = Boolean(draft.evidenceReceived || draft.document || draft.note);
  return `
    <div class="panel-title">Resolution</div>
    <div class="resolution-stack">
      <div class="resolution-card flagged">
        <span>Finding</span>
        <strong>${output.title}</strong>
        <p>${output.summary}</p>
      </div>

      <dl class="resolution-facts">
        <div><dt>Triggered by</dt><dd>${output.triggeredBy || output.summary}</dd></div>
        <div><dt>Rule</dt><dd>${output.rule || "Generated checklist rule"}</dd></div>
        <div><dt>Overlay</dt><dd>${output.overlay || "Baseline rule stack"}</dd></div>
        <div><dt>Invalidates</dt><dd>${(output.invalidates || []).join(", ")}</dd></div>
        <div><dt>Needed evidence</dt><dd>${(output.neededEvidence || [output.correction]).join(", ")}</dd></div>
        <div><dt>Contact route</dt><dd>${output.contactRoute || "Processor review"}</dd></div>
      </dl>

      <div class="cycle-note">
        <strong>Cycle-time compression</strong>
        <p>${output.manualPath || "Manual handoff waits on the loan officer before evidence returns."}</p>
      </div>

      <div class="outreach-actions">
        ${(output.outreachActions || ["Draft LO message", "Send secure upload link"]).map((label) => `
          <button class="inline-action" type="button" data-outreach-action="${label}">${label}</button>
        `).join("")}
      </div>

      <div class="outreach-log">
        <div class="panel-title">Outreach log</div>
        ${outreach.length ? outreach.map((item) => `
          <div class="log-entry">
            <div class="log-topline"><span class="dot"></span><strong>${item}</strong><em>sent</em></div>
          </div>
        `).join("") : `<div class="empty-state">Choose an outreach action to start the evidence loop.</div>`}
      </div>

      <div class="received-evidence ${draft.evidenceReceived ? "complete" : ""}">
        <span>Received evidence</span>
        <strong>${draft.evidenceReceived || "No supplement received yet"}</strong>
        <p>${draft.evidenceReceived ? output.resolvedSummary : "After outreach, receive the hardcoded supplement or upload a supporting file."}</p>
      </div>

      <button class="btn secondary" type="button" data-receive-evidence="${state.activeBucket}" ${canReceive ? "" : "disabled"}>Receive expected evidence</button>
    </div>
    <div class="correction-form">
      <label>
        <span>Upload alternate document</span>
        <input id="correctionFile" type="file" />
      </label>
      <label>
        <span>Clarification</span>
        <textarea id="correctionNote" placeholder="Enter borrower, processor, vendor, or title-company clarification">${draft.note || ""}</textarea>
      </label>
      ${draft.document ? renderChatBubble("processor", `Attached document: ${draft.document}`) : ""}
      ${draft.note ? renderChatBubble("processor", `Clarification: ${draft.note}`) : ""}
      ${correction.cleared ? renderChatBubble("agent", "Correction recorded. Requirement status updated to Cleared.") : ""}
      <button class="btn primary" type="button" data-correction="clear" ${canClear ? "" : "disabled"}>Record correction</button>
    </div>
  `;
}

function renderChatBubble(role, text) {
  return `
    <div class="chat-bubble ${role}">
      <span>${role === "agent" ? "Agent" : "Processor"}</span>
      <p>${text}</p>
    </div>
  `;
}

function groupBy(items, key) {
  return items.reduce((groups, item) => {
    groups[item[key]] = groups[item[key]] || [];
    groups[item[key]].push(item);
    return groups;
  }, {});
}

document.addEventListener("click", (event) => {
  const screenButton = event.target.closest("[data-screen]");
  if (screenButton) switchScreen(screenButton.dataset.screen);

  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action === "run-indexing") runIndexing();
  if (action === "run-checklist") runChecklistGeneration();
  if (action === "confirm-overlays") confirmOverlays();

  const overlayPresetButton = event.target.closest("[data-overlay-preset]");
  if (overlayPresetButton) applyOverlayPreset(overlayPresetButton.dataset.overlayPreset);

  const bucketButton = event.target.closest("[data-bucket]");
  if (bucketButton) {
    state.activeBucket = bucketButton.dataset.bucket;
    render();
  }

  const previewButton = event.target.closest("[data-preview-doc]");
  if (previewButton) {
    state.previewDoc = previewButton.dataset.previewDoc;
    render();
  }

  const runBucketButton = event.target.closest("[data-run-bucket]");
  if (runBucketButton) runBucket(runBucketButton.dataset.runBucket);

  const fetchEvidenceButton = event.target.closest("[data-fetch-evidence]");
  if (fetchEvidenceButton) fetchExternalEvidence(fetchEvidenceButton.dataset.fetchEvidence);

  const outreachButton = event.target.closest("[data-outreach-action]");
  if (outreachButton) recordOutreachAction(outreachButton.dataset.outreachAction);

  const receiveEvidenceButton = event.target.closest("[data-receive-evidence]");
  if (receiveEvidenceButton) receiveExpectedEvidence(receiveEvidenceButton.dataset.receiveEvidence);

  const correctionButton = event.target.closest("[data-correction]");
  if (correctionButton) {
    const kind = correctionButton.dataset.correction;
    const current = state.corrections[state.activeBucket] || {};
    const draft = state.correctionDrafts[state.activeBucket] || {};
    if (kind === "clear") {
      current.cleared = true;
      current.document = draft.document;
      current.note = draft.note;
      state.blockedBuckets.delete(state.activeBucket);
      state.completedBuckets.add(state.activeBucket);
      state.bucketOutputs[state.activeBucket] = {
        status: "Cleared",
        title: `${bucketDefinitions[state.activeBucket].label} cleared`,
        summary: draft.note || "Correction is recorded and tied requirements are cleared.",
      };
      current.resolvedSummary = draft.note;
    }
    state.corrections[state.activeBucket] = current;
    render();
  }
});

document.addEventListener("change", (event) => {
  if (event.target.id === "caseSelect") {
    state.selectedCase = event.target.value;
    resetDerivedState();
    render();
    return;
  }
  if (event.target.id === "correctionFile") {
    const draft = state.correctionDrafts[state.activeBucket] || {};
    draft.document = event.target.files?.[0]?.name || correctionDocumentName();
    state.correctionDrafts[state.activeBucket] = draft;
    render();
  }
  const overlayField = event.target.closest("[data-overlay-field]")?.dataset.overlayField;
  if (overlayField) {
    const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
    updateOverlayField(overlayField, value);
  }
});

document.addEventListener("input", (event) => {
  if (event.target.id !== "correctionNote") return;
  const draft = state.correctionDrafts[state.activeBucket] || {};
  draft.note = event.target.value.trim();
  state.correctionDrafts[state.activeBucket] = draft;
  render();
});

function correctionDocumentName() {
  const issue = bucketIssue(state.activeBucket);
  if (!issue) return "Supporting evidence";
  if (issue.title.includes("asset") || issue.title.includes("deposit")) return "Source account statement and transfer trace";
  if (issue.title.includes("income")) return "Form 1005 written VOE";
  if (issue.title.includes("liability")) return "Current liability statement";
  if (issue.title.includes("identity")) return "Corrected application pages";
  if (issue.title.includes("Value")) return "Executed contract amendment";
  if (issue.title.includes("Title")) return "Corrected title commitment";
  return "Supporting evidence";
}

function correctionNote() {
  const issue = bucketIssue(state.activeBucket);
  if (!issue) return "Processor clarification added.";
  return `${issue.title}: processor clarification recorded and linked to requirement.`;
}

function init() {
  state.workflow = {
    loan_route: "California conventional conforming purchase / Fannie DU",
    static_demo: true,
  };
  state.baseChecklist = { status: "static-demo" };
  state.edgeCases = visibleCaseIds
    .filter((id) => id !== "clean")
    .map((id) => ({ id, title: caseProfiles[id].title }));
  render();
}

init();
