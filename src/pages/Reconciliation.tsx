import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronDown,
  ChevronRight,
  Plus,
  X,
  Scale,
  CheckCircle2,
  AlertTriangle,
  Upload,
  Lock,
  Calendar,
  FileSpreadsheet,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatCurrency, formatDate } from '@/utils/reconciliation';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';

interface ReconciliationSummary {
  bankBalance: number;
  outstandingDeposits: number;
  outstandingChecks: number;
  outstandingOther: number;
  adjustedBankBalance: number;
  glBalance: number;
  feesNotBooked: number;
  depositCorrections: number;
  otherAdjustments: number;
  adjustedGLBalance: number;
  proof: number;
  outstandingChecksList: OutstandingItem[];
  outstandingDepositsList: OutstandingItem[];
  outstandingOtherList: OutstandingItem[];
  adjustments: Adjustment[];
}

interface OutstandingItem {
  id: string;
  date: string;
  description: string;
  amount: number;
  reference?: string;
  source_period?: string | null;
  item_type?: string;
  status?: string;
  cleared_in_period?: string | null;
}

interface Adjustment {
  id: string;
  category: 'bank' | 'gl';
  description: string;
  amount: number;
}

interface PeriodRecord {
  id: string;
  status: string;
  bank_balance?: number | null;
  gl_balance?: number | null;
  adjusted_bank_balance?: number | null;
  adjusted_gl_balance?: number | null;
  proof: number | null;
  closed_at: string | null;
  created_at: string;
}

interface OutstandingRecord {
  id: string;
  period: string;
  item_type: string;
  reference_number: string | null;
  description: string | null;
  amount: number;
  date: string | null;
  source: string | null;
  source_period: string | null;
  status: string;
  cleared_in_period: string | null;
  cleared_date: string | null;
}

const defaultSummary: ReconciliationSummary = {
  bankBalance: 0,
  outstandingDeposits: 0,
  outstandingChecks: 0,
  outstandingOther: 0,
  adjustedBankBalance: 0,
  glBalance: 0,
  feesNotBooked: 0,
  depositCorrections: 0,
  otherAdjustments: 0,
  adjustedGLBalance: 0,
  proof: 0,
  outstandingChecksList: [],
  outstandingDepositsList: [],
  outstandingOtherList: [],
  adjustments: [],
};

function formatPeriodLabel(periodId: string): string {
  const [yearStr, monthStr] = periodId.split('-');
  const date = new Date(parseInt(yearStr), parseInt(monthStr) - 1, 1);
  return date.toLocaleString('en-US', { month: 'short', year: 'numeric' });
}

export default function Reconciliation() {
  const [summary, setSummary] = useState<ReconciliationSummary>(defaultSummary);
  const [loading, setLoading] = useState(true);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [adjustmentDialogOpen, setAdjustmentDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [newAdjustment, setNewAdjustment] = useState<{ category: 'bank' | 'gl'; description: string; amount: string }>({
    category: 'bank',
    description: '',
    amount: '',
  });

  // Period management state
  const [periods, setPeriods] = useState<PeriodRecord[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<string>('');
  const [newPeriodDialogOpen, setNewPeriodDialogOpen] = useState(false);
  const [newPeriodValue, setNewPeriodValue] = useState('');
  const [closingPeriod, setClosingPeriod] = useState(false);

  // Outstanding items for period
  const [periodOutstandingItems, setPeriodOutstandingItems] = useState<OutstandingRecord[]>([]);
  const [clearedItems, setClearedItems] = useState<OutstandingRecord[]>([]);
  const [showCleared, setShowCleared] = useState(false);

  // Import state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importParsedItems, setImportParsedItems] = useState<any[]>([]);
  const [importFileName, setImportFileName] = useState('');

  // Fetch periods on mount
  useEffect(() => {
    fetchPeriods();
  }, []);

  const fetchPeriods = async () => {
    try {
      const res = await fetch('/api/reconciliation/periods');
      if (res.ok) {
        const data = await res.json();
        setPeriods(data);
        // Auto-select the first open period, or the most recent
        if (data.length > 0 && !selectedPeriod) {
          const openPeriod = data.find((p: PeriodRecord) => p.status === 'open');
          setSelectedPeriod(openPeriod ? openPeriod.id : data[0].id);
        }
      }
    } catch {
      // API not available
    }
  };

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    try {
      const url = selectedPeriod
        ? `/api/reconciliation/summary?period=${selectedPeriod}`
        : '/api/reconciliation/summary';
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setSummary(data);
      } else {
        setSummary(defaultSummary);
      }
    } catch {
      setSummary(defaultSummary);
    } finally {
      setLoading(false);
    }
  }, [selectedPeriod]);

  const fetchOutstandingItems = useCallback(async () => {
    if (!selectedPeriod) return;
    try {
      const res = await fetch(`/api/reconciliation/outstanding?period=${selectedPeriod}`);
      if (res.ok) {
        const data: OutstandingRecord[] = await res.json();
        setPeriodOutstandingItems(data.filter(i => i.status === 'outstanding'));
        setClearedItems(data.filter(i => i.status === 'cleared'));
      }
    } catch {
      // API not available
    }
  }, [selectedPeriod]);

  useEffect(() => {
    fetchSummary();
    fetchOutstandingItems();
  }, [fetchSummary, fetchOutstandingItems]);

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
      if (adjustment.category === 'bank') {
        updated.adjustedBankBalance += adjustment.amount;
      } else {
        updated.adjustedGLBalance += adjustment.amount;
      }
      updated.proof = updated.adjustedBankBalance - updated.adjustedGLBalance;
      return updated;
    });

    try {
      await fetch('/api/reconciliation/adjustments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...adjustment,
          period: selectedPeriod || 'default',
        }),
      });
    } catch {
      // Best-effort
    }

    setAdjustmentDialogOpen(false);
    setNewAdjustment({ category: 'bank', description: '', amount: '' });
    toast.success('Adjustment added');
  };

  const handleCreatePeriod = async () => {
    if (!newPeriodValue || !/^\d{4}-\d{2}$/.test(newPeriodValue)) {
      toast.error('Enter a valid period in YYYY-MM format');
      return;
    }

    try {
      const res = await fetch('/api/reconciliation/periods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period: newPeriodValue }),
      });
      if (res.ok) {
        const data = await res.json();
        toast.success(
          data.carried_forward
            ? `Period ${newPeriodValue} created with ${data.carried_forward} carried-forward items`
            : `Period ${newPeriodValue} created`
        );
        setSelectedPeriod(newPeriodValue);
        setNewPeriodDialogOpen(false);
        setNewPeriodValue('');
        await fetchPeriods();
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to create period');
      }
    } catch {
      toast.error('Failed to create period');
    }
  };

  const handleClosePeriod = async () => {
    if (!selectedPeriod) return;
    setClosingPeriod(true);
    try {
      const res = await fetch(`/api/reconciliation/periods/${selectedPeriod}/close`, {
        method: 'POST',
      });
      if (res.ok) {
        const data = await res.json();
        toast.success(`Period ${selectedPeriod} closed. Proof: ${formatCurrency(data.proof)}`);
        await fetchPeriods();
        await fetchSummary();
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to close period');
      }
    } catch {
      toast.error('Failed to close period');
    } finally {
      setClosingPeriod(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFileName(file.name);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const jsonRows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });

        // Map Excel columns to our format
        // Expected columns: Ref No., Date, Explanation/Payee, Amount
        const parsed = jsonRows.map((row) => {
          // Try various column name patterns
          const refNo =
            row['Ref No.'] || row['Ref No'] || row['Reference'] || row['Cheque No'] ||
            row['Check No'] || row['ref_no'] || '';
          const date =
            row['Date'] || row['date'] || '';
          const description =
            row['Explanation/Payee'] || row['Explanation'] || row['Payee'] ||
            row['Description'] || row['description'] || '';
          const amount =
            row['Amount'] || row['amount'] || 0;

          return {
            reference_number: String(refNo).trim(),
            date: date ? formatExcelDate(date) : null,
            description: String(description).trim(),
            amount: typeof amount === 'number' ? amount : parseFloat(String(amount).replace(/,/g, '')) || 0,
            item_type: 'cheque',
            source: 'Excel Import',
          };
        }).filter(item => item.amount !== 0);

        setImportParsedItems(parsed);
      } catch {
        toast.error('Failed to parse Excel file');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleImportSubmit = async () => {
    if (importParsedItems.length === 0 || !selectedPeriod) {
      toast.error('No items to import or no period selected');
      return;
    }

    try {
      const res = await fetch('/api/reconciliation/outstanding/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          period: selectedPeriod,
          items: importParsedItems,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        toast.success(`Imported ${data.imported} outstanding items`);
        setImportDialogOpen(false);
        setImportParsedItems([]);
        setImportFileName('');
        if (fileInputRef.current) fileInputRef.current.value = '';
        await fetchSummary();
        await fetchOutstandingItems();
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to import');
      }
    } catch {
      toast.error('Failed to import outstanding items');
    }
  };

  const isProofZero = Math.abs(summary.proof) < 0.01;
  const currentPeriodRecord = periods.find(p => p.id === selectedPeriod);
  const isPeriodClosed = currentPeriodRecord?.status === 'closed';

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
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Source</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.id} className="border-t border-border/50 hover:bg-secondary/20">
                        <td className="px-4 py-2 text-muted-foreground">{formatDate(item.date)}</td>
                        <td className="px-4 py-2 text-foreground">{item.description}</td>
                        <td className="px-4 py-2 text-muted-foreground font-mono">{item.reference || '-'}</td>
                        <td className="px-4 py-2">
                          {item.source_period && item.source_period !== selectedPeriod ? (
                            <span className="inline-flex items-center gap-1 text-xs bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded-full">
                              <Calendar className="w-3 h-3" />
                              From {formatPeriodLabel(item.source_period)}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">Current</span>
                          )}
                        </td>
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
        {/* Period Selector Bar */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 flex-wrap"
        >
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">Period:</span>
          </div>
          <Select value={selectedPeriod} onValueChange={(val) => setSelectedPeriod(val)}>
            <SelectTrigger className="w-[180px] bg-card border-border">
              <SelectValue placeholder="Select period" />
            </SelectTrigger>
            <SelectContent>
              {periods.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  <div className="flex items-center gap-2">
                    <span>{formatPeriodLabel(p.id)}</span>
                    {p.status === 'closed' && (
                      <Lock className="w-3 h-3 text-muted-foreground" />
                    )}
                  </div>
                </SelectItem>
              ))}
              {periods.length === 0 && (
                <SelectItem value="__none" disabled>
                  No periods yet
                </SelectItem>
              )}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="outline"
            className="gap-1"
            onClick={() => setNewPeriodDialogOpen(true)}
          >
            <Plus className="w-3 h-3" />
            New Period
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1"
            onClick={() => setImportDialogOpen(true)}
            disabled={!selectedPeriod || isPeriodClosed}
          >
            <Upload className="w-3 h-3" />
            Import Outstanding
          </Button>
          <Button
            size="sm"
            variant="default"
            className="gap-1"
            onClick={handleClosePeriod}
            disabled={!selectedPeriod || isPeriodClosed || closingPeriod}
          >
            <Lock className="w-3 h-3" />
            {closingPeriod ? 'Closing...' : 'Close Period'}
          </Button>
          {isPeriodClosed && (
            <span className="text-xs bg-emerald-500/10 text-emerald-400 px-3 py-1 rounded-full font-medium">
              Period Closed
            </span>
          )}
        </motion.div>

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
                <SummaryLine label="Balance per Bank Statement" amount={summary.bankBalance} isBold />
                <SummaryLine label="Outstanding Deposits" amount={summary.outstandingDeposits} isAdd={true} />
                <SummaryLine label="Outstanding Checks" amount={summary.outstandingChecks} isAdd={false} />
                <SummaryLine label="Outstanding Other" amount={summary.outstandingOther} isAdd={false} />
                <div className="border-t border-border my-2" />
                <SummaryLine label="Adjusted Bank Balance" amount={summary.adjustedBankBalance} isBold />
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
                <SummaryLine label="Balance per G/L" amount={summary.glBalance} isBold />
                <SummaryLine label="Fees Not Yet Booked" amount={summary.feesNotBooked} isAdd={true} />
                <SummaryLine label="Deposit Corrections" amount={summary.depositCorrections} isAdd={true} />
                <div className="border-t border-border my-2" />
                <SummaryLine label="Adjusted G/L Balance" amount={summary.adjustedGLBalance} isBold />
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
                count={summary.outstandingChecks_list.length}
                items={summary.outstandingChecks_list}
                sectionKey="checks"
              />
              <ExpandableSection
                title="Outstanding Deposits"
                count={summary.outstandingDeposits_list.length}
                items={summary.outstandingDeposits_list}
                sectionKey="deposits"
              />
              <ExpandableSection
                title="Outstanding Other"
                count={summary.outstandingOther_list.length}
                items={summary.outstandingOther_list}
                sectionKey="other"
              />

              {/* Cleared Items (collapsible) */}
              {clearedItems.length > 0 && (
                <div className="border border-border rounded-xl overflow-hidden">
                  <button
                    onClick={() => setShowCleared(!showCleared)}
                    className="w-full flex items-center justify-between px-5 py-3 bg-card hover:bg-secondary/30 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      {showCleared ? (
                        <ChevronDown className="w-4 h-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      )}
                      <span className="text-sm font-medium text-foreground">Cleared Items</span>
                      <span className="text-xs bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded-full">
                        {clearedItems.length}
                      </span>
                    </div>
                  </button>
                  <AnimatePresence>
                    {showCleared && (
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
                                <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Cleared In</th>
                                <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Amount</th>
                              </tr>
                            </thead>
                            <tbody>
                              {clearedItems.map((item) => (
                                <tr key={item.id} className="border-t border-border/50 hover:bg-secondary/20">
                                  <td className="px-4 py-2 text-muted-foreground line-through">
                                    {item.date ? formatDate(item.date) : '-'}
                                  </td>
                                  <td className="px-4 py-2 text-muted-foreground line-through">
                                    {item.description || '-'}
                                  </td>
                                  <td className="px-4 py-2 text-muted-foreground font-mono line-through">
                                    {item.reference_number || '-'}
                                  </td>
                                  <td className="px-4 py-2">
                                    {item.cleared_in_period && (
                                      <span className="text-xs bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded-full">
                                        {formatPeriodLabel(item.cleared_in_period)}
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-4 py-2 text-right font-mono text-muted-foreground line-through">
                                    {formatCurrency(parseFloat(String(item.amount)))}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

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

      {/* New Period Dialog */}
      <Dialog open={newPeriodDialogOpen} onOpenChange={setNewPeriodDialogOpen}>
        <DialogContent className="bg-card border-border max-w-sm">
          <DialogHeader>
            <DialogTitle>Create New Period</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Period (YYYY-MM)</label>
              <Input
                value={newPeriodValue}
                onChange={(e) => setNewPeriodValue(e.target.value)}
                placeholder="e.g., 2025-10"
                className="bg-input border-border"
              />
              <p className="text-xs text-muted-foreground mt-1.5">
                Outstanding items from the previous month will be carried forward automatically.
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setNewPeriodDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreatePeriod}>
                Create Period
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Import Outstanding Dialog */}
      <Dialog open={importDialogOpen} onOpenChange={(open) => {
        setImportDialogOpen(open);
        if (!open) {
          setImportParsedItems([]);
          setImportFileName('');
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      }}>
        <DialogContent className="bg-card border-border max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-primary" />
              Import Outstanding Items
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">
                Upload Excel file with columns: Ref No., Date, Explanation/Payee, Amount
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileUpload}
                className="w-full text-sm text-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border file:border-border file:bg-card file:text-sm file:text-foreground hover:file:bg-secondary/30"
              />
              {importFileName && (
                <p className="text-xs text-muted-foreground mt-1">
                  File: {importFileName}
                </p>
              )}
            </div>

            {importParsedItems.length > 0 && (
              <div>
                <p className="text-sm font-medium text-foreground mb-2">
                  Preview ({importParsedItems.length} items)
                </p>
                <div className="max-h-60 overflow-y-auto border border-border rounded-lg">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted/30 sticky top-0">
                        <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">Ref</th>
                        <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">Date</th>
                        <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">Description</th>
                        <th className="px-3 py-1.5 text-right font-medium text-muted-foreground">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importParsedItems.slice(0, 20).map((item, i) => (
                        <tr key={i} className="border-t border-border/50">
                          <td className="px-3 py-1.5 font-mono text-muted-foreground">{item.reference_number || '-'}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">{item.date || '-'}</td>
                          <td className="px-3 py-1.5 text-foreground truncate max-w-[200px]">{item.description}</td>
                          <td className="px-3 py-1.5 text-right font-mono text-foreground">{formatCurrency(item.amount)}</td>
                        </tr>
                      ))}
                      {importParsedItems.length > 20 && (
                        <tr className="border-t border-border/50">
                          <td colSpan={4} className="px-3 py-1.5 text-center text-muted-foreground">
                            ... and {importParsedItems.length - 20} more items
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setImportDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleImportSubmit} disabled={importParsedItems.length === 0}>
                Import {importParsedItems.length} Items
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Convert an Excel date (serial number or string) to YYYY-MM-DD format.
 */
function formatExcelDate(value: any): string | null {
  if (!value) return null;

  // If it's a number (Excel serial date)
  if (typeof value === 'number') {
    const date = new Date((value - 25569) * 86400 * 1000);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
  }

  // If it's already a string, try to parse it
  const str = String(value).trim();
  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    return d.toISOString().split('T')[0];
  }

  // Try DD/MM/YYYY format
  const parts = str.split('/');
  if (parts.length === 3) {
    const [day, month, year] = parts;
    const parsed = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split('T')[0];
    }
  }

  return str;
}
