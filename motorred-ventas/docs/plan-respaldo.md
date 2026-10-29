# Plan de migración y respaldo de la base de datos — Ventas

Lista de verificación 5.2, ítem 2: "Documenta cómo se migran y se respaldan las bases de datos
del servicio y cómo se recupera una orden a partir de la bitácora."

## Migraciones

El esquema se gobierna por migraciones de TypeORM (`src/db/migraciones/`), nunca por
`synchronize: true` (ver [ADR 0001](adr/0001-modelo-de-datos.md)). Para llevar la base de datos
de este servicio a la versión más reciente del esquema:

```bash
npm run migration:run       # aplica las migraciones pendientes, en orden
npm run migration:revert    # revierte la última migración (solo en desarrollo)
```

Cada migración nueva se agrega como un archivo más en `src/db/migraciones/` y se registra en
`src/db/opciones.ts`. Nunca se edita una migración ya aplicada en producción: si algo quedó mal,
se agrega una migración nueva que lo corrija.

## Respaldo (backup)

Una base de datos por servicio (ver Trabajo 7): esta instancia de PostgreSQL solo contiene los
datos de Ventas, así que el respaldo es el de un Postgres cualquiera.

**Respaldo completo** (puede correrse mientras el servicio sigue funcionando; `pg_dump` no bloquea
escrituras):

```bash
docker exec ventas-db pg_dump -U motorred -d motorred_ventas -F c -f /tmp/motorred_ventas.dump
docker cp ventas-db:/tmp/motorred_ventas.dump ./respaldo-$(date +%Y%m%d-%H%M).dump
```

**Frecuencia recomendada**: diario (al cierre del día, después del cierre contable), y antes de
cualquier despliegue que incluya una migración nueva. Los respaldos NUNCA se suben al
repositorio (son datos de clientes, aunque sean de prueba): se guardan fuera del control de
versiones, con una retención de al menos 30 días.

**Restaurar** (sobre una base de datos nueva, vacía):

```bash
docker exec -i ventas-db pg_restore -U motorred -d motorred_ventas --clean --if-exists < respaldo-20261029-0800.dump
```

Después de restaurar, correr `npm run migration:run` por si el respaldo es de una versión del
esquema anterior a la actual.

## Recuperar una orden a partir de la bitácora

La bitácora (`GET /bitacora?traza_id=<uuid>`, alcance `auditoria`) es la fuente de verdad para
reconstruir qué le pasó a una orden, incluso si se perdiera la tabla `ventas` (o para auditar
una venta sin tocar la base de datos directamente). Cada línea trae `ts`, `cliente`, `herramienta`
o `evento`, `ok`, `ms` y, en los eventos de negocio, datos adicionales (`venta_id`, `motivo`, etc.).

Pasos para reconstruir una orden completa:

1. Pedir la bitácora de ventas con la `traza_id` de la orden:
   `GET /bitacora?traza_id=<traza_id>` con el token del cliente `auditor`.
2. Ubicar la línea `crear_venta` para saber el `venta_id` que se creó.
3. Seguir la secuencia de eventos de esa venta en la misma bitácora: `webhook cobro.aprobado`
   (o `cobro.rechazado`), `venta_liquidada` o `saga_compensacion` / `venta_en_revision`.
4. Si se necesita el detalle completo (líneas, dispersiones, asientos) y la base de datos sigue
   disponible, cruzar el `venta_id` contra `consultar_venta` y `consultar_liquidacion` (o
   directamente las tablas `lineas_venta`, `dispersiones`, `asientos` filtradas por `venta_id`).
5. Para una traza que pasa por los cinco servicios del ecosistema, `node pruebas/traza.mjs
   <traza_id>` (en `ecosistema-motor`) arma la línea de tiempo completa cruzando la bitácora de
   los cinco a la vez — es la forma más rápida de ver dónde se rompió una orden.

La bitácora vive en memoria (igual que en la plantilla de referencia del kit): se reinicia si el
proceso se reinicia. El respaldo real de "qué pasó" para fines de auditoría a largo plazo son las
tablas `ventas`, `lineas_venta`, `cobros`, `eventos_pasarela`, `dispersiones` y `asientos`, que sí
persisten en PostgreSQL y quedan cubiertas por el respaldo de la sección anterior.
