-- CreateTable
CREATE TABLE "item_recebimento" (
    "id" TEXT NOT NULL,
    "recebimento_id" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "dados_brutos" JSONB NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_recebimento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "item_recebimento_recebimento_id_ordem_key" ON "item_recebimento"("recebimento_id", "ordem");

-- AddForeignKey
ALTER TABLE "item_recebimento" ADD CONSTRAINT "item_recebimento_recebimento_id_fkey" FOREIGN KEY ("recebimento_id") REFERENCES "recebimento"("id") ON DELETE CASCADE ON UPDATE CASCADE;
