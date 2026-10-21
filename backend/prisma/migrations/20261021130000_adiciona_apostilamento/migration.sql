-- CreateTable
CREATE TABLE "apostilamento" (
    "id" TEXT NOT NULL,
    "contrato_id" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "sequencial" INTEGER,
    "dados_brutos" JSONB NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "apostilamento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "apostilamento_contrato_id_ordem_key" ON "apostilamento"("contrato_id", "ordem");

-- AddForeignKey
ALTER TABLE "apostilamento" ADD CONSTRAINT "apostilamento_contrato_id_fkey" FOREIGN KEY ("contrato_id") REFERENCES "contrato"("id") ON DELETE CASCADE ON UPDATE CASCADE;
