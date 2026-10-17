import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AppProvider } from './lib/context';
import { ThemeProvider } from './lib/theme';
import { ToastProvider } from './components/ui';
import '@fontsource/oranienbaum/400.css';     // mesma família de letra do nome na logo
import '@fontsource/josefin-sans/400.css';
import '@fontsource/josefin-sans/600.css';    // a do slogan "O sabor de casa, todos os dias."
import '@fontsource/josefin-sans/700.css';    // imagem do cardápio
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
    <BrowserRouter>
      <ToastProvider>
        <AppProvider>
          <App />
        </AppProvider>
      </ToastProvider>
    </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>,
);
