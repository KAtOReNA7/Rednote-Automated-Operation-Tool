import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  readonly children: ReactNode;
}

interface ErrorBoundaryState {
  readonly failed: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public override state: ErrorBoundaryState = { failed: false };

  public static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  public override componentDidCatch(error: Error, info: ErrorInfo): void {
    void error;
    void info;
    // Error details stay inside the process; the UI exposes no path or stack.
  }

  public override render(): ReactNode {
    if (this.state.failed) {
      return (
        <main className="fatal-state" role="alert">
          <p className="eyebrow">本地界面异常</p>
          <h1>桌面壳层暂时无法显示</h1>
          <p>请关闭应用后重新打开。当前页面不会继续执行任何操作。</p>
        </main>
      );
    }
    return this.props.children;
  }
}
