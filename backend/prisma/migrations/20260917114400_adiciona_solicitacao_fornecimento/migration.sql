-- CreateTable
CREATE TABLE "solicitacao_fornecimento" (
    "id" TEXT NOT NULL,
    "contrato_id" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "dados_brutos" JSONB NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "solicitacao_fornecimento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "solicitacao_fornecimento_contrato_id_ordem_key" ON "solicitacao_fornecimento"("contrato_id", "ordem");

-- AddForeignKey
ALTER TABLE "solicitacao_fornecimento" ADD CONSTRAINT "solicitacao_fornecimento_contrato_id_fkey" FOREIGN KEY ("contrato_id") REFERENCES "contrato"("id") ON DELETE CASCADE ON UPDATE CASCADE;
