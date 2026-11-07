---
title: "Les endpoints RPC publics, mesurés avant d'être crus"
description: "La plupart des endpoints RPC publics connus sont morts ou échouent dans un HTTP 200 : je sonde chaque lecture de mon code, depuis chaque serveur qui la fera."
pubDate: 2026-10-11
track: "onchain"
tags: ["rpc", "evm", "resilience", "thorchain"]
sources: ["defi/rpc-publics-ethereum-sondage.md", "defi/rpc-publics-base-sondage.md", "defi/quand-aucun-noeud-public-ne-sert-tout.md", "defi/noeuds-publics-thorchain-maya-sondage.md", "defi/le-portefeuille-signe-et-rien-d-autre.md"]
---

## Trois entrées mortes sur cinq, dont deux dans un HTTP 200

Le 3 août 2026, j'ai sondé les cinq endpoints Ethereum publics que contient d'ordinaire une liste de fallback copiée d'un tutoriel. publicnode et drpc répondaient. cloudflare-eth.com répondait HTTP 200 avec `{"error":"Cannot fulfill request"}` dans le corps. rpc.ankr.com/eth répondait 200 avec `-32000 Unauthorized` : une clé d'API est désormais exigée. eth.llamarpc.com renvoyait 521. Trois sur cinq inutilisables, et deux des trois échouaient dans un HTTP 200. Un health check qui lit le code de statut les croit sains.

Deux mois plus tard, le constat était le même depuis un navigateur, et eth.llamarpc.com était toujours le RPC codé en dur d'un écran de dépôt dans la dApp expert de la plateforme DeFi d'un client.

Une entrée morte n'est pas neutre : elle coûte une tentative à chaque failover. Le 6 octobre, chaque lecture Sepolia du backend, qui essaie trois RPC, revenait « non mesuré » après 6,3 secondes : les trois premières entrées étaient mortes, les deux vivantes étaient en quatrième et sixième position. Avec les vivantes en tête, verrouillées par un test de blacklist, la même lecture prenait 65 à 85 ms. Une cascade de N tentatives vaut ses N premières entrées.

## L'archive est une capacité à part

Le 2 octobre, depuis le conteneur de staging, j'ai mesuré les endpoints à `latest`, 50 000 blocs en arrière et 500 000 blocs en arrière. publicnode servait `latest` en 59 ms et répondait 403 pour l'ancien bloc : « Archive requests require a personal token ». drpc, nodies et mevblocker servaient les deux. Alchemy, avec la clé du projet, répondait 429, « Monthly capacity limit exceeded ». cloudflare-eth.com trouvait une troisième façon d'échouer dans un 200, « Internal error ».

Le lecteur de LP limitait son pool Ethereum à trois tentatives, et ses trois premières entrées étaient mortes, sans archive, mortes : un nœud vivant et aucun pour un bloc ancien, alors qu'un mouvement Uniswap V4 se mesure sur l'état du pool avant son bloc. Un nœud qui sert `latest` en 59 ms et refuse 50 000 blocs en arrière passe tous les health checks habituels.

La sonde est courte, et le critère est la présence de `result`, jamais le code HTTP :

```bash
for u in https://ethereum-rpc.publicnode.com https://eth.drpc.org \
         https://cloudflare-eth.com https://rpc.ankr.com/eth https://eth.llamarpc.com; do
  r=$(curl -s -m 10 -X POST "$u" -H 'content-type: application/json' \
      -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}')
  echo "$r" | grep -q '"result"' && echo "OK $u" || echo "KO $u: $r"
done
```

## Les sept lectures dont a besoin une valorisation de position

Le 11 octobre, le fonds a ajouté Base. Les lectures d'état courant fonctionnaient via le batch public de la chaîne, mais les montants d'un mouvement V4 viennent de l'état du pool au bloc précédent, et le batch, publicnode, mainnet.base.org et Tenderly n'ont pas pu en calculer un seul : 429 Too Many Requests.

J'ai donc listé les lectures que fait la valorisation et sondé chacune avec le client de production, ethers v6, une tentative par URL : la hauteur de bloc ; le reçu d'un vrai mint V4 ; les logs d'un bloc ; `getSlot0` au bloc précédant ce mint ; quatre lectures lancées ensemble, qu'ethers envoie en un seul batch JSON-RPC, comme le fait le calcul des montants ; l'état 500 000 blocs en arrière ; l'état 5 000 000 blocs en arrière.

Sur 23 nœuds Base sans clé, trois ont tout passé depuis les deux serveurs : blastapi, avec `eth_getLogs` plafonné à 10 blocs, et les deux endpoints nodies. drpc renvoyait 500 sur un batch. publicnode renvoyait la tête de chaîne et 403 pour les reçus et l'ancien état. Tenderly répondait 429 depuis le serveur de staging et tout au vert depuis l'autre : les limites sont par IP, donc je sonde depuis chaque machine qui lira. Et le message d'erreur peut mentir sur la limite : drpc refusait 500 blocs de logs en parlant de 10 000. Mesurer la plage, ne pas la lire.

## Quand aucun nœud ne sert tout

BNB Chain, le même jour. blastapi gardait l'état 5 000 000 blocs en arrière et répondait 429 à tout `eth_getLogs`. 48.club et bloXroute servaient les logs par plages de 5 000 blocs et échouaient sur l'état du bloc précédent avec « missing revert data ». Ensemble, les nœuds servaient tout ; aucun ne servait les deux moitiés. Le backend lisait tout sur un nœud avant de passer au suivant, donc un mouvement V4 n'a jamais été calculé.

Le correctif est de découper la lecture par capacité. La phase A est ce que dit la transaction : le reçu et les logs de son bloc. La phase B est l'état autour : des lectures d'état uniquement, en batch. Chaque phase parcourt la liste et prend le premier nœud qui la sert. La sonde tourne par phase, avec les appels que fait le code : un batch contenant un `eth_getLogs` échoue sur blastapi, le même batch sans logs passe. Une lecture d'ancien état ne se mesure pas non plus avec un solde : le nœud officiel d'Avalanche renvoie `eth_getBalance` 500 000 blocs en arrière et met plus de 10 secondes pour un `eth_call` 5 000 000 blocs en arrière, donc la sonde fait un `eth_call` daté.

Conserver l'ancien état et conserver les anciens reçus sont aussi deux politiques distinctes : Alchemy sans clé, sur World Chain, servait l'état 5 000 000 blocs en arrière et `null` pour un reçu vieux d'environ neuf heures. Et sonder lourdement depuis ses propres serveurs dépense leur crédit : après une heure de sondage, le nœud officiel d'Avalanche a répondu 429 à un seul appel du serveur de staging, donc je sonde lentement, depuis une machine dont rien ne dépendra.

## Une seule source, et une alerte

THORChain et Maya n'offrent aucune liste. Le 2 octobre, j'ai essayé 14 hôtes THORNode, 5 Midgard et 6 MAYANode. Les hôtes de Nine Realms ne résolvent plus. Un THORNode gratuit répondait, la passerelle Liquify ; un Midgard, encore Liquify ; un MAYANode, celui de l'équipe Maya. Puis cinq semaines de logs du serveur de test, depuis le 24 août : 25 796 lignes citant la passerelle Liquify, zéro 429 ou rate limit, environ 430 à 500 appels par jour, une panne de cinq minutes le 27 août. La décision a été une source gratuite plus une alerte : une lecture LP illisible pendant 15 minutes envoie un e-mail et une notification à l'expert, et un message au retour. Un accès payant seulement si elle tombe. Une liste de secours d'hôtes morts coûterait une tentative à chaque failover et ne protégerait rien.

## Des lectures par son propre fournisseur, le wallet ne fait que signer

Le 7 octobre, un dépôt Uniswap V3, WBTC/WETH via Vultisig, a échoué à Confirm après le passage des deux approbations :

```
missing revert data in call exception; Transaction reverted without a reason string
(data="0x", transaction={"to":"0x2260FAC5…C599","data":"0x313ce567"}, error={"code":-32603},
code=CALL_EXCEPTION, version=providers/5.8.0)
```

On dirait une transaction annulée. Ce n'en est pas une. La `transaction` n'a ni `from`, ni gas, ni value, et quatre octets de data : c'est un `eth_call`. Le sélecteur `0x313ce567` est `decimals()` et `to` est WBTC. `data="0x"` avec le code d'erreur -32603 signifie que le RPC du wallet a répondu « Internal error », et ethers v5 traduit une réponse vide en « missing revert data ». `decimals()` sur WBTC ne peut pas être annulé. Les approbations étaient passées par le chemin de signature de l'application, avec gas et frais mesurés par le backend. Le dépôt faisait tout via le RPC du wallet : lectures, estimation du gas, `getFeeData`, approbations internes, envoi et `tx.wait()`.

La règle que je retiens : du wallet, on ne prend que le compte et la signature, rien d'autre. Toute lecture passe par mon propre fournisseur sur la chaîne cible, toute transaction par un seul chemin de signature, chacune confirmée avant la suivante. Le test est un faux wallet EIP-1193 qui répond à `eth_accounts` et `eth_chainId` et fait échouer tout le reste avec `{ code: -32603, message: 'Internal error' }` ; avant le correctif, il renvoyait mot pour mot l'erreur du client. Un endpoint public unique ne vaut pas mieux que le RPC d'un wallet : le 10 octobre, l'antivirus d'un utilisateur a fermé la connexion vers publicnode et répondu à sa place, et ethers a signalé un `CALL_EXCEPTION` sur un simple `balanceOf`. Une lecture qui compte passe par une route backend dédiée, sur notre propre domaine et nos fournisseurs. La cascade publique est un confort d'affichage.

## Ce que je retiens

- Le statut HTTP ne dit rien. Lire le corps pour `result`, et dater la sonde.
- Sonder chaque lecture que fait le code, comme le code la fait, en batch quand il fait du batch, depuis chaque serveur qui lira.
- L'état d'archive, les anciens reçus et les larges plages de logs sont trois politiques de rétention distinctes. Sonder chacune avec un bloc vraiment ancien.
- Quand aucun nœud ne sert tout, découper la lecture par capacité et prendre le premier nœud par phase.
- Une source vivante avec une alerte vaut mieux qu'une liste de fallbacks morts. Le wallet signe, et rien d'autre.
