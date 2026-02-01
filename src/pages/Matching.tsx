import { useState } from 'react';
import { motion } from 'framer-motion';
import { TopBar } from '@/components/layout/TopBar';
import { StatusBadge } from '@/components/badges/StatusBadge';
import { FlagBadge } from '@/components/badges/FlagBadge';
import { ConfidenceMeter } from '@/components/ui/ConfidenceMeter';
import { TransactionDetailModal } from '@/components/modals/TransactionDetailModal';
import { useRecon } from '@/context/ReconContext';
import { formatCurrency, formatDate } from '@/utils/reconciliation';
import { Transaction } from '@/types/transaction';
import { toast } from 'sonner';

export default function Matching() {
  const { transactions, updateStatus } = useRecon();
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

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
                  <th>ID</th>
                  <th>Date</th>
                  <th>Bank Description</th>
                  <th>GL Description</th>
                  <th className="text-right">Amount</th>
                  <th>Bank</th>
                  <th>Confidence</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx, i) => (
                  <motion.tr
                    key={tx.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.03 }}
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
              </tbody>
            </table>
          </div>
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
