import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { ErrorBoundary } from '../error-boundary.js';
import { V2App } from './app.js';

const root = document.querySelector('#v2-root');
if (root === null) throw new Error('V2 renderer root is unavailable.');

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <V2App />
    </ErrorBoundary>
  </StrictMode>,
);
