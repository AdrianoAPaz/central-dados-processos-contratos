import path from 'node:path';
import dotenv from 'dotenv';

// Único .env do monorepo, na raiz — nunca um .env dentro de /backend (CLAUDE.md 1.4).
// Em produção o docker-compose injeta as variáveis direto no processo via
// `env_file`, então esse arquivo simplesmente não existe dentro do container
// e a linha abaixo não faz nada (dotenv não sobrescreve o que já está em
// process.env, e não quebra se o arquivo não existir).
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Variável de ambiente obrigatória ausente: ${name} (confira o .env na raiz do projeto)`,
    );
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 8080),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  databaseUrl: required('DATABASE_URL'),
};
