import { Component, type ErrorInfo, type ReactNode } from 'react';
import { CircleAlert, RotateCw } from 'lucide-react';

interface AppErrorBoundaryState {
  error: Error | null;
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Application render failed.', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return <main className="app-error-screen">
      <section className="panel app-error-card" role="alert">
        <span className="app-error-icon"><CircleAlert size={23} /></span>
        <span className="eyebrow">4SEAS · OPERATIONS</span>
        <h1>หน้านี้เกิดข้อผิดพลาด</h1>
        <p>The page could not finish loading. Reload to try again.</p>
        {import.meta.env.DEV && <details className="app-error-details"><summary>รายละเอียดสำหรับตรวจสอบ</summary><pre>{this.state.error.stack ?? this.state.error.message}</pre></details>}
        <button className="button button-primary" type="button" onClick={() => window.location.reload()}><RotateCw size={16} />โหลดหน้าใหม่ / Reload</button>
      </section>
    </main>;
  }
}
