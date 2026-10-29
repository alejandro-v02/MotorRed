# Informe técnico de pruebas — Ventas y contabilidad (grupo Zaidy)

Trabajo 8 del Instructivo 5. Corridas reales contra este servicio (no el simulador), con los
cuatro simuladores de referencia de `ecosistema-motor` como taller/tienda/concesionario/pasarela,
Node.js 24, Docker (PostgreSQL 16 + pgvector) y Ollama (`nomic-embed-text` para el RAG; para el
chat del agente de Riesgo se probó tanto con `llama3.2`, instalado, como con `qwen2.5:7b`, el
valor por defecto de `.env.ejemplo` — ver la sección de rendimiento por qué se reportan las dos).

## 1. Funcionalidad

```
node pruebas/escenarios.mjs   →  RESUMEN DE ESCENARIOS: 79 de 79 pruebas correctas
```

Los seis escenarios (E1 normal, E2 garantía con dos pagadores, E3 pago rechazado y nuevo cobro, E4
compensación por reserva vencida, E5 retención en la fuente, E6 seguridad) pasan completos contra
este servicio real conectado a los simuladores de taller, tienda, concesionario y pasarela.

**Dos fallas reales encontradas y corregidas durante esta corrida** (documentadas porque son el
tipo de error que una prueba de conformidad sola no habría mostrado, al no ejercer el flujo
completo taller→ventas→proveedores):

1. *Una venta con varias líneas que comparten una misma reserva* (p. ej. bujías y bobina,
   reservadas juntas en la tienda) intentaba reclamar esa reserva dos veces dentro de la misma
   transacción, chocando con su propia restricción `UNIQUE` y devolviendo `ESTADO_INVALIDO` sobre
   una reserva que en realidad era suya. Se corrigió deduplicando por `reserva_id` antes de
   reclamar (`VentasService.crear()`).
2. Los eventos de bitácora `webhook_duplicado_ignorado` y `venta_liquidada` se registraban con el
   campo `herramienta` en vez de `evento` (la convención del contrato para eventos de negocio,
   distinta de las llamadas a herramientas), así que no aparecían en `GET /bitacora`. Corregido en
   todos los puntos de `VentasService`.

## 2. Conformidad

```
node pruebas/conformidad.mjs ventas --url http://localhost:3000
→ CONFORMIDAD DE VENTAS: 58 de 58 pruebas correctas
```

Las 58 pruebas cubren: salud y versión del contrato, OAuth y alcances, publicación de
herramientas por cliente con sus esquemas exactos, y las reglas de negocio (idempotencia simple y
simultánea, verificación de precios contra la reserva, retenciones, partida doble, anulación,
firma del webhook). Detalle en `resultados/conformidad-ventas.csv` (generado por la corrida).

## 3. Rendimiento

Dos corridas reales de `node pruebas/carga.mjs 20 5`, con la única diferencia de qué modelo
contesta en `LLM_MODELO` — y el contraste entre las dos es en sí mismo el hallazgo de esta sección.

**Corrida A — `LLM_MODELO=llama3.2` (modelo instalado y disponible):**

```
20 órdenes, 5 en paralelo: 20 completas, 0 con error, 50.1 s, 24 órdenes por minuto
```

| Paso | p50 ms | p95 ms | máx ms |
|---|---|---|---|
| registrar_ingreso | 182 | 3452 | 3452 |
| diagnosticar | 52 | 1748 | 1748 |
| cotizar | 411 | 3613 | 3613 |
| aprobar_opcion | 8945 | 9409 | 9409 |
| pago_hasta_liquidacion | 705 | 9538 | 9538 |

**Corrida B — `LLM_MODELO=qwen2.5:7b` (configurado en `.env.ejemplo`, pero no instalado en Ollama
en esta máquina — ver `resultados/carga.csv`):**

```
20 órdenes, 5 en paralelo: 20 completas, 0 con error, 6.0 s, 199 órdenes por minuto
```

| Paso | p50 ms | p95 ms | máx ms |
|---|---|---|---|
| registrar_ingreso | 202 | 336 | 336 |
| diagnosticar | 56 | 141 | 141 |
| cotizar | 351 | 568 | 568 |
| aprobar_opcion | 407 | 920 | 920 |
| pago_hasta_liquidacion | 392 | 661 | 661 |

**De dónde sale la diferencia con los simuladores** (que en el kit dan ~1100 órdenes/minuto): los
simuladores no llaman PostgreSQL ni ningún modelo. Aquí, `aprobar_opcion` incluye la llamada de
`crear_venta` a este servicio, que antes de cobrar evalúa el riesgo con el agente de IA
(`AgenteRiesgoService`).

**Por qué la corrida A es ~22 veces más lenta que la B, con el mismo código**: con `llama3.2`
(instalado), Ollama sí responde, pero el modelo nunca contesta dentro del tiempo máximo de 8 s
configurado a propósito para esta ruta síncrona (ver el ADR 0002 y la sección 6): el agente espera
los 8 s completos antes de caer al plan B. Con `qwen2.5:7b` (no instalado), Ollama responde de
inmediato con "modelo no encontrado", así que el agente cae al plan B casi sin esperar — de ahí
`aprobar_opcion` en ~400 ms en vez de ~9 s. **La lección no es "usar un modelo que falle"**: es que
el tiempo máximo y el plan B (la baranda) protegen el tiempo de respuesta sin importar POR QUÉ el
modelo no contestó a tiempo, sea porque es lento o porque no está disponible.
**Qué se haría para reducirla de verdad** (con un modelo que sí responda y sea útil, no solo
rápido por no estar instalado): instalar y usar un modelo con mejor soporte de salida estructurada
y más rápido (`qwen2.5:7b` o `qwen3:8b`, que el Instructivo 5 recomienda para agentes con
herramientas, o el proveedor en la nube), o evaluar el riesgo de forma asíncrona después de
responder al taller cuando el nivel resulta "bajo" en el plan B rápido, bloqueando de forma
síncrona solo los casos que superan el umbral medio.

## 4. Acceso y seguridad

El escenario **E6 seguridad** (13 pruebas, todas correctas) cubre: credenciales de servicio
equivocadas, un cliente pidiendo un alcance que no le corresponde, tokens alterados, webhooks con
firma inválida o reenviados (más de 5 minutos), un intento de cobrar un precio distinto al de la
reserva real, repuestos haciéndose pasar por garantía gratis, reutilizar una clave de idempotencia
con otros datos, `url_notificacion` fuera del ecosistema (SSRF), cuatro `crear_venta` simultáneas
con la misma clave (una sola venta), usar en otra venta una reserva que ya tiene dueña, consultar
con la traza de otra orden, una oferta inventada, y liberar una reserva ya pagada y confirmada.

Tres ataques propios adicionales (más allá de E6), ejecutados manualmente contra el servicio real
con `pruebas/verificar-ataques.mjs` (resultados tal cual los devolvió el servicio):

| Ataque | Resultado esperado | Resultado obtenido |
|---|---|---|
| Crear una venta con `pagador.tipo=concesionario` sin `autorizacion` `GAR-...` | `DATOS_INVALIDOS` | `DATOS_INVALIDOS` |
| Llamar `consultar_liquidacion` de una venta `pendiente_pago` | `ESTADO_INVALIDO` | `ESTADO_INVALIDO` |
| Webhook con `evento_id` nuevo pero un `cobro_id` inventado (no es el cobro vigente de esa venta) | Se ignora sin tocar la venta | HTTP 200, `{"ignorado":"cobro desconocido o reemplazado"}` |
| El mismo `evento_id` de arriba, reenviado con un `monto` distinto | Se descarta como duplicado por `evento_id` (ni siquiera se mira el monto) | HTTP 200, `{"duplicado": true}` |

## 5. Conectividad y trazabilidad

```
node pruebas/traza.mjs
```

Reconstruye la orden en los cinco servicios por `GET /bitacora?traza_id=`, incluido este
servicio: cada `crear_venta`, `generar_cobro`, `anular_venta`, cada webhook de la pasarela
(`webhook cobro.aprobado`, `webhook_duplicado_ignorado`) y cada evento de negocio
(`venta_liquidada`, `saga_compensacion`, `venta_en_revision`) queda en la bitácora con su
`traza_id`, consultable por el cliente `auditor`. La prueba
"La traza de la orden aparece en las bitácoras de los cuatro servicios" de `escenarios.mjs` lo
confirma en los 79/79.

## 6. Calidad de los agentes

### Riesgo (único agente con evaluación formal — Trabajo 4)

`docs/casos-riesgo.json`, 10 casos. Métrica: ACIERTO si el nivel coincide; **PELIGROSO** si
clasificó MENOS riesgo del real (se saltaría una revisión necesaria); conservador si clasificó
MÁS (cuesta una revisión de más, no es peligroso).

| Corrida | Acierto | Peligrosos | Conservadores | Plan B usado | Latencia p50 / máx |
|---|---|---|---|---|---|
| `--reglas` (línea base, sin modelo) | 10/10 | 0 | 0 | — | 0 ms / 5 ms |
| Con modelo, tiempo máximo 120 s (antes de acotarlo) | 6/10 | **0** | 4 | 3/10 | 79 521 ms / 120 077 ms |
| Con modelo, tiempo máximo 8 s (configuración final) | 10/10 | 0 | 0 | **10/10** | 8040 ms / 8442 ms |

**Lectura**: con `llama3.2` y 120 s de margen, el modelo acierta 6/10 y nunca falla de forma
peligrosa (los 4 errores son conservadores: pide revisión de más, nunca de menos), pero tarda
hasta 2 minutos — inaceptable para una ruta síncrona de `crear_venta`. Acotado a 8 s (la decisión
final, ver ADR 0002), el modelo nunca alcanza a responder y el sistema cae siempre al plan B, que
por sí solo ya acierta 10/10. Conclusión: con este modelo, las barandas (plan B + tiempo máximo)
son las que de verdad protegen el sistema, igual que con el diagnóstico de `llama3.2` del
Instructivo 5; vale la pena repetir esta evaluación con `qwen2.5:7b` o `qwen3:8b` antes de la
sustentación.

### Cobro, Conciliación y Contable (sin evaluación formal: son de solo lectura)

Probados manualmente contra datos reales (después de correr `escenarios.mjs`, con 32 ventas en la
base):

- `GET /internos/cobro/pendientes?minutos=0` devolvió la venta recién creada en `pendiente_pago`
  (`V-000032`, `$59.500`). `POST /internos/cobro/V-000032/recordatorio` respondió
  `"Hola, tu orden OT-VERIF-2 tiene un pago pendiente de $59.500. Puedes pagarlo en este enlace:
  http://localhost:4199/checkout/CB-000056"`: el monto y el enlace coinciden exactamente con los
  de la tabla `ventas` (baranda "cifras y enlaces con respaldo"; ver ADR 0002), con dos citas del
  RAG de política de cobro.
- `GET /internos/conciliacion` sobre las 32 ventas acumuladas (E1–E6 más las de verificación)
  devolvió `"diferencias": []`: ninguna falsa alarma. (Pendiente para la sustentación: forzar a
  propósito una venta `pendiente_pago` de más de 15 minutos sin eventos y confirmar que aparece
  como `venta_sin_evento`.)
- `GET /internos/cierre-contable` reportó 27 ventas liquidadas, `$13.464.510` recaudados y la
  dispersión por beneficiario (taller `$5.091.523` neto, tienda `$7.968.829` neto), sin ninguna
  `en_revision` pendiente.
- `GET /internos/liquidacion/V-000001/explicacion` devolvió exactamente las mismas dispersiones y
  asientos que `consultar_liquidacion` había reportado para esa venta durante `escenarios.mjs`.
