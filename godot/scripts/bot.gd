class_name UnoBot
extends RefCounted

## Computergegner in drei Stärken.
##
## "easy" spielt fast zufaellig, "normal" achtet auf Farben und hebt sich
## Wunschkarten auf, "hard" beachtet zusaetzlich, wer wenige Karten haelt,
## und zweifelt eine Zieh-Vier auch mal an.


static func color_counts(hand: Array) -> Dictionary:
	var counts := {"red": 0, "yellow": 0, "green": 0, "blue": 0}
	for card in hand:
		if card["color"] != "wild":
			counts[card["color"]] += 1
	return counts


## Die Farbe, in der die Hand am staerksten ist.
static func best_color(hand: Array, rng: RandomNumberGenerator) -> String:
	var counts := color_counts(hand)
	var best: String = UnoEngine.COLORS[0]
	for color in UnoEngine.COLORS:
		if counts[color] > counts[best]:
			best = color
	if counts[best] == 0:
		return UnoEngine.COLORS[rng.randi_range(0, 3)]
	return best


static func _score_card(engine: UnoEngine, me: Dictionary, card: Dictionary) -> float:
	var hand: Array = me["hand"]
	var counts := color_counts(hand)
	var next_count: int = engine.state["players"][engine.next_index()]["hand"].size()
	var score := 0.0

	if card["kind"] == "wild4":
		score -= 40.0          # teuer, nur als letzter Ausweg
	elif card["kind"] == "wild":
		score -= 18.0
	else:
		score += counts[card["color"]] * 2.0   # in der starken Farbe bleiben
		if UnoEngine.is_number(card):
			score += 4.0
		else:
			score += 10.0                      # Aktionskarten frueh loswerden

	# Gegen jemanden mit wenigen Karten helfen Aussetzen und Ziehen sofort.
	if next_count <= 2 and card["kind"] in ["skip", "reverse", "draw2", "wild4"]:
		score += 26.0
	if hand.size() <= 2:
		score += UnoEngine.card_points(card) / 4.0  # hohe Karten zuerst abwerfen
	return score


## Der Zug des Bots, als Aktion für apply_action.
static func action_for(engine: UnoEngine, player_idx: int, rng: RandomNumberGenerator) -> Dictionary:
	var me: Dictionary = engine.state["players"][player_idx]
	var level: String = me.get("botLevel", "normal")
	var phase: String = engine.state["phase"]

	if phase == "challenge":
		var pending = engine.state["pendingWild4"]
		if pending != null and pending["target"] == player_idx:
			var challenge := false
			if level == "hard":
				var offender: Dictionary = engine.state["players"][pending["by"]]
				challenge = offender["hand"].size() >= 4 and rng.randf() < 0.35
			elif level == "normal":
				challenge = rng.randf() < 0.12
			return {"type": "challenge", "challenge": challenge}

	if phase == "color":
		var color: String = UnoEngine.COLORS[rng.randi_range(0, 3)] if level == "easy" else best_color(me["hand"], rng)
		return {"type": "color", "color": color}

	if phase == "play" or phase == "drawn":
		var options := engine.playable_cards(player_idx)
		if options.is_empty():
			return {"type": "pass"} if phase == "drawn" else {"type": "draw"}

		var card: Dictionary
		if level == "easy":
			card = options[rng.randi_range(0, options.size() - 1)]
		else:
			# Zieh-Vier nur, wenn es nichts anderes gibt (und dann regelkonform).
			var cheap: Array = []
			for c in options:
				if c["kind"] != "wild4":
					cheap.append(c)
			var pool: Array = cheap if (not cheap.is_empty() and engine.has_active_color(player_idx)) else options
			card = pool[0]
			for c in pool:
				if _score_card(engine, me, c) > _score_card(engine, me, card):
					card = c

		var action := {"type": "play", "cardId": card["id"]}
		if card["color"] == "wild":
			var rest: Array = []
			for c in me["hand"]:
				if c["id"] != card["id"]:
					rest.append(c)
			action["color"] = UnoEngine.COLORS[rng.randi_range(0, 3)] if level == "easy" else best_color(rest, rng)
		# Wer gleich nur noch eine Karte hat, ruft UNO - auf "easy" gern zu spaet.
		if me["hand"].size() == 2:
			action["sayUno"] = (rng.randf() < 0.5) if level == "easy" else true
		return action

	return {}


## Erwischt der Bot jemanden, der "UNO!" vergessen hat?
static func catch_for(engine: UnoEngine, player_idx: int, rng: RandomNumberGenerator) -> Dictionary:
	var target = engine.state["unoVulnerable"]
	if target == null or target == player_idx:
		return {}
	var level: String = engine.state["players"][player_idx].get("botLevel", "normal")
	var chance := 0.6
	match level:
		"easy": chance = 0.25
		"hard": chance = 0.95
	if rng.randf() > chance:
		return {}
	return {"type": "catch", "target": target}
