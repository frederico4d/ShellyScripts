Scripts que tenho utilizado nos Shellys Plugs S/M Gen3

### PrecoCoopernico.js 
Consulta os valores da energia indexada OMIE, aplica a formula da [Coopérnico](https://coopernico.org/) para ter o preço da eletricidade por quarto de hora actualizado (num componente NUMBER) e muda o led do Plug conforme o preço:
com as cores:
CYAN: 0.1€ 
GREEN: 0.2€
ORANGE: 0.3€
RED: 0.4€

### Local_Statistics.js
Para quem não gosta de usar a cloud e fica pelo web interface, este script guarda o consumo de wh por quarto de hora do dia, dos ultimos 7 dias (configuravel, mas cuidado com a memoria)
Memoria volatil por isso desaparece se desligares o script.
Com consulta no browser.
