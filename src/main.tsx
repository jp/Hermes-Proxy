import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import '@fortawesome/fontawesome-free/css/all.min.css';
import './index.css';

const root = document.getElementById('root');

if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
