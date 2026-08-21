import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from './context/SessionContext';
import App from './App';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename="/console">
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <App />
        </SessionProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
