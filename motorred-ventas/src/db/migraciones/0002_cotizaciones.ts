import type { MigrationInterface, QueryRunner } from 'typeorm';

// Facturación sobre el servicio de Ventas: la cotización que el Taller pide antes de la venta, y la
// cola de mensajes que Facturación le envía al Taller y al cliente. No toca las tablas del 0001
// salvo ventas.cotizacion_ref, que enlaza la venta final con su cotización.
export class Cotizaciones1769731200000 implements MigrationInterface {
  name = 'Cotizaciones1769731200000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE cotizaciones (
        cotizacion_ref   varchar PRIMARY KEY,
        codigo           varchar NOT NULL UNIQUE,
        traza_id         uuid NOT NULL,
        id_relacion      varchar NOT NULL,
        taller           varchar,
        sede             varchar,
        cliente          jsonb NOT NULL,
        vehiculo         jsonb NOT NULL,
        estado           varchar NOT NULL DEFAULT 'recibida'
                           CHECK (estado IN ('recibida','cotizada','aceptada','rechazada','vencida','cancelada','sin_precio','en_cobro','pagada','liquidada','en_revision')),
        mensaje_garantia varchar,
        subtotal         integer NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
        iva              integer NOT NULL DEFAULT 0 CHECK (iva >= 0),
        total            integer NOT NULL DEFAULT 0 CHECK (total >= 0),
        total_cliente    integer NOT NULL DEFAULT 0 CHECK (total_cliente >= 0),
        total_cubierto_garantia integer NOT NULL DEFAULT 0 CHECK (total_cubierto_garantia >= 0),
        vence_en         timestamptz,
        motivo           varchar,
        huella           varchar NOT NULL,
        venta_id         varchar,
        pago_ref         varchar,
        creada_en        timestamptz NOT NULL DEFAULT now(),
        actualizada_en   timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX ix_cotizaciones_traza_id ON cotizaciones (traza_id);
      CREATE INDEX ix_cotizaciones_estado ON cotizaciones (estado);
    `);

    await q.query(`
      CREATE TABLE lineas_cotizacion (
        id               serial PRIMARY KEY,
        cotizacion_ref   varchar NOT NULL REFERENCES cotizaciones (cotizacion_ref) ON DELETE CASCADE,
        tarea_id         integer NOT NULL,
        tipo             varchar NOT NULL CHECK (tipo IN ('mano_obra','repuesto')),
        referencia       varchar NOT NULL,
        descripcion      varchar NOT NULL,
        cantidad         integer NOT NULL CHECK (cantidad > 0),
        precio_unitario  integer CHECK (precio_unitario >= 0),
        iva_porcentaje   numeric(5,2) NOT NULL DEFAULT 0,
        pagador          varchar NOT NULL DEFAULT 'cliente' CHECK (pagador IN ('cliente','fabricante','tienda','taller')),
        garantia         jsonb,
        proveedor        varchar CHECK (proveedor IN ('tienda','concesionario')),
        tienda           varchar,
        oferta_ref       varchar,
        compra_ref       varchar,
        estado           varchar NOT NULL DEFAULT 'pendiente_precio'
                           CHECK (estado IN ('pendiente_precio','cotizada','sin_stock','sin_precio','comprada','liberada','realizada','no_realizada'))
      );
      CREATE INDEX ix_lineas_cotizacion_ref ON lineas_cotizacion (cotizacion_ref);
    `);

    // Bandeja de salida: todo mensaje que Facturación debe entregar a otro (Taller o cliente) pasa
    // por aquí, con id_mensaje único. Si el destino no responde, el mensaje se reintenta; si no hay
    // destino configurado, queda pendiente (igual que la bandeja del Taller: "sin URL, queda en la bandeja").
    await q.query(`
      CREATE TABLE mensajes_salida (
        id            serial PRIMARY KEY,
        id_mensaje    varchar NOT NULL UNIQUE,
        destino       varchar NOT NULL CHECK (destino IN ('taller','cliente')),
        tipo          varchar NOT NULL,
        traza_id      uuid,
        codigo        varchar,
        payload       jsonb NOT NULL,
        estado        varchar NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','enviado','fallido')),
        intentos      integer NOT NULL DEFAULT 0,
        ultimo_error  varchar,
        creado_en     timestamptz NOT NULL DEFAULT now(),
        enviado_en    timestamptz
      );
      CREATE INDEX ix_mensajes_salida_estado ON mensajes_salida (estado, destino);
    `);

    await q.query(`ALTER TABLE ventas ADD COLUMN cotizacion_ref varchar`);
    await q.query(`CREATE INDEX ix_ventas_cotizacion_ref ON ventas (cotizacion_ref)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE ventas DROP COLUMN IF EXISTS cotizacion_ref`);
    for (const tabla of ['mensajes_salida', 'lineas_cotizacion', 'cotizaciones']) {
      await q.query(`DROP TABLE IF EXISTS ${tabla} CASCADE`);
    }
  }
}
