/**
 * App entry point.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// Show any fatal error directly on screen (debug aid — remove later)
function showFatalError(message) {
  const root = document.getElementById('root');
  if (root) {
    root.innerHTML = `
      <div style="padding:20px;font-family:monospace;color:#ff6b6b;background:#111;white-space:pre-wrap;font-size:13px;">
        <strong style="font-size:16px;">⚠ Error</strong>
        ${String(message).replace(/</g, '&lt;')}
      </div>`;
  }
}

window.addEventListener('error', e => {
  if (e.error || e.message) showFatalError(`${e.message}\n${e.error?.stack || ''}`);
});
window.addEventListener('unhandledrejection', e => {
  showFatalError(`Unhandled promise rejection: ${e.reason?.stack || e.reason}`);
});

// Register the service worker for offline support + installability
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => {
      console.warn('Service worker registration failed:', err);
    });
  });
}

const root = createRoot(document.getElementById('root'));
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    showFatalError(`${error?.stack || error}\n${info?.componentStack || ''}`);
  }
  render() {
    if (this.state.error) return null;
    return this.props.children;
  }
}

root.render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);