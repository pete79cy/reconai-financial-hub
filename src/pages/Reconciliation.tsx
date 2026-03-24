import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronDown,
  ChevronRight,
  Plus,
  X,
  Scale,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { TopBar } from '@/components/layout/TopBar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatCurrency, formatDate } from '@/utils/reconciliation';
import { toast } from 'sonner';

interface ReconciliationSummary {
  bank_balance: number;
  outstanding_deposits: number;
  outstanding_checks: number;
  outstanding_other: number;
  adjusted_bank_balance: number;
  gl_balance: number;
  fees_not_booked: number;
  deposit_corrections: number;
  adjusted_gl_balance: number;
  proof: number;
  outstanding_checks_list: OutstandingItem[];
  outstanding_deposits_list: OutstandingItem[];
  outstanding_other_list: OutstandingItem[];
  adjustments: Adjustment[];
}

interface OutstandingItem {
  id: string;
  date: string;
  description: string;
  amount: number;
  reference?: string;
}

interface Adjustment {
  id: string;
  category: 'bank' | 'gl';
  description: string;
  amount: number;
}

const defaultSummary: ReconciliationSummary = {
  bank_balance: 0,
  outstanding_deposits: 0,
  outstanding_checks: 0,
  outstanding_other: 0,
  adjusted_bank_balance: 0,
  gl_balance: 0,
  fees_not_booked: 0,
  deposit_corrections: 0,
  adjusted_gl_balance: 0,
  proof: 0,
  outstanding_checks_list: [],
  outstanding_deposits_list: [],
  outstanding_other_list: [],
  adjustments: [],
};

export default function Reconciliation() {
  const [summary, setSummary] = useState<ReconciliationSummary>(defaultSummary);
  const [loading, setLoading] = useState(true);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [adjustmentDialogOpen, setAdjustmentDialogOpen] = useState(false);
  const [newAdjustment, setNewAdjustment] = useState<{ category: 'bank' | 'gl'; description: string; amount: string }>({
    category: 'bank',
    description: '',
    amount: '',
  });

  useEffect(() => {
    fetchSummary();
  }, []);

  const fetchSummary = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/reconciliation/summary');
      if (res.ok) {
        const data = await res.json();
        setSummary(data);
      } else {
        // Use default/empty summary if API not available yet
        setSummary(defaultSummary);
      }
    } catch {
      // API not available, use defaults
      setSummary(defaultSummary);
    } finally {
      setLoading(false);
    }
  };

  const toggleSection = (key: string) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleAddAdjustment = async () => {
    const amount = parseFloat(newAdjustment.amount);
    if (!newAdjustment.description.trim() || isNaN(amount)) {
      toast.error('Please fill in all fields');
      return;
    }

    const adjustment: Adjustment = {
      id: `ADJ-${Date.now()}`,
      category: newAdjustment.category,
      description: newAdjustment.description.trim(),
      amount,
    };

    // Optimistic update
    setSummary(prev => {
      const updated = { ...prev, adjustments: [...prev.adjustments, adjustment] };
      // Recalculate proof with new adjustment
      if (adjustment.category === 'bank') {
        updated.adjusted_bank_balance += adjustment.amount;
      } else {
        updated.adjusted_gl_balance += adjustment.amount;
      }
      updated.proof = updated.adjusted_bank_balance - updated.adjusted_gl_balance;
      return updated;
    });

    // Try to persist on server
    try {
      await fetch('/api/reconciliation/adjustments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(adjustment),
      });
    } catch {
      // Best-effort; adjustment already applied locally
    }

    setAdjustmentDialogOpen(false);
    setNewAdjustment({ category: 'bank', description: '', amount: '' });
    toast.success('Adjustment added');
  };

  const isProofZero = Math.abs(summary.proof) < 0.01;

  const SummaryLine = ({ label, amount, isAdd, isBold }: { label: string; amount: number; isAdd?: boolean; isBold?: boolean }) => (
    <div className={`flex justify-between items-center py-1.5 ${isBold ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
      <span className="text-sm">{label}</span>
      <span className={`text-sm font-mono ${isBold ? 'text-foreground' : ''}`}>
        {isAdd !== undefined && (isAdd ? '+' : '-')}{formatCurrency(Math.abs(amount))}
      </span>
    </div>
  );

  const ExpandableSection = ({ title, count, items, sectionKey }: {
    title: string;
    count: number;
    items: OutstandingItem[];
    sectionKey: string;
  }) => {
    const isExpanded = expandedSections[sectionKey];
    return (
      <div className="border border-border rounded-xl overflow-hidden">
        <button
          onClick={() => toggleSection(sectionKey)}
          className="w-full flex items-center justify-between px-5 py-3 bg-card hover:bg-secondary/30 transition-colors"
        >
          <div className="flex items-center gap-2">
            {isExpanded ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            )}
            <span className="text-sm font-medium text-foreground">{title}</span>
            <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
              {count}
            </span>
          </div>
        </button>
        <AnimatePresence>
          {isExpanded && items.length > 0 && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="border-t border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/30">
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Date</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Description</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Reference</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.id} className="border-t border-border/50 hover:bg-secondary/20">
                        <td className="px-4 py-2 text-muted-foreground">{formatDate(item.date)}</td>
                        <td className="px-4 py-2 text-foreground">{item.description}</td>
                        <td className="px-4 py-2 text-muted-foreground font-mono">{item.reference || '-'}</td>
                        <td className="px-4 py-2 text-right font-mono text-foreground">{formatCurrency(item.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}
          {isExpanded && items.length === 0 && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="border-t border-border px-5 py-4 text-sm text-muted-foreground"
            >
              No outstanding items.
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  return (
    <div className="min-h-screen">
      <TopBar title="Reconciliation" subtitle="Bank vs GL Proof" />

      <div className="p-6 space-y-6">
        {loading ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center justify-center py-20"
          >
            <div className="text-muted-foreground text-sm">Loading reconciliation summary...</div>
          </motion.div>
        ) : (
          <>
            {/* Bank Side */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="bg-card border border-border rounded-xl shadow-card p-5"
            >
              <h2 className="text-base font-semibold text-foreground mb-3 flex items-center gap-2">
                <Scale className="w-4 h-4 text-primary" />
                Bank Side
              </h2>
              <div className="space-y-0">
                <SummaryLine label="Balance per Bank Statement" amount={summary.bank_balance} isBold />
                <SummaryLine label="Outstanding Deposits" amount={summary.outstanding_deposits} isAdd={true} />
                <SummaryLine label="Outstanding Checks" amount={summary.outstanding_checks} isAdd={false} />
                <SummaryLine label="Outstanding Other" amount={summary.outstanding_other} isAdd={false} />
                <div className="border-t border-border my-2" />
                <SummaryLine label="Adjusted Bank Balance" amount={summary.adjusted_bank_balance} isBold />
              </div>
            </motion.div>

            {/* GL Side */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.1 }}
              className="bg-card border border-border rounded-xl shadow-card p-5"
            >
              <h2 className="text-base font-semibold text-foreground mb-3 flex items-center gap-2">
                <Scale className="w-4 h-4 text-primary" />
                GL Side
              </h2>
              <div className="space-y-0">
                <SummaryLine label="Balance per G/L" amount={summary.gl_balance} isBold />
                <SummaryLine label="Fees Not Yet Booked" amount={summary.fees_not_booked} isAdd={true} />
                <SummaryLine label="Deposit Corrections" amount={summary.deposit_corrections} isAdd={true} />
                <div className="border-t border-border my-2" />
                <SummaryLine label="Adjusted G/L Balance" amount={summary.adjusted_gl_balance} isBold />
              </div>
            </motion.div>

            {/* Proof */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.2 }}
              className={`border rounded-xl shadow-card p-5 ${
                isProofZero
                  ? 'bg-emerald-500/5 border-emerald-500/30 shadow-emerald-500/5'
                  : 'bg-red-500/5 border-red-500/30 shadow-red-500/5'
              }`}
              style={{
                boxShadow: isProofZero
                  ? '0 0 20px rgba(16, 185, 129, 0.1)'
                  : '0 0 20px rgba(239, 68, 68, 0.1)',
              }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {isProofZero ? (
                    <CheckCircle2 className="w-6 h-6 text-emerald-500" />
                  ) : (
                    <AlertTriangle className="w-6 h-6 text-red-500" />
                  )}
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      PROOF: Adjusted Bank - Adjusted GL
                    </p>
                    <p className={`text-xs ${isProofZero ? 'text-emerald-500' : 'text-red-500'}`}>
                      {isProofZero ? 'Reconciliation balances' : 'Reconciliation does not balance'}
                    </p>
                  </div>
                </div>
                <span className={`text-2xl font-bold font-mono ${
                  isProofZero ? 'text-emerald-500' : 'text-red-500'
                }`}>
                  {formatCurrency(summary.proof)}
                </span>
              </div>
            </motion.div>

            {/* Expandable Sections */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.3 }}
              className="space-y-3"
            >
              <ExpandableSection
                title="Outstanding Checks"
                count={summary.outstanding_checks_list.length}
                items={summary.outstanding_checks_list}
                sectionKey="checks"
              />
              <ExpandableSection
                title="Outstanding Deposits"
                count={summary.outstanding_deposits_list.length}
                items={summary.outstanding_deposits_list}
                sectionKey="deposits"
              />
              <ExpandableSection
                title="Outstanding Other"
                count={summary.outstanding_other_list.length}
                items={summary.outstanding_other_list}
                sectionKey="other"
              />

              {/* Adjustments section */}
              <div className="border border-border rounded-xl overflow-hidden">
                <button
                  onClick={() => toggleSection('adjustments')}
                  className="w-full flex items-center justify-between px-5 py-3 bg-card hover:bg-secondary/30 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    {expandedSections['adjustments'] ? (
                      <ChevronDown className="w-4 h-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    )}
                    <span className="text-sm font-medium text-foreground">Adjustments</span>
                    <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
                      {summary.adjustments.length}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1 h-7 text-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      setAdjustmentDialogOpen(true);
                    }}
                  >
                    <Plus className="w-3 h-3" />
                    Add adjustment
                  </Button>
                </button>
                <AnimatePresence>
                  {expandedSections['adjustments'] && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="border-t border-border">
                        {summary.adjustments.length > 0 ? (
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="bg-muted/30">
                                <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Category</th>
                                <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Description</th>
                                <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Amount</th>
                              </tr>
                            </thead>
                            <tbody>
                              {summary.adjustments.map((adj) => (
                                <tr key={adj.id} className="border-t border-border/50 hover:bg-secondary/20">
                                  <td className="px-4 py-2">
                                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                                      adj.category === 'bank'
                                        ? 'bg-blue-500/10 text-blue-400'
                                        : 'bg-purple-500/10 text-purple-400'
                                    }`}>
                                      {adj.category === 'bank' ? 'Bank' : 'GL'}
                                    </span>
                                  </td>
                                  <td className="px-4 py-2 text-foreground">{adj.description}</td>
                                  <td className="px-4 py-2 text-right font-mono text-foreground">{formatCurrency(adj.amount)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <div className="px-5 py-4 text-sm text-muted-foreground">
                            No adjustments added yet.
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          </>
        )}
      </div>

      {/* Add Adjustment Dialog */}
      <Dialog open={adjustmentDialogOpen} onOpenChange={setAdjustmentDialogOpen}>
        <DialogContent className="bg-card border-border max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Adjustment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Category</label>
              <select
                value={newAdjustment.category}
                onChange={(e) => setNewAdjustment(prev => ({ ...prev, category: e.target.value as 'bank' | 'gl' }))}
                className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground"
              >
                <option value="bank">Bank Side</option>
                <option value="gl">GL Side</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Description</label>
              <Input
                value={newAdjustment.description}
                onChange={(e) => setNewAdjustment(prev => ({ ...prev, description: e.target.value }))}
                placeholder="e.g., Bank fee not yet recorded"
                className="bg-input border-border"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Amount (EUR)</label>
              <Input
                type="number"
                step="0.01"
                value={newAdjustment.amount}
                onChange={(e) => setNewAdjustment(prev => ({ ...prev, amount: e.target.value }))}
                placeholder="e.g., -150.00"
                className="bg-input border-border"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setAdjustmentDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleAddAdjustment}>
                Add Adjustment
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
