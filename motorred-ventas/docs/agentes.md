# Fichas de los agentes — Ventas y contabilidad (grupo Zaidy)

Trabajo 2, Paso 3. Ver también el [ADR 0002](adr/0002-agente-vs-codigo.md) sobre qué decide cada
agente y qué decide el código.

## Riesgo

| Campo | Detalle |
|---|---|
| **Objetivo** | Clasificar el riesgo de una venta (bajo/medio/alto) antes de generar el cobro. |
| **Herramientas que puede usar** | Ninguna. No llama ninguna herramienta MCP: recibe datos ya verificados por `VentasService` (monto, tipo de pagador, historial) y solo clasifica. |
| **Entrada** | `{ monto_a_pagar_cop, tipo_pagador, pagador_agente_retencion, cantidad_lineas, ventas_aprobadas_previas_de_este_pagador, rechazos_previos_de_este_pagador }` |
| **Salida (esquema `DecisionRiesgo`)** | `{ nivel_riesgo: "bajo"\|"medio"\|"alto", motivos: string[], confianza: number }` |
| **Barandas** | Salida estructurada con zod; tiempo máximo 120 s; plan B por reglas (`planB()` en `agente-riesgo.service.ts`) si el modelo falla, no responde a tiempo o no produce JSON válido; el agente nunca cambia el estado de una venta, solo clasifica. |
| **Cuándo pide un humano** | Siempre que clasifica "alto": el código deja la venta en `en_revision` sin generar el cobro. |
| **Cómo se evalúa** | `docs/casos-riesgo.json` (10 casos) + `src/agentes/evaluar-riesgo.ts` (`npm run evaluar-riesgo [--reglas]`), con las métricas ACIERTO / PELIGROSO (clasificó menos riesgo del real) / conservador (de más). |

## Cobro

| Campo | Detalle |
|---|---|
| **Objetivo** | Redactar el recordatorio de pago de una venta `pendiente_pago` con más de 30 minutos. |
| **Herramientas que puede usar** | Ninguna de escritura. Solo lee `ventas` y el RAG de política de cobro (`docs/conocimiento/politica-cobro.md`). |
| **Entrada** | `venta_id` |
| **Salida** | `{ venta_id, mensaje, fuentes }` |
| **Barandas** | "Cifras y enlaces con respaldo": el monto y la `url_pago` del mensaje SIEMPRE se toman de la base de datos, nunca los redacta el modelo (de hecho, en esta versión el mensaje es una plantilla, no una llamada al modelo: ver ADR 0002). |
| **Cuándo pide un humano** | Nunca por sí solo: el recordatorio es informativo, no cambia nada. |
| **Cómo se evalúa** | Prueba manual: `GET /internos/cobro/pendientes`, `POST /internos/cobro/:venta_id/recordatorio`. |

## Conciliación

| Campo | Detalle |
|---|---|
| **Objetivo** | Comparar `ventas`, `cobros`/`eventos_pasarela` y los asientos contables, y reportar diferencias. |
| **Herramientas que puede usar** | Ninguna de escritura. Solo lee las tablas propias y el RAG de política de conciliación. |
| **Entrada** | `dias` (ventana de tiempo a revisar) |
| **Salida** | `{ generado_en, ventas_revisadas, diferencias: [{venta_id, tipo, detalle}], fuentes }` |
| **Barandas** | El cálculo de cada diferencia es SQL determinista (`AgenteConciliacionService.reporte()`), no una decisión del modelo: el RAG solo aporta la cita de la política para explicar el reporte. |
| **Cuándo pide un humano** | Siempre: el reporte en sí es la señal para que una persona revise; el agente no actúa sobre las diferencias que encuentra. |
| **Cómo se evalúa** | `GET /internos/conciliacion`, comparado contra datos de prueba con diferencias forzadas (ver Trabajo 8, sección de acceso y seguridad / conectividad). |

## Contable

| Campo | Detalle |
|---|---|
| **Objetivo** | Explicar una liquidación en lenguaje llano y armar el cierre del día. |
| **Herramientas que puede usar** | Ninguna de escritura. Solo lee `dispersiones`, `asientos` y el RAG de política contable (`docs/conocimiento/cierre-contable.md`). |
| **Entrada** | `venta_id` (para explicar una liquidación) o `fecha` (para el cierre del día) |
| **Salida** | `{ venta_id, estado, total_a_pagar, dispersiones, asientos, fuentes }` o `{ fecha, ventas_liquidadas, recaudado, por_beneficiario, en_revision }` |
| **Barandas** | Nunca recalcula un valor: los toma tal cual de las tablas que `DineroService.liquidar()` ya escribió. Si los débitos no cuadran con los créditos, lo dice explícitamente en vez de inventar una explicación. |
| **Cuándo pide un humano** | Cuando reporta ventas `en_revision` en el cierre del día: esas nunca se dispersaron y necesitan revisión. |
| **Cómo se evalúa** | `GET /internos/cierre-contable`, `GET /internos/liquidacion/:venta_id/explicacion`, comparado contra la salida de `consultar_liquidacion`. |
