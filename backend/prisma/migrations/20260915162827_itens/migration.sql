-- CreateTable
CREATE TABLE "item" (
    "id" TEXT NOT NULL,
    "contrato_id" TEXT NOT NULL,
    "aditivo_id" TEXT,
    "ordem" INTEGER NOT NULL,
    "dados_brutos" JSONB NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "item_contrato_id_aditivo_id_ordem_key" ON "item"("contrato_id", "aditivo_id", "ordem");

-- AddForeignKey
ALTER TABLE "item" ADD CONSTRAINT "item_contrato_id_fkey" FOREIGN KEY ("contrato_id") REFERENCES "contrato"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item" ADD CONSTRAINT "item_aditivo_id_fkey" FOREIGN KEY ("aditivo_id") REFERENCES "aditivo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
