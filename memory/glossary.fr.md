## Sigles et abréviations

| Terme | Signification | Contexte |
|-------|---------------|----------|
| AAD | Additional Authenticated Data (données authentifiées supplémentaires) | Entrée AES-GCM authentifiée mais non chiffrée ; lie un identifiant stocké à sa propre ligne `(uid, mode)`, de sorte qu'un chiffré copié ne peut pas être déchiffré |
| AES-256-GCM | Advanced Encryption Standard, clé de 256 bits, mode Galois/Counter | Chiffrement authentifié utilisé pour les identifiants Alpaca de chaque utilisateur au repos (`src/secretsCrypto.js`) |
| ATR | Average True Range (amplitude moyenne réelle) | Mesure de volatilité ; sert à la distance de stop et au dimensionnement des positions |
| Key fingerprint | Empreinte courte et non secrète d'une clé de chiffrement | Les 4 premiers octets du SHA-256 de `TRADER_CREDENTIALS_ENC_KEY`, stockés par ligne d'identifiant (`key_fp`), afin qu'un identifiant enregistré depuis un autre environnement se signale au lieu d'échouer silencieusement |
| BB | Bandes de Bollinger | Enveloppe de 20 périodes et 2σ autour de la SMA |
| BoS | Break of Structure (rupture de structure) | Signal de changement de tendance (sommet plus bas cassé = BoS baissière) |
| BW | Bandwidth (largeur de bande) | Largeur des bandes de Bollinger : (haute−basse)/médiane |
| EMA | Exponential Moving Average (moyenne mobile exponentielle) | Moyenne pondérée ; réagit plus vite que la SMA |
| HH | Higher High (sommet plus haut) | Structure haussière |
| HL | Higher Low (creux plus haut) | Structure haussière |
| LH | Lower High (sommet plus bas) | Structure baissière |
| LL | Lower Low (creux plus bas) | Structure baissière |
| Audit trail (credentials) | Journal en ajout seul des modifications d'identifiants | `trader_credential_audit` — qui a modifié quel identifiant Alpaca, et quand. Ne contient aucune clé et n'a pas de clé étrangère, il survit donc au compte qu'il documente |
| Step-up auth | Ressaisir le mot de passe du compte pour confirmer une action lourde de conséquences | Demandé uniquement pour déconnecter un identifiant, ou pour remplacer celui avec lequel le moteur planifié trade. Connecter une première clé, ou basculer entre des clés déjà enregistrées, ne le demande pas |
| Legacy engine uid | Uid sentinelle du moteur d'avant le multi-locataire | `'trader'` — l'ancien id de ligne fixe de `trader_state` (`db.LEGACY_ENGINE_UID`), conservé comme instantané de retour arrière après que la reprise de la phase 4 l'a copié vers l'uid du propriétaire |
| MACD | Moving Average Convergence Divergence | Écart entre EMA 12 et 26 ; ligne de signal sur 9 périodes |
| MiCA | Règlement sur les marchés de crypto-actifs | Réglementation crypto de l'UE ; la raison pour laquelle ce projet se limite au paper trading |
| POC | Point of Control | Profil de volume : le niveau de prix au volume échangé le plus élevé |
| R:R | Rapport risque/rendement | Distance de stop comparée à la distance de prise de bénéfices (minimum 1:2, 1:3 de préférence) |
| RSI | Relative Strength Index | Méthode de Wilder, 14 périodes ; suracheté au-dessus de 70, survendu en dessous de 30 |
| SMA | Simple Moving Average (moyenne mobile simple) | Moyenne à pondération égale |
| SoS | Sign of Strength (signe de force) | Wyckoff : cassure confirmée par le volume au-dessus de la zone d'échange |
| TA | Analyse technique | Analyse des signaux à partir des graphiques |
| Tenant | Un compte pour lequel le moteur planifié s'exécute | Défini par la présence d'un identifiant Alpaca **actif**, pas par la simple existence d'un compte — `db.getActiveTenantsForJob()`. Un compte sans identifiant est ignoré, jamais exécuté sur le compte des variables d'environnement (`src/tenantEngine.js`) |
| TF | Timeframe (unité de temps) | Par exemple 15Min, 4Hour, 1Day |
| %b | Bollinger percent-B | Position dans la bande : 0 = basse, 1 = haute |

---

## Termes de trading

| Terme | Signification |
|-------|---------------|
| Confluence score | Score de confluence : score de signal technique sur 6 points ; ≥ 3,5 = achat, ≥ 2,5 = demi-taille, < 2,5 = attente (≥ 4,0 = long à contre-tendance en demi-taille dans une tendance baissière) ; ≤ −4 = vente à découvert, −3 = short en demi-taille, ≥ +2 = rachat |
| Soft delete | Suppression douce : un compte marqué comme supprimé mais dont les données existent toujours. La connexion cesse de fonctionner partout dans la suite en même temps et toutes les sessions prennent fin, mais rien n'est détruit et le nom d'utilisateur reste réservé |
| Grace period | Période de grâce : les 30 jours entre une suppression douce et l'effacement définitif, pendant lesquels un administrateur peut annuler la suppression. La seule fenêtre où une suppression accidentelle ou malveillante reste récupérable |
| Purge | Effacement définitif et irréversible d'un compte et de chaque ligne qui lui appartient dans les quatre applications de la suite, une fois sa période de grâce écoulée |
| Danger zone | Zone de danger : la section encadrée à part de l'écran du compte qui contient l'unique action irréversible, visuellement séparée des réglages courants pour ne pas être déclenchée par erreur |
| Step-up authentication | Prouver à nouveau son identité (mot de passe, plus un second facteur si activé) pour une action destructrice, même si la session est déjà ouverte — une session volée seule ne doit pas suffire à détruire un compte ou ses identifiants |
| Markov analysis | Analyse de Markov. Onglet Markov du tableau de bord. Chaîne de Markov d'ordre 1 sur les rendements journaliers de clôture à clôture |
| Transition matrix | Matrice de transition : matrice 3×3 où la cellule (i,j) est la probabilité empirique de passer de l'état i à l'état j le lendemain. Les lignes totalisent 1 |
| Stationary distribution | Distribution stationnaire : probabilités d'état à long terme π vérifiant π = πP ; calculées par itération de puissance. L'onglet Markov l'affiche à côté des fréquences d'état empiriques |
| Regime block | Blocage de régime : tendance journalière baissière détectée → toutes les nouvelles entrées longues sont bloquées |
| BB squeeze | Largeur des bandes de Bollinger dans les 20 % inférieurs des 60 dernières bougies → cassure imminente |
| Golden cross | L'EMA 20 croise au-dessus de l'EMA 50 → haussier |
| Death cross | L'EMA 20 croise en dessous de l'EMA 50 → baissier |
| EMA cross state | Déterminé à partir des deux dernières bougies ; « golden » / « death » / neutre |
| 4H regime | Filtre de tendance principal : EMA 20 contre EMA 50 sur les bougies de 4 heures |
| ADX | Average Directional Index (14, Wilder) — *force* de la tendance de 0 à 100, indépendamment de la direction |
| OBV / OBV trend | On-Balance Volume — volume cumulé signé selon le sens de clôture à clôture |
| Wyckoff | Phases du cycle de marché : accumulation → mark-up → distribution → mark-down |
| Mark-Up | Phase de tendance de Wyckoff : HH/HL réguliers, acheter les replis |
| Mark-Down | Phase baissière de Wyckoff : LH/LL réguliers, rester à l'écart |
| Accumulation | Zone d'achat de Wyckoff : range après une tendance baissière, guetter un SoS |
| Distribution | Zone de sortie de Wyckoff : range après une tendance haussière, ne pas renforcer les positions |
| Regime (daily) | Régime journalier : dernière clôture > SMA 50 jours ET SMA 20 jours > SMA 50 jours = tendance haussière |
| Hard cap | Plafond strict : la part maximale du capital qu'un seul symbole peut occuper, appliquée à chaque ordre. Le plafond est **par symbole, ce n'est pas un chiffre unique** : BTC 30 %, ETH 15 %, ADA/SOL 10 %, DOGE 8 %, LTC/DOT 6 %, LINK/AVAX/AAVE 5 %, et 5 % pour tout le reste |
| ATR sizing | Dimensionnement par ATR selon la règle du risque de 1 % : quantité = (capital × 1 %) / (ATR × 1,5), puis plafonnée par le plafond strict du symbole. Ce 1 % est **nominal** — la position sort en réalité sur le plus bas du range 4H, généralement 6 à 9 fois plus loin que la distance utilisée pour le calcul, donc un trade perdant peut coûter bien plus de 1 % du capital |
| Nominal risk | Risque nominal : un montant de risque par trade issu de la distance ayant servi à *dimensionner* la position, alors que la position est *clôturée* à une autre distance. Le pourcentage annoncé est alors une étiquette, pas une perte mesurée |
| Walk-forward test | Entraîner de façon répétée sur une tranche d'historique puis tester sur la tranche suivante encore inconnue, pour vérifier qu'une stratégie tient hors échantillon. Contrairement au banc de replay, ce test simule les exécutions et le résultat — c'est donc lui, et non le R:R net, qui montre si un signal rapporte réellement. **Ce projet n'a aujourd'hui aucun test walk-forward opérationnel**, ce qui explique pourquoi la bannière de l'onglet Backtest signale un fichier manquant |
| Limit order | Ordre à cours limité : le seul type d'ordre utilisé ; prix ≤ prix demandé + 0,2 % |
| Stop escalation | Escalade du stop : un ordre stop non exécuté pendant 2 cycles est annulé et remplacé par une bande limite plus large (0,5 % → 0,8 % du prix demandé), afin de pouvoir franchir un spread devenu plus large que la bande de base |
| Replay harness | Banc de replay : `scripts/replay.mjs` — rejoue des bougies historiques dans le moteur de décision réel et rapporte ce qu'il *aurait* fait : distribution des scores, franchissements de seuils et quel seuil a bloqué chaque candidat. Mesure un changement de stratégie avant sa mise en production. Ce n'est pas un backtester : ni exécutions, ni résultat |
| Timeframe comparison | Comparaison d'unités de temps : `scripts/compareTimeframes.mjs` — rejoue chaque configuration d'unité de temps, de stop et de cible sur *la même fenêtre calendaire* et compare le R:R net. Comparer un nombre égal de bougies au lieu de durées égales compare deux régimes de marché, pas deux unités de temps |
| Geometry vs edge | Géométrie contre avantage : le R:R net décrit la forme d'un trade (gain rapporté au risque) ; il ne dit rien sur la capacité du signal d'entrée à choisir la direction. Un rapport de 2:1 avec un taux de réussite de 30 % perd quand même de l'argent |
| Paper spot trading | Trades au comptant simulés uniquement ; environnement paper d'Alpaca (pas encore de futures) |
| Read-only mode | Mode lecture seule : des identifiants Alpaca live affichent le compte, les positions et les cotations, mais ne peuvent jamais passer ni annuler un ordre |
| Scheduled run | Exécution planifiée : une évaluation que le serveur réalise de lui-même, une fois par jour UTC à l'heure que vous choisissez dans Command → Scheduled Jobs. Elle passe de vrais ordres sur le compte paper que vous avez connecté, ce n'est donc pas un aperçu. Distincte de l'Autopilot, qui ne fonctionne que tant qu'un onglet de navigateur est ouvert |
| Daily regime | Régime journalier : calculé à partir de 90 jours de bougies journalières — SMA 20 contre SMA 50 contre la dernière clôture |
| Vol ratio | Ratio de volume : volume de la bougie courante / volume moyen sur 20 bougies. Compté seulement si au moins 10 de ces 20 bougies de référence ont réellement échangé — la bande 15 minutes d'Alpaca est vide à 64–92 % pour les alts, et une référence quasi vide transforme le ratio en pari sur l'arrivée d'un trade plutôt qu'en mesure de participation. Trop clairsemé ⇒ n/d, compte pour 0, jamais en pénalité ni en bonus |
| Live R:R | Rapport risque/rendement en direct : `(cible − actuel) / (actuel − stop)`, avec un stop de −5 % et une cible de +10 % |
| Ticker strip | Bandeau de cotations en haut du tableau de bord, alimenté par la watchlist active |
| Correlation heatmap | Carte de corrélation : matrice 10×10 de ρ de Pearson sur les rendements logarithmiques journaliers ; affichée dans l'onglet Risk |
| Trend arrow | Flèche de tendance : ↑/↓/→ dans l'onglet Signals, comparant le score de confluence actuel à celui de l'analyse précédente |
| Quick-buy (⚡) | Bouton d'achat rapide de l'onglet Signals pour les configurations dont le score est ≥ 3 ; pré-remplit la fenêtre d'ordre avec une quantité calculée sur l'ATR |
| Execute button (▶) | Bouton d'exécution : envoie directement l'ordre paper dimensionné par l'ATR de cette ligne de signal, sans ouvrir la fenêtre d'ordre |
| Trailing stop | Stop suiveur : s'active dès qu'une position longue est en gain d'au moins 2,5 %. Suit 3 % sous le plus haut atteint (HWM) |
| HWM | High-water mark — le plus haut cours de clôture atteint depuis l'entrée |
| Tier-1 symbols | Symboles de niveau 1 : BTC/USD et ETH/USD — les plus liquides et les plus corrélés entre eux. Budget par niveau distinct de celui des alts de niveau 2 |
| Daily drawdown gate | Seuil de drawdown journalier : si le capital du portefeuille baisse de 3 % ou plus par rapport à l'ouverture du jour, le mode préservation du capital s'active : toutes les nouvelles entrées sont bloquées et les stops existants sont resserrés à 3 %. Réinitialisé à minuit UTC |
| Over-cap trim | Réduction au-dessus du plafond : valeur de la position > plafond % du capital → vendre l'excédent pour revenir au plafond. Aucun seuil de signal ; s'applique toujours |
| Under-cap top-up | Renforcement sous le plafond : valeur de la position < plafond % → acheter pour combler l'écart, sous réserve du seuil de signal (score ≥ 3) et du seuil de régime (pas de tendance baissière) |
| Plan (Free / Pro) | Niveau d'abonnement d'un compte. Pro ne compte que tant que l'abonnement est actif ou en période d'essai **et** que la période payée n'a pas expiré ; tout le reste, y compris l'absence d'abonnement, est Free. Rien dans cette application n'en dépend encore |
| Entitlement | Droits : ce qu'un abonnement débloque réellement. Seules les fonctionnalités hébergées sur notre propre serveur sont contrôlables — pas celles calculées dans le navigateur à partir de données publiques |
| Gap and Go | Un fort mouvement de prix sur la nuit ou sur 24 h qui poursuit dans le même sens au lieu de combler l'écart. Le comportement inverse est un *fade* — le mouvement se retourne et rend l'écart. L'onglet Breakout évalue pour chaque symbole sa tendance historique entre les deux |
| ORB (Opening Range Breakout) | Cassure du range d'ouverture : attendre que le prix casse au-dessus ou en dessous du range formé dans les premières minutes d'une séance avant d'entrer, plutôt que de deviner la direction d'un écart. L'onglet Breakout le recommande quand l'historique d'un symbole est à pile ou face entre poursuite et retournement |
| VWAP | Volume-Weighted Average Price — le prix moyen payé sur une séance, pondéré par le volume échangé à chaque niveau. Sert de ligne de référence : se maintenir au-dessus est vu comme de la force, en être rejeté comme de la faiblesse |
| Catalyst quality | Qualité du catalyseur : à quel point un mouvement de prix est probablement dû à une vraie information plutôt qu'au bruit, jugé sur l'ampleur du mouvement et le volume qui l'accompagne. Faible signifie que le mouvement est probablement du bruit technique, et ne constitue donc pas à lui seul une raison de trader |
| Untranslated by design | Volontairement non traduit : les termes que le tableau de bord laisse en anglais dans toutes les langues, parce qu'ils sont identiques sur toutes les plateformes de trading du monde — les abréviations d'indicateurs (RSI, MACD, ADX, OBV, ATR, VWAP), les libellés d'action BUY / HALF / BEAR / HOLD, et les figures nommées Golden cross et Death cross. Tout le reste de ce qu'affiche le tableau de bord suit le sélecteur de langue |
