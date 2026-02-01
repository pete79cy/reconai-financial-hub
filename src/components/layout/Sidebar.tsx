import { NavLink, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  LayoutDashboard, 
  GitCompare, 
  Settings, 
  Shield, 
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Zap
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/matching', icon: GitCompare, label: 'Matching' },
  { to: '/rules', icon: Settings, label: 'Rules Engine' },
  { to: '/approvals', icon: CheckCircle, label: 'Approvals' },
];

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const location = useLocation();

  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 72 : 256 }}
      transition={{ duration: 0.3, ease: 'easeInOut' }}
      className="fixed left-0 top-0 h-screen bg-card border-r border-border flex flex-col z-50"
    >
      {/* Logo */}
      <div className="h-16 flex items-center px-4 border-b border-border">
        <motion.div 
          className="flex items-center gap-3"
          animate={{ justifyContent: collapsed ? 'center' : 'flex-start' }}
        >
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center glow-teal">
            <Zap className="w-5 h-5 text-primary" />
          </div>
          <AnimatePresence>
            {!collapsed && (
              <motion.div
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.2 }}
              >
                <h1 className="text-lg font-semibold text-foreground">ReconAI</h1>
                <p className="text-xs text-muted-foreground">Financial Platform</p>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-3 space-y-1">
        {navItems.map((item) => {
          const isActive = location.pathname === item.to;
          
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200',
                'hover:bg-secondary/80',
                isActive 
                  ? 'bg-primary/10 text-primary' 
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <item.icon className={cn(
                'w-5 h-5 flex-shrink-0',
                isActive && 'text-primary'
              )} />
              <AnimatePresence>
                {!collapsed && (
                  <motion.span
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    transition={{ duration: 0.2 }}
                    className="font-medium"
                  >
                    {item.label}
                  </motion.span>
                )}
              </AnimatePresence>
            </NavLink>
          );
        })}
      </nav>

      {/* Security Badge */}
      <div className="px-3 pb-4">
        <div className={cn(
          'flex items-center gap-3 px-3 py-2.5 rounded-lg',
          'bg-secondary/50 border border-border'
        )}>
          <Shield className="w-5 h-5 text-primary flex-shrink-0" />
          <AnimatePresence>
            {!collapsed && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-xs"
              >
                <p className="text-foreground font-medium">Bank-Grade Security</p>
                <p className="text-muted-foreground">256-bit Encryption</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Toggle Button */}
      <button
        onClick={onToggle}
        className={cn(
          'absolute -right-3 top-20 w-6 h-6 rounded-full',
          'bg-card border border-border',
          'flex items-center justify-center',
          'hover:bg-secondary transition-colors',
          'text-muted-foreground hover:text-foreground'
        )}
      >
        {collapsed ? (
          <ChevronRight className="w-4 h-4" />
        ) : (
          <ChevronLeft className="w-4 h-4" />
        )}
      </button>
    </motion.aside>
  );
}
