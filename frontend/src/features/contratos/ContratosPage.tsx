import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useApi } from '../../api/client';

interface Contrato {
  id: string;
  sequencial: number;
  numeroFormatado: string | null;
  objeto: string | null;
  fornecedorNome: string | null;
  situacaoDesc: string | null;
  criadoEm: string;
}

// Primeira versão: sem integração ao vivo com o Betha ainda, então a entrada
// é o JSON cru de um registro de `contratacoes` colado manualmente (copiado
// da aba Rede do navegador). Ver backend/src/routes/contratos.ts.
export function ContratosPage() {
  const api = useApi();
  const [contratos, setContratos] = useState<Contrato[]>([]);
  const [json, setJson] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [importando, setImportando] = useState(false);

  const carregar = useCallback(() => {
    api('/contratos').then((data: Contrato[]) => setContratos(data));
  }, [api]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const importar = async (e: FormEvent) => {
    e.preventDefault();
    setErro(null);

    let corpo: unknown;
    try {
      corpo = JSON.parse(json);
    } catch {
      setErro('JSON inválido — cole o objeto do contrato copiado da API do Betha.');
      return;
    }

    setImportando(true);
    try {
      await api('/contratos', { method: 'POST', body: JSON.stringify(corpo) });
      setJson('');
      carregar();
    } catch {
      setErro('Não foi possível importar. Confira se o JSON tem o campo "sequencial".');
    } finally {
      setImportando(false);
    }
  };

  return (
    <>
      <div className="page-header">
        <h1>Contratos</h1>
        <p>Importe o JSON de um contrato (copiado da API do Betha) e baixe o relatório em Excel.</p>
      </div>

      <div className="card">
        <form onSubmit={importar}>
          <textarea
            value={json}
            onChange={(e) => setJson(e.target.value)}
            placeholder='Cole aqui o JSON do contrato (registro de "contratacoes")'
            rows={8}
            style={{ width: '100%', fontFamily: 'monospace' }}
          />
          {erro && <p style={{ color: 'crimson' }}>{erro}</p>}
          <button className="btn-primary" type="submit" disabled={importando || !json.trim()}>
            {importando ? 'Importando…' : 'Importar contrato'}
          </button>
        </form>
      </div>

      <div className="card">
        {contratos.length === 0 ? (
          <p className="empty-state">Nenhum contrato importado ainda.</p>
        ) : (
          <ul className="task-list">
            {contratos.map((c) => (
              <li key={c.id}>
                <div>
                  <strong>{c.numeroFormatado ?? `Seq. ${c.sequencial}`}</strong> — {c.objeto || 'sem objeto'}
                  <br />
                  <span>{c.fornecedorNome}</span> · <span>{c.situacaoDesc}</span>
                </div>
                <a className="btn-ghost" href={`/api/contratos/${c.id}/relatorio`}>
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
