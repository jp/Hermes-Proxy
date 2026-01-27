import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import RequestEditorWindow from './features/traffic/RequestEditorWindow';
import '@fortawesome/fontawesome-free/css/all.min.css';
import './index.css';

const root = document.getElementById('root');

if (root) {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mode');
  const View = mode === 'request-editor' ? RequestEditorWindow : App;
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <View />
    </React.StrictMode>
  );
}
