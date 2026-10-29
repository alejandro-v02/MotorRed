import type { MigrationInterface, QueryRunner } from 'typeorm';

// Esquema inicial del servicio de Ventas (grupo Zaidy). Una base de datos por servicio (Trabajo 7):
// nadie más lee estas tablas directamente, todo pasa por el contrato MCP.
export class Inicial1769644800000 implements MigrationInterface {
  name = 'Inicial1769644800000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE EXTENSION IF NOT EXISTS vector`);
    await q.query(`CREATE SEQUENCE IF NOT EXISTS ventas_consecutivo`);

    await q.query(`
      CREATE TABLE ventas (
        venta_id       varchar PRIMARY KEY,
        traza_id       uuid NOT NULL,
        orden_id       varchar NOT NULL,
        estado         varchar NOT NULL DEFAULT 'pendiente_pago'
                         CHECK (estado IN ('pendiente_pago','pago_rechazado','pagada','liquidada','reembolsada','anulada','en_revision')),
        pagador        jsonb NOT NULL,
        subtotal       integer NOT NULL CHECK (subtotal >= 0),
        iva            integer NOT NULL CHECK (iva >= 0),
        retenciones    integer NOT NULL CHECK (retenciones >= 0),
        total          integer NOT NULL CHECK (total >= 0),
        total_a_pagar  integer NOT NULL CHECK (total_a_pagar >= 0),
        url_pago       varchar,
        url_notificacion varchar NOT NULL,
        cobro_id       varchar,
        motivo         varchar,
        liquidada      boolean NOT NULL DEFAULT false,
        creada_en      timestamptz NOT NULL DEFAULT now(),
        actualizada_en timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX ix_ventas_traza_id ON ventas (traza_id);
    `);

    await q.query(`
      CREATE TABLE lineas_venta (
        id              serial PRIMARY KEY,
        venta_id        varchar NOT NULL REFERENCES ventas (venta_id) ON DELETE CASCADE,
        beneficiario    varchar NOT NULL CHECK (beneficiario IN ('taller','tienda','concesionario')),
        concepto        varchar NOT NULL CHECK (concepto IN ('servicio','repuesto','garantia')),
        referencia      varchar NOT NULL,
        descripcion     varchar NOT NULL,
        cantidad        integer NOT NULL CHECK (cantidad > 0),
        precio_unitario integer NOT NULL CHECK (precio_unitario >= 0),
        iva_porcentaje  numeric(5,2) NOT NULL,
        reserva_id      varchar
      );
      CREATE INDEX ix_lineas_venta_venta_id ON lineas_venta (venta_id);
      CREATE INDEX ix_lineas_venta_reserva_id ON lineas_venta (reserva_id);
    `);

    await q.query(`
      CREATE TABLE cobros (
        cobro_id   varchar PRIMARY KEY,
        venta_id   varchar NOT NULL REFERENCES ventas (venta_id) ON DELETE CASCADE,
        monto      integer NOT NULL CHECK (monto >= 0),
        estado     varchar NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','aprobado','rechazado')),
        url_pago   varchar NOT NULL,
        creado_en  timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX ix_cobros_venta_id ON cobros (venta_id);
    `);

    await q.query(`
      CREATE TABLE eventos_pasarela (
        evento_id   varchar PRIMARY KEY,
        cobro_id    varchar NOT NULL,
        venta_id    varchar,
        tipo        varchar NOT NULL,
        monto       integer NOT NULL,
        resultado   varchar NOT NULL,
        recibido_en timestamptz NOT NULL DEFAULT now()
      );
    `);

    await q.query(`
      CREATE TABLE dispersiones (
        id            serial PRIMARY KEY,
        venta_id      varchar NOT NULL REFERENCES ventas (venta_id) ON DELETE CASCADE,
        beneficiario  varchar NOT NULL,
        base          integer NOT NULL,
        iva           integer NOT NULL,
        retencion     integer NOT NULL,
        comision      integer NOT NULL,
        iva_comision  integer NOT NULL,
        neto          integer NOT NULL,
        estado        varchar NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','transferida')),
        referencia    varchar
      );
      CREATE INDEX ix_dispersiones_venta_id ON dispersiones (venta_id);
    `);

    await q.query(`
      CREATE TABLE asientos (
        id            serial PRIMARY KEY,
        venta_id      varchar NOT NULL REFERENCES ventas (venta_id) ON DELETE CASCADE,
        cuenta        varchar NOT NULL,
        nombre_cuenta varchar NOT NULL,
        tercero       varchar NOT NULL,
        debito        integer NOT NULL DEFAULT 0,
        credito       integer NOT NULL DEFAULT 0
      );
      CREATE INDEX ix_asientos_venta_id ON asientos (venta_id);
    `);

    await q.query(`
      CREATE TABLE parametros_tributarios (
        id             serial PRIMARY KEY,
        concepto       varchar NOT NULL
                         CHECK (concepto IN ('iva_general','comision_plataforma','uvt','retefuente_servicio','retefuente_repuesto')),
        tarifa         numeric(6,3),
        base_uvt       numeric(10,2),
        valor          integer,
        vigente_desde  date NOT NULL,
        vigente_hasta  date,
        creado_en      timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX ix_parametros_concepto_vigencia ON parametros_tributarios (concepto, vigente_desde);
    `);

    // Qué venta es dueña de cada reserva, mientras esa venta sigue viva. Al anular una venta se
    // borran sus filas, para que la reserva (si el proveedor la libera) pueda volver a venderse.
    // Hace las veces del Map en memoria "reservasUsadas" del simulador de referencia, pero
    // persistente y con una restricción UNIQUE que hace imposible que dos ventas se queden con
    // la misma reserva aunque lleguen al mismo tiempo.
    await q.query(`
      CREATE TABLE reservas_venta_activas (
        reserva_id  varchar PRIMARY KEY,
        venta_id    varchar NOT NULL REFERENCES ventas (venta_id) ON DELETE CASCADE
      );
    `);

    await q.query(`
      CREATE TABLE claves_idempotencia (
        cliente    varchar NOT NULL,
        clave      varchar NOT NULL,
        huella     varchar NOT NULL,
        operacion  varchar NOT NULL,
        venta_id   varchar,
        creado_en  timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (cliente, clave)
      );
    `);

    await q.query(`
      CREATE TABLE fragmentos_conocimiento (
        id         serial PRIMARY KEY,
        titulo     varchar NOT NULL,
        contenido  text NOT NULL,
        fuente     varchar NOT NULL,
        embedding  vector(768),
        creado_en  timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX ix_fragmentos_embedding ON fragmentos_conocimiento USING hnsw (embedding vector_cosine_ops);
    `);

    await q.query(`
      CREATE TABLE decisiones_riesgo (
        id          serial PRIMARY KEY,
        venta_id    varchar,
        orden_id    varchar,
        traza_id    uuid,
        nivel_riesgo varchar NOT NULL CHECK (nivel_riesgo IN ('bajo','medio','alto')),
        motivos     jsonb NOT NULL,
        confianza   numeric(3,2),
        fuente      varchar NOT NULL CHECK (fuente IN ('modelo','plan_b')),
        modelo      varchar,
        tiempo_ms   integer NOT NULL,
        creado_en   timestamptz NOT NULL DEFAULT now()
      );
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const tabla of [
      'decisiones_riesgo', 'fragmentos_conocimiento', 'claves_idempotencia', 'reservas_venta_activas', 'parametros_tributarios',
      'asientos', 'dispersiones', 'eventos_pasarela', 'cobros', 'lineas_venta', 'ventas',
    ]) {
      await q.query(`DROP TABLE IF EXISTS ${tabla} CASCADE`);
    }
    await q.query(`DROP SEQUENCE IF EXISTS ventas_consecutivo`);
  }
}
