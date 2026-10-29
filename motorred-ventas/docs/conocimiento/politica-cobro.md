---
tags: [cobro, politica]
---

# Política de cobro

## Cuándo se genera el enlace de pago

`crear_venta` genera el cobro automáticamente si `total_a_pagar > 0`. Si el total a pagar es 0
(por ejemplo, una venta en garantía donde el concesionario no paga nada en esa línea), la venta
se confirma y se liquida de inmediato, sin pasar por la pasarela.

## Vigencia del enlace de pago

El enlace de pago no vence por sí solo: queda abierto hasta que el cliente pague, lo rechace, o
el taller anule la venta. Si el pago se rechaza, se usa `generar_cobro` para un enlace nuevo; no
se crea una venta nueva.

## Recordatorios

El agente de Cobro puede redactar un recordatorio cuando una venta lleva más de 30 minutos en
`pendiente_pago`. El recordatorio nunca incluye un monto ni un enlace que no haya salido de
`crear_venta` o `generar_cobro`: esos datos siempre vienen de la herramienta, nunca los inventa
el modelo. El agente de Cobro no tiene permiso para llamar `generar_cobro`, `anular_venta` ni
ninguna herramienta que cambie dinero: solo redacta texto a partir de lo que ya existe.

## Pago rechazado

Un pago rechazado dos veces seguidas en la misma venta es una señal para ofrecerle al cliente un
canal alterno (hablar con el taller) en vez de insistir con un tercer enlace automático.
