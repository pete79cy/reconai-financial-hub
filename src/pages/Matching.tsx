import { useState, useMemo, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
  GitCompare,
  Search,
  Link2,
  CheckCircle2,
  X,
} from 'lucide-react';
import { TopBar } from '@/components/layout/TopBar';
import { StatusBadge } from '@/components/badges/StatusBadge';
import { FlagBadge } from '@/components/badges/FlagBadge';
import { ConfidenceMeter } from '@/components/ui/ConfidenceMeter';
import { TransactionDetailModal } from '@/components/modals/TransactionDetailModal';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useRecon } from '@/context/ReconContext';
import { formatCurrency, formatDate } from '@/utils/reconciliation';
import { Transaction } from '@/types/transaction';
import { DEFAULT_PAGE_SIZE } from '@/utils/constants';
import { toast } from 'sonner';

type SortKey =
  | 'id'
  | 'date'
  | 'bank_desc'
  | 'gl_desc'
  | 'amount'
  | 'bank_name'
  | 'confidence'
  | 'status';
type SortDir = 'asc' | 'desc';
type CategoryFilter = 'all' | 'cheque' | 'deposit' | 'other' | 'unmatched';

function getRowBorderColor(status: string): string {
  switch (status) {
    case 'matched':
    case 'approved':
      return 'border-l-primary';
    case 'pending':
      return 'border-l-status-warn';
    case 'unmatched':
      return 'border-l-status-error';
    case 'rejected':
      return 'border-l-status-error';
    default:
      return 'border-l-transparent';
  }
}

type MainTab = 'auto' | 'manual';

interface UnmatchedTx {
  id: string;
  date: string;
  description: string;
  amount: string | number;
  type: string;
  reference?: string;
  reference_number?: string;
  bank_name?: string;
  source?: string;
}

export default function Matching() {
  const { filteredTransactions, updateStatus, refreshData } = useRecon();
  const [selectedTransaction, setSelectedTransaction] =
    useState<Transaction | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(0);
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>('all');
  const [mainTab, setMainTab] = useState<MainTab>('auto');

  // Manual match state
  const [bankSearch, setBankSearch] = useState('');
  const [glSearch, setGlSearch] = useState('');
  const [unmatchedBank, setUnmatchedBank] = useState<UnmatchedTx[]>([]);
  const [unmatchedGL, setUnmatchedGL] = useState<UnmatchedTx[]>([]);
  const [selectedBankTx, setSelectedBankTx] = useState<UnmatchedTx | null>(null);
  const [selectedGLTx, setSelectedGLTx] = useState<UnmatchedTx | null>(null);
  const [loadingManual, setLoadingManual] = useState(false);

  const fetchUnmatched = useCallback(async () => {
    try {
      const [bankRes, glRes] = await Promise.all([
        fetch(`/api/matching/unmatched-bank?q=${encodeURIComponent(bankSearch)}`),
        fetch(`/api/matching/unmatched-gl?q=${encodeURIComponent(glSearch)}`),
      ]);
      if (bankRes.ok) setUnmatchedBank(await bankRes.json());
      if (glRes.ok) setUnmatchedGL(await glRes.json());
    } catch {
      // silent
    }
  }, [bankSearch, glSearch]);

  useEffect(() => {
    if (mainTab === 'manual') {
      const timer = setTimeout(fetchUnmatched, 300);
      return () => clearTimeout(timer);
    }
  }, [mainTab, fetchUnmatched]);

  const handleManualMatch = async () => {
    if (!selectedBankTx || !selectedGLTx) return;
    setLoadingManual(true);
    try {
      const res = await fetch('/api/matching/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bank_tx_id: selectedBankTx.id,
          gl_tx_id: selectedGLTx.id,
        }),
      });
      if (res.ok) {
        toast.success('Manual match created');
        setSelectedBankTx(null);
        setSelectedGLTx(null);
        fetchUnmatched();
        refreshData();
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to create match');
      }
    } catch {
      toast.error('Failed to create manual match');
    } finally {
      setLoadingManual(false);
    }
  };

  const sorted = useMemo(() => {
    const copy = [...filteredTransactions];
    copy.sort((a, b) => {
      let cmp = 0;
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        cmp = aVal - bVal;
      } else {
        cmp = String(aVal).localeCompare(String(bVal));
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [filteredTransactions, sortKey, sortDir]);

  const categories = useMemo(() => [
    { key: 'all' as const, label: 'All', count: sorted.length },
    { key: 'cheque' as const, label: 'Checks', count: sorted.filter(t => t.match_category === 'cheque').length },
    { key: 'deposit' as const, label: 'Deposits', count: sorted.filter(t => t.match_category === 'deposit').length },
    { key: 'other' as const, label: 'Other', count: sorted.filter(t => t.match_category === 'other').length },
    { key: 'unmatched' as const, label: 'Unmatched', count: sorted.filter(t => t.status === 'unmatched').length },
  ], [sorted]);

  const filteredByCategory = useMemo(() => {
    if (activeCategory === 'all') return sorted;
    if (activeCategory === 'unmatched') return sorted.filter(t => t.status === 'unmatched');
    return sorted.filter(t => t.match_category === activeCategory);
  }, [sorted, activeCategory]);

  const totalPages = Math.max(1, Math.ceil(filteredByCategory.length / DEFAULT_PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const paginated = filteredByCategory.slice(
    safePage * DEFAULT_PAGE_SIZE,
    (safePage + 1) * DEFAULT_PAGE_SIZE
  );

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
    setPage(0);
  };

  const handleCategoryChange = (key: CategoryFilter) => {
    setActiveCategory(key);
    setPage(0);
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col)
      return (
        <ChevronsUpDown className="w-3.5 h-3.5 text-muted-foreground/50" />
      );
    return sortDir === 'asc' ? (
      <ChevronUp className="w-3.5 h-3.5 text-primary" />
    ) : (
      <ChevronDown className="w-3.5 h-3.5 text-primary" />
    );
  };

  const handleRowClick = (tx: Transaction) => {
    setSelectedTransaction(tx);
    setModalOpen(true);
  };

  const handleApprove = (id: string) => {
    updateStatus(id, 'matched');
    toast.success('Transaction approved', {
      description: `${id} has been matched successfully.`,
    });
  };

  const handleReject = (id: string) => {
    updateStatus(id, 'rejected');
    toast.error('Transaction rejected', {
      description: `${id} has been marked for review.`,
    });
  };

  const columns: [SortKey, string][] = [
    ['id', 'ID'],
    ['date', 'Date'],
    ['bank_desc', 'Bank description'],
    ['gl_desc', 'GL description'],
    ['amount', 'Amount'],
    ['bank_name', 'Bank'],
    ['confidence', 'Confidence'],
    ['status', 'Status'],
  ];

  return (
    <div className="min-h-screen">
      <TopBar title="Matching" subtitle="Transaction Reconciliation" />

      <div className="p-6">
        {/* Main Tab Switcher: Auto-Match vs Manual Match */}
        <div className="flex items-center gap-1 mb-4 bg-secondary/30 p-1 rounded-lg w-fit">
          <button
            onClick={() => setMainTab('auto')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              mainTab === 'auto'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <span className="flex items-center gap-2">
              <GitCompare className="w-4 h-4" />
              Auto-Matched
            </span>
          </button>
          <button
            onClick={() => setMainTab('manual')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              mainTab === 'manual'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <span className="flex items-center gap-2">
              <Link2 className="w-4 h-4" />
              Manual Match
            </span>
          </button>
        </div>

        {mainTab === 'manual' ? (
          /* ====== Manual Match View ====== */
          <div className="space-y-4">
            {/* Selected pair + match button */}
            {(selectedBankTx || selectedGLTx) && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-card border border-primary/30 rounded-xl p-4"
              >
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-foreground">Selected for matching</h3>
                  <Button
                    onClick={handleManualMatch}
                    disabled={!selectedBankTx || !selectedGLTx || loadingManual}
                    size="sm"
                    className="gap-2"
                  >
                    <Link2 className="w-4 h-4" />
                    {loadingManual ? 'Matching...' : 'Create Match'}
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className={`rounded-lg p-3 border ${selectedBankTx ? 'border-blue-500/30 bg-blue-500/5' : 'border-dashed border-border bg-muted/20'}`}>
                    <div className="text-xs font-medium text-blue-400 mb-1">BANK</div>
                    {selectedBankTx ? (
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="text-sm text-foreground truncate max-w-[300px]">{selectedBankTx.description}</p>
                          <p className="text-xs text-muted-foreground">{formatDate(selectedBankTx.date)} &middot; {selectedBankTx.type}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-mono font-medium text-foreground">{formatCurrency(Math.abs(parseFloat(String(selectedBankTx.amount))))}</span>
                          <button onClick={() => setSelectedBankTx(null)} className="p-0.5 rounded hover:bg-red-500/20 text-muted-foreground hover:text-red-400">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">Select a bank transaction below</p>
                    )}
                  </div>
                  <div className={`rounded-lg p-3 border ${selectedGLTx ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-dashed border-border bg-muted/20'}`}>
                    <div className="text-xs font-medium text-emerald-400 mb-1">LEDGER</div>
                    {selectedGLTx ? (
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="text-sm text-foreground truncate max-w-[300px]">{selectedGLTx.description}</p>
                          <p className="text-xs text-muted-foreground">{formatDate(selectedGLTx.date)} &middot; {selectedGLTx.source || selectedGLTx.type}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-mono font-medium text-foreground">{formatCurrency(Math.abs(parseFloat(String(selectedGLTx.amount))))}</span>
                          <button onClick={() => setSelectedGLTx(null)} className="p-0.5 rounded hover:bg-red-500/20 text-muted-foreground hover:text-red-400">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">Select a GL transaction below</p>
                    )}
                  </div>
                </div>
              </motion.div>
            )}

            {/* Two-column layout: Bank | GL */}
            <div className="grid grid-cols-2 gap-4">
              {/* Bank Transactions */}
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-border bg-blue-500/5">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-semibold text-foreground">
                      Bank Transactions
                      <span className="ml-2 text-xs text-muted-foreground font-normal">({unmatchedBank.length} unmatched)</span>
                    </h3>
                  </div>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="Search description, reference, amount..."
                      value={bankSearch}
                      onChange={(e) => setBankSearch(e.target.value)}
                      className="pl-9 h-8 text-sm"
                    />
                  </div>
                </div>
                <div className="max-h-[500px] overflow-y-auto">
                  {unmatchedBank.length === 0 ? (
                    <div className="p-8 text-center text-sm text-muted-foreground">
                      No unmatched bank transactions
                    </div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-card">
                        <tr className="border-b border-border">
                          <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Date</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Description</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Ref</th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Amount</th>
                          <th className="px-3 py-2 text-center text-xs font-medium text-muted-foreground">Type</th>
                        </tr>
                      </thead>
                      <tbody>
                        {unmatchedBank.map((tx) => (
                          <tr
                            key={tx.id}
                            onClick={() => setSelectedBankTx(tx)}
                            className={`cursor-pointer border-b border-border/50 hover:bg-blue-500/10 transition-colors ${
                              selectedBankTx?.id === tx.id ? 'bg-blue-500/15 ring-1 ring-inset ring-blue-500/30' : ''
                            }`}
                          >
                            <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{formatDate(tx.date)}</td>
                            <td className="px-3 py-2 text-foreground max-w-[200px] truncate">{tx.description}</td>
                            <td className="px-3 py-2 text-muted-foreground font-mono text-xs">{tx.reference_number || '-'}</td>
                            <td className="px-3 py-2 text-right font-mono font-medium text-foreground">{formatCurrency(Math.abs(parseFloat(String(tx.amount))))}</td>
                            <td className="px-3 py-2 text-center">
                              <span className={`text-xs px-1.5 py-0.5 rounded ${tx.type === 'debit' ? 'bg-red-500/10 text-red-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                                {tx.type}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              {/* GL Transactions */}
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-border bg-emerald-500/5">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-semibold text-foreground">
                      GL Transactions
                      <span className="ml-2 text-xs text-muted-foreground font-normal">({unmatchedGL.length} unmatched)</span>
                    </h3>
                  </div>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="Search description, reference, amount..."
                      value={glSearch}
                      onChange={(e) => setGlSearch(e.target.value)}
                      className="pl-9 h-8 text-sm"
                    />
                  </div>
                </div>
                <div className="max-h-[500px] overflow-y-auto">
                  {unmatchedGL.length === 0 ? (
                    <div className="p-8 text-center text-sm text-muted-foreground">
                      No unmatched GL transactions
                    </div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-card">
                        <tr className="border-b border-border">
                          <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Date</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Description</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Ref</th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Amount</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Source</th>
                        </tr>
                      </thead>
                      <tbody>
                        {unmatchedGL.map((tx) => (
                          <tr
                            key={tx.id}
                            onClick={() => setSelectedGLTx(tx)}
                            className={`cursor-pointer border-b border-border/50 hover:bg-emerald-500/10 transition-colors ${
                              selectedGLTx?.id === tx.id ? 'bg-emerald-500/15 ring-1 ring-inset ring-emerald-500/30' : ''
                            }`}
                          >
                            <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{formatDate(tx.date)}</td>
                            <td className="px-3 py-2 text-foreground max-w-[200px] truncate">{tx.description}</td>
                            <td className="px-3 py-2 text-muted-foreground font-mono text-xs">{tx.reference || '-'}</td>
                            <td className="px-3 py-2 text-right font-mono font-medium text-foreground">{formatCurrency(Math.abs(parseFloat(String(tx.amount))))}</td>
                            <td className="px-3 py-2 text-muted-foreground text-xs">{tx.source || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
        <>
        {/* Category Tabs */}
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          {categories.map((cat) => (
            <button
              key={cat.key}
              onClick={() => handleCategoryChange(cat.key)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                activeCategory === cat.key
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary/50 text-muted-foreground hover:bg-secondary hover:text-foreground'
              }`}
            >
              {cat.label}
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                activeCategory === cat.key
                  ? 'bg-primary-foreground/20 text-primary-foreground'
                  : 'bg-muted text-muted-foreground'
              }`}>
                {cat.count}
              </span>
            </button>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="bg-card border border-border rounded-xl shadow-card overflow-hidden"
        >
          {paginated.length === 0 ? (
            <EmptyState
              icon={GitCompare}
              title="No transactions to reconcile"
              description="Import bank and GL files, then run auto-match to begin reconciliation."
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="recon-table">
                  <thead className="bg-secondary/30">
                    <tr>
                      {/* Extra narrow column for the colored left border */}
                      <th className="w-0 p-0" />
                      {columns.map(([key, label]) => (
                        <th
                          key={key}
                          className={`cursor-pointer select-none hover:text-foreground transition-colors font-medium text-sm normal-case tracking-normal ${
                            key === 'amount' ? 'text-right' : ''
                          }`}
                          onClick={() => handleSort(key)}
                        >
                          <span className="inline-flex items-center gap-1">
                            {label}
                            <SortIcon col={key} />
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map((tx, i) => (
                      <motion.tr
                        key={tx.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.02 }}
                        onClick={() => handleRowClick(tx)}
                        className="cursor-pointer hover:bg-secondary/50 transition-colors"
                      >
                        {/* Colored left border cell */}
                        <td
                          className={`w-0 p-0 border-l-[3px] ${getRowBorderColor(
                            tx.status
                          )}`}
                        />
                        <td className="font-mono text-sm text-muted-foreground">
                          {tx.id}
                        </td>
                        <td className="text-sm text-muted-foreground">
                          {formatDate(tx.date)}
                        </td>
                        <td>
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-foreground">
                              {tx.bank_desc}
                            </span>
                            {tx.flags &&
                              tx.flags.map((flag) => (
                                <FlagBadge key={flag} flag={flag} />
                              ))}
                          </div>
                        </td>
                        <td className="text-sm text-muted-foreground">
                          {tx.gl_desc}
                        </td>
                        <td className="text-right font-mono text-sm font-medium text-foreground">
                          {formatCurrency(tx.amount)}
                        </td>
                        <td className="text-sm text-muted-foreground">
                          {tx.bank_name}
                        </td>
                        <td className="w-40">
                          <ConfidenceMeter value={tx.confidence} />
                        </td>
                        <td>
                          <StatusBadge status={tx.status} />
                        </td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {filteredByCategory.length > DEFAULT_PAGE_SIZE && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                  <p className="text-sm text-muted-foreground">
                    Showing {safePage * DEFAULT_PAGE_SIZE + 1}&ndash;
                    {Math.min(
                      (safePage + 1) * DEFAULT_PAGE_SIZE,
                      filteredByCategory.length
                    )}{' '}
                    of {filteredByCategory.length}
                  </p>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      disabled={safePage === 0}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    {Array.from({ length: totalPages }, (_, i) => i)
                      .slice(
                        Math.max(0, safePage - 2),
                        Math.min(totalPages, safePage + 3)
                      )
                      .map((i) => (
                        <Button
                          key={i}
                          variant={i === safePage ? 'default' : 'outline'}
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => setPage(i)}
                        >
                          {i + 1}
                        </Button>
                      ))}
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      disabled={safePage >= totalPages - 1}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </motion.div>
        </>
        )}
      </div>

      <TransactionDetailModal
        transaction={selectedTransaction}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onApprove={handleApprove}
        onReject={handleReject}
      />
    </div>
  );
}
