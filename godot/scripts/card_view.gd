class_name CardView
extends Control

## Eine Spielkarte, gezeichnet im Bild der Originalkarte: farbiger Grund mit
## weissem Rand, schraeges weisses Oval, grosses Zeichen in der Mitte und die
## kleinen Zeichen in zwei gegenueberliegenden Ecken.

signal pressed(card: Dictionary)

const DESIGN := Vector2(140.0, 210.0)   # Entwurfsmass, alles rechnet darin

const CARD_COLORS := {
	"red": Color("d8232f"),
	"yellow": Color("f7c800"),
	"green": Color("3ba33b"),
	"blue": Color("0a5cb8"),
	"wild": Color("101014"),
}

const SHADE := {
	"red": Color("9e161f"),
	"yellow": Color("b78f00"),
	"green": Color("27722a"),
	"blue": Color("063f80"),
	"wild": Color("000000"),
}

var card: Dictionary = {}: set = set_card
var face_down := false: set = set_face_down
var playable := false: set = set_playable
var dimmed := false: set = set_dimmed
var clickable := true

var _scale := 1.0


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_STOP
	# Nur einspringen, wenn keine Groesse gesetzt wurde - sonst wuerde
	# _ready die Vorgabe des Tisches ueberschreiben.
	if custom_minimum_size == Vector2.ZERO:
		custom_minimum_size = Vector2(88, 132)
	resized.connect(queue_redraw)


func set_card(value: Dictionary) -> void:
	card = value
	queue_redraw()


func set_face_down(value: bool) -> void:
	face_down = value
	queue_redraw()


func set_playable(value: bool) -> void:
	playable = value
	queue_redraw()


func set_dimmed(value: bool) -> void:
	dimmed = value
	modulate = Color(0.62, 0.62, 0.62) if value else Color.WHITE


func _gui_input(event: InputEvent) -> void:
	if not clickable:
		return
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		pressed.emit(card)
		accept_event()
	elif event is InputEventScreenTouch and event.pressed:
		pressed.emit(card)
		accept_event()


func _p(x: float, y: float) -> Vector2:
	return Vector2(x, y) * _scale


func _draw() -> void:
	_scale = min(size.x / DESIGN.x, size.y / DESIGN.y)
	var w := DESIGN.x * _scale
	var h := DESIGN.y * _scale

	var base: Color = CARD_COLORS["wild"] if face_down else CARD_COLORS.get(card.get("color", "wild"), CARD_COLORS["wild"])

	# Weisser Rand und farbiger Grund.
	_rounded(Rect2(0, 0, w, h), Color.WHITE, 14.0 * _scale)
	_rounded(Rect2(7 * _scale, 7 * _scale, w - 14 * _scale, h - 14 * _scale), base, 10.0 * _scale)

	if face_down:
		_ellipse(_p(70, 105), _p(58, 36), -22.0, CARD_COLORS["red"])
		_text_rotated("UNO", _p(70, 105), 40.0 * _scale, CARD_COLORS["yellow"], -22.0)
		return

	_ellipse(_p(70, 105), _p(53, 33), -22.0, Color.WHITE)

	var kind: String = card.get("kind", "0")
	var shade: Color = SHADE.get(card.get("color", "wild"), SHADE["wild"])

	if UnoEngine.is_number(card):
		_text(kind, _p(70, 105), 72.0 * _scale, base, shade, 3.0 * _scale)
	else:
		_big_glyph(kind, base)

	_corner(_p(24, 28), false)
	_corner(_p(w / _scale - 24, h / _scale - 28), true)

	if playable:
		# Ein feiner Rahmen zeigt, was gerade gelegt werden darf.
		_rounded_outline(Rect2(1, 1, w - 2, h - 2), Color("f7c800"), 14.0 * _scale, 3.0 * _scale)


func _big_glyph(kind: String, base: Color) -> void:
	var centre := _p(70, 105)
	match kind:
		"skip":
			draw_arc(centre, 23 * _scale, 0, TAU, 48, base, 9 * _scale, true)
			var d := Vector2(0.707, -0.707) * 17 * _scale
			draw_line(centre - d, centre + d, base, 9 * _scale, true)
		"reverse":
			_arrow(centre + Vector2(-12, 0).rotated(deg_to_rad(20)) * _scale, 20.0, base, 1.0)
			_arrow(centre + Vector2(12, 0).rotated(deg_to_rad(20)) * _scale, 20.0, base, -1.0)
		"draw2":
			_mini_card(base, -10.0, centre + Vector2(-10, 0) * _scale, 1.5)
			_mini_card(base, 10.0, centre + Vector2(10, 0) * _scale, 1.5)
		"wild":
			_wild_circle(centre, 25 * _scale)
		"wild4":
			_mini_card(CARD_COLORS["blue"], -12.0, centre + Vector2(-11, -12) * _scale, 0.95)
			_mini_card(CARD_COLORS["red"], 12.0, centre + Vector2(11, -12) * _scale, 0.95)
			_mini_card(CARD_COLORS["yellow"], -12.0, centre + Vector2(-11, 12) * _scale, 0.95)
			_mini_card(CARD_COLORS["green"], 12.0, centre + Vector2(11, 12) * _scale, 0.95)
		_:
			pass


## Die kleinen Zeichen in den Ecken - unten steht alles auf dem Kopf.
func _corner(at: Vector2, flipped: bool) -> void:
	var kind: String = card.get("kind", "0")
	var label := kind
	if kind == "wild4":
		label = "+4"
	elif kind == "draw2":
		label = "+2"

	if UnoEngine.is_number(card) or kind == "wild4" or kind == "draw2":
		_text_rotated(label, at, 30.0 * _scale, Color.WHITE, 180.0 if flipped else 0.0)
		return

	match kind:
		"skip":
			draw_arc(at, 9 * _scale, 0, TAU, 24, Color.WHITE, 3.5 * _scale, true)
			var d := Vector2(0.707, -0.707) * 6.6 * _scale
			draw_line(at - d, at + d, Color.WHITE, 3.5 * _scale, true)
		"reverse":
			_arrow(at + Vector2(-4.5, 0).rotated(deg_to_rad(20)) * _scale, 7.5, Color.WHITE, 1.0)
			_arrow(at + Vector2(4.5, 0).rotated(deg_to_rad(20)) * _scale, 7.5, Color.WHITE, -1.0)
		"wild":
			_wild_circle(at, 9 * _scale)
		_:
			pass


## Ein Pfeil für die Retour-Karte; dir = 1 zeigt nach oben, -1 nach unten.
func _arrow(at: Vector2, length: float, color: Color, dir: float) -> void:
	var s := length * _scale / 12.0
	var pts := PackedVector2Array([
		Vector2(-3.5, 11), Vector2(-3.5, -3), Vector2(-8.5, -3), Vector2(0, -13),
		Vector2(8.5, -3), Vector2(3.5, -3), Vector2(3.5, 11),
	])
	var out := PackedVector2Array()
	for p in pts:
		out.append(at + (p * s * dir).rotated(deg_to_rad(20)))
	draw_colored_polygon(out, color)


## Eine kleine Karte, wie sie auf Zieh-Zwei und Zieh-Vier abgebildet ist.
func _mini_card(color: Color, rotation_deg: float, at: Vector2, scale_factor: float) -> void:
	var half := Vector2(8.5, 12.5) * _scale * scale_factor
	var pts := PackedVector2Array([
		Vector2(-half.x, -half.y), Vector2(half.x, -half.y),
		Vector2(half.x, half.y), Vector2(-half.x, half.y),
	])
	var out := PackedVector2Array()
	var outline := PackedVector2Array()
	for p in pts:
		var v: Vector2 = at + p.rotated(deg_to_rad(rotation_deg))
		out.append(v)
		outline.append(v)
	outline.append(out[0])
	draw_colored_polygon(out, color)
	draw_polyline(outline, Color.WHITE, 2.5 * _scale, true)


## Der vierfarbige Kreis der Farbwunsch-Karte.
func _wild_circle(at: Vector2, radius: float) -> void:
	var quads := [
		[180.0, CARD_COLORS["red"]], [270.0, CARD_COLORS["blue"]],
		[0.0, CARD_COLORS["yellow"]], [90.0, CARD_COLORS["green"]],
	]
	for q in quads:
		var start: float = deg_to_rad(q[0])
		var pts := PackedVector2Array([at])
		for i in 13:
			var a: float = start + deg_to_rad(90.0) * (float(i) / 12.0)
			pts.append(at + Vector2(cos(a), sin(a)) * radius)
		draw_colored_polygon(pts, q[1])
	draw_arc(at, radius, 0, TAU, 48, Color.WHITE, 2.0 * _scale, true)


func _ellipse(at: Vector2, radii: Vector2, rotation_deg: float, color: Color) -> void:
	var pts := PackedVector2Array()
	for i in 48:
		var a := TAU * float(i) / 48.0
		pts.append(at + Vector2(cos(a) * radii.x, sin(a) * radii.y).rotated(deg_to_rad(rotation_deg)))
	draw_colored_polygon(pts, color)


func _rounded(rect: Rect2, color: Color, radius: float) -> void:
	var box := StyleBoxFlat.new()
	box.bg_color = color
	box.set_corner_radius_all(int(radius))
	draw_style_box(box, rect)


func _rounded_outline(rect: Rect2, color: Color, radius: float, width: float) -> void:
	var box := StyleBoxFlat.new()
	box.bg_color = Color(0, 0, 0, 0)
	box.set_corner_radius_all(int(radius))
	box.set_border_width_all(int(width))
	box.border_color = color
	draw_style_box(box, rect)


func _font() -> Font:
	return get_theme_default_font()


func _text(text: String, at: Vector2, font_size: float, color: Color, outline: Color, outline_width: float) -> void:
	var font := _font()
	var size_px := int(font_size)
	var measured := font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, size_px)
	# Grundlinie so legen, dass die Ziffer mittig im Oval sitzt.
	var baseline := (font.get_ascent(size_px) - font.get_descent(size_px)) / 2.0
	var pos := Vector2(at.x - measured.x / 2.0, at.y + baseline)
	if outline_width > 0.0:
		draw_string_outline(font, pos, text, HORIZONTAL_ALIGNMENT_LEFT, -1, size_px, int(outline_width), outline)
	draw_string(font, pos, text, HORIZONTAL_ALIGNMENT_LEFT, -1, size_px, color)


func _text_rotated(text: String, at: Vector2, font_size: float, color: Color, rotation_deg: float) -> void:
	draw_set_transform(at, deg_to_rad(rotation_deg), Vector2.ONE)
	var font := _font()
	var size_px := int(font_size)
	var measured := font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, size_px)
	var baseline := (font.get_ascent(size_px) - font.get_descent(size_px)) / 2.0
	draw_string(font, Vector2(-measured.x / 2.0, baseline), text, HORIZONTAL_ALIGNMENT_LEFT, -1, size_px, color)
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
