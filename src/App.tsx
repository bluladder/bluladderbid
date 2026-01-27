import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import Admin from "./pages/Admin";
import Services from "./pages/Services";
import ServiceLanding from "./pages/ServiceLanding";
import PlanBuilder from "./pages/PlanBuilder";
import QuoteView from "./pages/QuoteView";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/admin/jobber" element={<Admin initialTab="crew" />} />
          <Route path="/services" element={<Services />} />
          <Route path="/plan-builder" element={<PlanBuilder />} />
          <Route path="/quote/:id" element={<QuoteView />} />
          {/* Service-specific landing pages */}
          <Route path="/window-cleaning" element={<ServiceLanding />} />
          <Route path="/gutter-cleaning" element={<ServiceLanding />} />
          <Route path="/house-wash" element={<ServiceLanding />} />
          <Route path="/roof-cleaning" element={<ServiceLanding />} />
          <Route path="/driveway-cleaning" element={<ServiceLanding />} />
          <Route path="/pressure-washing" element={<ServiceLanding />} />
          {/* Generic service route (catches any service slug) */}
          <Route path="/:service" element={<ServiceLanding />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
