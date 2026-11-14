import { useId, type ReactNode } from "react";
import { cn } from "../../lib/cn";

type Tone = "neutral" | "emerald" | "amber" | "sky" | "violet" | "rose";
const TONES: Record<Tone, string> = {
  neutral: "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200",
  emerald: "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
  amber: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  sky: "border-sky-500/40 bg-sky-500/10 text-sky-800 dark:text-sky-300",
  violet: "border-violet-500/40 bg-violet-500/10 text-violet-800 dark:text-violet-300",
  rose: "border-rose-500/40 bg-rose-500/10 text-rose-800 dark:text-rose-300",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold", TONES[tone], className)}>{children}</span>;
}

/** Accessible on/off control with a 44px touch target. */
export function Switch({ checked, onChange, label, disabled, description }: {
  checked: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean; description?: string;
}) {
  const id = useId();
  return <div className="flex min-h-11 items-start gap-3">
    <button type="button" role="switch" aria-checked={checked} aria-labelledby={id} disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn("relative mt-1 inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 disabled:opacity-50",
        checked ? "border-emerald-600 bg-emerald-600" : "border-slate-400 bg-slate-300 dark:border-slate-600 dark:bg-slate-700")}>
      <span aria-hidden className={cn("inline-block size-5 rounded-full bg-white shadow transition-transform motion-reduce:transition-none", checked ? "translate-x-5" : "translate-x-0.5")} />
    </button>
    <span className="min-w-0 text-sm">
      <span id={id} className="font-medium">{label}</span>
      {description && <span className="muted block text-xs">{description}</span>}
    </span>
  </div>;
}

/** Radio group styled as a segmented control. */
export function Segmented<T extends string>({ value, onChange, options, label, disabled }: {
  value: T; onChange: (value: T) => void; label: string; disabled?: boolean;
  options: ReadonlyArray<{ value: T; label: string; hint?: string }>;
}) {
  return <div role="radiogroup" aria-label={label} className="inline-flex max-w-full flex-wrap gap-1 rounded-xl border border-slate-300 bg-slate-100 p-1 dark:border-slate-700 dark:bg-slate-900">
    {options.map(option => <button key={option.value} type="button" role="radio" aria-checked={value === option.value}
      disabled={disabled} title={option.hint} onClick={() => onChange(option.value)}
      className={cn("min-h-9 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-emerald-500 disabled:opacity-50 max-sm:min-h-11",
        value === option.value ? "bg-white text-emerald-700 shadow-sm dark:bg-slate-700 dark:text-emerald-300" : "muted hover:text-current")}>
      {option.label}
    </button>)}
  </div>;
}

export function Tabs<T extends string>({ value, onChange, tabs, label }: {
  value: T; onChange: (value: T) => void; label: string;
  tabs: ReadonlyArray<{ id: T; label: string; count?: number | string; icon?: ReactNode }>;
}) {
  return <div role="tablist" aria-label={label} className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
    {tabs.map(tab => <button key={tab.id} type="button" role="tab" aria-selected={value === tab.id}
      id={"tab-" + tab.id} aria-controls={"panel-" + tab.id} onClick={() => onChange(tab.id)}
      className={cn("inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg border px-3 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-emerald-500",
        value === tab.id ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800")}>
      {tab.icon}{tab.label}
      {tab.count !== undefined && <span className={cn("rounded-full px-1.5 text-[11px]", value === tab.id ? "bg-white/20" : "bg-slate-200 dark:bg-slate-700")}>{tab.count}</span>}
    </button>)}
  </div>;
}

export function StatTile({ label, value, icon, onClick, active }: {
  label: string; value: ReactNode; icon?: ReactNode; onClick?: () => void; active?: boolean;
}) {
  const body = <>
    <span className="flex items-center justify-between gap-2"><span className="muted text-xs font-medium">{label}</span>{icon}</span>
    <span className="mt-1 block text-2xl font-bold tabular-nums">{value}</span>
  </>;
  const style = cn("min-w-0 rounded-xl border p-3 text-left transition-colors", active
    ? "border-emerald-600 bg-emerald-500/10" : "border-slate-300 dark:border-slate-700",
    onClick && "hover:border-emerald-500 focus-visible:outline-2 focus-visible:outline-emerald-500");
  return onClick ? <button type="button" className={style} onClick={onClick} aria-pressed={active}>{body}</button> : <div className={style}>{body}</div>;
}

export function EmptyState({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-400 p-6 text-center dark:border-slate-600">
    {icon && <span className="muted">{icon}</span>}
    <p className="font-semibold">{title}</p>
    {children && <div className="muted max-w-prose text-sm">{children}</div>}
  </div>;
}
