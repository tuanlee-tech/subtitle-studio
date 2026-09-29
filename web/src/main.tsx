import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {App} from './App';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Không tìm thấy phần tử #root');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if (import.meta.env.DEV) {
  Promise.all([import('./store'), import('./actions'), import('./guide')]).then(
    ([store, actions, guide]) => {
      (window as unknown as Record<string, unknown>).__subtool = {...store, ...actions, ...guide};
    },
  );
}
