# Dieses Repository

Zwei getrennte Projekte:

* **[uno/](uno/)** – UNO mit den Originalkarten: allein gegen Bots,
  abwechselnd auf einem Handy oder online zu 2 bis 10. Läuft im Browser.
* **[godot/](godot/)** – dasselbe Spiel als Godot-Projekt (Godot 4.3), das
  sich denselben Online-Server teilt.
* **[index.html](index.html)** – „Wer findet mich?“, die Seite zur
  Selbstauskunft. Beschreibung unten.

---

# Wer findet mich?

Eine Webseite zur **Selbstauskunft**: Prüfe, wo dein eigenes Gesicht im Netz
auftaucht – und lass die Treffer entfernen.

Kein Build, kein Server, keine Abhängigkeiten. `index.html` im Browser öffnen
genügt.

## Was die Seite macht

1. **Foto laden** – lokale Datei (per Drag & Drop, Dateiauswahl oder Einfügen)
   oder eine Bild-Adresse.
2. **Gesicht zuschneiden** – ein enger Ausschnitt bringt deutlich bessere
   Treffer als ein Ganzkörperbild.
3. **Suche starten** – Google Lens, Bing Visual Search, Yandex und TinEye.
   Mit einer Bild-Adresse geht die Suche direkt los; bei einer lokalen Datei
   öffnet sich die Upload-Seite des Dienstes, in die du das Bild einfügst.
4. **Löschen lassen** – Anlaufstellen für Seitenbetreiber, Suchmaschinen und
   Notfälle, dazu ein Musterschreiben nach Art. 17 DSGVO.
5. **Weniger auffindbar werden** – Checkliste für die eigenen Konten.

## Datenschutz

Das Bild verlässt den Browser nicht. Es gibt keinen Server, der es entgegen-
nehmen könnte: Laden, Zuschneiden und Vorschau passieren auf einem `<canvas>`.
Erst wenn du eine Suchmaschinen-Kachel anklickst, öffnet sich ein neuer Tab
bei diesem Anbieter – von da an gelten dessen Regeln.

Gespeichert wird lediglich der Stand der Checkliste, in `localStorage` dieses
einen Browsers.

## Abgrenzung

Diese Seite sucht **nur nach der eigenen Person**. Sie durchsucht keine
Plattformen im Hintergrund, legt keine Gesichtsdatenbank an und ordnet keinem
fremden Gesicht Konten zu.

Das ist eine bewusste Entscheidung, keine technische Lücke. Ein Werkzeug, das
Unbeteiligte anhand eines Fotos identifiziert, ist das Handwerkszeug von
Stalking und Doxxing – und in der EU ohne Einwilligung ohnehin unzulässig, weil
Art. 9 DSGVO biometrische Daten als besonders schützenswert einstuft. Die
Plattformen selbst (TikTok, Instagram, Facebook, YouTube …) bieten eine
Gesichtssuche über ihre Nutzer aus demselben Grund nicht an.

## Entwicklung

```
python3 -m http.server 8000
# http://localhost:8000
```

Dateien:

```
index.html          Aufbau der Seite
assets/styles.css   Gestaltung, hell und dunkel
assets/app.js       Laden, Zuschneiden, Suchlinks, Musterschreiben
```
