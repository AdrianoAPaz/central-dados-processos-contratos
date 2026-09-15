/*
  Warnings:

  - You are about to drop the `placeholder` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "placeholder";

-- CreateTable
CREATE TABLE "contrato" (
    "id" TEXT NOT NULL,
    "sequencial" INTEGER NOT NULL,
    "numeroTermo" INTEGER,
    "ano" INTEGER,
    "numero_formatado" TEXT,
    "objeto" TEXT,
    "situacao" TEXT,
    "situacao_desc" TEXT,
    "tipo_instrumento" TEXT,
    "tipo_instrumento_desc" TEXT,
    "data_assinatura" TIMESTAMP(3),
    "data_inicio_vigencia" TIMESTAMP(3),
    "data_fim_vigencia" TIMESTAMP(3),
    "valor_original" DECIMAL(14,2),
    "valor_aditivos" DECIMAL(14,2),
    "valor_sol_fornec" DECIMAL(14,2),
    "fornecedor_nome" TEXT,
    "fornecedor_cpf_cnpj" TEXT,
    "entidade_nome" TEXT,
    "entidade_cnpj" TEXT,
    "processo_numero" INTEGER,
    "processo_ano" INTEGER,
    "dados_brutos" JSONB NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contrato_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contrato_sequencial_key" ON "contrato"("sequencial");
