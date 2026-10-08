import { NavLink } from "react-router-dom"
import {
  LayoutDashboard,
  Zap,
  Briefcase,
  FlaskConical,
  Settings,
  LineChart,
} from "lucide-react"
import { cn } from "@/lib/utils"

const navItems = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/tplus", label: "T+ Scanner", icon: Zap },
  { to: "/hold", label: "Hold Scanner", icon: Briefcase },
  { to: "/backtest", label: "Backtest", icon: FlaskConical },
  { to: "/settings", label: "Settings", icon: Settings },
]

interface SidebarProps {
  onNavigate?: () => void
}

export function Sidebar({ onNavigate }: SidebarProps) {
  return (
    <aside className="flex h-full w-56 flex-col border-r bg-card">
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <LineChart className="h-6 w-6 text-primary shrink-0" />
        <span className="font-semibold tracking-tight">VN Quant</span>
      </div>
      <nav className="flex-1 space-y-1 p-3">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )
            }
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t p-3 text-[11px] leading-relaxed text-muted-foreground">
        Frontend-only · Client-side quant
        <br />
        HOSE / HNX / UPCOM
      </div>
    </aside>
  )
}
