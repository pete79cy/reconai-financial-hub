import { cn } from '@/lib/utils';

interface FlagBadgeProps {
  flag: string;
  className?: string;
}

export function FlagBadge({ flag, className }: FlagBadgeProps) {
  const flagClasses: Record<string, string> = {
    'High Value': 'bg-brand-blue/10 text-brand-blue border-brand-blue/20',
    'Weekend': 'bg-status-warn/10 text-status-warn border-status-warn/20',
  };

  return (
    <span className={cn(
      'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border',
      flagClasses[flag] || 'bg-muted text-muted-foreground border-border',
      className
    )}>
      {flag}
    </span>
  );
}
