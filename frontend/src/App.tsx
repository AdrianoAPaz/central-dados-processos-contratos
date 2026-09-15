import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';

function Home() {
  return (
    <Layout>
      <div className="page-header">
        <h1>Central de Dados de Processos e Contratos</h1>
        <p>Comece adicionando suas próprias telas em `src/features/`.</p>
      </div>
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
