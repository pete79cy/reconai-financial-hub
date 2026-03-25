import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import {
  Transaction,
  BankTransaction,
  GLTransaction,
  RulesState,
  ReconContextType,
  Status,
  ApprovalStage,
} from '@/types/transaction';

const API_BASE = '/api';

const ReconContext = createContext<ReconContextType | undefined>(undefined);

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export function ReconProvider({ children }: { children: React.ReactNode }) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [bankTransactions, setBankTransactions] = useState<BankTransaction[]>([]);
  const [glTransactions, setGLTransactions] = useState<GLTransaction[]>([]);
  const [rulesState, setRulesState] = useState<RulesState>({ weekendAlert: true, highValue: true });
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  const refreshData = useCallback(async () => {
    try {
      const [txs, bankTxs, glTxs, rules] = await Promise.all([
        apiFetch<Transaction[]>('/transactions'),
        apiFetch<BankTransaction[]>('/bank-transactions'),
        apiFetch<GLTransaction[]>('/gl-transactions'),
        apiFetch<RulesState>('/rules'),
      ]);
      setTransactions(txs);
      setBankTransactions(bankTxs);
      setGLTransactions(glTxs);
      setRulesState(rules);
    } catch (err) {
      console.error('Failed to load data from API:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch all data from API on mount
  useEffect(() => {
    refreshData();
  }, [refreshData]);

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
    // Flags are now calculated server-side during matching and rule updates
  }, []);

  const updateStatus = useCallback(async (id: string, newStatus: Status) => {
    try {
      await apiFetch(`/transactions/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus }),
      });
      setTransactions(prev => prev.map(tx =>
        tx.id === id ? { ...tx, status: newStatus } : tx
      ));
    } catch (err) {
      console.error('Failed to update status:', err);
    }
  }, []);

  const updateApprovalStage = useCallback(async (id: string, newStage: ApprovalStage) => {
    try {
      await apiFetch(`/transactions/${id}/approval`, {
        method: 'PATCH',
        body: JSON.stringify({ approval_stage: newStage }),
      });
      setTransactions(prev => prev.map(tx =>
        tx.id === id ? { ...tx, approval_stage: newStage } : tx
      ));
    } catch (err) {
      console.error('Failed to update approval stage:', err);
    }
  }, []);

  const toggleRule = useCallback(async (ruleKey: keyof RulesState) => {
    const newValue = !rulesState[ruleKey];
    const update = { [ruleKey]: newValue };
    try {
      const result = await apiFetch<RulesState>('/rules', {
        method: 'PATCH',
        body: JSON.stringify(update),
      });
      setRulesState(result);
      // Reload transactions to get updated flags
      const txs = await apiFetch<Transaction[]>('/transactions');
      setTransactions(txs);
    } catch (err) {
      console.error('Failed to toggle rule:', err);
    }
  }, [rulesState]);

  const importTransactions = useCallback((newTransactions: Transaction[]) => {
    setTransactions(prev => [...prev, ...newTransactions]);
  }, []);

  const importBankTransactions = useCallback(async (txs: BankTransaction[]) => {
    try {
      const result = await apiFetch<{ imported: number }>('/bank-transactions/import', {
        method: 'POST',
        body: JSON.stringify({ transactions: txs }),
      });
      // Reload bank transactions from server
      const updated = await apiFetch<BankTransaction[]>('/bank-transactions');
      setBankTransactions(updated);
      return result;
    } catch (err) {
      console.error('Failed to import bank transactions:', err);
      throw err;
    }
  }, []);

  const importGLTransactions = useCallback(async (txs: GLTransaction[]) => {
    try {
      const result = await apiFetch<{ imported: number }>('/gl-transactions/import', {
        method: 'POST',
        body: JSON.stringify({ transactions: txs }),
      });
      // Reload GL transactions from server
      const updated = await apiFetch<GLTransaction[]>('/gl-transactions');
      setGLTransactions(updated);
      return result;
    } catch (err) {
      console.error('Failed to import GL transactions:', err);
      throw err;
    }
  }, []);

  const runAutoMatch = useCallback(async () => {
    try {
      const result = await apiFetch<{ transactions: Transaction[] }>('/matching/run', {
        method: 'POST',
      });
      setTransactions(result.transactions);
    } catch (err) {
      console.error('Failed to run auto-match:', err);
    }
  }, []);

  const clearAllData = useCallback(async () => {
    try {
      await Promise.all([
        apiFetch('/transactions', { method: 'DELETE' }),
        apiFetch('/bank-transactions', { method: 'DELETE' }),
        apiFetch('/gl-transactions', { method: 'DELETE' }),
      ]);
      setTransactions([]);
      setBankTransactions([]);
      setGLTransactions([]);
    } catch (err) {
      console.error('Failed to clear data:', err);
    }
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading data...</p>
        </div>
      </div>
    );
  }

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
      refreshData,
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
