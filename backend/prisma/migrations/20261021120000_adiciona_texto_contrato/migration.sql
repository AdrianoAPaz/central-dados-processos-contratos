-- CreateTable
CREATE TABLE "texto_contrato" (
    "id" TEXT NOT NULL,
    "contrato_id" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "dados_brutos" JSONB NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "texto_contrato_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "texto_contrato_contrato_id_ordem_key" ON "texto_contrato"("contrato_id", "ordem");

-- AddForeignKey
ALTER TABLE "texto_contrato" ADD CONSTRAINT "texto_contrato_contrato_id_fkey" FOREIGN KEY ("contrato_id") REFERENCES "contrato"("id") ON DELETE CASCADE ON UPDATE CASCADE;
