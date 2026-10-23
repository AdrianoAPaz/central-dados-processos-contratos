import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ContratosPage } from './features/contratos/ContratosPage';
import { ProcessosPage } from './features/processos/ProcessosPage';

export default function App() {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <Layout>
            <ContratosPage />
          </Layout>
        }
      />
      <Route
        path="/processos"
        element={
          <Layout>
            <ProcessosPage />
          </Layout>
        }
      />
    </Routes>
  );
}
