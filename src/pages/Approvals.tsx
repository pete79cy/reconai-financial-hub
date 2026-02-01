import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  CheckCircle, 
  Clock, 
  Eye, 
  Send,
  ArrowRight
} from 'lucide-react';
import { TopBar } from '@/components/layout/TopBar';
import { StatusBadge } from '@/components/badges/StatusBadge';
import { Button } from '@/components/ui/button';
import { useRecon } from '@/context/ReconContext';
import { formatCurrency, formatDate } from '@/utils/reconciliation';
import { ApprovalStage } from '@/types/transaction';
import { toast } from 'sonner';

const stageFlow: ApprovalStage[] = ['none', 'submitted', 'review', 'posted'];

function getNextStage(current: ApprovalStage): ApprovalStage {
  const currentIndex = stageFlow.indexOf(current);
  if (currentIndex < stageFlow.length - 1) {
    return stageFlow[currentIndex + 1];
  }
  return current;
}

function getStageAction(stage: ApprovalStage): { label: string; icon: React.ReactNode } {
  switch (stage) {
    case 'none':
      return { label: 'Submit', icon: <Send className="w-4 h-4" /> };
    case 'submitted':
      return { label: 'Review', icon: <Eye className="w-4 h-4" /> };
    case 'review':
      return { label: 'Approve', icon: <CheckCircle className="w-4 h-4" /> };
    default:
      return { label: 'Done', icon: <CheckCircle className="w-4 h-4" /> };
  }
}

export default function Approvals() {
  const { transactions, updateApprovalStage, updateStatus } = useRecon();

  // Filter for approval workflow items
  const approvalItems = transactions.filter(
    t => t.status === 'rejected' || t.approval_stage !== 'none'
  );

  const handleAdvanceStage = (id: string, currentStage: ApprovalStage) => {
    const nextStage = getNextStage(currentStage);
    updateApprovalStage(id, nextStage);

    if (nextStage === 'posted') {
      toast.success('Transaction Posted', {
        description: `${id} has been approved and posted to the ledger.`
      });
      
      // Update status to approved and archive after 2 seconds
      setTimeout(() => {
        updateStatus(id, 'approved');
      }, 2000);
    } else {
      toast.info(`Stage Updated: ${nextStage}`, {
        description: `${id} moved to ${nextStage} stage.`
      });
    }
  };

  return (
    <div className="min-h-screen">
      <TopBar 
        title="Approvals" 
        subtitle="Workflow Management" 
      />
      
      <div className="p-6 space-y-6">
        {/* Workflow Legend */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-card border border-border rounded-xl p-6 shadow-card"
        >
          <h3 className="text-sm font-medium text-muted-foreground mb-4">
            Approval Workflow Stages
          </h3>
          <div className="flex items-center gap-4 flex-wrap">
            {['submitted', 'review', 'posted'].map((stage, i) => (
              <div key={stage} className="flex items-center gap-2">
                <div className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-full ${
                    stage === 'posted' ? 'bg-primary' :
                    stage === 'review' ? 'bg-status-warn' :
                    'bg-brand-blue'
                  }`} />
                  <span className="text-sm capitalize text-foreground">{stage}</span>
                </div>
                {i < 2 && (
                  <ArrowRight className="w-4 h-4 text-muted-foreground mx-2" />
                )}
              </div>
            ))}
          </div>
        </motion.div>

        {/* Approval Queue */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-card border border-border rounded-xl shadow-card overflow-hidden"
        >
          <div className="p-4 border-b border-border">
            <h3 className="font-medium text-foreground">
              Pending Approvals ({approvalItems.length})
            </h3>
          </div>

          {approvalItems.length === 0 ? (
            <div className="p-12 text-center">
              <Clock className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground">
                No items pending approval
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              <AnimatePresence>
                {approvalItems.map((tx, i) => {
                  const action = getStageAction(tx.approval_stage);
                  const isPosted = tx.approval_stage === 'posted';

                  return (
                    <motion.div
                      key={tx.id}
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.3 }}
                      className={`p-4 ${isPosted ? 'bg-primary/5' : ''}`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                            isPosted ? 'bg-primary/10' :
                            tx.approval_stage === 'review' ? 'bg-status-warn/10' :
                            'bg-brand-blue/10'
                          }`}>
                            {isPosted ? (
                              <CheckCircle className="w-5 h-5 text-primary" />
                            ) : tx.approval_stage === 'review' ? (
                              <Eye className="w-5 h-5 text-status-warn" />
                            ) : (
                              <Send className="w-5 h-5 text-brand-blue" />
                            )}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-mono text-sm text-muted-foreground">
                                {tx.id}
                              </p>
                              <StatusBadge status={tx.approval_stage} />
                            </div>
                            <p className="text-sm text-foreground">
                              {tx.bank_desc}
                            </p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {formatDate(tx.date)} · {tx.bank_name}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <p className="font-mono font-medium text-foreground">
                              {formatCurrency(tx.amount)}
                            </p>
                            <p className="text-xs text-muted-foreground capitalize">
                              Status: {tx.status}
                            </p>
                          </div>
                          
                          {!isPosted && (
                            <Button
                              size="sm"
                              className="gap-2"
                              onClick={() => handleAdvanceStage(tx.id, tx.approval_stage)}
                            >
                              {action.icon}
                              {action.label}
                            </Button>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
