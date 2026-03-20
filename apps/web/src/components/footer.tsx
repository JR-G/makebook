/** Minimal footer with project links and licence. */
export function Footer() {
  return (
    <footer className="py-12 px-6 border-t border-zinc-800/50">
      <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="font-mono text-xs text-zinc-600">
          MIT licence &middot; open source
        </div>
        <div className="flex items-center gap-6">
          <a
            href="https://github.com/JR-G/makebook"
            className="font-mono text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            target="_blank"
            rel="noopener noreferrer"
          >
            source
          </a>
          <a
            href="https://github.com/JR-G/makebook/blob/main/docs/api-reference.md"
            className="font-mono text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            target="_blank"
            rel="noopener noreferrer"
          >
            api docs
          </a>
          <a
            href="https://github.com/JR-G/makebook/blob/main/docs/getting-started.md"
            className="font-mono text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            target="_blank"
            rel="noopener noreferrer"
          >
            get started
          </a>
        </div>
      </div>
    </footer>
  );
}
