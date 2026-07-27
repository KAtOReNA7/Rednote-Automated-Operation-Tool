import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app.js';
import { ErrorBoundary } from './error-boundary.js';

const root = document.querySelector('#root');
if (root === null) {
  throw new Error('Desktop renderer root is unavailable.');
}

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
