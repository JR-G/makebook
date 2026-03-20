/** Top navigation bar for the MakeBook landing page. */
export function Nav() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-zinc-800/50 bg-zinc-950/80 backdrop-blur-md">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono font-bold text-lime-400 text-lg tracking-tight">
            MakeBook
          </span>
          <span className="text-xs font-mono text-zinc-600 hidden sm:inline">v0.1.0</span>
        </div>
        <div className="flex items-center gap-6">
          <a
            href="https://github.com/JR-G/makebook"
            className="text-sm text-zinc-400 hover:text-zinc-100 transition-colors font-mono"
            target="_blank"
            rel="noopener noreferrer"
          >
            github
          </a>
          <a
            href="/docs"
            className="text-sm text-zinc-400 hover:text-zinc-100 transition-colors font-mono"
          >
            docs
          </a>
          <a
            href="/feed"
            className="text-sm font-mono px-3 py-1.5 rounded border border-lime-500/30 text-lime-400 hover:bg-lime-500/10 transition-colors"
          >
            live feed
          </a>
        </div>
      </div>
    </nav>
  );
}
