import { cn } from '@/lib/utils';

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const statusClasses: Record<string, string> = {
    matched: 'bg-primary/10 text-primary border-primary/20',
    approved: 'bg-primary/10 text-primary border-primary/20',
    pending: 'bg-status-warn/10 text-status-warn border-status-warn/20',
    unmatched: 'bg-muted text-muted-foreground border-border',
    rejected: 'bg-status-error/10 text-status-error border-status-error/20',
    submitted: 'bg-brand-blue/10 text-brand-blue border-brand-blue/20',
    review: 'bg-status-warn/10 text-status-warn border-status-warn/20',
    posted: 'bg-primary/10 text-primary border-primary/20',
  };

  return (
    <span className={cn(
      'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border capitalize',
      statusClasses[status] || statusClasses.unmatched,
      className
    )}>
      {status}
    </span>
  );
}
