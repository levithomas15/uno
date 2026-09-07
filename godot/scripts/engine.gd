class_name UnoEngine
extends RefCounted

## UNO nach den Originalregeln.
##
## Der ganze Spielstand steckt in einem Dictionary. Die Sicht, die diese
## Klasse ausgibt (view_for), hat genau den Aufbau, den auch der Web-Server
## schickt - so zeigt der Tisch lokale und Online-Partien mit demselben Code.

const COLORS := ["red", "yellow", "green", "blue"]

const COLOR_NAMES := {
	"red": "Rot",
	"yellow": "Gelb",
	"green": "Grün",
	"blue": "Blau",
}

const KIND_NAMES := {
	"skip": "Aussetzen",
	"reverse": "Retour",
	"draw2": "Zieh Zwei",
	"wild": "Farbwunsch",
	"wild4": "Zieh Vier",
}

const DEFAULT_OPTIONS := {
	"targetScore": 500,
	"stacking": false,
	"drawUntilPlayable": false,
	"challenge": true,
	"unoPenalty": 2,
}

var state: Dictionary = {}
var _rng := RandomNumberGenerator.new()


## Das Original-Deck: 108 Karten.
## Je Farbe eine 0, je zwei 1-9, zwei Aussetzen, zwei Retour, zwei Zieh-Zwei
## (25 pro Farbe), dazu vier Farbwünsche und vier Zieh-Vier.
static func create_deck() -> Array:
	var cards: Array = []
	var n := 0
	for color in COLORS:
		cards.append({"id": "c%d" % n, "color": color, "kind": "0"})
		n += 1
		for v in range(1, 10):
			for _copy in 2:
				cards.append({"id": "c%d" % n, "color": color, "kind": str(v)})
				n += 1
		for kind in ["skip", "reverse", "draw2"]:
			for _copy in 2:
				cards.append({"id": "c%d" % n, "color": color, "kind": kind})
				n += 1
	for _i in 4:
		cards.append({"id": "c%d" % n, "color": "wild", "kind": "wild"})
		n += 1
	for _i in 4:
		cards.append({"id": "c%d" % n, "color": "wild", "kind": "wild4"})
		n += 1
	return cards


static func is_wild(card: Dictionary) -> bool:
	return card.get("color", "") == "wild"


static func is_number(card: Dictionary) -> bool:
	return String(card.get("kind", "")).is_valid_int()


## Punktwerte der Originalregeln: Zahlen ihren Wert, Aktionskarten 20,
## Farbwunsch und Zieh-Vier 50.
static func card_points(card: Dictionary) -> int:
	if is_number(card):
		return int(card["kind"])
	if card["kind"] == "wild" or card["kind"] == "wild4":
		return 50
	return 20


static func hand_points(hand: Array) -> int:
	var sum := 0
	for card in hand:
		sum += card_points(card)
	return sum


static func card_label(card: Dictionary) -> String:
	var kind: String = KIND_NAMES.get(card["kind"], String(card["kind"]))
	if is_wild(card):
		return kind
	return "%s %s" % [COLOR_NAMES[card["color"]], kind]


func create_game(players: Array, options: Dictionary = {}, seed_value: int = 0) -> Dictionary:
	assert(players.size() >= 2 and players.size() <= 10, "UNO wird zu 2 bis 10 gespielt.")
	if seed_value == 0:
		seed_value = randi()
	_rng.seed = seed_value

	var merged := DEFAULT_OPTIONS.duplicate(true)
	for key in options:
		merged[key] = options[key]

	var seats: Array = []
	for i in players.size():
		var p: Dictionary = players[i]
		seats.append({
			"id": p.get("id", "p%d" % i),
			"name": p.get("name", "Spieler %d" % (i + 1)),
			"isBot": p.get("isBot", false),
			"botLevel": p.get("botLevel", "normal"),
			"hand": [],
			"score": 0,
			"saidUno": false,
			"connected": true,
		})

	state = {
		"seed": seed_value,
		"options": merged,
		"players": seats,
		"round": 0,
		"dealer": 0,
		"drawPile": [],
		"discard": [],
		"activeColor": null,
		"current": 0,
		"direction": 1,
		"pendingDraw": 0,
		"drawnCard": null,
		"phase": "play",
		"unoVulnerable": null,
		"pendingWild4": null,
		"winner": null,
		"lastRound": null,
		"log": [],
	}
	start_round()
	return state


func log_line(text: String) -> void:
	state["log"].append({"n": state["log"].size(), "text": text})
	if state["log"].size() > 200:
		state["log"] = state["log"].slice(state["log"].size() - 200)


func _shuffle(cards: Array) -> Array:
	for i in range(cards.size() - 1, 0, -1):
		var j := _rng.randi_range(0, i)
		var tmp = cards[i]
		cards[i] = cards[j]
		cards[j] = tmp
	return cards


func start_round() -> void:
	state["round"] += 1
	state["drawPile"] = _shuffle(create_deck())
	state["discard"] = []
	state["pendingDraw"] = 0
	state["drawnCard"] = null
	state["pendingWild4"] = null
	state["unoVulnerable"] = null
	state["direction"] = 1
	state["winner"] = null
	state["phase"] = "play"

	for p in state["players"]:
		p["hand"] = []
		p["saidUno"] = false
	for _round in 7:
		for p in state["players"]:
			p["hand"].append(state["drawPile"].pop_back())

	if state["round"] > 1:
		state["dealer"] = (state["dealer"] + 1) % state["players"].size()
	state["current"] = (state["dealer"] + 1) % state["players"].size()

	# Startkarte aufdecken. Eine Zieh-Vier wandert zurück ins Deck.
	var start: Dictionary = state["drawPile"].pop_back()
	while start["kind"] == "wild4":
		state["drawPile"].insert(_rng.randi_range(0, state["drawPile"].size()), start)
		start = state["drawPile"].pop_back()
	state["discard"].append(start)
	state["activeColor"] = null if is_wild(start) else start["color"]
	log_line("Runde %d - Startkarte: %s." % [state["round"], card_label(start)])
	_apply_start_card(start)


## Wirkung der aufgedeckten Startkarte, nach den Originalregeln.
func _apply_start_card(card: Dictionary) -> void:
	var two: bool = state["players"].size() == 2
	match card["kind"]:
		"skip":
			log_line("%s setzt aus." % current_player()["name"])
			_advance()
		"reverse":
			if two:
				# Zu zweit wirkt Retour wie Aussetzen: der Geber beginnt.
				state["current"] = state["dealer"]
				log_line("Retour: der Geber beginnt.")
			else:
				state["direction"] = -1
				var n: int = state["players"].size()
				state["current"] = (state["dealer"] - 1 + n) % n
				log_line("Retour: die Richtung dreht sich.")
		"draw2":
			var victim: String = current_player()["name"]
			draw_cards(state["current"], 2)
			log_line("%s zieht 2 und setzt aus." % victim)
			_advance()
		"wild":
			# Wer beginnt, wählt die Farbe.
			state["phase"] = "color"
			log_line("%s wählt die Startfarbe." % current_player()["name"])
		_:
			pass


func current_player() -> Dictionary:
	return state["players"][state["current"]]


func top_card() -> Dictionary:
	if state["discard"].is_empty():
		return {}
	return state["discard"][state["discard"].size() - 1]


func next_index(from: int = -1, steps: int = 1) -> int:
	if from < 0:
		from = state["current"]
	var n: int = state["players"].size()
	return ((from + state["direction"] * steps) % n + n) % n


func _advance(steps: int = 1) -> void:
	state["current"] = next_index(state["current"], steps)


## Passt die Karte auf den Ablagestapel?
func is_playable(card: Dictionary) -> bool:
	if state["phase"] == "drawn" and state["drawnCard"] != null:
		if card["id"] != state["drawnCard"]["id"]:
			return false
	var top := top_card()

	# Bei aktiver Stapel-Hausregel darf nur eine gleichwertige Karte folgen.
	if state["pendingDraw"] > 0:
		if top["kind"] == "draw2":
			return card["kind"] == "draw2" or card["kind"] == "wild4"
		if top["kind"] == "wild4":
			return card["kind"] == "wild4"

	if card["kind"] == "wild":
		return true
	if card["kind"] == "wild4":
		return true if state["options"]["challenge"] else not has_active_color(state["current"])
	if card["color"] == state["activeColor"]:
		return true
	return not is_wild(top) and card["kind"] == top["kind"]


## Haelt die Person eine Karte in der aktiven Farbe? Entscheidet darueber,
## ob eine Zieh-Vier regelkonform war.
func has_active_color(player_idx: int) -> bool:
	for card in state["players"][player_idx]["hand"]:
		if card["color"] == state["activeColor"]:
			return true
	return false


func playable_cards(player_idx: int) -> Array:
	if player_idx != state["current"]:
		return []
	if state["phase"] != "play" and state["phase"] != "drawn":
		return []
	var out: Array = []
	for card in state["players"][player_idx]["hand"]:
		if is_playable(card):
			out.append(card)
	return out


func _refill_draw_pile() -> bool:
	if not state["drawPile"].is_empty():
		return true
	if state["discard"].size() <= 1:
		return false
	var top = state["discard"].pop_back()
	var rest: Array = state["discard"]
	for card in rest:
		# Gewünschte Farben werden beim Zurückmischen wieder neutral.
		if card["kind"] == "wild" or card["kind"] == "wild4":
			card["color"] = "wild"
	state["drawPile"] = _shuffle(rest)
	state["discard"] = [top]
	log_line("Der Ablagestapel wird neu gemischt.")
	return not state["drawPile"].is_empty()


func draw_cards(player_idx: int, count: int) -> Array:
	var player: Dictionary = state["players"][player_idx]
	var drawn: Array = []
	for _i in count:
		if not _refill_draw_pile():
			break
		drawn.append(state["drawPile"].pop_back())
	for card in drawn:
		player["hand"].append(card)
	if player["hand"].size() > 1:
		player["saidUno"] = false
	if state["unoVulnerable"] == player_idx:
		state["unoVulnerable"] = null
	return drawn


## Alle Zuege laufen ueber diese eine Funktion.
## Rueckgabe: {"ok": true} oder {"ok": false, "error": "Text"}.
func apply_action(player_idx: int, action: Dictionary) -> Dictionary:
	if state["phase"] == "game-over":
		return _fail("Die Partie ist beendet.")
	if player_idx < 0 or player_idx >= state["players"].size():
		return _fail("Unbekannte Person.")

	# Das Zeitfenster fuers Erwischen endet, sobald die betroffene Person
	# wieder selbst am Zug ist.
	var t: String = action.get("type", "")
	if state["unoVulnerable"] == player_idx and (t == "play" or t == "draw"):
		state["unoVulnerable"] = null

	match t:
		"uno":
			return _act_uno(player_idx)
		"catch":
			return _act_catch(player_idx, action)
		"color":
			return _act_color(player_idx, action)
		"challenge":
			return _act_challenge(player_idx, action)
		"play":
			return _act_play(player_idx, action)
		"draw":
			return _act_draw(player_idx)
		"pass":
			return _act_pass(player_idx)
		"next-round":
			return _act_next_round()
		_:
			return _fail("Unbekannter Zug.")


func _fail(error: String) -> Dictionary:
	return {"ok": false, "error": error}


func _ok() -> Dictionary:
	return {"ok": true}


func _act_uno(player_idx: int) -> Dictionary:
	var player: Dictionary = state["players"][player_idx]
	if player["hand"].size() > 2:
		return _fail("Dafür hast du noch zu viele Karten.")
	player["saidUno"] = true
	if state["unoVulnerable"] == player_idx:
		state["unoVulnerable"] = null
	log_line("%s: UNO!" % player["name"])
	return _ok()


func _act_catch(player_idx: int, action: Dictionary) -> Dictionary:
	var target = action.get("target", null)
	if state["unoVulnerable"] == null or state["unoVulnerable"] != target:
		return _fail("Da gibt es nichts zu erwischen.")
	if target == player_idx:
		return _fail("Sich selbst erwischt man nicht.")
	var victim: Dictionary = state["players"][target]
	draw_cards(target, state["options"]["unoPenalty"])
	state["unoVulnerable"] = null
	log_line("%s erwischt %s - %d Strafkarten." % [
		state["players"][player_idx]["name"], victim["name"], state["options"]["unoPenalty"]])
	return _ok()


func _act_color(player_idx: int, action: Dictionary) -> Dictionary:
	if state["phase"] != "color":
		return _fail("Gerade ist keine Farbe zu wählen.")
	if player_idx != state["current"]:
		return _fail("Du bist nicht dran.")
	var color = action.get("color", "")
	if not COLORS.has(color):
		return _fail("Diese Farbe gibt es nicht.")

	state["activeColor"] = color
	log_line("%s wählt %s." % [state["players"][player_idx]["name"], COLOR_NAMES[color]])

	var top := top_card()
	if top["kind"] == "wild" and state["discard"].size() == 1:
		# Farbwahl zur Startkarte: die begonnene Person spielt normal weiter.
		state["phase"] = "play"
		return _ok()
	top["color"] = color
	state["phase"] = "play"
	return _finish_turn(top)


func _act_challenge(player_idx: int, action: Dictionary) -> Dictionary:
	if state["phase"] != "challenge":
		return _fail("Gerade ist nichts anzuzweifeln.")
	var pending = state["pendingWild4"]
	if pending == null or pending["target"] != player_idx:
		return _fail("Du bist nicht gefragt.")

	var offender: Dictionary = state["players"][pending["by"]]
	var challenger: Dictionary = state["players"][player_idx]

	if not action.get("challenge", false):
		draw_cards(player_idx, 4)
		log_line("%s akzeptiert und zieht 4." % challenger["name"])
		state["pendingWild4"] = null
		state["phase"] = "play"
		state["current"] = player_idx  # Wer zieht, setzt aus.
		_advance()
		return _end_turn_checks()

	if pending["legal"] == false:
		draw_cards(pending["by"], 4)
		log_line("Angezweifelt und erwischt: %s zieht 4, %s bleibt dran." % [offender["name"], challenger["name"]])
		state["pendingWild4"] = null
		state["phase"] = "play"
		state["current"] = player_idx  # Der Zug bleibt beim Anzweifelnden.
		return _end_turn_checks()

	draw_cards(player_idx, 6)
	log_line("Zu Unrecht angezweifelt: %s zieht 6 und setzt aus." % challenger["name"])
	state["pendingWild4"] = null
	state["phase"] = "play"
	state["current"] = player_idx
	_advance()
	return _end_turn_checks()


func _act_play(player_idx: int, action: Dictionary) -> Dictionary:
	if state["phase"] != "play" and state["phase"] != "drawn":
		return _fail("Gerade bist du nicht am Zug.")
	if player_idx != state["current"]:
		return _fail("Du bist nicht dran.")

	var player: Dictionary = state["players"][player_idx]
	var idx := -1
	for i in player["hand"].size():
		if player["hand"][i]["id"] == action.get("cardId", ""):
			idx = i
			break
	if idx == -1:
		return _fail("Diese Karte hast du nicht.")
	var card: Dictionary = player["hand"][idx]
	if not is_playable(card):
		return _fail("Diese Karte passt nicht.")

	var wild4_legal = null
	if card["kind"] == "wild4":
		wild4_legal = not has_active_color(player_idx)

	player["hand"].remove_at(idx)
	state["drawnCard"] = null
	state["discard"].append(card)
	log_line("%s legt %s." % [player["name"], card_label(card)])

	if action.get("sayUno", false) and player["hand"].size() == 1:
		player["saidUno"] = true
		log_line("%s: UNO!" % player["name"])

	if is_wild(card):
		state["activeColor"] = null
		if card["kind"] == "wild4":
			state["pendingWild4"] = {"by": player_idx, "legal": wild4_legal, "target": null}
		var color = action.get("color", null)
		if color != null and COLORS.has(color):
			state["activeColor"] = color
			card["color"] = color
			log_line("Farbe: %s." % COLOR_NAMES[color])
			return _finish_turn(card)
		state["phase"] = "color"
		return _ok()

	state["activeColor"] = card["color"]
	return _finish_turn(card)


## Wirkung der gelegten Karte, danach ist die nächste Person dran.
func _finish_turn(card: Dictionary) -> Dictionary:
	var player := current_player()
	var two: bool = state["players"].size() == 2

	if player["hand"].is_empty():
		return _end_round(state["current"])

	if player["hand"].size() == 1 and not player["saidUno"]:
		state["unoVulnerable"] = state["current"]
	elif player["hand"].size() > 1:
		player["saidUno"] = false

	match card["kind"]:
		"skip":
			log_line("%s setzt aus." % state["players"][next_index()]["name"])
			_advance(2)
		"reverse":
			if two:
				log_line("Retour - zu zweit wie Aussetzen.")
			else:
				state["direction"] *= -1
				log_line("Die Richtung dreht sich.")
				_advance()
		"draw2":
			if state["options"]["stacking"]:
				state["pendingDraw"] += 2
				_advance()
				return _resolve_stack()
			var victim := next_index()
			draw_cards(victim, 2)
			log_line("%s zieht 2 und setzt aus." % state["players"][victim]["name"])
			_advance(2)
		"wild4":
			if state["options"]["stacking"]:
				state["pendingDraw"] += 4
				_advance()
				return _resolve_stack()
			var target := next_index()
			if state["options"]["challenge"]:
				state["pendingWild4"]["target"] = target
				state["phase"] = "challenge"
				log_line("%s darf anzweifeln." % state["players"][target]["name"])
				return _ok()
			draw_cards(target, 4)
			log_line("%s zieht 4 und setzt aus." % state["players"][target]["name"])
			state["pendingWild4"] = null
			_advance(2)
		_:
			_advance()
	return _end_turn_checks()


## Hausregel "weiterreichen": wer nicht nachlegen kann, zieht den Stapel.
func _resolve_stack() -> Dictionary:
	var idx: int = state["current"]
	var can_answer := false
	for card in state["players"][idx]["hand"]:
		if is_playable(card):
			can_answer = true
			break
	if can_answer:
		log_line("%s kann weiterreichen (%d liegen an)." % [state["players"][idx]["name"], state["pendingDraw"]])
		return _end_turn_checks()
	draw_cards(idx, state["pendingDraw"])
	log_line("%s zieht %d und setzt aus." % [state["players"][idx]["name"], state["pendingDraw"]])
	state["pendingDraw"] = 0
	state["pendingWild4"] = null
	_advance()
	return _end_turn_checks()


func _act_draw(player_idx: int) -> Dictionary:
	if state["phase"] != "play":
		return _fail("Gerade kannst du nicht ziehen.")
	if player_idx != state["current"]:
		return _fail("Du bist nicht dran.")

	if state["options"]["drawUntilPlayable"]:
		var drawn = null
		var guard := 0
		while guard < 60:
			var cards := draw_cards(player_idx, 1)
			if cards.is_empty():
				break
			drawn = cards[0]
			guard += 1
			if _is_playable_raw(drawn):
				break
		log_line("%s zieht, bis es passt (%d)." % [state["players"][player_idx]["name"], guard])
		if drawn != null and _is_playable_raw(drawn):
			state["drawnCard"] = drawn
			state["phase"] = "drawn"
			return _ok()
		_advance()
		return _end_turn_checks()

	var cards := draw_cards(player_idx, 1)
	if cards.is_empty():
		log_line("Keine Karten mehr im Stapel - der Zug geht weiter.")
		_advance()
		return _end_turn_checks()
	log_line("%s zieht eine Karte." % state["players"][player_idx]["name"])
	if not _is_playable_raw(cards[0]):
		# Nichts zu holen: der Zug endet sofort.
		_advance()
		return _end_turn_checks()
	state["drawnCard"] = cards[0]
	state["phase"] = "drawn"
	return _ok()


## Wie is_playable, aber ohne die Einschraenkung auf die gezogene Karte.
func _is_playable_raw(card: Dictionary) -> bool:
	var saved = state["drawnCard"]
	var saved_phase: String = state["phase"]
	state["drawnCard"] = null
	state["phase"] = "play"
	var result := is_playable(card)
	state["drawnCard"] = saved
	state["phase"] = saved_phase
	return result


func _act_pass(player_idx: int) -> Dictionary:
	if state["phase"] != "drawn":
		return _fail("Passen geht nur nach dem Ziehen.")
	if player_idx != state["current"]:
		return _fail("Du bist nicht dran.")
	state["drawnCard"] = null
	state["phase"] = "play"
	log_line("%s spielt die gezogene Karte nicht." % state["players"][player_idx]["name"])
	_advance()
	return _end_turn_checks()


func _end_turn_checks() -> Dictionary:
	state["drawnCard"] = null
	if state["phase"] == "drawn":
		state["phase"] = "play"
	return _ok()


func _end_round(winner_idx: int) -> Dictionary:
	var winner: Dictionary = state["players"][winner_idx]
	var points := 0
	var detail: Array = []
	for i in state["players"].size():
		if i == winner_idx:
			continue
		var p: Dictionary = state["players"][i]
		var pts := hand_points(p["hand"])
		points += pts
		detail.append({"id": p["id"], "name": p["name"], "cards": p["hand"].size(), "points": pts})
	winner["score"] += points
	state["lastRound"] = {
		"winner": winner["id"], "winnerName": winner["name"], "points": points, "detail": detail,
	}
	state["unoVulnerable"] = null
	state["pendingWild4"] = null
	state["drawnCard"] = null
	log_line("%s gewinnt die Runde und bekommt %d Punkte." % [winner["name"], points])

	var target: int = state["options"]["targetScore"]
	if target == 0 or winner["score"] >= target:
		state["phase"] = "game-over"
		state["winner"] = winner["id"]
		log_line("%s gewinnt die Partie mit %d Punkten." % [winner["name"], winner["score"]])
	else:
		state["phase"] = "round-over"
	return _ok()


func _act_next_round() -> Dictionary:
	if state["phase"] != "round-over":
		return _fail("Die Runde läuft noch.")
	start_round()
	return _ok()


## Was eine einzelne Person sehen darf: die eigene Hand, von den anderen
## nur die Kartenzahl. Gleicher Aufbau wie die Sicht vom Web-Server.
func view_for(player_idx: int) -> Dictionary:
	var players: Array = []
	for i in state["players"].size():
		var p: Dictionary = state["players"][i]
		players.append({
			"id": p["id"],
			"name": p["name"],
			"isBot": p["isBot"],
			"connected": p["connected"],
			"score": p["score"],
			"saidUno": p["saidUno"],
			"count": p["hand"].size(),
			"hand": p["hand"].duplicate(true) if i == player_idx else null,
		})
	var drawn_id = null
	if state["current"] == player_idx and state["drawnCard"] != null:
		drawn_id = state["drawnCard"]["id"]
	var pending = null
	if state["pendingWild4"] != null:
		pending = {"by": state["pendingWild4"]["by"], "target": state["pendingWild4"]["target"]}
	return {
		"round": state["round"],
		"phase": state["phase"],
		"options": state["options"],
		"you": player_idx,
		"current": state["current"],
		"direction": state["direction"],
		"activeColor": state["activeColor"],
		"top": top_card(),
		"drawPileCount": state["drawPile"].size(),
		"discardCount": state["discard"].size(),
		"pendingDraw": state["pendingDraw"],
		"drawnCardId": drawn_id,
		"unoVulnerable": state["unoVulnerable"],
		"pendingWild4": pending,
		"winner": state["winner"],
		"lastRound": state["lastRound"],
		"log": state["log"].slice(max(0, state["log"].size() - 40)),
		"players": players,
	}


## Wer ist jetzt gefragt? Beim Anzweifeln nicht die Person am Zug.
func actor_index() -> int:
	if state["phase"] == "challenge" and state["pendingWild4"] != null:
		return state["pendingWild4"]["target"]
	if state["phase"] == "round-over" or state["phase"] == "game-over":
		return -1
	return state["current"]
