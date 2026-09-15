import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ContratosPage } from './features/contratos/ContratosPage';

function Home() {
  return (
    <Layout>
      <ContratosPage />
    </Layout>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
    </Routes>
  );
}
