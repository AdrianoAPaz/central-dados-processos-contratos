import { useEffect, useState } from 'react';
import { useApi } from '../../api/client';

interface Processo {
  id: string;
  idBetha: number;
  numeroFormatado: string | null;
  objeto: string | null;
  modalidade: string | null;
  situacaoDesc: string | null;
  dataProcesso: string | null;
  valorTotalItens: string | null;
  atualizadoEm: string;
  contagens: Record<string, number>;
}

// Rótulo + chave dos sub-recursos mostrados no resumo de cada processo.
const RESUMO: Array<[string, string]> = [
  ['itens', 'itens'],
  ['lotes', 'lotes'],
  ['participantes', 'participantes'],
  ['pareceres', 'pareceres'],
  ['sessoesjulgamento', 'sessões de julgamento'],
  ['anexos', 'anexos'],
];

function formatarData(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

function formatarValor(valor: string | null): string | null {
  return valor != null ? Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : null;
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
                  <span>
                    {[p.modalidade, p.situacaoDesc, formatarData(p.dataProcesso), formatarValor(p.valorTotalItens)]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  <br />
                  <span>
                    {RESUMO.filter(([chave]) => p.contagens[chave])
                      .map(([chave, rotulo]) => `${p.contagens[chave]} ${rotulo}`)
                      .join(' · ') || 'sem sub-registros'}
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
