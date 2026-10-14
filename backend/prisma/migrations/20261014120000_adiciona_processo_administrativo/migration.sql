-- CreateTable
CREATE TABLE "processo_administrativo" (
    "id" TEXT NOT NULL,
    "id_betha" INTEGER NOT NULL,
    "numero" INTEGER,
    "ano" INTEGER,
    "numero_formatado" TEXT,
    "objeto" TEXT,
    "modalidade" TEXT,
    "situacao" TEXT,
    "entidade_nome" TEXT,
    "dados_brutos" JSONB NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "processo_administrativo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lote_processo" (
    "id" TEXT NOT NULL,
    "processo_id" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "dados_brutos" JSONB NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lote_processo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_processo" (
    "id" TEXT NOT NULL,
    "processo_id" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "dados_brutos" JSONB NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_processo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fornecedor_processo" (
    "id" TEXT NOT NULL,
    "processo_id" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "dados_brutos" JSONB NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fornecedor_processo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documento_processo" (
    "id" TEXT NOT NULL,
    "processo_id" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "dados_brutos" JSONB NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documento_processo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "processo_administrativo_id_betha_key" ON "processo_administrativo"("id_betha");

-- CreateIndex
CREATE INDEX "processo_administrativo_numero_ano_idx" ON "processo_administrativo"("numero", "ano");

-- CreateIndex
CREATE UNIQUE INDEX "lote_processo_processo_id_ordem_key" ON "lote_processo"("processo_id", "ordem");

-- CreateIndex
CREATE UNIQUE INDEX "item_processo_processo_id_ordem_key" ON "item_processo"("processo_id", "ordem");

-- CreateIndex
CREATE UNIQUE INDEX "fornecedor_processo_processo_id_ordem_key" ON "fornecedor_processo"("processo_id", "ordem");

-- CreateIndex
CREATE UNIQUE INDEX "documento_processo_processo_id_ordem_key" ON "documento_processo"("processo_id", "ordem");

-- AddForeignKey
ALTER TABLE "lote_processo" ADD CONSTRAINT "lote_processo_processo_id_fkey" FOREIGN KEY ("processo_id") REFERENCES "processo_administrativo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_processo" ADD CONSTRAINT "item_processo_processo_id_fkey" FOREIGN KEY ("processo_id") REFERENCES "processo_administrativo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fornecedor_processo" ADD CONSTRAINT "fornecedor_processo_processo_id_fkey" FOREIGN KEY ("processo_id") REFERENCES "processo_administrativo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documento_processo" ADD CONSTRAINT "documento_processo_processo_id_fkey" FOREIGN KEY ("processo_id") REFERENCES "processo_administrativo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

