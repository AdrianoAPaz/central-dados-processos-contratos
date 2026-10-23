-- CreateTable
CREATE TABLE "processo_administrativo" (
    "id" TEXT NOT NULL,
    "entidade_token" TEXT NOT NULL DEFAULT '',
    "id_betha" INTEGER NOT NULL,
    "numero" INTEGER,
    "ano" INTEGER,
    "numero_formatado" TEXT,
    "objeto" TEXT,
    "modalidade" TEXT,
    "situacao" TEXT,
    "situacao_desc" TEXT,
    "data_processo" TIMESTAMP(3),
    "valor_total_itens" DECIMAL(16,2),
    "quantidade_itens" INTEGER,
    "dados_brutos" JSONB NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "processo_administrativo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subrecurso_processo" (
    "id" TEXT NOT NULL,
    "processo_id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "dados_brutos" JSONB NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subrecurso_processo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "processo_administrativo_numero_ano_idx" ON "processo_administrativo"("numero", "ano");

-- CreateIndex
CREATE UNIQUE INDEX "processo_administrativo_entidade_token_id_betha_key" ON "processo_administrativo"("entidade_token", "id_betha");

-- CreateIndex
CREATE UNIQUE INDEX "subrecurso_processo_processo_id_tipo_ordem_key" ON "subrecurso_processo"("processo_id", "tipo", "ordem");

-- AddForeignKey
ALTER TABLE "subrecurso_processo" ADD CONSTRAINT "subrecurso_processo_processo_id_fkey" FOREIGN KEY ("processo_id") REFERENCES "processo_administrativo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

