import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { applyTheme } from './lib/theme.js';
import './styles.css';

applyTheme();

// Register the service worker once the page has fully loaded so it doesn't
// compete with the initial paint. Failure is silent — SW is a nice-to-have.
if ('serviceWorker' in navigator && location.hostname !== 'localhost') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/ckf-sw.js', { scope: '/ckf/' }).catch(() => {});
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter basename="/ckf">
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
