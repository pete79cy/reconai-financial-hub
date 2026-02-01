import { motion } from 'framer-motion';
import { 
  X, 
  CheckCircle, 
  XCircle, 
  Building2, 
  Calendar,
  Hash,
  Banknote,
  FileText,
  TrendingUp
} from 'lucide-react';
import { Transaction } from '@/types/transaction';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/badges/StatusBadge';
import { FlagBadge } from '@/components/badges/FlagBadge';
import { ConfidenceMeter } from '@/components/ui/ConfidenceMeter';
import { formatCurrency, formatDate } from '@/utils/reconciliation';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
  if (!transaction) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-card border-border max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>Transaction Details</span>
            <StatusBadge status={transaction.status} />
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* ID and Date */}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center">
                <Hash className="w-5 h-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Transaction ID</p>
                <p className="text-sm font-mono font-medium text-foreground">
                  {transaction.id}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center">
                <Calendar className="w-5 h-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Date</p>
                <p className="text-sm font-medium text-foreground">
                  {formatDate(transaction.date)}
                </p>
              </div>
            </div>
          </div>

          {/* Amount */}
          <div className="bg-secondary/50 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Banknote className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Amount</p>
                  <p className="text-2xl font-bold font-mono text-foreground">
                    {formatCurrency(transaction.amount)}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Bank</p>
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium text-foreground">
                    {transaction.bank_name}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Descriptions */}
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0">
                <FileText className="w-5 h-5 text-muted-foreground" />
              </div>
              <div className="flex-1">
                <p className="text-xs text-muted-foreground mb-1">Bank Description</p>
                <p className="text-sm text-foreground">{transaction.bank_desc}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0">
                <FileText className="w-5 h-5 text-muted-foreground" />
              </div>
              <div className="flex-1">
                <p className="text-xs text-muted-foreground mb-1">GL Description</p>
                <p className="text-sm text-foreground">{transaction.gl_desc}</p>
              </div>
            </div>
          </div>

          {/* Confidence & Match Type */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-muted-foreground mb-2">AI Confidence</p>
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-muted-foreground" />
                <ConfidenceMeter value={transaction.confidence} />
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-2">Match Type</p>
              <StatusBadge status={transaction.match_type} />
            </div>
          </div>

          {/* Flags */}
          {transaction.flags && transaction.flags.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-2">Active Flags</p>
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
              onClick={() => {
                onReject(transaction.id);
                onClose();
              }}
              disabled={transaction.status === 'rejected'}
            >
              <XCircle className="w-4 h-4" />
              Reject
            </Button>
            <Button
              className="flex-1 gap-2"
              onClick={() => {
                onApprove(transaction.id);
                onClose();
              }}
              disabled={transaction.status === 'matched'}
            >
              <CheckCircle className="w-4 h-4" />
              Approve
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
