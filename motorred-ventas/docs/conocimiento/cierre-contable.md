---
tags: [contabilidad, cierre]
---

# Cierre contable del día

## Qué arma el agente Contable

Un resumen del día con: ventas liquidadas, total recaudado, total dispersado por beneficiario,
ingreso de la plataforma (comisión + su IVA) y ventas que quedaron `en_revision` (estas últimas se
listan aparte, porque no dispersaron dinero y necesitan una persona).

## Cómo explica una liquidación

El agente Contable explica una liquidación en lenguaje llano a partir de los campos de
`Liquidacion` (base, IVA, retención, comisión, IVA de la comisión, neto) y de los `asientos` en
partida doble, pero nunca recalcula esos valores: los toma tal cual los devolvió `consultar_liquidacion`.
Si los débitos no cuadran con los créditos (`cuadra: false`), lo dice explícitamente y no ofrece
una explicación alternativa inventada.

## Retención en la fuente, en términos simples

Si el pagador es agente de retención, se le resta al total a pagar un porcentaje sobre la base de
cada beneficiario y concepto, pero solo si esa base alcanza el mínimo en UVT. Por ejemplo, con
UVT de $52.374: una compra de repuestos (2,5%) solo tiene retención si la base de ese beneficiario
es de $523.740 o más; un servicio de mano de obra (4%) desde $104.748.
