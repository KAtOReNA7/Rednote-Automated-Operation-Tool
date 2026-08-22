import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { ErrorBoundary } from '../../error-boundary.js';
import { WebV2App } from './web-app.js';

const root = document.querySelector('#web-root');
if (root === null) throw new Error('Web workspace root is unavailable.');

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <WebV2App />
    </ErrorBoundary>
  </StrictMode>,
);
