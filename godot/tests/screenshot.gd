extends SceneTree

## Startet die Oberflaeche und legt Bilder ab - so laesst sich ohne Bildschirm
## pruefen, ob Menue, Tisch und Karten wirklich erscheinen.
##   xvfb-run -a godot --path godot --script res://tests/screenshot.gd

const OUT := "user://"


func _initialize() -> void:
	call_deferred("_run")


func _shot(name: String) -> void:
	await process_frame
	await process_frame
	await process_frame
	var image := get_root().get_texture().get_image()
	var path := "%s%s.png" % [OUT, name]
	image.save_png(path)
	print("Bild: %s (%dx%d)" % [ProjectSettings.globalize_path(path), image.get_width(), image.get_height()])


func _run() -> void:
	var scene: Control = load("res://scenes/main.tscn").instantiate()
	get_root().add_child(scene)
	await process_frame
	print("Menue steht: %s" % scene.get_child_count())
	await _shot("01_menue")

	# Solo gegen drei Bots, direkt an den Tisch.
	var players: Array = [
		{"id": "me", "name": "Du", "isBot": false},
		{"id": "b1", "name": "Ada", "isBot": true, "botLevel": "normal"},
		{"id": "b2", "name": "Bruno", "isBot": true, "botLevel": "hard"},
		{"id": "b3", "name": "Carla", "isBot": true, "botLevel": "easy"},
	]
	scene._start_local(players, "solo")
	await _shot("02_tisch")
	print("Handkarten sichtbar: %d" % scene._hand_box.get_child_count())
	print("Gegner sichtbar: %d" % scene._opponent_box.get_child_count())

	# Weiterreichen: die Hand muss verdeckt bleiben, bis bestaetigt wird.
	scene._start_local([
		{"id": "p0", "name": "Spieler 1", "isBot": false},
		{"id": "p1", "name": "Spieler 2", "isBot": false},
	], "pass")
	await _shot("03_weitergeben")
	print("Weitergabe-Sperre: %s" % (scene._overlay != null))
	print("Karten hinter der Sperre: %d" % scene._hand_box.get_child_count())

	scene.handoff_pending = false
	scene.shown_seat = scene._seat()
	scene._close_overlay()
	scene.refresh()
	await _shot("04_hand")
	print("Karten nach Bestaetigung: %d" % scene._hand_box.get_child_count())

	# Regeln und Farbwahl
	scene.show_rules()
	await _shot("05_regeln")
	scene._close_overlay()
	scene._ask_color(func(_c: String) -> void: pass)
	await _shot("06_farbwahl")
	scene._close_overlay()

	scene.show_online_setup()
	await _shot("07_online")

	quit(0)
