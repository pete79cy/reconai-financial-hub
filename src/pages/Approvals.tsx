import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle,
  Clock,
  Eye,
  Send,
  ArrowRight,
  Inbox,
} from 'lucide-react';
import { TopBar } from '@/components/layout/TopBar';
import { Button } from '@/components/ui/button';
import { useRecon } from '@/context/ReconContext';
import { formatCurrency, formatDate } from '@/utils/reconciliation';
import { ApprovalStage, Transaction } from '@/types/transaction';
import { toast } from 'sonner';

const stageFlow: ApprovalStage[] = ['none', 'submitted', 'review', 'posted'];

function getNextStage(current: ApprovalStage): ApprovalStage {
  const currentIndex = stageFlow.indexOf(current);
  if (currentIndex < stageFlow.length - 1) {
    return stageFlow[currentIndex + 1];
  }
  return current;
}

function getStageAction(
  stage: ApprovalStage
): { label: string; icon: React.ReactNode } {
  switch (stage) {
    case 'none':
      return { label: 'Submit', icon: <Send className="w-4 h-4" /> };
    case 'submitted':
      return { label: 'Review', icon: <Eye className="w-4 h-4" /> };
    case 'review':
      return {
        label: 'Approve',
        icon: <CheckCircle className="w-4 h-4" />,
      };
    default:
      return { label: 'Done', icon: <CheckCircle className="w-4 h-4" /> };
  }
}

interface ColumnDef {
  key: 'submitted' | 'review' | 'posted';
  label: string;
  dotColor: string;
}

const columns: ColumnDef[] = [
  { key: 'submitted', label: 'Submitted', dotColor: 'bg-brand-blue' },
  { key: 'review', label: 'In Review', dotColor: 'bg-status-warn' },
  { key: 'posted', label: 'Posted', dotColor: 'bg-primary' },
];

export default function Approvals() {
  const { transactions, updateApprovalStage, updateStatus } = useRecon();

  // Filter for approval workflow items
  const approvalItems = transactions.filter(
    (t) => t.status === 'rejected' || t.approval_stage !== 'none'
  );

  // Group by stage
  const grouped: Record<string, Transaction[]> = {
    submitted: approvalItems.filter((t) => t.approval_stage === 'submitted' || (t.approval_stage === 'none' && t.status === 'rejected')),
    review: approvalItems.filter((t) => t.approval_stage === 'review'),
    posted: approvalItems.filter((t) => t.approval_stage === 'posted'),
  };

  const handleAdvanceStage = (id: string, currentStage: ApprovalStage) => {
    const nextStage = getNextStage(currentStage);
    updateApprovalStage(id, nextStage);

    if (nextStage === 'posted') {
      toast.success('Transaction Posted', {
        description: `${id} has been approved and posted to the ledger.`,
      });

      setTimeout(() => {
        updateStatus(id, 'approved');
      }, 2000);
    } else {
      toast.info(`Stage Updated: ${nextStage}`, {
        description: `${id} moved to ${nextStage} stage.`,
      });
    }
  };

  return (
    <div className="min-h-screen">
      <TopBar title="Approvals" subtitle="Workflow Management" />

      <div className="p-6 space-y-4">
        {/* Workflow legend - subtle */}
        <div className="flex items-center gap-6 text-xs text-muted-foreground">
          {columns.map((col, i) => (
            <div key={col.key} className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <div className={`w-2 h-2 rounded-full ${col.dotColor}`} />
                <span>{col.label}</span>
              </div>
              {i < columns.length - 1 && (
                <ArrowRight className="w-3 h-3 text-muted-foreground/50" />
              )}
            </div>
          ))}
        </div>

        {/* Kanban columns */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {columns.map((col) => {
            const items = grouped[col.key] || [];
            return (
              <motion.div
                key={col.key}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-card border border-border rounded-xl shadow-card flex flex-col min-h-[300px]"
              >
                {/* Column header */}
                <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-2.5 h-2.5 rounded-full ${col.dotColor}`}
                    />
                    <span className="text-sm font-medium text-foreground">
                      {col.label}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {items.length}
                  </span>
                </div>

                {/* Column items */}
                <div className="flex-1 p-3 space-y-2 overflow-y-auto">
                  {items.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 text-center">
                      <Inbox className="w-8 h-8 text-muted-foreground/30 mb-2" />
                      <p className="text-xs text-muted-foreground/60">
                        No items
                      </p>
                    </div>
                  ) : (
                    <AnimatePresence>
                      {items.map((tx) => {
                        const action = getStageAction(tx.approval_stage);
                        const isPosted = tx.approval_stage === 'posted';

                        return (
                          <motion.div
                            key={tx.id}
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            transition={{ duration: 0.2 }}
                            className={`rounded-lg border border-border p-3 ${
                              isPosted ? 'bg-primary/5' : 'bg-secondary/30'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <p className="text-sm font-medium text-foreground line-clamp-1">
                                {tx.bank_desc}
                              </p>
                              <p className="text-sm font-mono font-medium text-foreground whitespace-nowrap">
                                {formatCurrency(tx.amount)}
                              </p>
                            </div>
                            <p className="text-xs text-muted-foreground mb-3">
                              {formatDate(tx.date)} &middot;{' '}
                              <span className="font-mono">{tx.id}</span>
                            </p>
                            {!isPosted && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="w-full gap-1.5 text-xs h-7"
                                onClick={() =>
                                  handleAdvanceStage(tx.id, tx.approval_stage)
                                }
                              >
                                {action.icon}
                                {action.label}
                              </Button>
                            )}
                            {isPosted && (
                              <div className="flex items-center gap-1.5 text-xs text-primary">
                                <CheckCircle className="w-3.5 h-3.5" />
                                <span>Posted to ledger</span>
                              </div>
                            )}
                          </motion.div>
                        );
                      })}
                    </AnimatePresence>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
