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

## Facturación (agente que coordina repuestos y taller)

Código: `src/facturacion/agente-facturacion.service.ts`. Reemplaza el flujo fijo de
`FacturacionService` por un agente que **elige la herramienta y el servicio** en cada evento.

| Campo | Detalle |
|---|---|
| **Objetivo** | Ante un evento (cotizar, el cliente aceptó, la reparación terminó, el cliente pagó) decidir qué hacer y con quién hablar. |
| **Herramientas que puede usar** | `hablar_con_repuestos` (le escribe en español al agente de repuestos, MCP `hablar_con_repuestos`), `avisar_taller` (`registrar_respuesta_cliente` / `registrar_pago`, con argumentos que pone el código) y `terminar`. No toca la base de datos ni calcula dinero. |
| **Entrada** | Evento + hechos (orden, repuestos, referencia PSE) + historial de lo que ya hizo en esa corrida. |
| **Salida (esquema zod)** | `{ razon, accion: "hablar_con_repuestos" \| "avisar_taller" \| "terminar", mensaje? }` en JSON validado (no exige herramientas nativas: `gemma3:4b` no las tiene). |
| **Barandas** | **Cifras:** precios/cantidades/totales nunca salen del modelo (vienen de `datos[]` de repuestos o de la base). **Intención permitida:** el mensaje debe corresponder al evento (no puede "pagar" al cotizar), nombrar cada repuesto con su cantidad exacta y, en pagos, la referencia PSE. **Idempotencia:** el `id_mensaje` lo genera el código. **Límites:** 5 pasos, 60 s por decisión, una sola llamada que comprometa stock por evento. **Plan B:** si el modelo no responde, se equivoca dos veces o no hace lo requerido, el código ejecuta lo pendiente con mensajes de plantilla (el flujo anterior) usando el mismo `id_mensaje`. |
| **Cuándo pide un humano** | No pide confirmación humana: el cliente ya aceptó/pagó antes de cada evento. Un fallo al apartar/entregar/pagar repuestos no detiene el cobro; queda en el log (ERROR) para seguimiento. |
| **Cómo se ve** | Panel `/panel`, canal **Agente**: cada decisión, cada mensaje rechazado por las barandas y cada paso de **PLAN B**. |
| **Configuración** | `AGENTE_FACTURACION=no` lo apaga (todo por código). `LLM_URL` (API compatible con OpenAI; por defecto Ollama `…/v1`), `LLM_LLAVE`, `LLM_AGENTE_MODELO` (por defecto `LLM_MODELO`), `LLM_AGENTE_TIEMPO_MS`, `LLM_AGENTE_MAX_PASOS`. |
| **Cómo se evalúa** | Corridas con `gemma3:4b` y servicios simulados: 3/3 eventos resueltos por el agente sin plan B tras incluir el formato de referencia en el prompt; sin él, el modelo escribía mensajes que las barandas rechazaban y todo caía al plan B. Cotización real contra el MCP de repuestos: 33 s en total (≈12 s el modelo + ≈20 s su agente). |
