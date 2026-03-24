import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
  GitCompare,
} from 'lucide-react';
import { TopBar } from '@/components/layout/TopBar';
import { StatusBadge } from '@/components/badges/StatusBadge';
import { FlagBadge } from '@/components/badges/FlagBadge';
import { ConfidenceMeter } from '@/components/ui/ConfidenceMeter';
import { TransactionDetailModal } from '@/components/modals/TransactionDetailModal';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/button';
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

export default function Matching() {
  const { filteredTransactions, updateStatus } = useRecon();
  const [selectedTransaction, setSelectedTransaction] =
    useState<Transaction | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(0);
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>('all');

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
