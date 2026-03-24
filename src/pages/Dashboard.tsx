import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  CheckCircle,
  Clock,
  XCircle,
  TrendingUp,
  Banknote,
  AlertTriangle,
  Activity,
  Upload,
} from 'lucide-react';
import { TopBar } from '@/components/layout/TopBar';
import { KPICard } from '@/components/cards/KPICard';
import { RingChart } from '@/components/charts/RingChart';
import { EmptyState } from '@/components/ui/EmptyState';
import { useRecon } from '@/context/ReconContext';
import { formatCurrency } from '@/utils/reconciliation';
import { HIGH_VALUE_THRESHOLD } from '@/utils/constants';
import { ImportModal } from '@/components/modals/ImportModal';
import { BankTransaction, GLTransaction } from '@/types/transaction';

export default function Dashboard() {
  const { transactions, bankTransactions, glTransactions, importBankTransactions } = useRecon();
  const [bankImportOpen, setBankImportOpen] = useState(false);

  const isEmpty = bankTransactions.length === 0 && transactions.length === 0;

  // Calculate KPIs
  const matched = transactions.filter((t) => t.status === 'matched').length;
  const pending = transactions.filter((t) => t.status === 'pending').length;
  const unmatched = transactions.filter((t) => t.status === 'unmatched').length;
  const total = transactions.length;
  const matchRate = total > 0 ? Math.round((matched / total) * 100) : 0;

  const totalValue = transactions.reduce((sum, t) => sum + t.amount, 0);
  const pendingValue = transactions
    .filter((t) => t.status === 'pending')
    .reduce((sum, t) => sum + t.amount, 0);

  const highValueCount = transactions.filter((t) =>
    t.flags?.includes('High Value')
  ).length;

  const avgConfidence =
    transactions.length > 0
      ? Math.round(
          transactions.reduce((sum, t) => sum + t.confidence, 0) /
            transactions.length
        )
      : 0;

  // Derive active period from transaction dates
  const activePeriod = (() => {
    if (transactions.length === 0) return 'No data';
    const dates = transactions
      .map((t) => new Date(t.date))
      .filter((d) => !isNaN(d.getTime()));
    if (dates.length === 0) return 'No data';
    const latest = new Date(Math.max(...dates.map((d) => d.getTime())));
    return latest.toLocaleDateString('en-US', {
      month: 'short',
      year: 'numeric',
    });
  })();

  const handleBankImport = (txs: BankTransaction[] | GLTransaction[]) => {
    importBankTransactions(txs as BankTransaction[]);
  };

  return (
    <div className="min-h-screen">
      <TopBar title="Dashboard" subtitle="Reconciliation Overview" />

      {isEmpty ? (
        /* Empty state */
        <div className="flex items-center justify-center min-h-[60vh]">
          <EmptyState
            icon={Upload}
            title="Get started with reconciliation"
            description="Import your first bank statement to begin matching transactions against your general ledger."
            action={{
              label: 'Import bank statement',
              onClick: () => setBankImportOpen(true),
            }}
          />
        </div>
      ) : (
        <div className="p-6 space-y-6">
          {/* Hero: Match Rate + Avg Confidence */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="bg-card border border-border rounded-xl p-6 shadow-card flex items-baseline gap-8"
          >
            <div>
              <p className="text-sm text-muted-foreground mb-1">Match rate</p>
              <div className="flex items-baseline gap-2">
                <span className="text-5xl font-bold font-mono text-foreground">
                  {matchRate}%
                </span>
                <span className="text-sm text-muted-foreground">
                  of {total} transactions
                </span>
              </div>
            </div>
            <div className="border-l border-border pl-8">
              <p className="text-sm text-muted-foreground mb-1">
                Avg confidence
              </p>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold font-mono text-foreground">
                  {avgConfidence}%
                </span>
                <span className="text-xs text-muted-foreground">AI score</span>
              </div>
            </div>
          </motion.div>

          {/* KPI Cards with status left borders */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.05 }}
              className="border-l-[3px] border-l-primary rounded-xl"
            >
              <KPICard
                title="Matched"
                value={matched}
                subtitle={`of ${total} total`}
                icon={CheckCircle}
                color="teal"
              />
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.1 }}
              className="border-l-[3px] border-l-status-warn rounded-xl"
            >
              <KPICard
                title="Pending review"
                value={pending}
                subtitle="Awaiting action"
                icon={Clock}
                color="warn"
              />
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.15 }}
              className="border-l-[3px] border-l-status-error rounded-xl"
            >
              <KPICard
                title="Unmatched"
                value={unmatched}
                subtitle="No match found"
                icon={XCircle}
                color="error"
              />
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.2 }}
              className="border-l-[3px] border-l-brand-blue rounded-xl"
            >
              <KPICard
                title="High value"
                value={highValueCount}
                subtitle={`Above ${formatCurrency(HIGH_VALUE_THRESHOLD)}`}
                icon={AlertTriangle}
                color="blue"
              />
            </motion.div>
          </div>

          {/* Bottom row: Ring chart + Financial summary */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Reconciliation ring chart (larger) */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.25 }}
              className="bg-card border border-border rounded-xl p-6 shadow-card lg:col-span-1"
            >
              <h3 className="text-sm font-medium text-muted-foreground mb-6">
                Reconciliation status
              </h3>
              <div className="flex justify-center">
                <RingChart
                  value={matchRate}
                  label="Match rate"
                  sublabel={`${matched}/${total}`}
                  color="teal"
                  size={180}
                  strokeWidth={14}
                />
              </div>
            </motion.div>

            {/* Financial Summary */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.3 }}
              className="bg-card border border-border rounded-xl p-6 shadow-card lg:col-span-2"
            >
              <h3 className="text-sm font-medium text-muted-foreground mb-6">
                Financial summary
              </h3>
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-5">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Banknote className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Total volume
                      </p>
                      <p className="text-lg font-bold font-mono text-foreground">
                        {formatCurrency(totalValue)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-lg bg-status-warn/10 flex items-center justify-center">
                      <Clock className="w-5 h-5 text-status-warn" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Pending amount
                      </p>
                      <p className="text-lg font-bold font-mono text-foreground">
                        {formatCurrency(pendingValue)}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="space-y-5">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-lg bg-brand-blue/10 flex items-center justify-center">
                      <TrendingUp className="w-5 h-5 text-brand-blue" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Processing rate
                      </p>
                      <p className="text-lg font-bold font-mono text-foreground">
                        {matchRate}%
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center">
                      <Activity className="w-5 h-5 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Active period
                      </p>
                      <p className="text-lg font-bold text-foreground">
                        {activePeriod}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>

          {/* Recent Transactions */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.35 }}
            className="bg-card border border-border rounded-xl p-6 shadow-card"
          >
            <h3 className="text-sm font-medium text-muted-foreground mb-4">
              Recent transactions
            </h3>
            <div className="space-y-2">
              {transactions.slice(0, 5).map((tx, i) => (
                <motion.div
                  key={tx.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.4 + i * 0.04 }}
                  className="flex items-center justify-between py-2.5 border-b border-border last:border-0"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-2 h-2 rounded-full ${
                        tx.status === 'matched'
                          ? 'bg-primary'
                          : tx.status === 'pending'
                            ? 'bg-status-warn'
                            : 'bg-status-error'
                      }`}
                    />
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {tx.bank_desc}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {tx.id} &middot; {tx.bank_name}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-mono font-medium text-foreground">
                      {formatCurrency(tx.amount)}
                    </p>
                    <p className="text-xs text-muted-foreground capitalize">
                      {tx.status}
                    </p>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      )}

      {/* Bank Import Modal for empty state CTA */}
      <ImportModal
        open={bankImportOpen}
        onOpenChange={setBankImportOpen}
        type="bank"
        onImport={handleBankImport}
      />
    </div>
  );
}
