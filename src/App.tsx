import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ReconProvider } from "./context/ReconContext";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AppLayout } from "./components/layout/AppLayout";
import Dashboard from "./pages/Dashboard";
import Matching from "./pages/Matching";
import Rules from "./pages/Rules";
import Approvals from "./pages/Approvals";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <ReconProvider>
        <TooltipProvider>
          <Sonner
            theme="dark"
            position="bottom-right"
            toastOptions={{
              style: {
                background: 'hsl(210 40% 12%)',
                border: '1px solid hsl(210 35% 18%)',
                color: 'hsl(210 30% 95%)',
              },
            }}
          />
          <BrowserRouter>
            <Routes>
              <Route element={<AppLayout />}>
                <Route path="/" element={<Dashboard />} />
                <Route path="/matching" element={<Matching />} />
                <Route path="/rules" element={<Rules />} />
                <Route path="/approvals" element={<Approvals />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </ReconProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
