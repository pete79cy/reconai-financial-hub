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
} from 'lucide-react';
import { Transaction } from '@/types/transaction';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/badges/StatusBadge';
import { FlagBadge } from '@/components/badges/FlagBadge';
import { ConfidenceMeter } from '@/components/ui/ConfidenceMeter';
import { formatCurrency, formatDate } from '@/utils/reconciliation';
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
  if (!transaction) return null;

  // Build a simple timeline of status changes
  const timeline = [
    {
      label: 'Created',
      date: transaction.date,
      icon: <Clock className="w-3.5 h-3.5" />,
      active: true,
    },
    {
      label: 'Matched',
      date:
        transaction.status === 'matched' || transaction.status === 'approved'
          ? transaction.date
          : null,
      icon: <CheckCircle className="w-3.5 h-3.5" />,
      active:
        transaction.status === 'matched' || transaction.status === 'approved',
    },
    {
      label:
        transaction.status === 'rejected'
          ? 'Rejected'
          : transaction.status === 'approved'
            ? 'Approved'
            : 'Pending review',
      date:
        transaction.status !== 'unmatched' && transaction.status !== 'pending'
          ? transaction.date
          : null,
      icon:
        transaction.status === 'rejected' ? (
          <XCircle className="w-3.5 h-3.5" />
        ) : (
          <CheckCircle className="w-3.5 h-3.5" />
        ),
      active:
        transaction.status === 'approved' || transaction.status === 'rejected',
    },
  ];

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md bg-card border-border overflow-y-auto"
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

        <div className="space-y-6 py-6">
          {/* ID and Date */}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-secondary flex items-center justify-center">
                <Hash className="w-4 h-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Transaction ID</p>
                <p className="text-sm font-mono font-medium text-foreground">
                  {transaction.id}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-secondary flex items-center justify-center">
                <Calendar className="w-4 h-4 text-muted-foreground" />
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
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Banknote className="w-5 h-5 text-primary" />
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
                <div className="flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
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
              <div className="w-9 h-9 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0">
                <FileText className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="flex-1">
                <p className="text-xs text-muted-foreground mb-0.5">
                  Bank description
                </p>
                <p className="text-sm text-foreground">
                  {transaction.bank_desc}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0">
                <FileText className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="flex-1">
                <p className="text-xs text-muted-foreground mb-0.5">
                  GL description
                </p>
                <p className="text-sm text-foreground">
                  {transaction.gl_desc}
                </p>
              </div>
            </div>
          </div>

          {/* Confidence & Match Type */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-muted-foreground mb-2">
                AI confidence
              </p>
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-muted-foreground" />
                <ConfidenceMeter value={transaction.confidence} />
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-2">Match type</p>
              <StatusBadge status={transaction.match_type} />
            </div>
          </div>

          {/* Flags */}
          {transaction.flags && transaction.flags.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-2">
                Active flags
              </p>
              <div className="flex gap-2 flex-wrap">
                {transaction.flags.map((flag) => (
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

          {/* Timeline */}
          <div className="pt-4 border-t border-border">
            <p className="text-xs text-muted-foreground mb-3">
              Match history
            </p>
            <div className="space-y-0">
              {timeline.map((step, i) => (
                <div key={step.label} className="flex items-start gap-3">
                  {/* Vertical line + dot */}
                  <div className="flex flex-col items-center">
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center ${
                        step.active
                          ? 'bg-primary/10 text-primary'
                          : 'bg-secondary text-muted-foreground/40'
                      }`}
                    >
                      {step.icon}
                    </div>
                    {i < timeline.length - 1 && (
                      <div className="w-px h-5 bg-border" />
                    )}
                  </div>
                  {/* Label */}
                  <div className="pb-4">
                    <p
                      className={`text-sm ${
                        step.active
                          ? 'text-foreground font-medium'
                          : 'text-muted-foreground'
                      }`}
                    >
                      {step.label}
                    </p>
                    {step.date && (
                      <p className="text-xs text-muted-foreground">
                        {formatDate(step.date)}
                      </p>
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
