# ADR 0001 — Modelo de datos de Ventas

**Estado:** aceptado · **Fecha:** 2026-10-28

## Contexto

Ventas es el orquestador comercial: crea la venta, la cobra, confirma reservas en otros dos
servicios externos (tienda y concesionario), y liquida y dispersa el dinero. Necesita persistir
todo eso en PostgreSQL de forma que sobreviva un reinicio del proceso y que dos peticiones
concurrentes nunca produzcan un doble cobro o una reserva vendida dos veces.

## Decisión

1. **Una tabla por entidad del contrato**, en vez de guardar `lineas`, `dispersiones` y `asientos`
   como arreglos `jsonb` dentro de `ventas`. Permite consultarlos con SQL normal (por ejemplo, el
   cierre contable agrupa `dispersiones` por beneficiario con un `GROUP BY`) y mantiene la
   integridad referencial con `ON DELETE CASCADE`.
2. **`pagador` sí se guarda como `jsonb`** dentro de `ventas`, porque el contrato no le da un id
   propio en ningún otro punto del sistema (no hay un `consultar_pagador`); normalizarlo sería
   anticipar un requisito que el contrato 1.0 no pide.
3. **Idempotencia con dos mecanismos combinados**: un `Map` en memoria de promesas en vuelo (igual
   que el simulador de referencia) para serializar peticiones concurrentes con la misma clave
   dentro de este proceso, y la tabla `claves_idempotencia` para que una repetición sobreviva a un
   reinicio del servicio. El primero es necesario porque un `SELECT` + `INSERT` con un pequeño
   `await` en medio no basta para bloquear una carrera entre llamadas simultáneas del mismo
   proceso; el segundo, porque el `Map` se pierde si el proceso se reinicia.
4. **`reservas_venta_activas` como tabla con `reserva_id` de llave primaria**, en vez de confiar
   solo en la verificación de precio contra el proveedor. Dos ventas no pueden reclamar la misma
   reserva aunque las dos peticiones lleguen casi al mismo tiempo: la segunda `INSERT` choca con la
   restricción `UNIQUE` y PostgreSQL resuelve la carrera, no el código de la aplicación.
5. **`parametros_tributarios` con vigencia** (`vigente_desde`/`vigente_hasta`) en vez de constantes
   en `config.ts`: las tarifas de IVA, comisión y retención cambian por decreto (ver Concepto 5 del
   Instructivo 5), así que un cambio de tarifa es una fila nueva, no un despliegue.

## Alternativas consideradas

- **Guardar todo en `ventas` como `jsonb`** (un solo documento por venta). Se descartó porque hace
  más difícil el cierre contable y la conciliación (que necesitan agregar por beneficiario o por
  fecha a través de muchas ventas) y porque TypeORM maneja mejor relaciones que documentos grandes.
- **Confiar solo en el `Map` en memoria para la idempotencia**, sin tabla. Se descartó porque no
  sobrevive un reinicio: una repetición legítima después de que el servicio se reinicia crearía una
  segunda venta.

## Consecuencias

- El esquema solo funciona correctamente con una única instancia del servicio corriendo a la vez
  (el `Map` en memoria no se comparte entre réplicas). Para escalar horizontalmente, el candado de
  idempotencia tendría que moverse a un `SELECT ... FOR UPDATE` o un advisory lock de PostgreSQL.
  Documentado como riesgo pendiente para la sustentación (Trabajo 9).
- Cada liquidación exitosa escribe en tres tablas (`dispersiones`, `asientos`, y actualiza `ventas`)
  dentro de una sola transacción, así que la base de datos nunca queda con una liquidación a medias.
