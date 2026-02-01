export type MatchType = '1:1' | '1:N' | 'Manual' | 'System';
export type Status = 'matched' | 'pending' | 'unmatched' | 'rejected' | 'approved';
export type ApprovalStage = 'none' | 'submitted' | 'review' | 'posted';
export type BankName = 'Piraeus' | 'Alpha' | 'Eurobank';

export interface Transaction {
  id: string;
  date: string;
  bank_desc: string;
  gl_desc: string;
  amount: number;
  currency: 'EUR';
  bank_name: BankName;
  match_type: MatchType;
  confidence: number;
  status: Status;
  approval_stage: ApprovalStage;
  flags?: string[];
}

export interface RulesState {
  weekendAlert: boolean;
  highValue: boolean;
}

export interface ReconContextType {
  transactions: Transaction[];
  rulesState: RulesState;
  updateStatus: (id: string, newStatus: Status) => void;
  updateApprovalStage: (id: string, newStage: ApprovalStage) => void;
  toggleRule: (ruleKey: keyof RulesState) => void;
  recalculateFlags: () => void;
}

// Seed data
export const INITIAL_TRANSACTIONS: Transaction[] = [
  {
    id: "REC-2025-001",
    date: "2025-02-08",
    bank_desc: "DEH Utility Payment Ref: 99281",
    gl_desc: "Utilities Expense - DEH",
    amount: 1250.00,
    currency: "EUR",
    bank_name: "Piraeus",
    match_type: "1:1",
    confidence: 98,
    status: "matched",
    approval_stage: "none"
  },
  {
    id: "REC-2025-002",
    date: "2025-02-09",
    bank_desc: "INT'L TRANSFER - TechSol Ltd",
    gl_desc: "Vendor Pmt - TechSol",
    amount: 15000.00,
    currency: "EUR",
    bank_name: "Alpha",
    match_type: "Manual",
    confidence: 65,
    status: "pending",
    approval_stage: "none"
  },
  {
    id: "REC-2025-003",
    date: "2025-02-10",
    bank_desc: "AB VASSILOPOULOS POS 22",
    gl_desc: "Office Supplies",
    amount: 45.20,
    currency: "EUR",
    bank_name: "Eurobank",
    match_type: "1:1",
    confidence: 92,
    status: "matched",
    approval_stage: "none"
  },
  {
    id: "REC-2025-004",
    date: "2025-02-10",
    bank_desc: "Unknown Check 4421",
    gl_desc: "Unrecorded Liability",
    amount: 5000.00,
    currency: "EUR",
    bank_name: "Alpha",
    match_type: "Manual",
    confidence: 12,
    status: "rejected",
    approval_stage: "submitted"
  },
  {
    id: "REC-2025-005",
    date: "2025-02-15",
    bank_desc: "COSMOTE MOBILE FEB 2025",
    gl_desc: "Telecom Expenses",
    amount: 320.50,
    currency: "EUR",
    bank_name: "Piraeus",
    match_type: "1:1",
    confidence: 95,
    status: "matched",
    approval_stage: "none"
  },
  {
    id: "REC-2025-006",
    date: "2025-02-16",
    bank_desc: "PAYROLL BATCH 2025-02",
    gl_desc: "Salaries & Wages",
    amount: 42500.00,
    currency: "EUR",
    bank_name: "Alpha",
    match_type: "1:N",
    confidence: 88,
    status: "pending",
    approval_stage: "none"
  },
  {
    id: "REC-2025-007",
    date: "2025-02-17",
    bank_desc: "RENT Q1 2025 - PROP MGT",
    gl_desc: "Rent Expense",
    amount: 8500.00,
    currency: "EUR",
    bank_name: "Eurobank",
    match_type: "1:1",
    confidence: 99,
    status: "matched",
    approval_stage: "none"
  }
];
