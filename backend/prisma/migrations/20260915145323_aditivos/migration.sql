-- CreateTable
CREATE TABLE "aditivo" (
    "id" TEXT NOT NULL,
    "contrato_id" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "sequencial" INTEGER,
    "dados_brutos" JSONB NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aditivo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "aditivo_contrato_id_ordem_key" ON "aditivo"("contrato_id", "ordem");

-- AddForeignKey
ALTER TABLE "aditivo" ADD CONSTRAINT "aditivo_contrato_id_fkey" FOREIGN KEY ("contrato_id") REFERENCES "contrato"("id") ON DELETE CASCADE ON UPDATE CASCADE;
