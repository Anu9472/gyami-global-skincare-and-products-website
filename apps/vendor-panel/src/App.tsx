import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./auth/AuthProvider";
import { Layout } from "./components/Layout";

const ForgotPasswordPage = lazy(() =>
  import("./pages/AuthPages").then((module) => ({ default: module.ForgotPasswordPage })),
);
const LoginPage = lazy(() =>
  import("./pages/AuthPages").then((module) => ({ default: module.LoginPage })),
);
const RegisterPage = lazy(() =>
  import("./pages/AuthPages").then((module) => ({ default: module.RegisterPage })),
);
const ResetPasswordPage = lazy(() =>
  import("./pages/AuthPages").then((module) => ({ default: module.ResetPasswordPage })),
);
const DashboardPage = lazy(() =>
  import("./pages/DashboardPage").then((module) => ({ default: module.DashboardPage })),
);
const ProfilePage = lazy(() =>
  import("./pages/ProfilePage").then((module) => ({ default: module.ProfilePage })),
);
const ProductsPage = lazy(() =>
  import("./pages/ProductsPage").then((module) => ({ default: module.ProductsPage })),
);
const InventoryPage = lazy(() =>
  import("./pages/InventoryPage").then((module) => ({ default: module.InventoryPage })),
);
const OrdersPage = lazy(() =>
  import("./pages/OrdersPage").then((module) => ({ default: module.OrdersPage })),
);
const OperationsPage = lazy(() =>
  import("./pages/OperationsPage").then((module) => ({ default: module.OperationsPage })),
);
const FinancePage = lazy(() =>
  import("./pages/FinancePage").then((module) => ({ default: module.FinancePage })),
);
const SupportPage = lazy(() =>
  import("./pages/SupportPage").then((module) => ({ default: module.SupportPage })),
);
const NotificationsPage = lazy(() =>
  import("./pages/SimplePages").then((module) => ({ default: module.NotificationsPage })),
);
const SettingsPage = lazy(() =>
  import("./pages/SimplePages").then((module) => ({ default: module.SettingsPage })),
);
const VerifyMobilePage = lazy(() =>
  import("./pages/SimplePages").then((module) => ({ default: module.VerifyMobilePage })),
);
const client = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 20_000 } },
});
function Protected() {
  const { session } = useAuth();
  const location = useLocation();
  return session ? (
    <Outlet />
  ) : (
    <Navigate to="/login" replace state={{ from: location.pathname }} />
  );
}
export function App() {
  return (
    <QueryClientProvider client={client}>
      <Suspense fallback={<main className="workspace"><div className="state">Loading workspace…</div></main>}>
        <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route element={<Protected />}>
          <Route element={<Layout />}>
            <Route index element={<DashboardPage />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="verify-mobile" element={<VerifyMobilePage />} />
            <Route path="products" element={<ProductsPage />} />
            <Route path="inventory" element={<InventoryPage />} />
            <Route path="orders" element={<OrdersPage />} />
            <Route path="operations" element={<OperationsPage />} />
            <Route path="returns" element={<OperationsPage />} />
            <Route path="replacements" element={<OperationsPage />} />
            <Route path="support" element={<SupportPage />} />
            <Route path="finance" element={<FinancePage />} />
            <Route path="settlements" element={<FinancePage />} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </QueryClientProvider>
  );
}
