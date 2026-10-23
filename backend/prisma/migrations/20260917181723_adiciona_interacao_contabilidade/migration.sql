-- CreateTable
CREATE TABLE "interacao_contabilidade" (
    "id" TEXT NOT NULL,
    "contrato_id" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "dados_brutos" JSONB NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interacao_contabilidade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "interacao_contabilidade_contrato_id_ordem_key" ON "interacao_contabilidade"("contrato_id", "ordem");

-- AddForeignKey
ALTER TABLE "interacao_contabilidade" ADD CONSTRAINT "interacao_contabilidade_contrato_id_fkey" FOREIGN KEY ("contrato_id") REFERENCES "contrato"("id") ON DELETE CASCADE ON UPDATE CASCADE;
