import { motion } from 'framer-motion';
import { 
  CheckCircle, 
  Clock, 
  XCircle, 
  TrendingUp,
  Banknote,
  AlertTriangle,
  Activity,
  FileText,
  FileSpreadsheet
} from 'lucide-react';
import { TopBar } from '@/components/layout/TopBar';
import { KPICard } from '@/components/cards/KPICard';
import { RingChart } from '@/components/charts/RingChart';
import { useRecon } from '@/context/ReconContext';
import { formatCurrency } from '@/utils/reconciliation';
import { HIGH_VALUE_THRESHOLD } from '@/utils/constants';

export default function Dashboard() {
  const { transactions, bankTransactions, glTransactions } = useRecon();

  // Derive active period from transaction dates
  const activePeriod = (() => {
    if (transactions.length === 0) return 'No data';
    const dates = transactions.map(t => new Date(t.date)).filter(d => !isNaN(d.getTime()));
    if (dates.length === 0) return 'No data';
    const latest = new Date(Math.max(...dates.map(d => d.getTime())));
    return latest.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  })();

  // Calculate KPIs
  const matched = transactions.filter(t => t.status === 'matched').length;
  const pending = transactions.filter(t => t.status === 'pending').length;
  const rejected = transactions.filter(t => t.status === 'rejected').length;
  const unmatched = transactions.filter(t => t.status === 'unmatched').length;
  const total = transactions.length;
  const matchRate = total > 0 ? Math.round((matched / total) * 100) : 0;
  
  const totalValue = transactions.reduce((sum, t) => sum + t.amount, 0);
  const pendingValue = transactions
    .filter(t => t.status === 'pending')
    .reduce((sum, t) => sum + t.amount, 0);
  
  const highValueCount = transactions.filter(t => 
    t.flags?.includes('High Value')
  ).length;
  
  const avgConfidence = transactions.length > 0 
    ? Math.round(transactions.reduce((sum, t) => sum + t.confidence, 0) / transactions.length)
    : 0;

  const bankCount = bankTransactions.length;
  const glCount = glTransactions.length;

  return (
    <div className="min-h-screen">
      <TopBar 
        title="Dashboard" 
        subtitle="Reconciliation Overview" 
      />
      
      <div className="p-6 space-y-6">
        {/* Import Status Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <KPICard
            title="Bank Transactions"
            value={bankCount}
            subtitle="Imported from bank"
            icon={FileText}
            color="blue"
            delay={0}
          />
          <KPICard
            title="GL Transactions"
            value={glCount}
            subtitle="Imported from accounting"
            icon={FileSpreadsheet}
            color="teal"
            delay={0.1}
          />
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard
            title="Matched Transactions"
            value={matched}
            subtitle={`of ${total} total`}
            icon={CheckCircle}
            color="teal"
            trend={{ value: 12, label: 'vs last week', positive: true }}
            delay={0}
          />
          <KPICard
            title="Pending Review"
            value={pending}
            subtitle="Awaiting action"
            icon={Clock}
            color="warn"
            delay={0.1}
          />
          <KPICard
            title="Unmatched Items"
            value={unmatched}
            subtitle="No match found"
            icon={XCircle}
            color="error"
            delay={0.2}
          />
          <KPICard
            title="High Value Alerts"
            value={highValueCount}
            subtitle={`Above ${formatCurrency(HIGH_VALUE_THRESHOLD)}`}
            icon={AlertTriangle}
            color="blue"
            delay={0.3}
          />
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Ring Charts */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.4 }}
            className="bg-card border border-border rounded-xl p-6 shadow-card"
          >
            <h3 className="text-sm font-medium text-muted-foreground mb-6">
              Reconciliation Status
            </h3>
            <div className="flex justify-around">
              <RingChart 
                value={matchRate} 
                label="Match Rate"
                sublabel={`${matched}/${total}`}
                color="teal"
              />
              <RingChart 
                value={avgConfidence} 
                label="Avg Confidence"
                sublabel="AI Score"
                color="blue"
              />
            </div>
          </motion.div>

          {/* Financial Summary */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.5 }}
            className="bg-card border border-border rounded-xl p-6 shadow-card lg:col-span-2"
          >
            <h3 className="text-sm font-medium text-muted-foreground mb-6">
              Financial Summary
            </h3>
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Banknote className="w-6 h-6 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Total Volume</p>
                    <p className="text-xl font-bold font-mono text-foreground">
                      {formatCurrency(totalValue)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-lg bg-status-warn/10 flex items-center justify-center">
                    <Clock className="w-6 h-6 text-status-warn" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Pending Amount</p>
                    <p className="text-xl font-bold font-mono text-foreground">
                      {formatCurrency(pendingValue)}
                    </p>
                  </div>
                </div>
              </div>
              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-lg bg-brand-blue/10 flex items-center justify-center">
                    <TrendingUp className="w-6 h-6 text-brand-blue" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Processing Rate</p>
                    <p className="text-xl font-bold font-mono text-foreground">
                      {matchRate}%
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-lg bg-secondary flex items-center justify-center">
                    <Activity className="w-6 h-6 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Active Period</p>
                    <p className="text-xl font-bold text-foreground">
                      {activePeriod}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Recent Activity */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.6 }}
          className="bg-card border border-border rounded-xl p-6 shadow-card"
        >
          <h3 className="text-sm font-medium text-muted-foreground mb-4">
            Recent Transactions
          </h3>
          <div className="space-y-3">
            {transactions.slice(0, 5).map((tx, i) => (
              <motion.div
                key={tx.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.7 + i * 0.05 }}
                className="flex items-center justify-between py-3 border-b border-border last:border-0"
              >
                <div className="flex items-center gap-4">
                  <div className={`w-2 h-2 rounded-full ${
                    tx.status === 'matched' ? 'bg-primary' :
                    tx.status === 'pending' ? 'bg-status-warn' :
                    'bg-status-error'
                  }`} />
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {tx.bank_desc}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {tx.id} · {tx.bank_name}
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
    </div>
  );
}
