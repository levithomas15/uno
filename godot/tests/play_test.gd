extends SceneTree

## Spielt eine ganze Partie durch die Oberfläche - so faellt auf, wenn
## Anzeige und Regelwerk auseinanderlaufen.

var errors: Array = []


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	var scene: Control = load("res://scenes/main.tscn").instantiate()
	get_root().add_child(scene)
	await process_frame

	scene._start_local([
		{"id": "me", "name": "Du", "isBot": false},
		{"id": "b1", "name": "Ada", "isBot": true, "botLevel": "normal"},
		{"id": "b2", "name": "Bruno", "isBot": true, "botLevel": "hard"},
	], "solo")
	scene.options["targetScore"] = 0
	scene.engine.state["options"]["targetScore"] = 0

	var steps := 0
	var my_moves := 0
	while scene.engine.state["phase"] != "game-over" and steps < 3000:
		steps += 1
		var seat: int = scene._seat()
		var actor: int = scene._actor()
		if scene.engine.state["phase"] == "round-over":
			scene.engine.apply_action(0, {"type": "next-round"})
			scene.refresh()
			continue
		if actor != seat:
			scene._on_bot_timer()      # der Bot zieht sofort statt nach einer Pause
			continue

		var view: Dictionary = scene._view()
		var phase: String = view["phase"]
		if phase == "color":
			scene._send({"type": "color", "color": "red"})
		elif phase == "challenge":
			scene._send({"type": "challenge", "challenge": false})
		else:
			var hand: Array = view["players"][seat]["hand"]
			var ids: Array = scene._playable_ids(view, hand, true)
			# Was die Anzeige als spielbar zeigt, muss das Regelwerk auch annehmen.
			for card in hand:
				var shown: bool = ids.has(card["id"])
				var allowed: bool = scene.engine.is_playable(card)
				if shown != allowed:
					errors.append("Anzeige und Regel uneinig: %s %s (Anzeige %s, Regel %s)" % [
						card["color"], card["kind"], shown, allowed])
			if ids.is_empty():
				scene._send({"type": "pass"} if phase == "drawn" else {"type": "draw"})
			else:
				var card: Dictionary = {}
				for c in hand:
					if c["id"] == ids[0]:
						card = c
				var action := {"type": "play", "cardId": card["id"]}
				if card["color"] == "wild":
					action["color"] = "blue"
				scene._send(action)
				my_moves += 1
		# Der Tisch muss nach jedem Zug so viele Karten zeigen, wie die Hand hat.
		var v2: Dictionary = scene._view()
		var s2: int = scene._seat()
		if s2 >= 0 and not scene.handoff_pending and v2["players"][s2]["hand"] != null:
			var shown_cards := 0
			for child in scene._hand_box.get_children():
				if child is CardView:
					shown_cards += 1
			if shown_cards != v2["players"][s2]["count"]:
				errors.append("Hand zeigt %d Karten, es sind %d" % [shown_cards, v2["players"][s2]["count"]])

	print("Zuege insgesamt: %d, davon eigene: %d" % [steps, my_moves])
	print("Endstand: %s" % scene.engine.state["phase"])
	if scene.engine.state["lastRound"] != null:
		print("Sieger: %s mit %d Punkten" % [
			scene.engine.state["lastRound"]["winnerName"], scene.engine.state["lastRound"]["points"]])
	if errors.is_empty():
		print("Keine Abweichungen zwischen Anzeige und Regelwerk.")
	else:
		for e in errors:
			print("FEHLER: %s" % e)
	quit(1 if not errors.is_empty() else 0)
