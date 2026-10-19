-- CreateTable
CREATE TABLE "item_solicitacao_fornecimento" (
    "id" TEXT NOT NULL,
    "solicitacao_id" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "dados_brutos" JSONB NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_solicitacao_fornecimento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "item_solicitacao_fornecimento_solicitacao_id_ordem_key" ON "item_solicitacao_fornecimento"("solicitacao_id", "ordem");

-- AddForeignKey
ALTER TABLE "item_solicitacao_fornecimento" ADD CONSTRAINT "item_solicitacao_fornecimento_solicitacao_id_fkey" FOREIGN KEY ("solicitacao_id") REFERENCES "solicitacao_fornecimento"("id") ON DELETE CASCADE ON UPDATE CASCADE;
