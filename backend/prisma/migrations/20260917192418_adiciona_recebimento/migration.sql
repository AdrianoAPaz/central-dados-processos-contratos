-- CreateTable
CREATE TABLE "recebimento" (
    "id" TEXT NOT NULL,
    "solicitacao_id" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "dados_brutos" JSONB NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recebimento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recebimento_solicitacao_id_ordem_key" ON "recebimento"("solicitacao_id", "ordem");

-- AddForeignKey
ALTER TABLE "recebimento" ADD CONSTRAINT "recebimento_solicitacao_id_fkey" FOREIGN KEY ("solicitacao_id") REFERENCES "solicitacao_fornecimento"("id") ON DELETE CASCADE ON UPDATE CASCADE;
