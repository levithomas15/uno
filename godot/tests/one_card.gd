extends SceneTree
func _initialize() -> void: call_deferred("_run")
func _run() -> void:
	var bg := ColorRect.new(); bg.color = Color("1b5e3a"); bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	get_root().add_child(bg)
	var v := CardView.new()
	v.position = Vector2(40, 40); v.size = Vector2(400, 600); v.custom_minimum_size = Vector2(400, 600)
	v.card = {"id": "x", "color": "red", "kind": "5"}
	get_root().add_child(v)
	await process_frame; await process_frame; await process_frame
	var img := get_root().get_texture().get_image()
	img.save_png("user://eine.png")
	# Mitte der Karte abtasten
	for p in [Vector2i(240, 340), Vector2i(200, 300), Vector2i(150, 250), Vector2i(240, 240)]:
		print("Pixel %s = %s" % [p, img.get_pixelv(p).to_html(false)])
	print("Bild: %s" % ProjectSettings.globalize_path("user://eine.png"))
	quit(0)
