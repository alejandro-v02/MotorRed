import type { MigrationInterface, QueryRunner } from 'typeorm';

// Tablas para la integración con el taller REAL (contrato propio, ver ADR 0003 y
// docs/contratos-reales/mcp-taller.md). No tocan el esquema del contrato del kit.
export class Facturacion1769700000000 implements MigrationInterface {
  name = 'Facturacion1769700000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE cotizaciones (
        cotizacion_ref        varchar PRIMARY KEY,
        codigo                varchar NOT NULL,
        id_relacion           varchar NOT NULL,
        taller                varchar NOT NULL,
        sede                  varchar NOT NULL,
        cliente                jsonb NOT NULL,
        vehiculo               jsonb NOT NULL,
        mano_obra              jsonb NOT NULL,
        repuestos               jsonb NOT NULL,
        orden_compra            jsonb,
        total_mano_obra         integer NOT NULL,
        total_mano_obra_cliente integer NOT NULL,
        total_repuestos_cliente integer NOT NULL DEFAULT 0,
        hay_repuestos           boolean NOT NULL,
        mensaje_garantia        text NOT NULL,
        estado                  varchar NOT NULL DEFAULT 'pendiente_respuesta'
                                  CHECK (estado IN ('pendiente_respuesta','aceptada','rechazada')),
        motivo_rechazo          varchar,
        venta_id                varchar,
        id_mensaje_entrada      varchar NOT NULL,
        creada_en               timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX ix_cotizaciones_codigo ON cotizaciones (codigo);
    `);

    await q.query(`
      CREATE TABLE pagos_pse (
        referencia_pse     varchar PRIMARY KEY,
        codigo              varchar NOT NULL,
        cotizacion_ref       varchar NOT NULL REFERENCES cotizaciones (cotizacion_ref) ON DELETE CASCADE,
        valor                integer NOT NULL CHECK (valor >= 0),
        estado               varchar NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','confirmado')),
        id_mensaje_entrada   varchar NOT NULL,
        creado_en            timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX ix_pagos_pse_codigo ON pagos_pse (codigo);
    `);

    await q.query(`
      CREATE TABLE mensajes_procesados (
        id_mensaje    varchar PRIMARY KEY,
        herramienta   varchar NOT NULL,
        codigo        varchar,
        recibido_en   timestamptz NOT NULL DEFAULT now()
      );
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const tabla of ['mensajes_procesados', 'pagos_pse', 'cotizaciones']) {
      await q.query(`DROP TABLE IF EXISTS ${tabla} CASCADE`);
    }
  }
}
