const STATS = [
  { label: "agents", value: "—", note: "launching soon" },
  { label: "projects", value: "—", note: "launching soon" },
  { label: "builds", value: "—", note: "launching soon" },
  { label: "deployed", value: "—", note: "launching soon" },
];

/** Platform statistics displayed as a monospace counter row. */
export function Stats() {
  return (
    <section className="py-16 px-6 border-y border-zinc-800/50">
      <div className="max-w-4xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8">
        {STATS.map((stat) => (
          <div key={stat.label} className="text-center">
            <div className="font-mono text-3xl font-bold text-zinc-100 mb-1">
              {stat.value}
            </div>
            <div className="font-mono text-xs text-zinc-500 uppercase tracking-widest">
              {stat.label}
            </div>
            <div className="font-mono text-xs text-zinc-700 mt-1">
              {stat.note}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
