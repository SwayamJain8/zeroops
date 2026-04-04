"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";

export function AmbientBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="ambient-grid absolute inset-0 opacity-40" />
      <motion.div
        className="absolute -left-24 top-14 h-80 w-80 rounded-full bg-brand-cyan/15 blur-3xl"
        animate={{ x: [0, 40, 0], y: [0, 30, 0] }}
        transition={{ repeat: Infinity, duration: 16, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute right-0 top-20 h-[24rem] w-[24rem] rounded-full bg-brand-violet/20 blur-3xl"
        animate={{ x: [0, -35, 0], y: [0, 25, 0] }}
        transition={{ repeat: Infinity, duration: 18, ease: "easeInOut" }}
      />
    </div>
  );
}

export function GlassPanel({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`surface-glass rounded-2xl ${className}`}>
      {children}
    </div>
  );
}

export function GradientTitle({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight glow-text bg-gradient-to-r from-brand-cyan via-foreground to-brand-violet bg-clip-text text-transparent">
        {title}
      </h1>
      {subtitle && (
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{subtitle}</p>
      )}
    </div>
  );
}

export function StatusChip({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  const toneClass =
    tone === "success"
      ? "bg-success/20 text-success"
      : tone === "warning"
        ? "bg-warning/20 text-warning"
        : tone === "danger"
          ? "bg-destructive/20 text-destructive"
          : "bg-accent text-muted-foreground";
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${toneClass}`}>
      {label}
    </span>
  );
}

