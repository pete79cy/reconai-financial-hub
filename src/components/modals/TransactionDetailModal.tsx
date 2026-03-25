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
  ArrowRightLeft,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Scale,
  Type,
} from 'lucide-react';
import { Transaction, BankTransaction, GLTransaction } from '@/types/transaction';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/badges/StatusBadge';
import { FlagBadge } from '@/components/badges/FlagBadge';
import { formatCurrency, formatDate } from '@/utils/reconciliation';
import { useRecon } from '@/context/ReconContext';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

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

  const bankTx = useMemo<BankTransaction | null>(() => {
    if (!transaction?.bank_tx_id) return null;
    return bankTransactions.find(t => t.id === transaction.bank_tx_id) || null;
  }, [transaction, bankTransactions]);

  const glTx = useMemo<GLTransaction | null>(() => {
    if (!transaction?.gl_tx_id) return null;
    return glTransactions.find(t => t.id === transaction.gl_tx_id) || null;
  }, [transaction, glTransactions]);

  if (!transaction) return null;

  const bankAmount = bankTx?.amount ?? transaction.amount;
  const glAmount = glTx?.amount ?? transaction.amount;
  const amountDiff = Math.abs(bankAmount - glAmount);
  const amountMatch = amountDiff < 0.01;

  const maxAmount = Math.max(bankAmount, glAmount, 1);
  const percentDiff = Math.abs(bankAmount - glAmount) / maxAmount;
  const amountScore = amountDiff < 0.01 ? 70 : Math.max(0, Math.round(70 * (1 - percentDiff)));
  const descScore = Math.max(0, transaction.confidence - amountScore);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-card border-border max-w-2xl p-0 gap-0">
        {/* Header */}
        <DialogHeader className="px-5 py-3 border-b border-border">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-sm">Transaction details</DialogTitle>
            <StatusBadge status={transaction.status} />
          </div>
          <DialogDescription className="sr-only">
            Details for transaction {transaction.id}
          </DialogDescription>
        </DialogHeader>

        {/* Compact ID + Date row */}
        <div className="px-5 py-2 flex items-center gap-6 border-b border-border bg-muted/20">
          <div className="flex items-center gap-2">
            <Hash className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-[11px] text-muted-foreground">ID:</span>
            <span className="text-[11px] font-mono text-foreground">{transaction.id}</span>
          </div>
          <div className="flex items-center gap-2">
            <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-[11px] text-muted-foreground">Date:</span>
            <span className="text-[11px] font-medium text-foreground">{formatDate(transaction.date)}</span>
          </div>
          {transaction.flags && transaction.flags.length > 0 && (
            <div className="flex gap-1 ml-auto">
              {transaction.flags.map(flag => (
                <FlagBadge key={flag} flag={flag} />
              ))}
            </div>
          )}
        </div>

        {/* Side-by-side comparison - compact */}
        <div className="grid grid-cols-2 divide-x divide-border">
          {/* Bank */}
          <div className="px-4 py-3 bg-brand-blue/5">
            <div className="flex items-center gap-1.5 mb-2">
              <Building2 className="w-3.5 h-3.5 text-brand-blue" />
              <span className="text-[10px] font-semibold text-brand-blue uppercase tracking-wider">Bank</span>
            </div>
            <p className="text-lg font-bold font-mono text-foreground tabular-nums">{formatCurrency(bankAmount)}</p>
            <div className="flex items-center gap-1 mt-1 mb-2">
              {bankTx?.type === 'debit' ? (
                <ArrowUp className="w-3 h-3 text-status-error" />
              ) : (
                <ArrowDown className="w-3 h-3 text-primary" />
              )}
              <span className="text-xs text-muted-foreground capitalize">{bankTx?.type || 'N/A'}</span>
            </div>
            <p className="text-[11px] text-foreground leading-snug mb-1">{transaction.bank_desc || '—'}</p>
            {bankTx?.reference_number && (
              <p className="text-[10px] text-muted-foreground">Ref: <span className="font-mono">{bankTx.reference_number}</span></p>
            )}
            <p className="text-[10px] text-muted-foreground mt-0.5">Bank: {transaction.bank_name}</p>
          </div>

          {/* GL */}
          <div className="px-4 py-3 bg-primary/5">
            <div className="flex items-center gap-1.5 mb-2">
              <FileText className="w-3.5 h-3.5 text-primary" />
              <span className="text-[10px] font-semibold text-primary uppercase tracking-wider">Ledger</span>
            </div>
            <p className="text-lg font-bold font-mono text-foreground tabular-nums">{glTx ? formatCurrency(glAmount) : '—'}</p>
            <div className="flex items-center gap-1 mt-1 mb-2">
              {glTx ? (
                <>
                  {glTx.type === 'debit' ? (
                    <ArrowDown className="w-3 h-3 text-primary" />
                  ) : (
                    <ArrowUp className="w-3 h-3 text-status-error" />
                  )}
                  <span className="text-xs text-muted-foreground capitalize">{glTx.type}</span>
                </>
              ) : (
                <span className="text-xs text-muted-foreground">N/A</span>
              )}
            </div>
            <p className="text-[11px] text-foreground leading-snug mb-1">{transaction.gl_desc || '—'}</p>
            {glTx?.reference && (
              <p className="text-[10px] text-muted-foreground">Ref: <span className="font-mono">{glTx.reference}</span></p>
            )}
            {glTx?.source && (
              <p className="text-[10px] text-muted-foreground mt-0.5">Source: {glTx.source}</p>
            )}
          </div>
        </div>

        {/* Variance bar */}
        <div className={`px-5 py-2 border-y border-border flex items-center justify-between ${
          amountMatch ? 'bg-primary/5' : 'bg-status-warn/5'
        }`}>
          <div className="flex items-center gap-1.5">
            <Scale className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-[11px] text-muted-foreground">Variance</span>
          </div>
          {amountMatch ? (
            <span className="text-xs font-mono font-semibold text-primary flex items-center gap-1">
              <CheckCircle className="w-3.5 h-3.5" /> Exact match
            </span>
          ) : (
            <span className="text-xs font-mono font-semibold text-status-warn flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" /> {formatCurrency(amountDiff)} difference
            </span>
          )}
        </div>

        {/* Confidence - single row */}
        <div className="px-5 py-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">AI Confidence</span>
            <span className="text-sm font-bold font-mono text-foreground">{transaction.confidence}%</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Banknote className="w-3 h-3" /> Amount
                </span>
                <span className="text-[10px] font-mono text-foreground">{amountScore}/70</span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full" style={{ width: `${(amountScore / 70) * 100}%` }} />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Type className="w-3 h-3" /> Description
                </span>
                <span className="text-[10px] font-mono text-foreground">{descScore}/30</span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-brand-blue rounded-full" style={{ width: `${(descScore / 30) * 100}%` }} />
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50">
            <span className="text-[10px] text-muted-foreground">Match type</span>
            <StatusBadge status={transaction.match_type} />
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 px-5 py-3 border-t border-border bg-muted/10">
          <Button
            variant="outline"
            className="flex-1 gap-2 h-9"
            onClick={() => { onReject(transaction.id); onClose(); }}
            disabled={transaction.status === 'rejected'}
          >
            <XCircle className="w-4 h-4" />
            Reject
          </Button>
          <Button
            className="flex-1 gap-2 h-9"
            onClick={() => { onApprove(transaction.id); onClose(); }}
            disabled={transaction.status === 'matched'}
          >
            <CheckCircle className="w-4 h-4" />
            Approve
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
