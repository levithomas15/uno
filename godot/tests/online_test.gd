extends SceneTree

## Verbindet sich mit dem mitgelieferten Server, eroeffnet einen Raum,
## holt einen Bot dazu und spielt ein paar Zuege.
##   node uno/server/server.js &   (PORT=8142)
##   xvfb-run -a godot --path godot --script res://tests/online_test.gd

var net: UnoNet
var view: Dictionary = {}
var lobby: Dictionary = {}
var started := false
var moves := 0


func _initialize() -> void:
	net = UnoNet.new()
	net.welcomed.connect(func(code: String, you: String) -> void:
		print("Willkommen im Raum %s als %s" % [code, you.substr(0, 6)]))
	net.lobby_changed.connect(func(l: Dictionary) -> void:
		lobby = l
		var names: Array = []
		for p in l.get("players", []):
			names.append("%s%s" % [p["name"], " (Bot)" if p["isBot"] else ""])
		print("Warteraum: %s" % ", ".join(names)))
	net.state_changed.connect(func(v: Dictionary) -> void:
		view = v
		if not started:
			print("Erste Sicht: Phase %s, %d Karten" % [v["phase"], v["players"][int(v["you"])]["count"]])
		started = true)
	net.failed.connect(func(m: String) -> void: print("FEHLER vom Server: %s" % m))
	net.closed.connect(func(m: String) -> void: print("Zu: %s" % m))
	net.connect_to_server("ws://127.0.0.1:8142/ws")
	net.create_room("Godot", {"targetScore": 0})
	call_deferred("_run")


func _run() -> void:
	# Auf den Warteraum warten
	var deadline := Time.get_ticks_msec() + 8000
	while Time.get_ticks_msec() < deadline:
		net.poll()
		await process_frame
		if not lobby.is_empty():
			break
	if lobby.is_empty():
		print("FEHLER: keine Verbindung zum Server")
		quit(1)
		return

	net.add_bot("hard")
	var wait_until := Time.get_ticks_msec() + 800
	while Time.get_ticks_msec() < wait_until:
		net.poll()
		await process_frame
	net.start_game()
	print("Start geschickt")

	# Nach Zeit warten, nicht nach Bildern: der Bot zieht mit Bedacht.
	var until := Time.get_ticks_msec() + 25000
	while Time.get_ticks_msec() < until:
		net.poll()
		await process_frame
		if started and not view.is_empty():
			var phase: String = view["phase"]
			if phase == "game-over" or phase == "round-over":
				break
			var seat: int = int(view["you"])
			var actor: int = seat
			if phase == "challenge" and view.get("pendingWild4") != null:
				actor = int(view["pendingWild4"]["target"])
			else:
				actor = int(view["current"])
			if actor != seat:
				continue
			var hand: Array = view["players"][seat]["hand"]
			if phase == "color":
				net.play({"type": "color", "color": "red"})
			elif phase == "challenge":
				net.play({"type": "challenge", "challenge": false})
			else:
				var playable: Array = []
				for card in hand:
					if phase == "drawn" and card["id"] != view.get("drawnCardId"):
						continue
					if card["color"] == "wild" or card["color"] == view.get("activeColor") \
							or (view["top"]["color"] != "wild" and card["kind"] == view["top"]["kind"]):
						playable.append(card)
				if playable.is_empty():
					net.play({"type": "pass"} if phase == "drawn" else {"type": "draw"})
				else:
					var action := {"type": "play", "cardId": playable[0]["id"]}
					if playable[0]["color"] == "wild":
						action["color"] = "green"
					net.play(action)
					moves += 1
			view = {}   # auf die naechste Sicht vom Server warten

	print("Eigene Zuege ueber den Server: %d" % moves)
	print("Kartenzahl der Gegenseite sichtbar, fremde Hand verdeckt: %s" %
		str(lobby.size() > 0))
	net.leave()
	quit(0)
