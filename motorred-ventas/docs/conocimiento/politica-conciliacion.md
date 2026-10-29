---
tags: [conciliacion, politica]
---

# Política de conciliación

## Qué se concilia

Para cada venta en estado `pagada`, `liquidada` o `reembolsada`, el agente de Conciliación
compara tres fuentes: (1) el total_a_pagar registrado en la tabla `ventas`, (2) la suma de los
`eventos_pasarela` recibidos para esa venta, y (3) el estado que el taller confirma en su propia
bitácora (`venta.pagada` / `venta.liquidada` recibidos por webhook).

## Diferencias que se reportan

- **Monto no coincide**: el evento de la pasarela trae un monto distinto al `total_a_pagar`. Esta
  venta ya debería estar en `en_revision` (la regla la aplica el código al recibir el webhook),
  así que si el agente la encuentra en otro estado es un error del propio servicio, no del cliente.
- **Evento sin venta**: llegó un evento_id de la pasarela cuya `referencia` no corresponde a
  ninguna venta registrada. Se reporta pero no se actúa: puede ser de otro ambiente de prueba.
- **Venta sin evento**: una venta lleva más de 15 minutos en `pendiente_pago` sin ningún evento de
  la pasarela asociado a su `cobro_id` vigente. Puede ser que el cliente nunca pagó, o que el
  webhook no llegó.
- **Liquidación no cuadra**: `Liquidacion.cuadra` es `false`. Nunca se dispersa dinero en ese caso
  (la venta ya quedó en `en_revision`); el agente solo explica por qué no cuadró.

## Qué NO hace el agente de Conciliación

No cambia el estado de ninguna venta, no reintenta cobros ni reembolsos, y no tiene acceso a
ninguna herramienta que escriba. Solo lee y redacta el reporte para que una persona decida.
