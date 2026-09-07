# UNO – Godot

Dieselbe Partie als Godot-Projekt: allein gegen Bots, abwechselnd auf einem
Gerät und online über den Server aus `../uno/`.

## Öffnen und spielen

```
godot --path godot            # startet das Spiel
godot -e --path godot         # öffnet es im Editor
```

Im Projektmanager von Godot stattdessen einfach diesen Ordner auswählen.
Gebaut mit **Godot 4.3**; Renderer ist „Compatibility“, damit es auch auf
älteren Geräten und auf Android läuft.

Für Online-Partien muss der Server laufen:

```
cd ../uno && npm start
```

Im Spiel unter „Online“ die Adresse eintragen – im selben WLAN etwa
`ws://192.168.1.20:8080/ws`. Godot- und Browser-Spieler können am selben Tisch
sitzen: beide sprechen dasselbe Protokoll.

## Prüfen

```
godot --headless --path godot --script res://tests/run_tests.gd    # Regelwerk
xvfb-run -a godot --path godot --script res://tests/play_test.gd   # Partie über die Oberfläche
xvfb-run -a godot --path godot --script res://tests/screenshot.gd  # Bilder ablegen
```

## Aufbau

```
project.godot          Projekteinstellungen (Hochformat, 720x1280)
scenes/main.tscn       Einstiegsszene
scripts/engine.gd      Das Regelwerk, Zug um Zug wie in der Web-Fassung
scripts/bot.gd         Computergegner in drei Stärken
scripts/card_view.gd   Die Karte, gezeichnet wie das Original
scripts/net.gd         WebSocket-Client für Online-Partien
scripts/app.gd         Menü, Vorbereitung, Warteraum, Spieltisch
tests/                 Regelprüfungen, Durchspieltest, Bildschirmfotos
```

`engine.gd` gibt seine Sicht im selben Aufbau aus wie der Web-Server
(`view_for`). Deshalb zeigt derselbe Tisch lokale und Online-Partien.

## Abgrenzung

UNO ist eine Marke von Mattel. Dies ist eine private Umsetzung der Regeln und
gehört nicht zu Mattel.
