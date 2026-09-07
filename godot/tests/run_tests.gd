extends SceneTree

## Prueft das Regelwerk der Godot-Fassung.
##   godot --headless --path godot --script res://tests/run_tests.gd

var failures := 0
var checks := 0


func check(condition: bool, label: String) -> void:
	checks += 1
	if not condition:
		failures += 1
		print("  FEHLER: %s" % label)


func check_eq(actual, expected, label: String) -> void:
	checks += 1
	if actual != expected:
		failures += 1
		print("  FEHLER: %s (erwartet %s, war %s)" % [label, expected, actual])


func _initialize() -> void:
	test_deck()
	test_setup()
	test_playable()
	test_reverse_two_players()
	test_draw_two()
	test_uno_penalty()
	test_challenge()
	test_scoring()
	test_full_games()

	print("\n%d Pruefungen, %d Fehler" % [checks, failures])
	quit(1 if failures > 0 else 0)


func test_deck() -> void:
	print("Deck")
	var deck := UnoEngine.create_deck()
	check_eq(deck.size(), 108, "108 Karten")
	var per_color := {}
	var wilds := 0
	var wild4 := 0
	var points := 0
	for card in deck:
		points += UnoEngine.card_points(card)
		if card["color"] == "wild":
			if card["kind"] == "wild":
				wilds += 1
			else:
				wild4 += 1
		else:
			per_color[card["color"]] = per_color.get(card["color"], 0) + 1
	check_eq(wilds, 4, "vier Farbwuensche")
	check_eq(wild4, 4, "vier Zieh-Vier")
	for color in UnoEngine.COLORS:
		check_eq(per_color[color], 25, "25 Karten in %s" % color)
	check_eq(points, 1240, "Punktsumme des Decks")


func test_setup() -> void:
	print("Startaufstellung")
	var e := UnoEngine.new()
	e.create_game([{"name": "A"}, {"name": "B"}, {"name": "C"}], {}, 42)
	for p in e.state["players"]:
		check_eq(p["hand"].size(), 7, "7 Karten auf der Hand")
	check_eq(e.state["discard"].size(), 1, "eine offene Karte")
	check(e.top_card()["kind"] != "wild4", "Zieh-Vier ist nicht Startkarte")
	check_eq(e.state["drawPile"].size(), 108 - 21 - 1, "Rest im Nachziehstapel")


func test_playable() -> void:
	print("Passende Karten")
	var e := UnoEngine.new()
	e.create_game([{"name": "A"}, {"name": "B"}], {}, 5)
	for card in e.playable_cards(e.state["current"]):
		var matches: bool = card["color"] == e.state["activeColor"] \
			or card["color"] == "wild" \
			or card["kind"] == e.top_card()["kind"]
		check(matches, "nur passende Karten sind spielbar")
	# Wer nicht dran ist, darf nichts legen.
	var other: int = (e.state["current"] + 1) % 2
	var res := e.apply_action(other, {"type": "play", "cardId": e.state["players"][other]["hand"][0]["id"]})
	check_eq(res["ok"], false, "fremder Zug wird abgewiesen")


func test_reverse_two_players() -> void:
	print("Retour zu zweit")
	var e := UnoEngine.new()
	e.create_game([{"name": "A"}, {"name": "B"}], {}, 3)
	e.state["phase"] = "play"
	var me: int = e.state["current"]
	var color: String = e.state["activeColor"] if e.state["activeColor"] != null else "red"
	e.state["activeColor"] = color
	e.state["players"][me]["hand"].append({"id": "x1", "color": color, "kind": "reverse"})
	var res := e.apply_action(me, {"type": "play", "cardId": "x1"})
	check_eq(res["ok"], true, "Retour ist spielbar")
	check_eq(e.state["current"], me, "dieselbe Person ist erneut am Zug")


func test_draw_two() -> void:
	print("Zieh Zwei")
	var e := UnoEngine.new()
	e.create_game([{"name": "A"}, {"name": "B"}, {"name": "C"}], {}, 9)
	e.state["phase"] = "play"
	var me: int = e.state["current"]
	var victim: int = (me + 1) % 3
	var before: int = e.state["players"][victim]["hand"].size()
	var color: String = e.state["activeColor"] if e.state["activeColor"] != null else "red"
	e.state["activeColor"] = color
	e.state["direction"] = 1
	e.state["players"][me]["hand"].append({"id": "x2", "color": color, "kind": "draw2"})
	e.apply_action(me, {"type": "play", "cardId": "x2"})
	check_eq(e.state["players"][victim]["hand"].size(), before + 2, "zwei Strafkarten")
	check_eq(e.state["current"], (me + 2) % 3, "die betroffene Person setzt aus")


func test_uno_penalty() -> void:
	print("UNO-Ruf")
	var e := UnoEngine.new()
	e.create_game([{"name": "A"}, {"name": "B"}], {}, 21)
	e.state["phase"] = "play"
	var me: int = e.state["current"]
	var other: int = (me + 1) % 2
	var color := "red"
	e.state["activeColor"] = color
	e.state["discard"].append({"id": "top", "color": color, "kind": "3"})
	e.state["players"][me]["hand"] = [
		{"id": "y1", "color": color, "kind": "5"},
		{"id": "y2", "color": color, "kind": "9"},
	]
	e.apply_action(me, {"type": "play", "cardId": "y1"})
	check_eq(e.state["unoVulnerable"], me, "vergessenes UNO ist angreifbar")
	e.apply_action(other, {"type": "catch", "target": me})
	check_eq(e.state["players"][me]["hand"].size(), 3, "zwei Strafkarten")
	check_eq(e.state["unoVulnerable"], null, "danach ist nichts mehr zu holen")


func test_challenge() -> void:
	print("Zieh Vier anzweifeln")
	var e := UnoEngine.new()
	e.create_game([{"name": "A"}, {"name": "B"}], {}, 33)
	e.state["phase"] = "play"
	var me: int = e.state["current"]
	var other: int = (me + 1) % 2
	e.state["activeColor"] = "red"
	e.state["discard"].append({"id": "top", "color": "red", "kind": "3"})
	e.state["players"][me]["hand"] = [
		{"id": "w4", "color": "wild", "kind": "wild4"},
		{"id": "r7", "color": "red", "kind": "7"},   # passende Farbe -> unzulaessig
		{"id": "b2", "color": "blue", "kind": "2"},
	]
	e.apply_action(me, {"type": "play", "cardId": "w4", "color": "green"})
	check_eq(e.state["phase"], "challenge", "die naechste Person darf anzweifeln")
	e.apply_action(other, {"type": "challenge", "challenge": true})
	check_eq(e.state["players"][me]["hand"].size(), 6, "zu Recht angezweifelt: 4 Strafkarten")
	check_eq(e.state["current"], other, "die anzweifelnde Person bleibt am Zug")

	# Zu Unrecht angezweifelt kostet sechs Karten und den Zug.
	var f := UnoEngine.new()
	f.create_game([{"name": "A"}, {"name": "B"}], {}, 34)
	f.state["phase"] = "play"
	var m2: int = f.state["current"]
	var o2: int = (m2 + 1) % 2
	f.state["activeColor"] = "red"
	f.state["discard"].append({"id": "top", "color": "red", "kind": "3"})
	f.state["players"][m2]["hand"] = [
		{"id": "w4", "color": "wild", "kind": "wild4"},
		{"id": "b2", "color": "blue", "kind": "2"},
	]
	var before: int = f.state["players"][o2]["hand"].size()
	f.apply_action(m2, {"type": "play", "cardId": "w4", "color": "green"})
	f.apply_action(o2, {"type": "challenge", "challenge": true})
	check_eq(f.state["players"][o2]["hand"].size(), before + 6, "zu Unrecht: 6 Strafkarten")
	check_eq(f.state["current"], m2, "die anzweifelnde Person setzt aus")


func test_scoring() -> void:
	print("Punkte")
	var e := UnoEngine.new()
	e.create_game([{"name": "A"}, {"name": "B"}], {"targetScore": 500}, 55)
	e.state["phase"] = "play"
	var me: int = e.state["current"]
	var other: int = (me + 1) % 2
	var color := "red"
	e.state["activeColor"] = color
	e.state["discard"].append({"id": "top", "color": color, "kind": "3"})
	e.state["players"][me]["hand"] = [{"id": "z1", "color": color, "kind": "5"}]
	e.state["players"][other]["hand"] = [
		{"id": "z2", "color": "blue", "kind": "9"},
		{"id": "z3", "color": "wild", "kind": "wild4"},
	]
	e.apply_action(me, {"type": "play", "cardId": "z1"})
	check_eq(e.state["phase"], "round-over", "die Runde ist vorbei")
	check_eq(e.state["players"][me]["score"], 59, "9 + 50 Punkte")


## Ganze Partien nur mit Bots - faengt Haenger und verlorene Karten ab.
func test_full_games() -> void:
	print("Vollstaendige Bot-Partien")
	var rng := RandomNumberGenerator.new()
	for count in [2, 4, 7, 10]:
		for s in 6:
			var seed_value: int = 1000 * int(count) + int(s) + 1
			rng.seed = seed_value
			var players: Array = []
			for i in count:
				players.append({
					"name": "Bot %d" % (i + 1),
					"isBot": true,
					"botLevel": ["easy", "normal", "hard"][i % 3],
				})
			var e := UnoEngine.new()
			e.create_game(players, {"targetScore": 200}, seed_value)

			var steps := 0
			while e.state["phase"] != "game-over" and steps < 40000:
				steps += 1
				if e.state["phase"] == "round-over":
					e.apply_action(0, {"type": "next-round"})
					continue
				var actor := e.actor_index()
				var action := UnoBot.action_for(e, actor, rng)
				if action.is_empty():
					check(false, "Bot ohne Zug in Phase %s" % e.state["phase"])
					break
				var res := e.apply_action(actor, action)
				if not res["ok"]:
					check(false, "ungueltiger Botzug: %s" % res["error"])
					break
				if e.state["unoVulnerable"] != null:
					for i in e.state["players"].size():
						var c := UnoBot.catch_for(e, i, rng)
						if not c.is_empty():
							e.apply_action(i, c)
							break
				var total: int = e.state["drawPile"].size() + e.state["discard"].size()
				for p in e.state["players"]:
					total += p["hand"].size()
				if total != 108:
					check(false, "Karten verloren oder verdoppelt (%d)" % total)
					break
			check_eq(e.state["phase"], "game-over", "Partie zu %d endet (Seed %d)" % [count, seed_value])
