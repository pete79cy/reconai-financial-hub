import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { TopBar } from '@/components/layout/TopBar';
import { StatusBadge } from '@/components/badges/StatusBadge';
import { FlagBadge } from '@/components/badges/FlagBadge';
import { ConfidenceMeter } from '@/components/ui/ConfidenceMeter';
import { TransactionDetailModal } from '@/components/modals/TransactionDetailModal';
import { Button } from '@/components/ui/button';
import { useRecon } from '@/context/ReconContext';
import { formatCurrency, formatDate } from '@/utils/reconciliation';
import { Transaction } from '@/types/transaction';
import { DEFAULT_PAGE_SIZE } from '@/utils/constants';
import { toast } from 'sonner';

type SortKey = 'id' | 'date' | 'bank_desc' | 'gl_desc' | 'amount' | 'bank_name' | 'confidence' | 'status';
type SortDir = 'asc' | 'desc';

export default function Matching() {
  const { filteredTransactions, updateStatus } = useRecon();
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(0);

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

  const totalPages = Math.max(1, Math.ceil(sorted.length / DEFAULT_PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const paginated = sorted.slice(safePage * DEFAULT_PAGE_SIZE, (safePage + 1) * DEFAULT_PAGE_SIZE);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
    setPage(0);
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ChevronsUpDown className="w-3.5 h-3.5 text-muted-foreground/50" />;
    return sortDir === 'asc'
      ? <ChevronUp className="w-3.5 h-3.5 text-primary" />
      : <ChevronDown className="w-3.5 h-3.5 text-primary" />;
  };

  const handleRowClick = (tx: Transaction) => {
    setSelectedTransaction(tx);
    setModalOpen(true);
  };

  const handleApprove = (id: string) => {
    updateStatus(id, 'matched');
    toast.success('Transaction approved', {
      description: `${id} has been matched successfully.`
    });
  };

  const handleReject = (id: string) => {
    updateStatus(id, 'rejected');
    toast.error('Transaction rejected', {
      description: `${id} has been marked for review.`
    });
  };

  return (
    <div className="min-h-screen">
      <TopBar
        title="Matching"
        subtitle="Transaction Reconciliation"
      />

      <div className="p-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="bg-card border border-border rounded-xl shadow-card overflow-hidden"
        >
          <div className="overflow-x-auto">
            <table className="recon-table">
              <thead className="bg-secondary/30">
                <tr>
                  {([
                    ['id', 'ID'],
                    ['date', 'Date'],
                    ['bank_desc', 'Bank Description'],
                    ['gl_desc', 'GL Description'],
                    ['amount', 'Amount'],
                    ['bank_name', 'Bank'],
                    ['confidence', 'Confidence'],
                    ['status', 'Status'],
                  ] as [SortKey, string][]).map(([key, label]) => (
                    <th
                      key={key}
                      className={`cursor-pointer select-none hover:text-foreground transition-colors ${key === 'amount' ? 'text-right' : ''}`}
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
                        {tx.flags && tx.flags.map(flag => (
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
                    <td className="w-32">
                      <ConfidenceMeter value={tx.confidence} />
                    </td>
                    <td>
                      <StatusBadge status={tx.status} />
                    </td>
                  </motion.tr>
                ))}
                {paginated.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center py-12 text-muted-foreground">
                      No transactions found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {sorted.length > DEFAULT_PAGE_SIZE && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border">
              <p className="text-sm text-muted-foreground">
                Showing {safePage * DEFAULT_PAGE_SIZE + 1}–{Math.min((safePage + 1) * DEFAULT_PAGE_SIZE, sorted.length)} of {sorted.length}
              </p>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={safePage === 0}
                  onClick={() => setPage(p => p - 1)}
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                {Array.from({ length: totalPages }, (_, i) => i).slice(
                  Math.max(0, safePage - 2),
                  Math.min(totalPages, safePage + 3)
                ).map(i => (
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
                  onClick={() => setPage(p => p + 1)}
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
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
