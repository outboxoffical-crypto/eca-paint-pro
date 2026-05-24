import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { lazy, Suspense } from "react";
import { usePerformanceMonitoring } from "@/hooks/usePerformanceMonitoring";

// Lazy load all screen components for code splitting
const SplashScreen = lazy(() => import("./components/SplashScreen"));
const LoginScreen = lazy(() => import("./components/LoginScreen"));
const DealerInfoScreen = lazy(() => import("./components/DealerInfoScreen"));
const DealerPricingScreen = lazy(() => import("./components/DealerPricingScreen"));
const CoverageDataScreen = lazy(() => import("./components/CoverageDataScreen"));
const Dashboard = lazy(() => import("./components/Dashboard"));
const AddProjectScreen = lazy(() => import("./components/AddProjectScreen"));
const RoomMeasurementScreen = lazy(() => import("./components/RoomMeasurementScreen"));
const PaintEstimationScreen = lazy(() => import("./components/PaintEstimationScreen"));
const SavedProjectsScreen = lazy(() => import("./components/SavedProjectsScreen"));
const SettingsScreen = lazy(() => import("./components/SettingsScreen"));
const ProjectDetailsPage = lazy(() => import("./components/ProjectDetailsPage"));
const LeadBookScreen = lazy(() => import("./components/LeadBookScreen"));
const NotFound = lazy(() => import("./pages/NotFound"));

// Loading component for suspense fallback
const LoadingFallback = () => (
  <div className="min-h-screen bg-background flex items-center justify-center">
    <div className="text-center">
      <div className="w-12 h-12 rounded-full border-4 border-primary border-t-transparent animate-spin mx-auto mb-3"></div>
      <p className="text-muted-foreground">Loading...</p>
    </div>
  </div>
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 10, // 10 minutes (formerly cacheTime)
    },
  },
});

const App = () => {
  usePerformanceMonitoring();

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Suspense fallback={<LoadingFallback />}>
            <Routes>
              <Route path="/" element={<SplashScreen />} />
              <Route path="/login" element={<LoginScreen />} />
              <Route path="/dealer-info" element={<DealerInfoScreen />} />
              <Route path="/dealer-pricing" element={<DealerPricingScreen />} />
              <Route path="/dashboard" element={<Dashboard />} />
               <Route path="/add-project" element={<AddProjectScreen />} />
               <Route path="/project-details" element={<ProjectDetailsPage />} />
               <Route path="/room-measurement/:projectId" element={<RoomMeasurementScreen />} />
               <Route path="/paint-estimation/:projectId" element={<PaintEstimationScreen />} />
               <Route path="/saved-projects" element={<SavedProjectsScreen />} />
              <Route path="/lead-book" element={<LeadBookScreen />} />
              <Route path="/coverage-data" element={<CoverageDataScreen />} />
              <Route path="/settings" element={<SettingsScreen />} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
