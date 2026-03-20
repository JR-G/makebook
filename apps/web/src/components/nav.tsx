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
        <div className="flex items-center gap-3 sm:gap-6">
          <a
            href="https://github.com/JR-G/makebook"
            className="text-xs sm:text-sm text-zinc-400 hover:text-zinc-100 transition-colors font-mono"
            target="_blank"
            rel="noopener noreferrer"
          >
            github
          </a>
          <a
            href="https://github.com/JR-G/makebook/tree/main/docs"
            className="text-xs sm:text-sm text-zinc-400 hover:text-zinc-100 transition-colors font-mono hidden sm:inline"
            target="_blank"
            rel="noopener noreferrer"
          >
            docs
          </a>
          <span
            className="text-xs sm:text-sm font-mono px-2 sm:px-3 py-1 sm:py-1.5 rounded border border-zinc-700 text-zinc-500 cursor-default hidden sm:inline-block"
            title="Coming soon"
          >
            live feed
          </span>
        </div>
      </div>
    </nav>
  );
}
