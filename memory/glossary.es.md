## Siglas y abreviaturas

| Término | Significado | Contexto |
|---------|-------------|----------|
| AAD | Additional Authenticated Data (datos autenticados adicionales) | Entrada de AES-GCM que se autentica pero no se cifra; vincula una credencial almacenada a su propia fila `(uid, mode)`, de modo que un texto cifrado copiado no puede descifrarse |
| AES-256-GCM | Advanced Encryption Standard, clave de 256 bits, modo Galois/Counter | Cifrado autenticado que protege en reposo las credenciales de Alpaca de cada usuario (`src/secretsCrypto.js`) |
| ATR | Average True Range (rango verdadero medio) | Medida de volatilidad; se usa para la distancia del stop y el tamaño de la posición |
| Key fingerprint | Huella corta y no secreta de una clave de cifrado | Los primeros 4 bytes del SHA-256 de `TRADER_CREDENTIALS_ENC_KEY`, guardados en cada fila de credencial (`key_fp`) para que una credencial guardada en otro entorno se identifique en vez de fallar en silencio |
| BB | Bandas de Bollinger | Envolvente de 20 periodos y 2σ alrededor de la SMA |
| BoS | Break of Structure (ruptura de estructura) | Señal de cambio de tendencia (máximo decreciente roto = BoS bajista) |
| BW | Bandwidth (ancho de banda) | Anchura de las bandas de Bollinger: (superior−inferior)/media |
| EMA | Exponential Moving Average (media móvil exponencial) | Media ponderada; reacciona más rápido que la SMA |
| HH | Higher High (máximo más alto) | Estructura alcista |
| HL | Higher Low (mínimo más alto) | Estructura alcista |
| LH | Lower High (máximo más bajo) | Estructura bajista |
| LL | Lower Low (mínimo más bajo) | Estructura bajista |
| Audit trail (credentials) | Registro de solo adición de los cambios en las credenciales | `trader_credential_audit` — quién cambió qué credencial de Alpaca y cuándo. No contiene material de clave y no tiene clave foránea, por lo que sobrevive a la cuenta que documenta |
| Step-up auth | Volver a introducir la contraseña de la cuenta para confirmar una acción de alto impacto | Solo se pide al desconectar una credencial, o al sustituir aquella con la que opera el motor programado. Conectar una primera clave, o cambiar entre claves ya guardadas, no lo requiere |
| Legacy engine uid | Uid centinela del motor anterior al multiinquilino | `'trader'` — el antiguo id de fila fijo de `trader_state` (`db.LEGACY_ENGINE_UID`), conservado como instantánea de reversión después de que el relleno de la fase 4 lo copiara al uid del propietario |
| MACD | Moving Average Convergence Divergence | Diferencia entre las EMA de 12 y 26; línea de señal de 9 periodos |
| MiCA | Reglamento de Mercados de Criptoactivos | Normativa cripto de la UE; el motivo por el que este proyecto se limita a paper trading |
| POC | Point of Control | Perfil de volumen: el nivel de precio con mayor volumen negociado |
| R:R | Relación riesgo/beneficio | Distancia del stop frente a la distancia del objetivo de beneficios (mínimo 1:2, preferible 1:3) |
| RSI | Relative Strength Index | Método de Wilder, 14 periodos; sobrecomprado por encima de 70, sobrevendido por debajo de 30 |
| SMA | Simple Moving Average (media móvil simple) | Media de ponderación igual |
| SoS | Sign of Strength (señal de fuerza) | Wyckoff: ruptura confirmada por volumen por encima del rango de negociación |
| TA | Análisis técnico | Análisis de señales basado en gráficos |
| Tenant | Una cuenta para la que se ejecuta el motor programado | Se define por tener una credencial de Alpaca **activa**, no por tener una cuenta — `db.getActiveTenantsForJob()`. Una cuenta sin credencial se omite y nunca se ejecuta con la cuenta de las variables de entorno (`src/tenantEngine.js`) |
| TF | Timeframe (marco temporal) | Por ejemplo 15Min, 4Hour, 1Day |
| %b | Bollinger percent-B | Posición dentro de la banda: 0 = inferior, 1 = superior |

---

## Términos de trading

| Término | Significado |
|---------|-------------|
| Confluence score | Puntuación de confluencia: puntuación de señal técnica sobre 6 puntos; ≥ 3,5 = comprar, ≥ 2,5 = media posición, < 2,5 = mantener (≥ 4,0 = largo a contratendencia en media posición dentro de una tendencia bajista); ≤ −4 = corto, −3 = corto en media posición, ≥ +2 = recomprar |
| Soft delete | Borrado suave: una cuenta marcada como eliminada cuyos datos siguen existiendo. El inicio de sesión deja de funcionar en toda la suite a la vez y todas las sesiones terminan, pero no se destruye nada y el nombre de usuario sigue reservado |
| Grace period | Periodo de gracia: los 30 días entre un borrado suave y el borrado definitivo, durante los cuales un administrador puede deshacer la eliminación. La única ventana en la que un borrado accidental o malintencionado es recuperable |
| Purge | Borrado permanente e irreversible de una cuenta y de cada fila que le pertenece en las cuatro aplicaciones de la suite, una vez vencido su periodo de gracia |
| Danger zone | Zona de peligro: la sección enmarcada aparte en la pantalla de cuenta que contiene la única acción irreversible, separada visualmente de los ajustes habituales para que no se active por error |
| Step-up authentication | Volver a demostrar la identidad (contraseña, y un segundo factor si está activado) para una acción destructiva aunque la sesión ya esté iniciada — una sesión robada por sí sola no debería bastar para destruir una cuenta o sus credenciales |
| Markov analysis | Análisis de Markov. Pestaña Markov del panel. Cadena de Markov de primer orden sobre las rentabilidades diarias de cierre a cierre |
| Transition matrix | Matriz de transición: matriz 3×3 en la que la celda (i,j) es la probabilidad empírica de pasar del estado i al estado j al día siguiente. Las filas suman 1 |
| Stationary distribution | Distribución estacionaria: probabilidades de estado a largo plazo π que cumplen π = πP; calculadas por iteración de potencias. La pestaña Markov la muestra junto a las frecuencias empíricas de estado |
| Regime block | Bloqueo por régimen: se detecta tendencia diaria bajista → se bloquean todas las nuevas entradas largas |
| BB squeeze | Anchura de las bandas de Bollinger en el 20 % inferior de las últimas 60 velas → ruptura inminente |
| Golden cross | La EMA 20 cruza por encima de la EMA 50 → alcista |
| Death cross | La EMA 20 cruza por debajo de la EMA 50 → bajista |
| EMA cross state | Se determina a partir de las dos últimas velas; «golden» / «death» / neutral |
| 4H regime | Filtro de tendencia principal: EMA 20 frente a EMA 50 en velas de 4 horas |
| ADX | Average Directional Index (14, Wilder) — *fuerza* de la tendencia de 0 a 100, con independencia de la dirección |
| OBV / OBV trend | On-Balance Volume — volumen acumulado con signo según la dirección de cierre a cierre |
| Wyckoff | Fases del ciclo de mercado: acumulación → mark-up → distribución → mark-down |
| Mark-Up | Fase de tendencia de Wyckoff: HH/HL constantes, comprar los retrocesos |
| Mark-Down | Fase bajista de Wyckoff: LH/LL constantes, mantenerse fuera |
| Accumulation | Zona de compra de Wyckoff: rango tras una tendencia bajista, buscar una SoS |
| Distribution | Zona de salida de Wyckoff: rango tras una tendencia alcista, no ampliar posiciones |
| Regime (daily) | Régimen diario: último cierre > SMA de 50 días Y SMA de 20 días > SMA de 50 días = tendencia alcista |
| Hard cap | Límite estricto: la mayor parte del capital que puede ocupar un solo símbolo, aplicada en cada orden. El límite es **por símbolo, no una única cifra**: BTC 30 %, ETH 15 %, ADA/SOL 10 %, DOGE 8 %, LTC/DOT 6 %, LINK/AVAX/AAVE 5 %, y 5 % para todo lo demás |
| ATR sizing | Dimensionamiento por ATR con la regla del 1 % de riesgo: cantidad = (capital × 1 %) / (ATR × 1,5), y después limitada por el límite estricto de ese símbolo. Ese 1 % es **nominal** — la posición sale en realidad en el mínimo del rango 4H, normalmente entre 6 y 9 veces más lejos que la distancia usada para el cálculo, así que una operación perdedora puede costar bastante más del 1 % del capital |
| Nominal risk | Riesgo nominal: una cifra de riesgo por operación derivada de la distancia con la que se *dimensionó* la posición, cuando la posición se *cierra* a una distancia distinta. El porcentaje declarado es entonces una etiqueta, no una pérdida medida |
| Walk-forward test | Entrenar repetidamente sobre un tramo del historial y probar sobre el siguiente tramo aún no visto, para comprobar que una estrategia aguanta fuera de muestra. A diferencia del banco de repetición, esta prueba simula ejecuciones y resultado — por lo que es ella, y no el R:R neto, la que muestra si una señal gana dinero de verdad. **Hoy este proyecto no tiene ninguna prueba walk-forward operativa**, y por eso el aviso de la pestaña Backtest informa de un archivo ausente |
| Limit order | Orden limitada: el único tipo de orden que se usa; precio ≤ precio de venta + 0,2 % |
| Stop escalation | Escalado del stop: una orden de stop-loss que lleva 2 ciclos sin ejecutarse se cancela y se sustituye por una banda limitada más amplia (del 0,5 % al 0,8 % desde el precio de venta), para que aún pueda cruzar un spread que se ha ensanchado más allá de la banda base |
| Replay harness | Banco de repetición: `scripts/replay.mjs` — hace pasar velas históricas por el motor de decisión real e informa de lo que *habría* hecho: distribución de puntuaciones, cruces de umbral y qué umbral bloqueó cada candidato. Mide un cambio de estrategia antes de publicarlo. No es un backtester: sin ejecuciones y sin resultado |
| Timeframe comparison | Comparación de marcos temporales: `scripts/compareTimeframes.mjs` — repite cada configuración de marco de ejecución, stop y objetivo sobre *la misma ventana de calendario* y compara el R:R neto. Comparar un número igual de velas en lugar de periodos iguales compara dos regímenes de mercado, no dos marcos temporales |
| Geometry vs edge | Geometría frente a ventaja: el R:R neto describe la forma de una operación (beneficio en relación con el riesgo); no dice nada sobre si la señal de entrada acierta la dirección. Una relación de 2:1 con una tasa de acierto del 30 % sigue perdiendo dinero |
| Paper spot trading | Solo operaciones al contado simuladas; entorno paper de Alpaca (todavía sin soporte de futuros) |
| Read-only mode | Modo de solo lectura: las credenciales live de Alpaca muestran cuenta, posiciones y cotizaciones, pero nunca pueden enviar ni cancelar una orden |
| Scheduled run | Ejecución programada: una evaluación que el servidor realiza por su cuenta, una vez por día UTC a la hora que elijas en Command → Scheduled Jobs. Envía órdenes reales a la cuenta paper que hayas conectado, así que no es una vista previa. Es distinta del Autopilot, que solo funciona mientras haya una pestaña del navegador abierta |
| Daily regime | Régimen diario: se calcula a partir de 90 días de velas diarias — SMA 20 frente a SMA 50 frente al último cierre |
| Vol ratio | Ratio de volumen: volumen de la vela actual / volumen medio de 20 velas. Solo se puntúa cuando al menos 10 de esas 20 velas de referencia han negociado realmente — la cinta de 15 minutos de Alpaca está vacía entre un 64 % y un 92 % en las alts, y una referencia casi vacía convierte el ratio en una apuesta sobre la llegada de una operación en lugar de una medida de participación. Demasiado escaso ⇒ n/d, cuenta como 0, nunca como penalización ni como bonificación |
| Live R:R | Relación riesgo/beneficio en directo: `(objetivo − actual) / (actual − stop)`, con un stop del −5 % y un objetivo del +10 % |
| Ticker strip | Barra de cotizaciones en la parte superior del panel, alimentada por la lista de seguimiento activa |
| Correlation heatmap | Mapa de calor de correlación: matriz 10×10 de ρ de Pearson sobre rentabilidades logarítmicas diarias; se muestra en la pestaña Risk |
| Trend arrow | Flecha de tendencia: ↑/↓/→ en la pestaña Signals, que compara la puntuación de confluencia actual con la del análisis anterior |
| Quick-buy (⚡) | Botón de compra rápida de la pestaña Signals para configuraciones con puntuación ≥ 3; precarga la ventana de orden con una cantidad basada en el ATR |
| Execute button (▶) | Botón de ejecución: envía directamente la orden paper dimensionada por ATR de esa fila de señal, sin abrir la ventana de orden |
| Trailing stop | Stop dinámico: se activa cuando una posición larga acumula un beneficio de al menos el 2,5 %. Sigue un 3 % por debajo del máximo alcanzado (HWM) |
| HWM | High-water mark — el precio de cierre más alto alcanzado desde la entrada |
| Tier-1 symbols | Símbolos de nivel 1: BTC/USD y ETH/USD — los más líquidos y los más correlacionados entre sí. Presupuesto por nivel independiente del de las alts de nivel 2 |
| Daily drawdown gate | Umbral de drawdown diario: si el capital de la cartera cae un 3 % o más respecto a la apertura del día, se activa el modo de preservación de capital: se bloquean todas las nuevas entradas y los stops existentes se ajustan al 3 %. Se reinicia a medianoche UTC |
| Over-cap trim | Recorte por encima del límite: valor de la posición > límite % del capital → vender el exceso para volver al límite. Sin umbral de señal; se aplica siempre |
| Under-cap top-up | Ampliación por debajo del límite: valor de la posición < límite % → comprar para cerrar la diferencia, sujeto al umbral de señal (puntuación ≥ 3) y al de régimen (sin tendencia bajista) |
| Plan (Free / Pro) | Nivel de suscripción de una cuenta. Pro solo cuenta mientras la suscripción esté activa o en prueba **y** el periodo pagado no haya vencido; cualquier otro caso, incluida la ausencia de suscripción, es Free. Nada en esta aplicación depende todavía de ello |
| Entitlement | Derechos: lo que una suscripción desbloquea realmente. Solo pueden controlarse las funciones que viven en nuestro propio servidor — no las que se calculan en el navegador a partir de datos públicos |
| Gap and Go | Un movimiento fuerte de precio durante la noche o en 24 h que continúa en la misma dirección en lugar de cerrar el hueco. El comportamiento contrario es un *fade* — el movimiento se gira y devuelve el hueco. La pestaña Breakout valora en cada símbolo su tendencia histórica entre ambos |
| ORB (Opening Range Breakout) | Ruptura del rango de apertura: esperar a que el precio rompa por encima o por debajo del rango formado en los primeros minutos de una sesión antes de entrar, en lugar de adivinar la dirección de un hueco. La pestaña Breakout lo recomienda cuando el historial de un símbolo está a cara o cruz entre continuar y girarse |
| VWAP | Volume-Weighted Average Price — el precio medio pagado durante una sesión, ponderado por el volumen negociado en cada nivel. Se usa como línea de referencia: mantenerse por encima se interpreta como fuerza, y ser rechazado desde ella como debilidad |
| Catalyst quality | Calidad del catalizador: cuán probable es que un movimiento de precio lo impulsen noticias reales y no el ruido, juzgado por el tamaño del movimiento y el volumen que lo acompaña. Débil significa que el movimiento es probablemente ruido técnico y, por sí solo, no es motivo para operar |
| Untranslated by design | Sin traducir por diseño: los términos que el panel deja en inglés en todos los idiomas, porque son idénticos en cualquier plataforma de trading del mundo — las abreviaturas de indicadores (RSI, MACD, ADX, OBV, ATR, VWAP), las etiquetas de acción BUY / HALF / BEAR / HOLD, y los patrones con nombre Golden cross y Death cross. Todo lo demás que muestra el panel sigue el selector de idioma |
