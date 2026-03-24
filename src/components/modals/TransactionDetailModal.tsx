import { useMemo } from 'react';
import {
  CheckCircle,
  XCircle,
  Building2,
  Calendar,
  Hash,
  Banknote,
  FileText,
  TrendingUp,
  Clock,
  ArrowRightLeft,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Scale,
  Percent,
  Type,
} from 'lucide-react';
import { Transaction, BankTransaction, GLTransaction } from '@/types/transaction';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/badges/StatusBadge';
import { FlagBadge } from '@/components/badges/FlagBadge';
import { ConfidenceMeter } from '@/components/ui/ConfidenceMeter';
import { formatCurrency, formatDate } from '@/utils/reconciliation';
import { useRecon } from '@/context/ReconContext';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';

interface TransactionDetailModalProps {
  transaction: Transaction | null;
  open: boolean;
  onClose: () => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}

export function TransactionDetailModal({
  transaction,
  open,
  onClose,
  onApprove,
  onReject,
}: TransactionDetailModalProps) {
  const { bankTransactions, glTransactions } = useRecon();

  // Look up the original bank and GL transactions
  const bankTx = useMemo<BankTransaction | null>(() => {
    if (!transaction?.bank_tx_id) return null;
    return bankTransactions.find(t => t.id === transaction.bank_tx_id) || null;
  }, [transaction, bankTransactions]);

  const glTx = useMemo<GLTransaction | null>(() => {
    if (!transaction?.gl_tx_id) return null;
    return glTransactions.find(t => t.id === transaction.gl_tx_id) || null;
  }, [transaction, glTransactions]);

  if (!transaction) return null;

  // Calculate amount variance
  const bankAmount = bankTx?.amount ?? transaction.amount;
  const glAmount = glTx?.amount ?? transaction.amount;
  const amountDiff = Math.abs(bankAmount - glAmount);
  const amountMatch = amountDiff < 0.01;

  // Confidence breakdown (reverse-engineer from the algorithm: 70pts amount + 30pts description)
  const maxAmount = Math.max(bankAmount, glAmount, 1);
  const percentDiff = Math.abs(bankAmount - glAmount) / maxAmount;
  const amountScore = amountDiff < 0.01 ? 70 : Math.max(0, Math.round(70 * (1 - percentDiff)));
  const descScore = Math.max(0, transaction.confidence - amountScore);

  const timeline = [
    {
      label: 'Created',
      date: transaction.date,
      icon: <Clock className="w-3.5 h-3.5" />,
      active: true,
    },
    {
      label: 'Matched',
      date: (transaction.status === 'matched' || transaction.status === 'approved') ? transaction.date : null,
      icon: <CheckCircle className="w-3.5 h-3.5" />,
      active: transaction.status === 'matched' || transaction.status === 'approved',
    },
    {
      label: transaction.status === 'rejected' ? 'Rejected'
        : transaction.status === 'approved' ? 'Approved'
        : 'Pending review',
      date: (transaction.status !== 'unmatched' && transaction.status !== 'pending') ? transaction.date : null,
      icon: transaction.status === 'rejected' ? <XCircle className="w-3.5 h-3.5" /> : <CheckCircle className="w-3.5 h-3.5" />,
      active: transaction.status === 'approved' || transaction.status === 'rejected',
    },
  ];

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-lg bg-card border-border overflow-y-auto"
      >
        <SheetHeader className="pb-4 border-b border-border">
          <div className="flex items-center justify-between pr-6">
            <SheetTitle className="text-base">Transaction details</SheetTitle>
            <StatusBadge status={transaction.status} />
          </div>
          <SheetDescription className="sr-only">
            Details for transaction {transaction.id}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 py-6">
          {/* ID and Date */}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-secondary flex items-center justify-center">
                <Hash className="w-4 h-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Transaction ID</p>
                <p className="text-xs font-mono font-medium text-foreground">{transaction.id}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-secondary flex items-center justify-center">
                <Calendar className="w-4 h-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Date</p>
                <p className="text-sm font-medium text-foreground">{formatDate(transaction.date)}</p>
              </div>
            </div>
          </div>

          {/* ═══════ SIDE-BY-SIDE COMPARISON ═══════ */}
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="grid grid-cols-2 divide-x divide-border">
              {/* Bank Side */}
              <div className="p-4 bg-brand-blue/5">
                <div className="flex items-center gap-2 mb-3">
                  <Building2 className="w-4 h-4 text-brand-blue" />
                  <span className="text-xs font-semibold text-brand-blue uppercase tracking-wide">Bank</span>
                </div>
                <div className="space-y-3">
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Amount</p>
                    <p className="text-lg font-bold font-mono text-foreground tabular-nums">
                      {formatCurrency(bankAmount)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Type</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {bankTx?.type === 'debit' ? (
                        <ArrowUp className="w-3.5 h-3.5 text-status-error" />
                      ) : (
                        <ArrowDown className="w-3.5 h-3.5 text-primary" />
                      )}
                      <span className="text-sm text-foreground capitalize">{bankTx?.type || 'N/A'}</span>
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Description</p>
                    <p className="text-xs text-foreground mt-0.5 leading-relaxed">{transaction.bank_desc || '—'}</p>
                  </div>
                  {bankTx?.reference && (
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Reference</p>
                      <p className="text-xs font-mono text-foreground mt-0.5">{bankTx.reference}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Bank name</p>
                    <p className="text-xs text-foreground mt-0.5">{transaction.bank_name}</p>
                  </div>
                </div>
              </div>

              {/* GL Side */}
              <div className="p-4 bg-primary/5">
                <div className="flex items-center gap-2 mb-3">
                  <FileText className="w-4 h-4 text-primary" />
                  <span className="text-xs font-semibold text-primary uppercase tracking-wide">Ledger</span>
                </div>
                <div className="space-y-3">
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Amount</p>
                    <p className="text-lg font-bold font-mono text-foreground tabular-nums">
                      {glTx ? formatCurrency(glAmount) : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Type</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {glTx ? (
                        <>
                          {glTx.type === 'debit' ? (
                            <ArrowDown className="w-3.5 h-3.5 text-primary" />
                          ) : (
                            <ArrowUp className="w-3.5 h-3.5 text-status-error" />
                          )}
                          <span className="text-sm text-foreground capitalize">{glTx.type}</span>
                        </>
                      ) : (
                        <span className="text-sm text-muted-foreground">N/A</span>
                      )}
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Description</p>
                    <p className="text-xs text-foreground mt-0.5 leading-relaxed">{transaction.gl_desc || '—'}</p>
                  </div>
                  {glTx?.reference && (
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Reference</p>
                      <p className="text-xs font-mono text-foreground mt-0.5">{glTx.reference}</p>
                    </div>
                  )}
                  {glTx?.source && (
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Source</p>
                      <p className="text-xs text-foreground mt-0.5">{glTx.source}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Variance Bar */}
            <div className={`px-4 py-3 border-t border-border flex items-center justify-between ${
              amountMatch ? 'bg-primary/5' : 'bg-status-warn/5'
            }`}>
              <div className="flex items-center gap-2">
                <Scale className="w-4 h-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Amount variance</span>
              </div>
              <div className="flex items-center gap-2">
                {amountMatch ? (
                  <>
                    <CheckCircle className="w-4 h-4 text-primary" />
                    <span className="text-sm font-mono font-semibold text-primary">Exact match</span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="w-4 h-4 text-status-warn" />
                    <span className="text-sm font-mono font-semibold text-status-warn">
                      {formatCurrency(amountDiff)} difference
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* ═══════ CONFIDENCE BREAKDOWN ═══════ */}
          <div className="rounded-xl border border-border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-muted-foreground" />
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">AI Confidence Breakdown</span>
              </div>
              <span className="text-lg font-bold font-mono text-foreground">{transaction.confidence}%</span>
            </div>

            {/* Amount score bar */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  <Banknote className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Amount match</span>
                </div>
                <span className="text-xs font-mono text-foreground">{amountScore}/70</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-500"
                  style={{ width: `${(amountScore / 70) * 100}%` }}
                />
              </div>
            </div>

            {/* Description score bar */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  <Type className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Description similarity</span>
                </div>
                <span className="text-xs font-mono text-foreground">{descScore}/30</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-brand-blue rounded-full transition-all duration-500"
                  style={{ width: `${(descScore / 30) * 100}%` }}
                />
              </div>
            </div>

            {/* Match type */}
            <div className="flex items-center justify-between pt-2 border-t border-border">
              <span className="text-xs text-muted-foreground">Match type</span>
              <StatusBadge status={transaction.match_type} />
            </div>
          </div>

          {/* Flags */}
          {transaction.flags && transaction.flags.length > 0 && (
            <div className="rounded-xl border border-status-warn/20 bg-status-warn/5 p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-status-warn" />
                <span className="text-xs font-semibold text-status-warn uppercase tracking-wide">Flags</span>
              </div>
              <div className="flex gap-2 flex-wrap">
                {transaction.flags.map(flag => (
                  <FlagBadge key={flag} flag={flag} />
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-4 border-t border-border">
            <Button
              variant="outline"
              className="flex-1 gap-2"
              onClick={() => { onReject(transaction.id); onClose(); }}
              disabled={transaction.status === 'rejected'}
            >
              <XCircle className="w-4 h-4" />
              Reject
            </Button>
            <Button
              className="flex-1 gap-2"
              onClick={() => { onApprove(transaction.id); onClose(); }}
              disabled={transaction.status === 'matched'}
            >
              <CheckCircle className="w-4 h-4" />
              Approve
            </Button>
          </div>

          {/* Timeline */}
          <div className="pt-4 border-t border-border">
            <p className="text-xs text-muted-foreground mb-3">Match history</p>
            <div className="space-y-0">
              {timeline.map((step, i) => (
                <div key={step.label} className="flex items-start gap-3">
                  <div className="flex flex-col items-center">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center ${
                      step.active ? 'bg-primary/10 text-primary' : 'bg-secondary text-muted-foreground/40'
                    }`}>
                      {step.icon}
                    </div>
                    {i < timeline.length - 1 && <div className="w-px h-5 bg-border" />}
                  </div>
                  <div className="pb-4">
                    <p className={`text-sm ${step.active ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                      {step.label}
                    </p>
                    {step.date && (
                      <p className="text-xs text-muted-foreground">{formatDate(step.date)}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
