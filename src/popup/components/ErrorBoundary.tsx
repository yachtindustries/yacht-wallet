import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

// Last line of defence against a render bug white-screening the popup mid-flow
// (e.g. mid-signing). Catches synchronous render errors anywhere in the tree
// and shows a recovery card with a Reload button.
//
// Async errors (promise rejections, setTimeout throws) bypass error boundaries
// by design — we wire window.unhandledrejection / window.error in main.tsx to
// at least log them and forward into here for surfacing.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[Yacht] popup render error:', error, info.componentStack);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  reload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="p-6 flex flex-col items-center justify-center text-center" style={{ minHeight: '100%' }}>
        <div className="text-4xl mb-3">⚓</div>
        <h1 className="font-bold mb-2" style={{ fontSize: 19 }}>Something went wrong</h1>
        <p className="text-ink-dim mb-4" style={{ fontSize: 14 }}>
          The wallet hit an unexpected error. Your funds and recovery phrase are safe — they live in your encrypted vault on disk, not in this view.
        </p>
        <pre className="bg-bg-soft border border-line rounded-xl p-3 mb-4 text-left whitespace-pre-wrap break-words max-w-full overflow-auto" style={{ fontSize: 12, maxHeight: 160 }}>
          {this.state.error.message || String(this.state.error)}
        </pre>
        <div className="flex gap-2 w-full">
          <button className="btn-ghost flex-1 font-bold" style={{ fontSize: 16 }} onClick={this.reset}>
            Dismiss
          </button>
          <button
            className="btn flex-1 text-white font-bold bg-[#5eccfa] hover:bg-[#3eb8e8]"
            style={{ fontSize: 16 }}
            onClick={this.reload}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
