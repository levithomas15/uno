# UNO – Web

UNO mit den Originalkarten und den Originalregeln. Läuft im Browser, ohne
Installation: `index.html` öffnen genügt für Solo und Weiterreichen, für
Online-Partien kommt der mitgelieferte Server dazu.

## Die drei Spielarten

| Spielart | Wer spielt | Was man braucht |
| --- | --- | --- |
| **Allein gegen Bots** | 1 Mensch, 1–9 Computergegner | nur den Browser |
| **Abwechselnd auf einem Handy** | 2–10 Menschen, dazu Bots | nur den Browser |
| **Online** | 2–10 Menschen an eigenen Geräten | den Server (siehe unten) |

Beim Weiterreichen bleibt die Hand zwischen zwei Zügen verdeckt: Erst wer
bestätigt, dass er an der Reihe ist, sieht seine Karten.

## Starten

```
# Solo und Weiterreichen: genügt
open index.html

# Mit Online-Partien
npm start                 # oder: node server/server.js
# http://localhost:8080
```

Im selben WLAN erreichen andere Geräte das Spiel unter
`http://<IP-des-Rechners>:8080`. Wer einen Raum eröffnet, bekommt einen
vierstelligen Code; damit treten die anderen bei. Fehlende Plätze lassen sich
mit Bots auffüllen, und wer die Verbindung verliert, kann auf seinen Platz
zurückkehren – solange die Runde läuft, spielt der Rechner ihn übergangsweise.

```
npm test                  # 16 Prüfungen, darunter komplette Bot-Partien
```

## Die Regeln

108 Karten: je Farbe eine 0, je zwei 1–9, zwei Aussetzen, zwei Retour und zwei
Zieh-Zwei, dazu vier Farbwunsch- und vier Zieh-Vier-Karten.

* Jede Person bekommt 7 Karten, eine Karte wird aufgedeckt. Ist es eine
  Zieh-Vier, wandert sie zurück ins Deck.
* Gelegt wird, was in Farbe oder Zeichen passt; Wunschkarten passen immer.
* Wer nichts legen kann, zieht eine Karte und darf sie sofort spielen.
* Zu zweit wirkt Retour wie Aussetzen.
* Zieh-Vier ist nur erlaubt, wenn keine Karte der aktiven Farbe auf der Hand
  liegt. Die nächste Person darf das anzweifeln: zu Recht angezweifelt zieht
  die Legerin 4 und die anzweifelnde Person bleibt am Zug, zu Unrecht zieht
  die anzweifelnde Person 6 und setzt aus.
* Wer die vorletzte Karte legt, ruft **UNO!**. Vergessen und erwischt heißt
  zwei Strafkarten. Das Zeitfenster endet, sobald die betroffene Person wieder
  am Zug ist.
* Punkte: Zahlen ihren Wert, Aktionskarten 20, Wunschkarten 50. Gewonnen hat,
  wer zuerst 500 Punkte erreicht.

Dazu abschaltbar zwei Hausregeln: Zieh-Karten weiterreichen und ziehen, bis es
passt. Beide sind ab Werk aus, weil sie nicht zu den Originalregeln gehören.

## Aufbau

```
index.html          Seite mit allen Ansichten
css/uno.css         Gestaltung, fürs Handy gebaut
js/engine.js        Das Regelwerk – ohne DOM, läuft auch im Server
js/bot.js           Computergegner in drei Stärken
js/cards.js         Die Karten als SVG
js/local.js         Partie auf diesem Gerät (Solo, Weiterreichen)
js/net.js           Client für die Online-Partie
js/ui.js            Der Spieltisch
js/main.js          Menü, Einstellungen, Warteraum
server/server.js    Räume, Warteraum, Spielleitung
server/websocket.js WebSocket nach RFC 6455, ohne Fremdpakete
test/               Prüfungen des Regelwerks
```

Das Regelwerk kennt weder Bildschirm noch Netz: dieselbe Datei rechnet im
Browser und im Server. Deshalb kann der Server jeden Zug nachprüfen, und
niemand sieht mehr, als er sehen darf – fremde Hände verlassen den Server nie.

## Abgrenzung

UNO ist eine Marke von Mattel. Dies ist eine private Umsetzung der Regeln und
gehört nicht zu Mattel.
