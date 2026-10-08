import { createBrowserRouter, Navigate } from "react-router-dom"
import { AppLayout } from "@/components/layout/app-layout"
import { DashboardPage } from "@/pages/dashboard/dashboard-page"
import { TPlusPage } from "@/pages/tplus/tplus-page"
import { HoldPage } from "@/pages/hold/hold-page"
import { StockPage } from "@/pages/stock/stock-page"
import { BacktestPage } from "@/pages/backtest/backtest-page"
import { SettingsPage } from "@/pages/settings/settings-page"
import { EmptyState } from "@/components/common/empty-state"

function NotFoundPage() {
  return (
    <EmptyState
      title="Page not found"
      description="This route does not exist in VN Quant."
      actionLabel="Go to Dashboard"
      onAction={() => {
        window.location.assign("/dashboard")
      }}
    />
  )
}

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: "dashboard", element: <DashboardPage /> },
      { path: "tplus", element: <TPlusPage /> },
      { path: "hold", element: <HoldPage /> },
      { path: "stock/:symbol", element: <StockPage /> },
      { path: "backtest", element: <BacktestPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
])
