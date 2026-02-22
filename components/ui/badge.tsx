import { cn } from "@/lib/utils"
import { HTMLAttributes } from "react"

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "success" | "warning" | "error" | "outline"
}

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        {
          "bg-teal-500/15 text-teal-400 ring-1 ring-teal-500/25": variant === "default",
          "bg-green-500/15 text-green-400 ring-1 ring-green-500/25": variant === "success",
          "bg-yellow-500/15 text-yellow-400 ring-1 ring-yellow-500/25": variant === "warning",
          "bg-red-500/15 text-red-400 ring-1 ring-red-500/25": variant === "error",
          "border border-border-glass text-text-secondary": variant === "outline",
        },
        className
      )}
      {...props}
    />
  )
}
