## Acroniemen en afkortingen

| Term | Betekenis | Context |
|------|-----------|---------|
| AAD | Additional Authenticated Data (aanvullende geauthenticeerde data) | AES-GCM-invoer die wel wordt geauthenticeerd maar niet versleuteld; koppelt een opgeslagen inloggegeven aan zijn eigen `(uid, mode)`-rij, zodat een gekopieerde ciphertext niet ontsleuteld kan worden |
| AES-256-GCM | Advanced Encryption Standard, 256-bits sleutel, Galois/Counter Mode | Geauthenticeerde versleuteling voor Alpaca-inloggegevens per gebruiker in rust (`src/secretsCrypto.js`) |
| ATR | Average True Range (gemiddelde werkelijke bandbreedte) | Volatiliteitsmaat; gebruikt voor stopafstand en positiegrootte |
| Key fingerprint | Korte, niet-geheime vingerafdruk van een encryptiesleutel | De eerste 4 bytes van SHA-256 over `TRADER_CREDENTIALS_ENC_KEY`, per inloggegevenrij opgeslagen (`key_fp`), zodat een inloggegeven dat in een andere omgeving is opgeslagen zichzelf meldt in plaats van stil te falen |
| BB | Bollinger Bands | Envelop van 20 perioden en 2σ rond het SMA |
| BoS | Break of Structure (structuurbreuk) | Signaal van trendverandering (lagere top gebroken = bearish BoS) |
| BW | Bandwidth (bandbreedte) | Breedte van de Bollinger Bands: (boven−onder)/midden |
| EMA | Exponential Moving Average (exponentieel voortschrijdend gemiddelde) | Gewogen gemiddelde; reageert sneller dan het SMA |
| HH | Higher High (hogere top) | Bullish structuur |
| HL | Higher Low (hogere bodem) | Bullish structuur |
| LH | Lower High (lagere top) | Bearish structuur |
| LL | Lower Low (lagere bodem) | Bearish structuur |
| Audit trail (credentials) | Alleen-toevoegen registratie van wijzigingen aan inloggegevens | `trader_credential_audit` — wie welk Alpaca-inloggegeven wanneer heeft gewijzigd. Bevat geen sleutelmateriaal en heeft geen foreign key, dus het overleeft het account dat het documenteert |
| Step-up auth | Je accountwachtwoord opnieuw invoeren om een ingrijpende actie te bevestigen | Wordt alleen gevraagd bij het loskoppelen van een inloggegeven, of bij het vervangen van het inloggegeven waarmee de geplande engine handelt. Een eerste sleutel koppelen, of wisselen tussen sleutels die je al hebt opgeslagen, vraagt er niet om |
| Legacy engine uid | Sentinel-uid voor de engine van vóór multi-tenant | `'trader'` — de oude vaste rij-id van `trader_state` (`db.LEGACY_ENGINE_UID`), bewaard als rollback-momentopname nadat de Fase 4-backfill hem naar de uid van de eigenaar heeft gekopieerd |
| MACD | Moving Average Convergence Divergence | Verschil tussen 12/26 EMA; signaallijn over 9 perioden |
| MiCA | Markets in Crypto-Assets Regulation | EU-cryptoregelgeving; de reden dat dit project uitsluitend paper trading doet |
| POC | Point of Control | Volumeprofiel: het prijsniveau met het hoogste verhandelde volume |
| R:R | Risk-to-Reward-verhouding (risico-rendementsverhouding) | Stopafstand versus afstand tot winstdoel (minimaal 1:2 nodig, 1:3 heeft de voorkeur) |
| RSI | Relative Strength Index | Wilder-methode, 14 perioden; overbought boven 70, oversold onder 30 |
| SMA | Simple Moving Average (eenvoudig voortschrijdend gemiddelde) | Gemiddelde met gelijke weging |
| SoS | Sign of Strength (teken van kracht) | Wyckoff: door volume bevestigde uitbraak boven de handelsrange |
| TA | Technische analyse | Signaalanalyse op basis van grafieken |
| Tenant | Een account waarvoor de geplande engine draait | Bepaald door het hebben van een **actief** Alpaca-inloggegeven, niet door het hebben van een account — `db.getActiveTenantsForJob()`. Een account zonder inloggegeven wordt overgeslagen en draait nooit op het env-var-account (`src/tenantEngine.js`) |
| TF | Timeframe (tijdsbestek) | Bijvoorbeeld 15Min, 4Hour, 1Day |
| %b | Bollinger percent-B | Positie binnen de band: 0 = onder, 1 = boven |

---

## Handelstermen

| Term | Betekenis |
|------|-----------|
| Confluence score | Confluentiescore: TA-signaalscore van 6 punten; ≥ 3,5 = kopen, ≥ 2,5 = halve omvang, < 2,5 = afwachten (≥ 4,0 = halve tegentrend-long in een neerwaartse trend); ≤ −4 = short, −3 = halve short, ≥ +2 = terugkopen |
| Soft delete | Zachte verwijdering: een account dat als verwijderd is gemarkeerd terwijl de gegevens nog bestaan. Aanmelden werkt direct in de hele suite niet meer en alle sessies eindigen, maar er wordt niets vernietigd en de gebruikersnaam blijft gereserveerd |
| Grace period | Respijtperiode: de 30 dagen tussen een zachte verwijdering en definitieve wissing, waarin een beheerder de verwijdering ongedaan kan maken. Het enige venster waarin een per ongeluk of kwaadwillig verwijderd account nog te herstellen is |
| Purge | Definitieve, onomkeerbare wissing van een account en elke rij die het bezit in alle vier de suite-applicaties, zodra de respijtperiode is verstreken |
| Danger zone | Gevarenzone: het apart omkaderde deel van het accountscherm met de ene onomkeerbare actie, visueel gescheiden van de gewone instellingen zodat het niet per ongeluk wordt aangeklikt |
| Step-up authentication | Je identiteit opnieuw bewijzen (wachtwoord, plus een tweede factor indien ingeschakeld) voor een destructieve actie, ook al ben je al aangemeld — een gestolen sessie alleen mag niet genoeg zijn om een account of zijn inloggegevens te vernietigen |
| Markov analysis | Markov-analyse. Het Markov-tabblad van het dashboard. Markov-keten van de eerste orde over dagelijkse close-op-close-rendementen |
| Transition matrix | Overgangsmatrix: 3×3-matrix waarin cel (i,j) de empirische kans is om de volgende dag van toestand i naar toestand j te gaan. Rijen tellen op tot 1 |
| Stationary distribution | Stationaire verdeling: langetermijnkansen π waarvoor geldt π = πP; berekend via machtsiteratie. Het Markov-tabblad toont deze naast de empirische toestandsfrequenties |
| Regime block | Regimeblokkade: dagelijkse neerwaartse trend gedetecteerd → alle nieuwe long-entries geblokkeerd |
| BB squeeze | Bollinger-bandbreedte in de onderste 20% van de laatste 60 bars → uitbraak op komst |
| Golden cross | 20 EMA kruist boven 50 EMA → bullish |
| Death cross | 20 EMA kruist onder 50 EMA → bearish |
| EMA cross state | Bepaald uit de laatste twee bars; "golden" / "death" / "neutraal" |
| 4H regime | Primair trendfilter: 20 EMA versus 50 EMA op 4-uursbars |
| ADX | Average Directional Index (14, Wilder) — trend*sterkte* van 0 tot 100, ongeacht de richting |
| OBV / OBV trend | On-Balance Volume — cumulatief volume met een teken op basis van de close-op-close-richting |
| Wyckoff | Marktcyclusfasen: accumulatie → mark-up → distributie → mark-down |
| Mark-Up | Wyckoff-trendfase: consistente HH/HL, koop terugvallen |
| Mark-Down | Wyckoff-neerwaartse fase: consistente LH/LL, blijf aan de zijlijn |
| Accumulation | Wyckoff-koopzone: range na een neerwaartse trend, let op SoS |
| Distribution | Wyckoff-uitstapzone: range na een opwaartse trend, bouw geen posities bij |
| Regime (daily) | Dagelijks regime: laatste slotkoers > 50-daags SMA ÉN 20-daags SMA > 50-daags SMA = opwaartse trend |
| Hard cap | Harde limiet: het grootste deel van het vermogen dat één symbool mag innemen, afgedwongen bij elke order. De limiet geldt **per symbool en is niet één getal**: BTC 30%, ETH 15%, ADA/SOL 10%, DOGE 8%, LTC/DOT 6%, LINK/AVAX/AAVE 5%, en 5% voor al het overige |
| ATR sizing | ATR-positiegrootte volgens de 1%-risicoregel: aantal = (vermogen × 1%) / (ATR × 1,5), daarna begrensd door de harde limiet van dat symbool. Die 1% is **nominaal** — de positie sluit in werkelijkheid op de 4H swing low, doorgaans 6 tot 9 keer verder weg dan de afstand waarmee is gerekend, dus een verliestrade kan ruim meer dan 1% van het vermogen kosten |
| Nominal risk | Nominaal risico: een risicobedrag per trade dat is afgeleid van de afstand waarmee de positie is *gedimensioneerd*, terwijl de positie op een andere afstand wordt *gesloten*. Het genoemde percentage is dan een etiket, geen gemeten verlies |
| Walk-forward test | Herhaaldelijk trainen op één deel van de historie en testen op het volgende, nog ongeziene deel, om te controleren of een strategie ook buiten de steekproef standhoudt. Anders dan de replay-harnas simuleert deze test uitvoeringen en winst/verlies — dus deze test, en niet de netto R:R, laat zien of een signaal daadwerkelijk geld oplevert. **Dit project heeft vandaag geen werkende walk-forward-test**, en daarom meldt de banner op het Backtest-tabblad een ontbrekend bestand |
| Limit order | Limietorder: het enige ordertype dat wordt gebruikt; prijs ≤ laatprijs + 0,2% |
| Stop escalation | Stopescalatie: een stop-lossorder die 2 cycli niet is uitgevoerd wordt geannuleerd en vervangen door een ruimere limietband (0,5% → 0,8% vanaf de laatprijs), zodat hij een spread kan overbruggen die breder is geworden dan de basisband |
| Replay harness | Replay-harnas: `scripts/replay.mjs` — speelt historische bars door de live beslissingsengine en rapporteert wat die *zou* hebben gedaan: scoreverdeling, drempeloverschrijdingen en welke drempel elke kandidaat blokkeerde. Meet een strategiewijziging vóórdat die live gaat. Geen backtester: geen uitvoeringen, geen winst/verlies |
| Timeframe comparison | Tijdsbestekvergelijking: `scripts/compareTimeframes.mjs` — speelt elke combinatie van uitvoeringstijdsbestek, stop en doel af over *hetzelfde kalendervenster* en vergelijkt de netto R:R. Gelijke aantallen bars vergelijken in plaats van gelijke tijdspannen vergelijkt twee marktregimes, niet twee tijdsbestekken |
| Geometry vs edge | Geometrie versus edge: de netto R:R beschrijft de vorm van een trade (opbrengst ten opzichte van risico); hij zegt niets over de vraag of het entrysignaal de richting goed voorspelt. Een verhouding van 2:1 bij een winstratio van 30% verliest nog steeds geld |
| Paper spot trading | Uitsluitend gesimuleerde spottrades; Alpaca paper-omgeving (nog geen ondersteuning voor futures) |
| Read-only mode | Alleen-lezenmodus: live Alpaca-inloggegevens tonen account, posities en koersen, maar kunnen nooit een order plaatsen of annuleren |
| Scheduled run | Geplande uitvoering: een evaluatie die de server zelfstandig uitvoert, eenmaal per UTC-dag op het uur dat je kiest in Command → Scheduled Jobs. Er worden echte orders geplaatst op het paper-account dat je hebt gekoppeld, dus het is geen voorbeeldweergave. Los van Autopilot, die alleen draait zolang er een browsertabblad open staat |
| Daily regime | Dagelijks regime: berekend uit 90 dagen aan dagbars — SMA-20 versus SMA-50 versus de laatste slotkoers |
| Vol ratio | Volumeratio: volume van de huidige bar / gemiddeld volume over 20 bars. Wordt alleen meegeteld als minstens 10 van die 20 basisbars daadwerkelijk zijn verhandeld — Alpaca's 15-minutentape is voor de alts 64 tot 92% leeg, en een grotendeels lege basis maakt de ratio een gok op het aankomen van een trade in plaats van een maat voor deelname. Te dun ⇒ n.v.t., telt als 0, nooit als straf of bonus |
| Live R:R | Live risico-rendementsverhouding: `(doel − huidig) / (huidig − stop)`, met een stop van −5% en een doel van +10% |
| Ticker strip | Koersbalk boven aan het dashboard, gevoed door de actieve watchlist |
| Correlation heatmap | Correlatie-heatmap: 10×10-matrix met Pearson-ρ van dagelijkse logrendementen; te zien op het Risk-tabblad |
| Trend arrow | Trendpijl: ↑/↓/→ op het Signals-tabblad die de huidige confluentiescore vergelijkt met de vorige scan |
| Quick-buy (⚡) | Snelkoopknop op het Signals-tabblad voor setups met een score ≥ 3; vult het handelsvenster vooraf in met een ATR-gebaseerde omvang |
| Execute button (▶) | Uitvoerknop: plaatst direct de ATR-gebaseerde paper-order van die signaalrij vanaf het Signals-tabblad, zonder het handelsvenster te openen |
| Trailing stop | Meelopende stop: wordt actief zodra een longpositie ≥ 2,5% in de winst staat. Loopt 3% onder de hoogste stand (HWM) mee |
| HWM | High-water mark — de hoogste slotkoers sinds de entry |
| Tier-1 symbols | Tier-1-symbolen: BTC/USD en ETH/USD — het meest liquide, met de hoogste onderlinge correlatie. Apart budget per tier, los van de Tier-2-alts |
| Daily drawdown gate | Dagelijkse drawdown-drempel: zakt het portefeuillevermogen ≥ 3% ten opzichte van de openingsstand van de dag, dan gaat de kapitaalbehoudmodus aan: alle nieuwe entries geblokkeerd, bestaande stops aangescherpt naar 3%. Reset om middernacht UTC |
| Over-cap trim | Afbouw boven de limiet: positiewaarde > limiet% van het vermogen → verkoop het overschot om terug te keren naar de limiet. Geen signaaldrempel; gebeurt altijd |
| Under-cap top-up | Bijkopen onder de limiet: positiewaarde < limiet% → koop bij om het gat te dichten, mits de signaaldrempel (score ≥ 3) en de regimedrempel (geen neerwaartse trend) dat toelaten |
| Plan (Free / Pro) | Abonnementsniveau van een account. Pro telt alleen zolang het abonnement actief is of in proefperiode, én de betaalde periode nog niet is verlopen; al het andere, inclusief helemaal geen abonnement, is Free. Niets in deze app is er nog van afhankelijk |
| Entitlement | Rechten: wat een abonnement daadwerkelijk ontsluit. Alleen functies die op onze eigen server draaien zijn af te dwingen — alles wat in de browser tegen publieke data wordt berekend niet |
| Gap and Go | Een grote koersbeweging over nacht of over 24 uur die in dezelfde richting doorloopt in plaats van het gat te sluiten. Het tegenovergestelde gedrag is een *fade* — de beweging draait om en geeft het gat terug. Het Breakout-tabblad beoordeelt per symbool de historische neiging tussen die twee |
| ORB (Opening Range Breakout) | Uitbraak uit de openingsrange: wachten tot de koers boven of onder de range breekt die in de eerste minuten van een sessie is gevormd, in plaats van de richting van een gat te gokken. Het Breakout-tabblad raadt dit aan wanneer de historie van een symbool ongeveer fiftyfifty is tussen doorlopen en terugvallen |
| VWAP | Volume-Weighted Average Price — de gemiddelde betaalde prijs over een sessie, gewogen naar het volume op elk niveau. Wordt gebruikt als referentielijn: erboven blijven geldt als kracht, eraf ketsen als zwakte |
| Catalyst quality | Katalysatorkwaliteit: hoe waarschijnlijk het is dat een koersbeweging door echt nieuws wordt gedreven in plaats van door ruis, beoordeeld op de omvang van de beweging en het volume erachter. Zwak betekent dat de beweging waarschijnlijk technische ruis is, en op zichzelf dus geen reden om te handelen |
| Untranslated by design | Bewust onvertaald: termen die het dashboard in elke taal in het Engels laat staan, omdat ze op elk handelsplatform ter wereld hetzelfde zijn — indicatorafkortingen (RSI, MACD, ADX, OBV, ATR, VWAP), de actielabels BUY / HALF / BEAR / HOLD, en de benoemde patronen Golden cross en Death cross. Al het andere dat het dashboard toont volgt de taalkeuze |
