extends SceneTree

## Legt ein Blatt mit allen Kartenarten ab, um das Kartenbild zu pruefen.

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	var bg := ColorRect.new()
	bg.color = Color("1b5e3a")
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.add_child(bg)
	var grid := GridContainer.new()
	grid.columns = 7
	grid.add_theme_constant_override("h_separation", 8)
	grid.add_theme_constant_override("v_separation", 8)
	grid.position = Vector2(10, 10)
	root.add_child(grid)

	var cards: Array = []
	for color in ["red", "yellow", "green", "blue"]:
		for kind in ["0", "7", "skip", "reverse", "draw2"]:
			cards.append({"id": "x", "color": color, "kind": kind})
	cards.append({"id": "w", "color": "wild", "kind": "wild"})
	cards.append({"id": "w4", "color": "wild", "kind": "wild4"})
	for c in cards:
		var view := CardView.new()
		view.custom_minimum_size = Vector2(140, 210)
		view.card = c
		grid.add_child(view)
	var back := CardView.new()
	back.custom_minimum_size = Vector2(140, 210)
	back.face_down = true
	grid.add_child(back)

	get_root().add_child(root)
	await process_frame
	await process_frame
	await process_frame
	var image := get_root().get_texture().get_image()
	image.save_png("user://karten.png")
	print("Kartenblatt: %s" % ProjectSettings.globalize_path("user://karten.png"))
	quit(0)
