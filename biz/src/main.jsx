import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { applyTheme } from '@ckf-lib/theme.js';
import './styles.css';

applyTheme();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter basename="/biz">
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
