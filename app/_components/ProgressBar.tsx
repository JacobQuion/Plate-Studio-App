export function ProgressBar({ value, label }: { value: number; label: string }) {
  const progress = Math.max(0, Math.min(100, Math.round(value)));
  return <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} className="h-2 w-full overflow-hidden rounded-full bg-white/10">
    <div className="h-full rounded-full bg-gradient-to-r from-brand-600 to-brand-300 transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${progress}%` }} />
  </div>;
}
