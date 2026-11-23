/**
 * Non-destructive React ErrorBoundary — displays a clean recovery screen with
 * Reload and Copy Details instead of nuking #root.innerHTML.
 */
import React from 'react';
import { AlertTriangle, RotateCw, Copy } from 'lucide-react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null, copied: false };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info);
    this.setState({ info });
  }

  handleCopy = async () => {
    const details = `${this.state.error?.stack || this.state.error}\n${this.state.info?.componentStack || ''}`;
    try {
      await navigator.clipboard.writeText(details);
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    } catch {
      // ignore
    }
  };

  handleReset = () => {
    this.setState({ error: null, info: null });
  };

  render() {
    if (!this.state.error) return this.props.children;
    const msg = this.state.error?.message || String(this.state.error);
    return (
      <div className="error-boundary-screen" role="alert">
        <div className="error-boundary-card">
          <div className="error-boundary-icon">
            <AlertTriangle size={32} />
          </div>
          <h1 className="error-boundary-title">Something went wrong</h1>
          <p className="error-boundary-msg">{msg}</p>
          <p className="error-boundary-hint">Your notes are safely stored offline on this device.</p>
          <div className="error-boundary-actions">
            <button className="btn btn-primary" onClick={() => window.location.reload()}>
              <RotateCw size={16} /> Reload app
            </button>
            <button className="btn btn-secondary" onClick={this.handleReset}>
              Try recovering
            </button>
          </div>
          <button className="btn btn-ghost error-copy-btn" onClick={this.handleCopy}>
            <Copy size={14} /> {this.state.copied ? 'Copied error details' : 'Copy error details'}
          </button>
        </div>
      </div>
    );
  }
}
