import { Inbox } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "./button"

export function EmptyState({
  title = "No data",
  description,
  actionLabel,
  onAction,
  className,
}: {
  title?: string
  description?: string
  actionLabel?: string
  onAction?: () => void
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 py-12 px-4 text-center",
        className
      )}
    >
      <div className="rounded-full bg-muted p-3">
        <Inbox className="h-6 w-6 text-muted-foreground" />
      </div>
      <h3 className="text-sm font-medium">{title}</h3>
      {description && (
        <p className="text-xs text-muted-foreground max-w-sm">{description}</p>
      )}
      {actionLabel && onAction && (
        <Button size="sm" variant="outline" className="mt-2" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  )
}
