import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { 
  Transaction, 
  RulesState, 
  ReconContextType, 
  Status, 
  ApprovalStage,
  INITIAL_TRANSACTIONS 
} from '@/types/transaction';

const STORAGE_KEY = 'reconai_transactions';
const RULES_KEY = 'reconai_rules';

const ReconContext = createContext<ReconContextType | undefined>(undefined);

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

function saveRules(rules: RulesState) {
  localStorage.setItem(RULES_KEY, JSON.stringify(rules));
}

function isWeekend(dateStr: string): boolean {
  const day = new Date(dateStr).getDay();
  return day === 0 || day === 6;
}

function isHighValue(amount: number): boolean {
  return amount > 10000;
}

export function ReconProvider({ children }: { children: React.ReactNode }) {
  const [transactions, setTransactions] = useState<Transaction[]>(loadTransactions);
  const [rulesState, setRulesState] = useState<RulesState>(loadRules);

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

  return (
    <ReconContext.Provider value={{
      transactions,
      rulesState,
      updateStatus,
      updateApprovalStage,
      toggleRule,
      recalculateFlags,
      importTransactions,
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
