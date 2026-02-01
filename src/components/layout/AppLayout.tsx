import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Sidebar } from './Sidebar';
import { cn } from '@/lib/utils';

export function AppLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <Sidebar 
        collapsed={sidebarCollapsed} 
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} 
      />
      
      <motion.main
        initial={false}
        animate={{ 
          marginLeft: sidebarCollapsed ? 72 : 256 
        }}
        transition={{ duration: 0.3, ease: 'easeInOut' }}
        className={cn('min-h-screen transition-all duration-300')}
      >
        <Outlet />
      </motion.main>
    </div>
  );
}
