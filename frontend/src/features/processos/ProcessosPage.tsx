import { useEffect, useState } from 'react';
import { useApi } from '../../api/client';

interface Processo {
  id: string;
  idBetha: number;
  numeroFormatado: string | null;
  objeto: string | null;
  modalidade: string | null;
  situacao: string | null;
  entidadeNome: string | null;
  atualizadoEm: string;
  _count: { lotes: number; itens: number; fornecedores: number; documentos: number };
}

// Os processos chegam pela extensão de navegador (campo "Processo
// administrativo" do popup, que lê o Betha Compras Cloud) — esta página só
// lista o que já foi enviado e baixa o relatório em Excel.
export function ProcessosPage() {
  const api = useApi();
  const [processos, setProcessos] = useState<Processo[]>([]);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    api('/processos')
      .then((data: Processo[]) => setProcessos(data))
      .catch(() => setErro(true));
  }, [api]);

  return (
    <>
      <div className="page-header">
        <h1>Processos administrativos</h1>
        <p>
          Processos do Betha Compras Cloud enviados pela extensão do navegador (informe o número/ano no campo
          &ldquo;Processo administrativo&rdquo; do popup).
        </p>
      </div>

      <div className="card">
        {erro ? (
          <p style={{ color: 'crimson' }}>Não foi possível carregar os processos.</p>
        ) : processos.length === 0 ? (
          <p className="empty-state">Nenhum processo administrativo enviado ainda.</p>
        ) : (
          <ul className="task-list">
            {processos.map((p) => (
              <li key={p.id}>
                <div>
                  <strong>{p.numeroFormatado ?? `Id ${p.idBetha}`}</strong> — {p.objeto || 'sem objeto'}
                  <br />
                  <span>{[p.modalidade, p.situacao, p.entidadeNome].filter(Boolean).join(' · ')}</span>
                  <br />
                  <span>
                    {p._count.lotes} lotes · {p._count.itens} itens · {p._count.fornecedores} fornecedores ·{' '}
                    {p._count.documentos} documentos
                  </span>
                </div>
                <a className="btn-ghost" href={`/api/processos/${p.id}/relatorio`}>
                  Baixar relatório (Excel)
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
