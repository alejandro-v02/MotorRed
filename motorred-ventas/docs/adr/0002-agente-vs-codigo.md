# ADR 0002 — Qué decide el agente y qué decide el código

**Estado:** aceptado · **Fecha:** 2026-10-28

## Contexto

Ventas mueve dinero: cobra, dispersa y lleva la contabilidad. El Instructivo 5 es explícito en que
"el agente propone, el código dispone" y en que "ningún agente crea, cambia ni anula ventas o
dispersiones: solo el orquestador comercial, con las reglas del código". Había que decidir, agente
por agente, dónde está esa línea.

## Decisión

| Agente | Qué decide el agente | Qué decide el código |
|---|---|---|
| **Riesgo** | Clasifica bajo/medio/alto con motivos, a partir de datos que el código ya verificó (monto, historial del pagador). | Si el nivel es "alto", el código decide NO llamar a la pasarela y deja la venta en `en_revision`. El agente nunca toca el estado de la venta directamente: devuelve una clasificación y `VentasService.crear()` es quien actúa sobre ella. |
| **Cobro** | Redacta el texto del recordatorio. | El monto y la `url_pago` salen siempre de la base de datos (tabla `ventas`), nunca del modelo: si el modelo los repitiera mal, igual se sobrescriben con el dato real antes de enviarse. El agente no tiene ninguna ruta para llamar `generar_cobro` ni `anular_venta`. |
| **Conciliación** | Nada numérico: el cálculo de cada diferencia (monto no coincide, liquidación no cuadra, venta sin evento) es una consulta SQL determinista en `AgenteConciliacionService`. | El agente solo usa el RAG para citar la política y, si se le pidiera una narrativa en lenguaje natural, redactarla a partir de esos números ya calculados — nunca al revés. |
| **Contable** | Explica una liquidación en lenguaje llano y arma el resumen del cierre. | Los valores de `dispersiones` y `asientos` ya los calculó `DineroService.liquidar()` (determinista, sin modelo) en el momento de liquidar; el agente contable solo los lee y los redacta después. |

La saga completa (confirmar reservas, liquidar, dispersar, compensar) vive en
`VentasService.alAprobarse()`, como una máquina de estados escrita en código: ningún modelo decide
cuándo una venta pasa de `pagada` a `liquidada` o a `reembolsada`.

## Por qué el cálculo de dinero nunca pasa por un modelo

A diferencia del diagnóstico del taller (donde el modelo SÍ decide qué está fallando), en Ventas
cualquier número que termine en una dispersión o un asiento contable es 100% aritmética sobre datos
que ya pasaron por las verificaciones del contrato (`PRECIO_NO_COINCIDE`, reservas activas, etc.).
Pedirle a un modelo que sume o que decida una retención introduciría una fuente de error que el
Instructivo 5 no permite (un error contable no tiene plan B razonable: "el error no te dice la
cuenta correcta"). El único lugar donde un modelo clasifica algo que de verdad podría equivocarse
en cualquier dirección es el riesgo de una venta, que es justamente donde sí hay una baranda (plan
B + revisión humana) que absorbe el error de forma segura.

## Consecuencias

- El agente de Riesgo es el único de los cuatro que puede cambiar el camino que sigue una venta
  real (aunque sea solo "no cobrar todavía"); por eso es también el único con evaluación formal
  (Trabajo 4, `docs/casos-riesgo.json`) y bitácora propia (`decisiones_riesgo`).
- Los otros tres agentes son deliberadamente de solo lectura: se pueden apagar sin que el
  ecosistema deje de funcionar, porque no están en el camino crítico de ninguna herramienta del
  contrato.
