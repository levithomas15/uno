extends Control

## UNO - der Rahmen: Menü, Vorbereitung, Warteraum und Spieltisch.
##
## Drei Spielarten, ein Tisch: allein gegen Bots, abwechselnd auf einem
## Gerät und online zu 2 bis 10. Lokal rechnet UnoEngine mit, online
## fuehrt der Server das Spiel - der Tisch zeigt in beiden Faellen
## dieselbe Sicht.

const FELT := Color("1b5e3a")
const FELT_DARK := Color("123f28")
const PAPER := Color("f5f6f8")
const YELLOW := Color("f7c800")
const RED := Color("d8232f")
const MUTED := Color("bcd3c4")
const PANEL_BG := Color(0, 0, 0, 0.32)

const BOT_NAMES := ["Ada", "Bruno", "Carla", "Deniz", "Ella", "Franz", "Gina", "Hakan", "Ida"]
const BOT_DELAY := 0.9
const BOT_CATCH_DELAY := 1.5
const DEFAULT_SERVER := "ws://127.0.0.1:8080/ws"

var engine: UnoEngine = null
var net: UnoNet = null
var rng := RandomNumberGenerator.new()

var mode := ""              # "solo" | "pass" | "online"
var shown_seat := -1        # wem das Gerät gerade gehoert (Weiterreichen)
var handoff_pending := false
var uno_armed := false
var online_view: Dictionary = {}
var online_lobby: Dictionary = {}
var player_name := "Du"
var options: Dictionary = {"targetScore": 500, "challenge": true, "stacking": false, "drawUntilPlayable": false}

var _screen: Control = null
var _overlay: Control = null
var _bot_timer: Timer = null
var _catch_timer: Timer = null

# Knoten des Tisches, die bei jeder Aenderung neu befuellt werden
var _opponent_box: HBoxContainer = null
var _hand_box: HBoxContainer = null
var _controls_box: HBoxContainer = null
var _turn_label: Label = null
var _title_label: Label = null
var _draw_card: CardView = null
var _discard_card: CardView = null
var _color_dots: HBoxContainer = null
var _pile_note: Label = null


func _ready() -> void:
	rng.randomize()
	set_anchors_preset(Control.PRESET_FULL_RECT)

	var bg := ColorRect.new()
	bg.color = FELT
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(bg)

	_bot_timer = Timer.new()
	_bot_timer.one_shot = true
	_bot_timer.timeout.connect(_on_bot_timer)
	add_child(_bot_timer)

	_catch_timer = Timer.new()
	_catch_timer.one_shot = true
	_catch_timer.timeout.connect(_on_catch_timer)
	add_child(_catch_timer)

	show_menu()


func _process(_delta: float) -> void:
	if net != null:
		net.poll()


# ----------------------------------------------------------------- Bausteine

func _clear_children(node: Node) -> void:
	# queue_free() laesst die Knoten bis zum Bildende im Baum - beim
	# Neuzeichnen wuerden sie sich sonst stapeln.
	for child in node.get_children():
		node.remove_child(child)
		child.queue_free()


func _clear_screen() -> void:
	if _screen != null:
		_screen.queue_free()
		_screen = null
	_close_overlay()


func _new_screen(with_margin := true) -> VBoxContainer:
	_clear_screen()
	var root := MarginContainer.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	if with_margin:
		for side in ["margin_left", "margin_right", "margin_top", "margin_bottom"]:
			root.add_theme_constant_override(side, 26)
	add_child(root)
	_screen = root

	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 14)
	root.add_child(box)
	return box


func _title(text: String, size := 34) -> Label:
	var label := Label.new()
	label.text = text
	label.add_theme_font_size_override("font_size", size)
	label.add_theme_color_override("font_color", PAPER)
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	return label


func _note(text: String, size := 18, color := MUTED) -> Label:
	var label := Label.new()
	label.text = text
	label.add_theme_font_size_override("font_size", size)
	label.add_theme_color_override("font_color", color)
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	return label


func _button(text: String, action: Callable, kind := "normal") -> Button:
	var button := Button.new()
	button.text = text
	button.custom_minimum_size = Vector2(0, 54)
	button.add_theme_font_size_override("font_size", 20)

	var box := StyleBoxFlat.new()
	box.set_corner_radius_all(27)
	match kind:
		"primary":
			box.bg_color = YELLOW
			button.add_theme_color_override("font_color", Color("1a1400"))
			button.add_theme_color_override("font_hover_color", Color("1a1400"))
			button.add_theme_color_override("font_pressed_color", Color("1a1400"))
		"danger":
			box.bg_color = RED
			button.add_theme_color_override("font_color", Color.WHITE)
		"ghost":
			box.bg_color = Color(1, 1, 1, 0.08)
			box.set_border_width_all(2)
			box.border_color = Color(1, 1, 1, 0.22)
			button.add_theme_color_override("font_color", PAPER)
		_:
			box.bg_color = Color(1, 1, 1, 0.14)
			button.add_theme_color_override("font_color", PAPER)

	button.add_theme_stylebox_override("normal", box)
	var hover := box.duplicate()
	hover.bg_color = box.bg_color.lightened(0.08)
	button.add_theme_stylebox_override("hover", hover)
	var pressed_box := box.duplicate()
	pressed_box.bg_color = box.bg_color.darkened(0.12)
	button.add_theme_stylebox_override("pressed", pressed_box)
	button.add_theme_stylebox_override("focus", StyleBoxEmpty.new())

	if action.is_valid():
		button.pressed.connect(action)
	return button


func _panel(child: Control) -> PanelContainer:
	var panel := PanelContainer.new()
	var box := StyleBoxFlat.new()
	box.bg_color = PANEL_BG
	box.set_corner_radius_all(16)
	box.set_border_width_all(2)
	box.border_color = Color(1, 1, 1, 0.16)
	box.set_content_margin_all(16)
	panel.add_theme_stylebox_override("panel", box)
	panel.add_child(child)
	return panel


func _option_button(items: Array, selected := 0, on_change := Callable()) -> OptionButton:
	var picker := OptionButton.new()
	picker.custom_minimum_size = Vector2(0, 48)
	picker.add_theme_font_size_override("font_size", 19)
	for item in items:
		picker.add_item(String(item))
	picker.selected = selected
	if on_change.is_valid():
		picker.item_selected.connect(func(index: int) -> void: on_change.call(index))
	return picker


func _line_edit(text: String, placeholder := "") -> LineEdit:
	var edit := LineEdit.new()
	edit.text = text
	edit.placeholder_text = placeholder
	edit.custom_minimum_size = Vector2(0, 48)
	edit.add_theme_font_size_override("font_size", 20)
	edit.max_length = 14
	return edit


# -------------------------------------------------------------------- Menü

func show_menu() -> void:
	_stop_game()
	var box := _new_screen()
	box.alignment = BoxContainer.ALIGNMENT_CENTER

	# Das Logo ist schlicht die Rückseite einer Karte.
	var logo_row := HBoxContainer.new()
	logo_row.alignment = BoxContainer.ALIGNMENT_CENTER
	var logo := CardView.new()
	logo.custom_minimum_size = Vector2(170, 255)
	logo.face_down = true
	logo.clickable = false
	logo_row.add_child(logo)
	box.add_child(logo_row)
	box.add_child(_note(
		"Die Originalkarten, die Originalregeln. Spiel allein gegen den Rechner, "
		+ "reich das Gerät reihum weiter oder tritt zu zehnt online an.", 19))

	var spacer := Control.new()
	spacer.custom_minimum_size = Vector2(0, 18)
	box.add_child(spacer)

	box.add_child(_button("Allein gegen Bots", show_solo_setup, "primary"))
	box.add_child(_button("Abwechselnd auf einem Gerät", show_pass_setup))
	box.add_child(_button("Online zu 2 bis 10", show_online_setup))
	box.add_child(_button("Die Regeln", show_rules, "ghost"))


func show_rules() -> void:
	var text := """Karten
108 Karten: je Farbe eine 0, je zwei 1 bis 9, zwei Aussetzen, zwei Retour und
zwei Zieh-Zwei, dazu vier Farbwunsch- und vier Zieh-Vier-Karten.

Ablauf
Jede Person bekommt 7 Karten, eine Karte wird aufgedeckt. Gelegt wird, was in
Farbe oder Zeichen passt; Wunschkarten passen immer. Wer nichts legen kann,
zieht eine Karte und darf sie sofort spielen. Zu zweit wirkt Retour wie
Aussetzen. Zieh-Vier ist nur erlaubt, wenn keine Karte der aktiven Farbe auf
der Hand liegt - die nächste Person darf das anzweifeln.

UNO!
Wer die vorletzte Karte legt, ruft UNO. Vergessen und erwischt heißt zwei
Strafkarten.

Punkte
Wer zuerst alle Karten los ist, bekommt die Handkarten der anderen
gutgeschrieben: Zahlen ihren Wert, Aktionskarten 20, Wunschkarten 50.
Gewonnen hat, wer zuerst 500 Punkte erreicht.

UNO ist eine Marke von Mattel. Dieses Projekt gehoert nicht zu Mattel."""
	_show_overlay("Die Regeln", text, [{"text": "Schließen", "kind": "primary", "action": _close_overlay}])


# -------------------------------------------------------------- Vorbereitung

func _options_panel(box: VBoxContainer) -> void:
	var inner := VBoxContainer.new()
	inner.add_theme_constant_override("separation", 10)
	inner.add_child(_note("Einstellungen", 20, PAPER))

	var targets := [500, 300, 0]
	var target_index := targets.find(int(options["targetScore"]))
	inner.add_child(_option_button(
		["Spiel geht bis 500 Punkte", "Spiel geht bis 300 Punkte", "Nur eine Runde"],
		max(target_index, 0),
		func(index: int) -> void: options["targetScore"] = targets[index]))

	var challenge := CheckBox.new()
	challenge.text = "Zieh Vier darf angezweifelt werden"
	challenge.button_pressed = options["challenge"]
	challenge.add_theme_font_size_override("font_size", 18)
	challenge.toggled.connect(func(on: bool) -> void: options["challenge"] = on)
	inner.add_child(challenge)

	var stacking := CheckBox.new()
	stacking.text = "Hausregel: Zieh-Karten weiterreichen"
	stacking.button_pressed = options["stacking"]
	stacking.add_theme_font_size_override("font_size", 18)
	stacking.toggled.connect(func(on: bool) -> void: options["stacking"] = on)
	inner.add_child(stacking)

	box.add_child(_panel(inner))


func show_solo_setup() -> void:
	var box := _new_screen()
	box.add_child(_title("Allein gegen Bots"))

	var inner := VBoxContainer.new()
	inner.add_theme_constant_override("separation", 10)
	inner.add_child(_note("Dein Name", 17))
	var name_edit := _line_edit(player_name)
	inner.add_child(name_edit)

	inner.add_child(_note("Gegner", 17))
	var bots := 3
	var bot_items: Array = []
	for i in range(1, 10):
		bot_items.append("%d Bot%s" % [i, "" if i == 1 else "s"])
	inner.add_child(_option_button(bot_items, 2, func(index: int) -> void: bots = index + 1))

	inner.add_child(_note("Spielstärke", 17))
	var levels := ["easy", "normal", "hard"]
	var level := "normal"
	inner.add_child(_option_button(
		["Leicht - spielt drauflos", "Normal - achtet auf Farben", "Schwer - zählt mit"],
		1, func(index: int) -> void: level = levels[index]))
	box.add_child(_panel(inner))

	_options_panel(box)

	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	row.add_child(_button("Zurück", show_menu, "ghost"))
	var start := _button("Spiel starten", func() -> void:
		player_name = name_edit.text.strip_edges()
		if player_name.is_empty():
			player_name = "Du"
		var players: Array = [{"id": "me", "name": player_name, "isBot": false}]
		for i in bots:
			players.append({"id": "bot%d" % i, "name": BOT_NAMES[i % BOT_NAMES.size()], "isBot": true, "botLevel": level})
		_start_local(players, "solo"), "primary")
	start.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(start)
	box.add_child(row)


func show_pass_setup() -> void:
	var box := _new_screen()
	box.add_child(_title("Abwechselnd auf einem Gerät"))
	box.add_child(_note("Das Gerät wandert reihum. Zwischen zwei Zuegen bleibt die Hand verdeckt."))

	var inner := VBoxContainer.new()
	inner.add_theme_constant_override("separation", 10)
	var humans := 2
	var bots := 1

	inner.add_child(_note("Menschen am Tisch", 17))
	var human_items: Array = []
	for i in range(1, 11):
		human_items.append("%d" % i)
	inner.add_child(_option_button(human_items, 1, func(index: int) -> void: humans = index + 1))

	inner.add_child(_note("Dazu Bots", 17))
	var bot_items: Array = []
	for i in range(0, 10):
		bot_items.append("%d" % i)
	inner.add_child(_option_button(bot_items, 1, func(index: int) -> void: bots = index))
	box.add_child(_panel(inner))

	_options_panel(box)

	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	row.add_child(_button("Zurück", show_menu, "ghost"))
	var start := _button("Spiel starten", func() -> void:
		var total := humans + bots
		if total < 2:
			_show_overlay("Zu wenige", "UNO wird zu mindestens zweit gespielt.",
				[{"text": "Gut", "kind": "primary", "action": _close_overlay}])
			return
		if total > 10:
			_show_overlay("Zu viele", "An den Tisch passen hoechstens zehn.",
				[{"text": "Gut", "kind": "primary", "action": _close_overlay}])
			return
		var players: Array = []
		for i in humans:
			players.append({"id": "p%d" % i, "name": "Spieler %d" % (i + 1), "isBot": false})
		for i in bots:
			players.append({"id": "b%d" % i, "name": BOT_NAMES[i % BOT_NAMES.size()], "isBot": true, "botLevel": "normal"})
		_start_local(players, "pass"), "primary")
	start.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(start)
	box.add_child(row)


func show_online_setup() -> void:
	var box := _new_screen()
	box.add_child(_title("Online spielen"))

	var inner := VBoxContainer.new()
	inner.add_theme_constant_override("separation", 10)
	inner.add_child(_note("Dein Name", 17))
	var name_edit := _line_edit(player_name)
	inner.add_child(name_edit)

	inner.add_child(_note("Serveradresse", 17))
	var url_edit := _line_edit(DEFAULT_SERVER)
	url_edit.max_length = 120
	inner.add_child(url_edit)
	inner.add_child(_note("Das ist der Server aus dem Ordner uno/: npm start startet ihn.", 15))

	inner.add_child(_button("Raum eröffnen", func() -> void:
		player_name = name_edit.text.strip_edges()
		_online_connect(url_edit.text.strip_edges(), "", player_name), "primary"))

	inner.add_child(_note("Raum-Code", 17))
	var code_edit := _line_edit("", "ABCD")
	code_edit.max_length = 4
	inner.add_child(code_edit)
	inner.add_child(_button("Beitreten", func() -> void:
		player_name = name_edit.text.strip_edges()
		_online_connect(url_edit.text.strip_edges(), code_edit.text.strip_edges().to_upper(), player_name)))
	box.add_child(_panel(inner))

	_options_panel(box)
	box.add_child(_button("Zurück", show_menu, "ghost"))


# ------------------------------------------------------------ Partie starten

func _start_local(players: Array, game_mode: String) -> void:
	_stop_game()
	mode = game_mode
	engine = UnoEngine.new()
	engine.create_game(players, options, rng.randi())
	shown_seat = -1
	handoff_pending = mode == "pass"
	build_table()
	refresh()
	_schedule_bot()


func _stop_game() -> void:
	_bot_timer.stop()
	_catch_timer.stop()
	engine = null
	uno_armed = false
	if net != null:
		net.leave()
		net = null
	online_view = {}
	online_lobby = {}


## Wer ist gefragt, und welchen Platz zeigt das Gerät?
func _actor() -> int:
	if mode == "online":
		if online_view.is_empty():
			return -1
		var phase: String = online_view.get("phase", "")
		if phase == "challenge" and online_view.get("pendingWild4") != null:
			return int(online_view["pendingWild4"]["target"])
		if phase == "round-over" or phase == "game-over":
			return -1
		return int(online_view.get("current", -1))
	if engine == null:
		return -1
	return engine.actor_index()


func _seat() -> int:
	if mode == "online":
		return int(online_view.get("you", -1)) if not online_view.is_empty() else -1
	if engine == null:
		return -1
	if mode == "solo":
		for i in engine.state["players"].size():
			if not engine.state["players"][i]["isBot"]:
				return i
		return 0
	var actor := _actor()
	if actor < 0:
		return shown_seat
	return -1 if engine.state["players"][actor]["isBot"] else actor


func _view() -> Dictionary:
	if mode == "online":
		return online_view
	if engine == null:
		return {}
	var seat := _seat()
	if handoff_pending or seat < 0:
		return engine.view_for(-1)   # während des Weiterreichens bleibt alles verdeckt
	return engine.view_for(seat)


## Ein Zug der Person, der das Gerät gerade gehoert.
func _send(action: Dictionary) -> void:
	if mode == "online":
		if net != null:
			net.play(action)
		return
	if engine == null:
		return
	var seat := _seat()
	if handoff_pending or seat < 0:
		return
	var res := engine.apply_action(seat, action)
	if not res["ok"]:
		_toast(res["error"])
		return
	if mode == "pass":
		shown_seat = seat
		_check_handoff()
	refresh()
	_schedule_bot()


func _check_handoff() -> void:
	if mode != "pass":
		handoff_pending = false
		return
	var seat := _seat()
	if seat < 0:
		handoff_pending = false
		return
	if seat != shown_seat:
		handoff_pending = true


func _schedule_bot() -> void:
	if mode == "online" or engine == null:
		return
	if engine.state["unoVulnerable"] != null:
		_catch_timer.start(BOT_CATCH_DELAY)
	var actor := _actor()
	if actor < 0:
		return
	if engine.state["players"][actor]["isBot"]:
		_bot_timer.start(BOT_DELAY)


func _on_bot_timer() -> void:
	if engine == null:
		return
	var actor := _actor()
	if actor < 0 or not engine.state["players"][actor]["isBot"]:
		return
	var action := UnoBot.action_for(engine, actor, rng)
	if action.is_empty():
		action = {"type": "draw"}
	var res := engine.apply_action(actor, action)
	if not res["ok"]:
		engine.apply_action(actor, {"type": "draw"})
	_check_handoff()
	refresh()
	_schedule_bot()


func _on_catch_timer() -> void:
	if engine == null or engine.state["unoVulnerable"] == null:
		return
	for i in engine.state["players"].size():
		if not engine.state["players"][i]["isBot"]:
			continue
		var c := UnoBot.catch_for(engine, i, rng)
		if not c.is_empty():
			engine.apply_action(i, c)
			refresh()
			break


# ------------------------------------------------------------------- Online

func _online_connect(url: String, room_code: String, name: String) -> void:
	if name.is_empty():
		_toast("Trag bitte einen Namen ein.")
		return
	if room_code.length() > 0 and room_code.length() != 4:
		_toast("Der Raum-Code hat vier Zeichen.")
		return
	_stop_game()
	mode = "online"
	net = UnoNet.new()
	net.welcomed.connect(func(_code: String, _you: String) -> void: show_lobby())
	net.lobby_changed.connect(_on_lobby)
	net.state_changed.connect(_on_online_state)
	net.failed.connect(func(message: String) -> void: _toast(message))
	net.noticed.connect(func(message: String) -> void: _toast(message))
	net.closed.connect(func(message: String) -> void:
		_toast(message)
		show_menu())
	net.connect_to_server(url)
	if room_code.is_empty():
		net.create_room(name, options)
	else:
		net.join_room(room_code, name)
	_show_waiting("Verbinde mit %s ..." % url)


func _on_lobby(lobby: Dictionary) -> void:
	online_lobby = lobby
	if not bool(lobby.get("started", false)):
		show_lobby()


func _on_online_state(view: Dictionary) -> void:
	online_view = view
	if _hand_box == null or not is_instance_valid(_hand_box):
		build_table()
	refresh()


func _show_waiting(text: String) -> void:
	var box := _new_screen()
	box.alignment = BoxContainer.ALIGNMENT_CENTER
	box.add_child(_title("Moment", 30))
	box.add_child(_note(text, 19))
	box.add_child(_button("Abbrechen", show_menu, "ghost"))


func show_lobby() -> void:
	var box := _new_screen()
	box.add_child(_title("Warteraum"))

	var inner := VBoxContainer.new()
	inner.add_theme_constant_override("separation", 8)
	inner.add_child(_note("Diesen Code weitergeben:", 17))
	var code_label := _title(online_lobby.get("code", net.code if net != null else "----"), 44)
	code_label.add_theme_color_override("font_color", YELLOW)
	inner.add_child(code_label)
	box.add_child(_panel(inner))

	var list := VBoxContainer.new()
	list.add_theme_constant_override("separation", 6)
	list.add_child(_note("Am Tisch", 20, PAPER))
	var host_id: String = String(online_lobby.get("host", ""))
	var me: String = net.you if net != null else ""
	for p in online_lobby.get("players", []):
		var line := "%s%s%s" % [
			p.get("name", "?"),
			"  (Bot)" if p.get("isBot", false) else "",
			"  - Gastgeber" if String(p.get("id", "")) == host_id else "",
		]
		var label := _note(line, 19, YELLOW if String(p.get("id", "")) == me else PAPER)
		list.add_child(label)
	box.add_child(_panel(list))

	var is_host := host_id == me and not host_id.is_empty()
	if is_host:
		var tools := HBoxContainer.new()
		tools.add_theme_constant_override("separation", 10)
		tools.add_child(_button("Bot dazu", func() -> void: net.add_bot("normal"), "ghost"))
		tools.add_child(_button("Bot weg", func() -> void: net.remove_bot(), "ghost"))
		box.add_child(tools)

	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	row.add_child(_button("Verlassen", show_menu, "ghost"))
	var players_count: int = online_lobby.get("players", []).size()
	var start := _button(
		"Spiel starten" if is_host else "Der Gastgeber startet",
		func() -> void: net.start_game(), "primary")
	start.disabled = not is_host or players_count < 2
	start.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(start)
	box.add_child(row)


# ------------------------------------------------------------------- Tisch

func build_table() -> void:
	_clear_screen()
	var root := VBoxContainer.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.add_theme_constant_override("separation", 0)
	add_child(root)
	_screen = root

	# Kopfzeile
	var top := HBoxContainer.new()
	top.add_theme_constant_override("separation", 8)
	var top_margin := MarginContainer.new()
	for side in ["margin_left", "margin_right", "margin_top", "margin_bottom"]:
		top_margin.add_theme_constant_override(side, 10)
	_title_label = _note("UNO", 20, PAPER)
	_title_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	top.add_child(_title_label)
	var log_button := _button("Verlauf", _show_log, "ghost")
	log_button.custom_minimum_size = Vector2(0, 40)
	top.add_child(log_button)
	var quit_button := _button("Beenden", show_menu, "ghost")
	quit_button.custom_minimum_size = Vector2(0, 40)
	top.add_child(quit_button)
	top_margin.add_child(top)
	root.add_child(top_margin)

	# Gegner
	var opp_scroll := ScrollContainer.new()
	opp_scroll.custom_minimum_size = Vector2(0, 108)
	opp_scroll.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_opponent_box = HBoxContainer.new()
	_opponent_box.add_theme_constant_override("separation", 8)
	opp_scroll.add_child(_opponent_box)
	root.add_child(opp_scroll)

	# Mitte: Farbe, Stapel, Hinweis
	var middle := VBoxContainer.new()
	middle.size_flags_vertical = Control.SIZE_EXPAND_FILL
	middle.alignment = BoxContainer.ALIGNMENT_CENTER
	middle.add_theme_constant_override("separation", 14)

	_color_dots = HBoxContainer.new()
	_color_dots.alignment = BoxContainer.ALIGNMENT_CENTER
	_color_dots.add_theme_constant_override("separation", 10)
	middle.add_child(_color_dots)

	var piles := HBoxContainer.new()
	piles.alignment = BoxContainer.ALIGNMENT_CENTER
	piles.add_theme_constant_override("separation", 34)
	_draw_card = CardView.new()
	_draw_card.custom_minimum_size = Vector2(132, 198)
	_draw_card.face_down = true
	_draw_card.pressed.connect(func(_c: Dictionary) -> void: _send({"type": "draw"}))
	piles.add_child(_draw_card)
	_discard_card = CardView.new()
	_discard_card.custom_minimum_size = Vector2(132, 198)
	_discard_card.clickable = false
	piles.add_child(_discard_card)
	middle.add_child(piles)

	_pile_note = _note("", 16)
	_pile_note.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	middle.add_child(_pile_note)

	_turn_label = _note("", 21, PAPER)
	_turn_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	middle.add_child(_turn_label)
	root.add_child(middle)

	# Knoepfe und eigene Hand
	_controls_box = HBoxContainer.new()
	_controls_box.alignment = BoxContainer.ALIGNMENT_CENTER
	_controls_box.add_theme_constant_override("separation", 10)
	var controls_margin := MarginContainer.new()
	for side in ["margin_left", "margin_right", "margin_top", "margin_bottom"]:
		controls_margin.add_theme_constant_override(side, 8)
	controls_margin.add_child(_controls_box)
	root.add_child(controls_margin)

	var hand_scroll := ScrollContainer.new()
	hand_scroll.custom_minimum_size = Vector2(0, 220)
	hand_scroll.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_hand_box = HBoxContainer.new()
	_hand_box.add_theme_constant_override("separation", 6)
	hand_scroll.add_child(_hand_box)
	root.add_child(hand_scroll)


func refresh() -> void:
	if _hand_box == null or not is_instance_valid(_hand_box):
		return
	var view := _view()
	if view.is_empty():
		return

	var seat := int(view.get("you", -1))
	var actor := _actor()
	var my_turn := seat >= 0 and actor == seat and not handoff_pending

	var target: int = int(view["options"].get("targetScore", 500))
	_title_label.text = "Runde %d%s" % [view["round"], "" if target == 0 else " - bis %d" % target]

	_fill_opponents(view, seat, actor)
	_fill_board(view, my_turn)
	_fill_hand(view, seat, my_turn)
	_fill_controls(view, seat, my_turn)

	# Farbwunsch, Anzweifeln, Weitergeben und Rundenende als Einblendung.
	if handoff_pending:
		_show_handoff()
	elif view["phase"] == "color" and my_turn:
		_ask_color(func(color: String) -> void: _send({"type": "color", "color": color}))
	elif view["phase"] == "challenge" and view.get("pendingWild4") != null \
			and int(view["pendingWild4"]["target"]) == seat:
		_ask_challenge(view)
	elif view["phase"] == "round-over" or view["phase"] == "game-over":
		_show_round_end(view)


func _fill_opponents(view: Dictionary, seat: int, actor: int) -> void:
	_clear_children(_opponent_box)
	var players: Array = view["players"]
	var n := players.size()
	var direction := int(view.get("direction", 1))
	for step in range(1, n + 1):
		var i := ((seat if seat >= 0 else 0) + step * direction + n * n) % n
		if i == seat:
			continue
		var p: Dictionary = players[i]
		var card_box := VBoxContainer.new()
		card_box.custom_minimum_size = Vector2(150, 0)
		card_box.add_theme_constant_override("separation", 2)
		var who := _note("%s%s" % [p["name"], "  (Bot)" if p["isBot"] else ""], 17,
			YELLOW if i == actor else PAPER)
		who.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		card_box.add_child(who)
		var count := _note("%d Karten%s" % [p["count"], "" if int(view["options"]["targetScore"]) == 0 else " - %d P" % p["score"]], 15)
		count.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		card_box.add_child(count)
		if p["count"] == 1 and p["saidUno"]:
			var uno := _note("UNO!", 15, RED)
			uno.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			card_box.add_child(uno)
		if view.get("unoVulnerable") != null and int(view["unoVulnerable"]) == i and seat >= 0 and seat != i:
			var catch_button := _button("Erwischt!", func() -> void: _send({"type": "catch", "target": i}), "danger")
			catch_button.custom_minimum_size = Vector2(0, 36)
			catch_button.add_theme_font_size_override("font_size", 15)
			card_box.add_child(catch_button)
		_opponent_box.add_child(_panel(card_box))


func _fill_board(view: Dictionary, my_turn: bool) -> void:
	var top = view.get("top")
	if top != null and not (top as Dictionary).is_empty():
		_discard_card.card = top
	_draw_card.clickable = my_turn and view["phase"] == "play"
	_draw_card.dimmed = not _draw_card.clickable
	_pile_note.text = "%d im Stapel" % int(view.get("drawPileCount", 0))

	_clear_children(_color_dots)
	for color in UnoEngine.COLORS:
		var dot := ColorRect.new()
		var active: bool = view.get("activeColor") == color
		dot.color = CardView.CARD_COLORS[color]
		dot.custom_minimum_size = Vector2(26, 26) if active else Vector2(16, 16)
		if not active:
			dot.color = dot.color.darkened(0.45)
		_color_dots.add_child(dot)

	var actor := _actor()
	var text := ""
	if handoff_pending:
		text = "Weitergeben ..."
	elif view["phase"] == "round-over":
		text = "Runde vorbei."
	elif view["phase"] == "game-over":
		text = "Partie vorbei."
	elif actor < 0:
		text = ""
	elif my_turn and view["phase"] == "drawn":
		text = "Gezogene Karte legen - oder passen."
	elif my_turn:
		text = "Du bist dran."
	else:
		text = "%s ist dran ..." % view["players"][actor]["name"]
	_turn_label.text = text
	_turn_label.add_theme_color_override("font_color", YELLOW if my_turn else PAPER)


func _fill_hand(view: Dictionary, seat: int, my_turn: bool) -> void:
	_clear_children(_hand_box)
	if seat < 0 or handoff_pending:
		var hidden := _note("Die Karten sind verdeckt.", 18)
		_hand_box.add_child(hidden)
		return
	var hand = view["players"][seat].get("hand")
	if hand == null:
		return
	var playable_ids := _playable_ids(view, hand, my_turn)
	for card in hand:
		var node := CardView.new()
		node.custom_minimum_size = Vector2(118, 177)
		node.card = card
		node.playable = playable_ids.has(card["id"])
		node.dimmed = my_turn and not node.playable
		node.pressed.connect(_on_card_pressed)
		_hand_box.add_child(node)


## Spielbarkeit nur für die Anzeige - die letzte Pruefung macht das Regelwerk.
func _playable_ids(view: Dictionary, hand: Array, my_turn: bool) -> Array:
	if not my_turn or (view["phase"] != "play" and view["phase"] != "drawn"):
		return []
	var out: Array = []
	var top = view.get("top")
	for card in hand:
		if view["phase"] == "drawn" and card["id"] != view.get("drawnCardId"):
			continue
		if card["color"] == "wild" or card["color"] == view.get("activeColor"):
			out.append(card["id"])
		elif top != null and top["color"] != "wild" and card["kind"] == top["kind"]:
			out.append(card["id"])
	return out


func _on_card_pressed(card: Dictionary) -> void:
	var view := _view()
	var seat := int(view.get("you", -1))
	if seat < 0 or _actor() != seat or handoff_pending:
		_toast("Du bist nicht dran.")
		return
	if card["color"] == "wild":
		_ask_color(func(color: String) -> void:
			var action := {"type": "play", "cardId": card["id"], "color": color}
			if uno_armed:
				action["sayUno"] = true
			uno_armed = false
			_send(action))
		return
	var action := {"type": "play", "cardId": card["id"]}
	if uno_armed:
		action["sayUno"] = true
	uno_armed = false
	_send(action)


func _fill_controls(view: Dictionary, seat: int, my_turn: bool) -> void:
	_clear_children(_controls_box)
	if my_turn and view["phase"] == "play":
		_controls_box.add_child(_button("Karte ziehen", func() -> void: _send({"type": "draw"}), "ghost"))
	if my_turn and view["phase"] == "drawn":
		_controls_box.add_child(_button("Passen", func() -> void: _send({"type": "pass"}), "ghost"))
	if seat >= 0 and not handoff_pending:
		var count: int = view["players"][seat]["count"]
		if count > 0 and count <= 2:
			_controls_box.add_child(_button("UNO!" if not uno_armed else "UNO! angesagt", func() -> void:
				uno_armed = true
				_send({"type": "uno"})
				refresh(), "danger"))


# ---------------------------------------------------------------- Einblendungen

func _close_overlay() -> void:
	if _overlay != null and is_instance_valid(_overlay):
		_overlay.queue_free()
	_overlay = null


func _overlay_root() -> VBoxContainer:
	_close_overlay()
	var shade := ColorRect.new()
	shade.color = Color(0.02, 0.05, 0.03, 0.86)
	shade.set_anchors_preset(Control.PRESET_FULL_RECT)
	shade.mouse_filter = Control.MOUSE_FILTER_STOP
	add_child(shade)
	_overlay = shade

	var margin := MarginContainer.new()
	margin.set_anchors_preset(Control.PRESET_FULL_RECT)
	for side in ["margin_left", "margin_right", "margin_top", "margin_bottom"]:
		margin.add_theme_constant_override(side, 30)
	shade.add_child(margin)

	var box := VBoxContainer.new()
	box.alignment = BoxContainer.ALIGNMENT_CENTER
	box.add_theme_constant_override("separation", 12)
	margin.add_child(box)
	return box


func _show_overlay(title: String, text: String, buttons: Array) -> void:
	var box := _overlay_root()
	box.add_child(_title(title, 28))
	if not text.is_empty():
		var scroll := ScrollContainer.new()
		scroll.custom_minimum_size = Vector2(0, 260)
		var label := _note(text, 17)
		label.custom_minimum_size = Vector2(600, 0)
		scroll.add_child(label)
		box.add_child(scroll)
	for entry in buttons:
		box.add_child(_button(entry["text"], entry["action"], entry.get("kind", "normal")))


func _ask_color(on_pick: Callable) -> void:
	var box := _overlay_root()
	box.add_child(_title("Farbe wuenschen", 28))
	var grid := GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 12)
	grid.add_theme_constant_override("v_separation", 12)
	for color in UnoEngine.COLORS:
		var button := Button.new()
		button.text = UnoEngine.COLOR_NAMES[color]
		button.custom_minimum_size = Vector2(180, 90)
		button.add_theme_font_size_override("font_size", 22)
		var style := StyleBoxFlat.new()
		style.bg_color = CardView.CARD_COLORS[color]
		style.set_corner_radius_all(14)
		button.add_theme_stylebox_override("normal", style)
		button.add_theme_stylebox_override("hover", style)
		button.add_theme_stylebox_override("pressed", style)
		button.add_theme_color_override("font_color", Color.WHITE)
		button.pressed.connect(func() -> void:
			_close_overlay()
			on_pick.call(color))
		grid.add_child(button)
	box.add_child(grid)


func _ask_challenge(view: Dictionary) -> void:
	var by: Dictionary = view["players"][int(view["pendingWild4"]["by"])]
	var box := _overlay_root()
	box.add_child(_title("Zieh Vier anzweifeln?", 28))
	box.add_child(_note(
		"%s legt Zieh Vier und wünscht %s. Erlaubt ist das nur ohne passende Farbe auf der Hand." % [
			by["name"], UnoEngine.COLOR_NAMES.get(view.get("activeColor", ""), "-")], 18))
	box.add_child(_button("Annehmen (4 ziehen)", func() -> void:
		_close_overlay()
		_send({"type": "challenge", "challenge": false})))
	box.add_child(_button("Anzweifeln", func() -> void:
		_close_overlay()
		_send({"type": "challenge", "challenge": true}), "danger"))
	box.add_child(_note("Zu Recht angezweifelt zieht die andere Person 4 - zu Unrecht ziehst du 6 und setzt aus.", 15))


func _show_handoff() -> void:
	var seat := _seat()
	if seat < 0 or engine == null:
		return
	var name: String = engine.state["players"][seat]["name"]
	var box := _overlay_root()
	box.add_child(_title(name, 32))
	box.add_child(_note("Gib das Gerät an %s weiter." % name, 19))
	box.add_child(_button("Ich bin dran", func() -> void:
		handoff_pending = false
		shown_seat = seat
		_close_overlay()
		refresh(), "primary"))


func _show_round_end(view: Dictionary) -> void:
	var over: bool = view["phase"] == "game-over"
	var last = view.get("lastRound")
	var lines := ""
	if last != null:
		lines += "%s ist alle Karten los und bekommt %d Punkte.\n\n" % [last["winnerName"], last["points"]]
	for p in view["players"]:
		lines += "%s: %d Punkte (%d Karten)\n" % [p["name"], p["score"], p["count"]]

	var box := _overlay_root()
	box.add_child(_title("Partie vorbei!" if over else "Runde vorbei", 30))
	box.add_child(_note(lines, 19))
	if over:
		box.add_child(_button("Zum Menü", show_menu, "primary"))
	else:
		box.add_child(_button("Nächste Runde", func() -> void:
			_close_overlay()
			if mode == "online":
				net.play({"type": "next-round"})
			else:
				engine.apply_action(0, {"type": "next-round"})
				shown_seat = -1
				handoff_pending = mode == "pass"
				refresh()
				_schedule_bot(), "primary"))
		box.add_child(_button("Zum Menü", show_menu, "ghost"))


func _show_log() -> void:
	var view := _view()
	var text := ""
	var entries: Array = view.get("log", [])
	for i in range(entries.size() - 1, -1, -1):
		text += "%s\n" % entries[i]["text"]
	_show_overlay("Verlauf", text, [{"text": "Schließen", "kind": "primary", "action": _close_overlay}])


func _toast(message: String) -> void:
	if message.is_empty():
		return
	var label := _note(message, 18, PAPER)
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	var panel := _panel(label)
	panel.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	panel.position = Vector2(size.x / 2.0 - 200, size.y - 150)
	panel.custom_minimum_size = Vector2(400, 0)
	panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(panel)
	var timer := get_tree().create_timer(2.2)
	timer.timeout.connect(func() -> void:
		if is_instance_valid(panel):
			panel.queue_free())
