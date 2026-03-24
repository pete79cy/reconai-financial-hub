import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import {
  Transaction,
  BankTransaction,
  GLTransaction,
  RulesState,
  ReconContextType,
  Status,
  ApprovalStage,
  INITIAL_TRANSACTIONS
} from '@/types/transaction';
import { calculateConfidence } from '@/utils/reconciliation';
import {
  CONFIDENCE_AUTO_MATCH_MIN,
  CONFIDENCE_HIGH,
  CONFIDENCE_MEDIUM,
  HIGH_VALUE_THRESHOLD,
} from '@/utils/constants';

const STORAGE_KEY = 'reconai_transactions';
const BANK_STORAGE_KEY = 'reconai_bank_transactions';
const GL_STORAGE_KEY = 'reconai_gl_transactions';
const RULES_KEY = 'reconai_rules';

const ReconContext = createContext<ReconContextType | undefined>(undefined);

function generateId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 12)}`;
}

function loadTransactions(): Transaction[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('Failed to load transactions:', e);
  }
  return INITIAL_TRANSACTIONS;
}

function loadBankTransactions(): BankTransaction[] {
  try {
    const stored = localStorage.getItem(BANK_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('Failed to load bank transactions:', e);
  }
  return [];
}

function loadGLTransactions(): GLTransaction[] {
  try {
    const stored = localStorage.getItem(GL_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('Failed to load GL transactions:', e);
  }
  return [];
}

function loadRules(): RulesState {
  try {
    const stored = localStorage.getItem(RULES_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('Failed to load rules:', e);
  }
  return { weekendAlert: true, highValue: true };
}

function saveTransactions(transactions: Transaction[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
}

function saveBankTransactions(transactions: BankTransaction[]) {
  localStorage.setItem(BANK_STORAGE_KEY, JSON.stringify(transactions));
}

function saveGLTransactions(transactions: GLTransaction[]) {
  localStorage.setItem(GL_STORAGE_KEY, JSON.stringify(transactions));
}

function saveRules(rules: RulesState) {
  localStorage.setItem(RULES_KEY, JSON.stringify(rules));
}

function isWeekend(dateStr: string): boolean {
  const day = new Date(dateStr).getDay();
  return day === 0 || day === 6;
}

function isHighValue(amount: number): boolean {
  return amount > HIGH_VALUE_THRESHOLD;
}

export function ReconProvider({ children }: { children: React.ReactNode }) {
  const [transactions, setTransactions] = useState<Transaction[]>(loadTransactions);
  const [bankTransactions, setBankTransactions] = useState<BankTransaction[]>(loadBankTransactions);
  const [glTransactions, setGLTransactions] = useState<GLTransaction[]>(loadGLTransactions);
  const [rulesState, setRulesState] = useState<RulesState>(loadRules);
  const [searchQuery, setSearchQuery] = useState('');

  // Filtered transactions based on search query
  const filteredTransactions = useMemo(() => {
    if (!searchQuery.trim()) return transactions;
    const q = searchQuery.toLowerCase();
    return transactions.filter(tx =>
      tx.id.toLowerCase().includes(q) ||
      tx.bank_desc.toLowerCase().includes(q) ||
      tx.gl_desc.toLowerCase().includes(q) ||
      tx.bank_name.toLowerCase().includes(q) ||
      tx.status.toLowerCase().includes(q) ||
      tx.amount.toFixed(2).includes(q)
    );
  }, [transactions, searchQuery]);

  const recalculateFlags = useCallback(() => {
    setTransactions(prev => {
      const updated = prev.map(tx => {
        const flags: string[] = [];

        if (rulesState.highValue && isHighValue(tx.amount)) {
          flags.push('High Value');
        }

        if (rulesState.weekendAlert && isWeekend(tx.date)) {
          flags.push('Weekend');
        }

        return { ...tx, flags };
      });

      saveTransactions(updated);
      return updated;
    });
  }, [rulesState]);

  // Recalculate flags when rules change
  useEffect(() => {
    recalculateFlags();
  }, [rulesState, recalculateFlags]);

  const updateStatus = useCallback((id: string, newStatus: Status) => {
    setTransactions(prev => {
      const updated = prev.map(tx =>
        tx.id === id ? { ...tx, status: newStatus } : tx
      );
      saveTransactions(updated);
      return updated;
    });
  }, []);

  const updateApprovalStage = useCallback((id: string, newStage: ApprovalStage) => {
    setTransactions(prev => {
      const updated = prev.map(tx =>
        tx.id === id ? { ...tx, approval_stage: newStage } : tx
      );
      saveTransactions(updated);
      return updated;
    });
  }, []);

  const toggleRule = useCallback((ruleKey: keyof RulesState) => {
    setRulesState(prev => {
      const updated = { ...prev, [ruleKey]: !prev[ruleKey] };
      saveRules(updated);
      return updated;
    });
  }, []);

  const importTransactions = useCallback((newTransactions: Transaction[]) => {
    setTransactions(prev => {
      const updated = [...prev, ...newTransactions];
      saveTransactions(updated);
      return updated;
    });
  }, []);

  const importBankTransactions = useCallback((txs: BankTransaction[]) => {
    setBankTransactions(prev => {
      // Duplicate detection: skip transactions with same amount+date+description
      const existingKeys = new Set(prev.map(t => `${t.date}|${t.amount}|${t.description}`));
      const newTxs = txs.filter(t => !existingKeys.has(`${t.date}|${t.amount}|${t.description}`));
      const updated = [...prev, ...newTxs];
      saveBankTransactions(updated);
      return updated;
    });
  }, []);

  const importGLTransactions = useCallback((txs: GLTransaction[]) => {
    setGLTransactions(prev => {
      // Duplicate detection: skip transactions with same amount+date+description
      const existingKeys = new Set(prev.map(t => `${t.date}|${t.amount}|${t.description}`));
      const newTxs = txs.filter(t => !existingKeys.has(`${t.date}|${t.amount}|${t.description}`));
      const updated = [...prev, ...newTxs];
      saveGLTransactions(updated);
      return updated;
    });
  }, []);

  const runAutoMatch = useCallback(() => {
    const usedBankIds = new Set<string>();
    const usedGLIds = new Set<string>();
    const newMatches: Transaction[] = [];

    // Match bank transactions to GL transactions
    for (const bankTx of bankTransactions) {
      if (usedBankIds.has(bankTx.id)) continue;

      let bestMatch: GLTransaction | null = null;
      let bestConfidence = 0;

      for (const glTx of glTransactions) {
        if (usedGLIds.has(glTx.id)) continue;

        // Must be same type (debit/credit)
        if (bankTx.type !== glTx.type) continue;

        const confidence = calculateConfidence(
          bankTx.amount,
          glTx.amount,
          bankTx.description,
          glTx.description
        );

        if (confidence > bestConfidence && confidence >= CONFIDENCE_AUTO_MATCH_MIN) {
          bestConfidence = confidence;
          bestMatch = glTx;
        }
      }

      if (bestMatch) {
        usedBankIds.add(bankTx.id);
        usedGLIds.add(bestMatch.id);

        newMatches.push({
          id: generateId('MATCH'),
          date: bankTx.date,
          bank_desc: bankTx.description,
          gl_desc: bestMatch.description,
          amount: bankTx.amount,
          currency: 'EUR',
          bank_name: bankTx.bank_name,
          match_type: bestConfidence >= CONFIDENCE_HIGH ? '1:1' : 'Manual',
          confidence: bestConfidence,
          status: bestConfidence >= CONFIDENCE_MEDIUM ? 'matched' : 'pending',
          approval_stage: 'none',
          bank_tx_id: bankTx.id,
          gl_tx_id: bestMatch.id,
        });
      }
    }

    // Add unmatched bank transactions
    for (const bankTx of bankTransactions) {
      if (!usedBankIds.has(bankTx.id)) {
        newMatches.push({
          id: generateId('UNMATCHED-BANK'),
          date: bankTx.date,
          bank_desc: bankTx.description,
          gl_desc: '',
          amount: bankTx.amount,
          currency: 'EUR',
          bank_name: bankTx.bank_name,
          match_type: 'Manual',
          confidence: 0,
          status: 'unmatched',
          approval_stage: 'none',
          bank_tx_id: bankTx.id,
        });
      }
    }

    // Add unmatched GL transactions
    for (const glTx of glTransactions) {
      if (!usedGLIds.has(glTx.id)) {
        newMatches.push({
          id: generateId('UNMATCHED-GL'),
          date: glTx.date,
          bank_desc: '',
          gl_desc: glTx.description,
          amount: glTx.amount,
          currency: 'EUR',
          bank_name: 'BOC',
          match_type: 'Manual',
          confidence: 0,
          status: 'unmatched',
          approval_stage: 'none',
          gl_tx_id: glTx.id,
        });
      }
    }

    if (newMatches.length > 0) {
      setTransactions(prev => {
        const updated = [...prev, ...newMatches];
        saveTransactions(updated);
        return updated;
      });
    }

  }, [bankTransactions, glTransactions]);

  const clearAllData = useCallback(() => {
    setTransactions(INITIAL_TRANSACTIONS);
    setBankTransactions([]);
    setGLTransactions([]);
    saveTransactions(INITIAL_TRANSACTIONS);
    saveBankTransactions([]);
    saveGLTransactions([]);
  }, []);

  return (
    <ReconContext.Provider value={{
      transactions,
      bankTransactions,
      glTransactions,
      rulesState,
      searchQuery,
      setSearchQuery,
      filteredTransactions,
      updateStatus,
      updateApprovalStage,
      toggleRule,
      recalculateFlags,
      importTransactions,
      importBankTransactions,
      importGLTransactions,
      runAutoMatch,
      clearAllData,
    }}>
      {children}
    </ReconContext.Provider>
  );
}

export function useRecon(): ReconContextType {
  const context = useContext(ReconContext);
  if (!context) {
    throw new Error('useRecon must be used within a ReconProvider');
  }
  return context;
}
