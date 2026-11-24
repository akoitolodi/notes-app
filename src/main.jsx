/**
 * App entry point — safe ErrorBoundary + DialogProvider + theme init + SW registration.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { applySettings } from './theme';
import ErrorBoundary from './components/ui/ErrorBoundary';
import DialogProvider from './components/ui/DialogProvider';
import './styles.css';

// Apply saved theme / accent / font-size before first paint
applySettings();

// Register service worker for offline support + installability (skip inside native Capacitor WebView)
const isNative = Boolean(typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.());
if ('serviceWorker' in navigator && !isNative) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => {
      console.warn('Service worker registration failed:', err);
    });
  });
}

const rootEl = document.getElementById('root');
createRoot(rootEl).render(
  <React.StrictMode>
    <ErrorBoundary>
      <DialogProvider>
        <App />
      </DialogProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
