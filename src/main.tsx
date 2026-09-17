import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { initDriveSyncServiceWorker } from './lib/driveSyncServiceWorker';

// Inicializar Service Worker dedicado para sincronización en segundo plano
initDriveSyncServiceWorker().catch((err) => {
  console.info('[App] Service Worker inicializado con modo de respaldo seguro:', err?.message || err);
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
